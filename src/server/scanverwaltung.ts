/**
 * Verwaltung laufender Scans.
 *
 * Ein Scan dauert Minuten, auf schwacher Hardware laenger. Die Antwort auf
 * `POST /api/scan` darf darauf nicht warten. Deshalb: Scan anlegen, Kennung
 * zurueckgeben, im Hintergrund weiterarbeiten und den Fortschritt als
 * Ereignisstrom anbieten (ARCHITEKTUR 6).
 *
 * Die Ereignisse werden mitgeschrieben. Wer sich spaeter anmeldet — etwa weil
 * die Oberflaeche neu geladen wurde —, bekommt zuerst alles Bisherige und dann
 * den weiteren Verlauf. Ohne diesen Puffer entstuende eine Luecke zwischen
 * Start und Anmeldung.
 */

import type { Database } from 'better-sqlite3';

import type { Betriebsart, ScanErgebnis, SeitenErgebnis, Standard } from '../typen/index.js';
import { Katalog } from '../katalog/laden.js';
import { Protokoll, stillesProtokoll } from '../protokoll.js';
import { WERKZEUG_VERSION, fuehreScanAus } from '../scan/runner.js';
import { verdichte } from '../scan/statusableitung.js';
import {
  ergaenzeSeiten,
  ladeScan,
  legeScanAn,
  markiereGeschuetzt,
  schliesseScanAb,
  speichereSeitenErgebnis,
} from '../db/scan-speichern.js';
import { Browser } from '../scan/browser.js';
import { Anmeldung } from '../scan/anmeldung.js';
import { crawle } from '../scan/crawl.js';
import { OllamaAdapter } from '../stufe2/adapter/ollama.js';
import { datenbankSpeicher } from '../stufe2/cache.js';
import { erkenneHardware, schlageModellVor } from '../plattform/hardware.js';
import { lesAntwortenFuer } from '../stufe3/antworten.js';
import { wendeAntwortenAn } from '../stufe3/uebernahme.js';

export type ScanZustand = 'laeuft' | 'fertig' | 'abgebrochen' | 'fehler';

/** Ereignistypen nach ARCHITEKTUR 6. Nicht alle entstehen schon in Phase 2. */
export type EreignisArt =
  | 'seite-begonnen'
  | 'seite-fertig'
  | 'befund'
  | 'stufe-fertig'
  | 'fortschritt'
  | 'anmeldung-noetig'
  | 'sitzung-verloren'
  | 'fehler'
  | 'fertig';

export interface Ereignis {
  nummer: number;
  art: EreignisArt;
  daten: Record<string, unknown>;
}

/** Crawl-Vorgaben der Gesamtpruefung (K-08, K-09). */
export interface CrawlEingang {
  start: string;
  hoechsttiefe?: number | undefined;
  hoechstzahl?: number | undefined;
  einschluss?: string[] | undefined;
  ausschluss?: string[] | undefined;
  verzoegerungMs?: number | undefined;
  robotsBeachten?: boolean | undefined;
}

export interface ScanAuftragEingang {
  /** Bei der Gesamtpruefung leer — die Seiten entstehen erst im Crawl. */
  urls: string[];
  standard: Standard;
  betriebsart?: Betriebsart;
  /** Sprachmodell-Stufe fuer diesen Lauf zuschalten (L-46). */
  stufe2Aktiv?: boolean;
  /** Abweichendes Modell; sonst der Vorschlag nach Hardware (L-29). */
  modell?: string;
  /** Profil, aus dem der Auftrag stammt (K-03, K-13). */
  profilId?: number;
  /** Bezeichnungen der Seiten aus dem Profil (K-04), gleiche Reihenfolge wie `urls`. */
  bezeichnungen?: (string | null)[];
  /**
   * Anmeldung vor dem Scan (S-01, S-02).
   *
   * Ist sie gesetzt, oeffnet der Lauf zuerst ein sichtbares Browserfenster auf
   * dieser Adresse, meldet `anmeldung-noetig` und wartet auf die Bestaetigung.
   * Zugangsdaten sieht das Werkzeug dabei nicht (S-03).
   */
  anmeldung?: { url: string };
  /** Nur bei Betriebsart `gesamt`: Vorgaben fuer den Crawl (K-08). */
  crawl?: CrawlEingang;
}

/** Was die Oberflaeche ueber eine wartende Anmeldung wissen muss (S-02). */
export interface AnmeldeBericht {
  url: string;
  zustand: 'wartet' | 'bestaetigt' | 'abgebrochen' | 'zeitueberschreitung';
}

export interface ScanZustandBericht {
  scanId: number;
  zustand: ScanZustand;
  standard: Standard;
  seitenGesamt: number;
  seitenFertig: number;
  aktuelleUrl: string | null;
  fehler: string | null;
  /** Gesetzt, solange auf eine Anmeldung gewartet wird (S-01). */
  anmeldung?: AnmeldeBericht | null;
  /** Der Scan laeuft in einer angemeldeten Sitzung (S-22). */
  geschuetzt?: boolean;
}

type Hoerer = (ereignis: Ereignis) => void;

class Lauf {
  readonly scanId: number;
  readonly standard: Standard;
  readonly ereignisse: Ereignis[] = [];

  /** Nicht `readonly`: bei der Gesamtpruefung steht die Zahl erst nach dem Crawl fest. */
  seitenGesamt: number;
  zustand: ScanZustand = 'laeuft';
  seitenFertig = 0;
  aktuelleUrl: string | null = null;
  fehler: string | null = null;
  ergebnis: ScanErgebnis | null = null;
  /** Laufende Anmeldung, solange das sichtbare Fenster offen ist (S-01). */
  anmeldung: Anmeldung | null = null;
  geschuetzt = false;

  readonly #abbruch = new AbortController();
  readonly #hoerer = new Set<Hoerer>();

  constructor(scanId: number, standard: Standard, seitenGesamt: number) {
    this.scanId = scanId;
    this.standard = standard;
    this.seitenGesamt = seitenGesamt;
  }

  get abbruchsignal(): AbortSignal {
    return this.#abbruch.signal;
  }

  abbrechen(): void {
    if (this.zustand !== 'laeuft') return;
    this.#abbruch.abort();
    this.zustand = 'abgebrochen';
    // Eine wartende Anmeldung mitnehmen: sonst bliebe ein sichtbares Fenster
    // stehen und der Lauf haenge bis zur Zeitueberschreitung.
    this.anmeldung?.abbrechen();
  }

  melde(art: EreignisArt, daten: Record<string, unknown> = {}): void {
    const ereignis: Ereignis = { nummer: this.ereignisse.length + 1, art, daten };
    this.ereignisse.push(ereignis);
    for (const hoerer of this.#hoerer) {
      try {
        hoerer(ereignis);
      } catch {
        // Ein abgebrochener Ereignisstrom darf den Scan nicht anhalten.
      }
    }
  }

  /** Meldet einen Hoerer an; liefert die Abmeldung zurueck. */
  hoere(hoerer: Hoerer): () => void {
    this.#hoerer.add(hoerer);
    return () => this.#hoerer.delete(hoerer);
  }

  bericht(): ScanZustandBericht {
    return {
      scanId: this.scanId,
      zustand: this.zustand,
      standard: this.standard,
      seitenGesamt: this.seitenGesamt,
      seitenFertig: this.seitenFertig,
      aktuelleUrl: this.aktuelleUrl,
      fehler: this.fehler,
      anmeldung: this.anmeldung ? { url: this.anmeldung.url, zustand: this.anmeldung.zustand } : null,
      geschuetzt: this.geschuetzt,
    };
  }
}

export class Scanverwaltung {
  readonly #db: Database;
  readonly #katalog: Katalog;
  readonly #protokoll: Protokoll;
  readonly #laeufe = new Map<number, Lauf>();

  constructor(db: Database, katalog: Katalog, protokoll: Protokoll = stillesProtokoll) {
    this.#db = db;
    this.#katalog = katalog;
    this.#protokoll = protokoll;
  }

  /** Legt den Scan an und startet ihn im Hintergrund. Liefert sofort zurueck. */
  starte(eingang: ScanAuftragEingang): number {
    const betriebsart: Betriebsart =
      eingang.betriebsart ?? (eingang.crawl ? 'gesamt' : eingang.urls.length > 1 ? 'profil' : 'einzelseite');
    const gestartetAm = new Date().toISOString();

    /*
      Bei der Gesamtpruefung bleibt die Seitenliste zunaechst leer: Welche
      Seiten es gibt, weiss erst der Crawl. Die Scan-Zeile muss trotzdem sofort
      entstehen, denn die Oberflaeche braucht auf der Stelle eine Kennung und
      einen Ereignisstrom (ARCHITEKTUR 6). Die Seiten werden nachgetragen.
    */
    const scanId = legeScanAn(this.#db, {
      betriebsart,
      standard: eingang.standard,
      stufe2Aktiv: eingang.stufe2Aktiv ?? false,
      werkzeugVersion: WERKZEUG_VERSION,
      gestartetAm,
      seiten: eingang.urls.map((url, nummer) => ({
        url,
        bezeichnung: eingang.bezeichnungen?.[nummer] ?? undefined,
      })),
      profilId: eingang.profilId ?? null,
      ...(eingang.modell ? { stufe2Modell: eingang.modell } : {}),
    });

    const lauf = new Lauf(scanId, eingang.standard, eingang.urls.length);
    this.#laeufe.set(scanId, lauf);

    void this.#fuehreAus(lauf, eingang, betriebsart, gestartetAm);
    return scanId;
  }

  // -------------------------------------------- Anmeldung (S-01, S-02)

  /**
   * Bestaetigung des Menschen, dass die Anmeldung steht (S-02).
   *
   * Ohne diesen Aufruf beginnt kein Scan in einem geschuetzten Bereich. Das
   * Werkzeug raet nicht, ob eine Anmeldung abgeschlossen ist — es fragt.
   */
  bestaetigeAnmeldung(scanId: number): boolean {
    return this.#laeufe.get(scanId)?.anmeldung?.bestaetige() ?? false;
  }

  /** Zustand einer wartenden Anmeldung; `null`, wenn keine laeuft. */
  anmeldung(scanId: number): AnmeldeBericht | null {
    const anmeldung = this.#laeufe.get(scanId)?.anmeldung;
    return anmeldung ? { url: anmeldung.url, zustand: anmeldung.zustand } : null;
  }

  zustand(scanId: number): ScanZustandBericht | null {
    const lauf = this.#laeufe.get(scanId);
    if (lauf) return lauf.bericht();

    // Nicht mehr im Speicher, aber vielleicht in der Datenbank.
    const gespeichert = ladeScan(this.#db, scanId, this.#katalog.kriterien);
    if (!gespeichert) return null;
    return {
      scanId,
      zustand: gespeichert.beendetAm ? 'fertig' : 'abgebrochen',
      standard: gespeichert.standard,
      seitenGesamt: gespeichert.seiten.length,
      seitenFertig: gespeichert.seiten.filter((s) => s.zustand !== 'offen').length,
      aktuelleUrl: null,
      fehler: null,
      anmeldung: null,
      geschuetzt: gespeichert.geschuetzt ?? false,
    };
  }

  /**
   * Ergebnis eines Scans. Waehrend der Lauf noch geht, kommt der Zwischenstand
   * aus der Datenbank — bereits gepruefte Seiten stehen dort schon.
   */
  ergebnis(scanId: number): ScanErgebnis | null {
    const lauf = this.#laeufe.get(scanId);
    if (lauf?.ergebnis) return lauf.ergebnis;

    const gespeichert = ladeScan(this.#db, scanId, this.#katalog.fuerStandard(lauf?.standard ?? '2.1'));
    if (!gespeichert) return null;
    return {
      ...gespeichert,
      projektebene: verdichte(gespeichert.seiten, this.#katalog.fuerStandard(gespeichert.standard)),
    };
  }

  /**
   * Traegt die gespeicherten Antworten in das Ergebnis nach (M-02).
   *
   * Wird nach jeder Antwort aufgerufen. Der Status aendert sich damit sofort,
   * ohne dass ein neuer Scan noetig waere — sonst waere die manuelle Liste
   * nicht abzuarbeiten.
   */
  uebernehmeAntworten(scanId: number): number {
    const ergebnis = this.#laeufe.get(scanId)?.ergebnis;
    if (!ergebnis) return 0;

    const antworten = lesAntwortenFuer(this.#db, ergebnis.seiten.map((s) => s.url));
    const geaendert = wendeAntwortenAn(ergebnis, antworten);

    if (geaendert > 0) {
      ergebnis.projektebene = verdichte(ergebnis.seiten, this.#katalog.fuerStandard(ergebnis.standard));
    }
    return geaendert;
  }

  ereignisseSeit(scanId: number, letzteNummer: number): Ereignis[] {
    return this.#laeufe.get(scanId)?.ereignisse.filter((e) => e.nummer > letzteNummer) ?? [];
  }

  hoere(scanId: number, hoerer: Hoerer): (() => void) | null {
    return this.#laeufe.get(scanId)?.hoere(hoerer) ?? null;
  }

  laeuft(scanId: number): boolean {
    return this.#laeufe.get(scanId)?.zustand === 'laeuft';
  }

  abbrechen(scanId: number): boolean {
    const lauf = this.#laeufe.get(scanId);
    if (!lauf || lauf.zustand !== 'laeuft') return false;
    lauf.abbrechen();
    lauf.melde('fehler', { text: 'Der Scan wurde abgebrochen.' });
    return true;
  }

  /** Loescht einen Scan samt Belegen (S-24). */
  loesche(scanId: number): boolean {
    this.abbrechen(scanId);
    this.#laeufe.delete(scanId);
    const ergebnis = this.#db.prepare(`DELETE FROM scan WHERE id = ?`).run(scanId);
    return ergebnis.changes > 0;
  }

  async #fuehreAus(
    lauf: Lauf,
    eingang: ScanAuftragEingang,
    betriebsart: Betriebsart,
    gestartetAm: string,
  ): Promise<void> {
    const seitenErgebnisse: SeitenErgebnis[] = [];
    let browser: Browser | null = null;

    try {
      /*
        Erst anmelden, dann pruefen (S-01, S-02).

        Solange die Bestaetigung fehlt, laeuft nichts. Das ist der ganze Sinn
        der Uebergabe: Das Werkzeug raet nicht, ob eine Anmeldung fertig ist,
        und es sieht die Zugangsdaten dabei nie (S-03).
      */
      if (eingang.anmeldung) {
        const angemeldet = await this.#warteAufAnmeldung(lauf, eingang.anmeldung.url);
        if (!angemeldet) return;
      }

      const kontext = lauf.anmeldung?.kontext() ?? null;
      browser = await Browser.starten({
        protokoll: this.#protokoll,
        ...(kontext ? { angemeldeterKontext: kontext } : {}),
      });

      /*
        Seitenliste: aus dem Auftrag oder aus dem Crawl (K-08).

        Bei der Gesamtpruefung steht sie beim Start noch nicht fest. Der Crawl
        laeuft im selben Browser — bei einer angemeldeten Sitzung also auch
        hinter der Anmeldung, sonst faende er nur die oeffentlichen Seiten.
      */
      let seiten = eingang.urls.map((url, nummer) => ({
        url,
        ...(eingang.bezeichnungen?.[nummer] ? { bezeichnung: eingang.bezeichnungen[nummer] as string } : {}),
      }));

      if (eingang.crawl) {
        seiten = await this.#crawleSeiten(lauf, browser, eingang.crawl);
        if (seiten.length === 0) throw new Error('Der Crawl hat keine prüfbare Seite gefunden.');

        ergaenzeSeiten(this.#db, lauf.scanId, seiten);
        lauf.seitenGesamt = seiten.length;
      }

      /*
        Stufe 2 wird hier zusammengesteckt, nicht im Runner.

        Der Runner soll nichts ueber Ollama wissen — er bekommt einen Adapter
        oder keinen. Faellt der Dienst aus, bleibt die Stufe eben aus; das ist
        kein Fehler, sondern der vorgesehene Betrieb ohne Sprachmodell (L-26).
      */
      const stufe2Aktiv = eingang.stufe2Aktiv ?? false;
      const modell = eingang.modell ?? schlageModellVor(erkenneHardware()).modell;
      const adapter = stufe2Aktiv ? new OllamaAdapter({ modell, protokoll: this.#protokoll }) : null;

      if (adapter) {
        const zustand = await adapter.zustand();
        if (!zustand.erreichbar) {
          lauf.melde('fehler', {
            text: `Die Sprachmodell-Stufe konnte nicht gestartet werden: ${zustand.grund ?? 'unbekannt'} Der Scan läuft ohne sie weiter.`,
          });
          this.#protokoll.warnung('stufe2', `Ollama nicht erreichbar — Scan ${lauf.scanId} laeuft ohne Stufe 2`);
        }
      }

      // Frueher gegebene Antworten zu diesen Adressen mitgeben (M-04).
      const fruehereAntworten = lesAntwortenFuer(
        this.#db,
        seiten.map((s) => s.url),
      );

      const ergebnis = await fuehreScanAus({
        seiten,
        fruehereAntworten,
        standard: eingang.standard,
        betriebsart,
        katalog: this.#katalog,
        protokoll: this.#protokoll,
        browser,
        abbruch: lauf.abbruchsignal,
        stufe2Aktiv,
        ...(eingang.anmeldung ? { anmeldeAdresse: eingang.anmeldung.url } : {}),
        beiSitzungsverlust: (grund) => {
          // Anhalten und Bescheid sagen, nicht stillschweigend weiterpruefen
          // (S-05). Die Oberflaeche fordert daraufhin zur erneuten Anmeldung auf.
          lauf.melde('sitzung-verloren', { text: grund });
        },
        ...(adapter ? { stufe2Adapter: adapter, stufe2Speicher: datenbankSpeicher(this.#db, modell) } : {}),
        beiFortschritt: (meldung) => {
          if (meldung.art === 'seite-begonnen') {
            lauf.aktuelleUrl = meldung.url;
            lauf.melde('seite-begonnen', { url: meldung.url, nummer: meldung.nummer, gesamt: meldung.gesamt });
            return;
          }

          lauf.seitenFertig = meldung.nummer;
          lauf.aktuelleUrl = null;

          if (meldung.ergebnis) {
            seitenErgebnisse.push(meldung.ergebnis);
            try {
              speichereSeitenErgebnis(this.#db, lauf.scanId, meldung.nummer - 1, meldung.ergebnis);
            } catch (e) {
              this.#protokoll.fehler('scanverwaltung', `Seitenergebnis nicht gespeichert: ${(e as Error).message}`);
            }

            const verstoesse = meldung.ergebnis.bewertungen.filter((b) => b.status === 'nicht_erfuellt');
            for (const bewertung of verstoesse) {
              lauf.melde('befund', {
                url: meldung.ergebnis.url,
                kriterium: bewertung.kriterium,
                anzahl: bewertung.befunde.length,
              });
            }
          }

          lauf.melde(meldung.art === 'fehler' ? 'fehler' : 'seite-fertig', {
            url: meldung.url,
            nummer: meldung.nummer,
            gesamt: meldung.gesamt,
            ...(meldung.text ? { text: meldung.text } : {}),
          });
          lauf.melde('fortschritt', { fertig: meldung.nummer, gesamt: meldung.gesamt });
        },
      });

      lauf.ergebnis = {
        ...ergebnis,
        scanId: lauf.scanId,
        profilId: eingang.profilId ?? null,
        geschuetzt: lauf.geschuetzt,
      };
      if (lauf.zustand === 'laeuft') lauf.zustand = 'fertig';
    } catch (e) {
      lauf.zustand = 'fehler';
      lauf.fehler = e instanceof Error ? e.message : String(e);
      this.#protokoll.fehler('scanverwaltung', `Scan ${lauf.scanId} abgebrochen`, { ursache: lauf.fehler });
      lauf.ergebnis = {
        scanId: lauf.scanId,
        betriebsart,
        profilId: eingang.profilId ?? null,
        geschuetzt: lauf.geschuetzt,
        standard: eingang.standard,
        gestartetAm,
        beendetAm: new Date().toISOString(),
        stufe2Aktiv: false,
        werkzeugVersion: WERKZEUG_VERSION,
        seiten: seitenErgebnisse,
        projektebene: verdichte(seitenErgebnisse, this.#katalog.fuerStandard(eingang.standard)),
      };
    } finally {
      /*
        Erst den Abschluss schreiben, dann aufraeumen.

        Der Zustand des Laufs steht zu diesem Zeitpunkt bereits auf `fertig`.
        Wer den Scan jetzt abfragt, bekommt „laeuft nicht mehr" — und muss
        dann auch den Endzeitpunkt vorfinden. Ein `await` davor riss genau
        dieses Fenster auf.
      */
      try {
        schliesseScanAb(this.#db, lauf.scanId, new Date().toISOString());
      } catch {
        // Der Scan ist gelaufen; ein Schreibfehler beim Abschluss aendert daran nichts.
      }

      /*
        Sitzungsdaten verwerfen (S-04).

        Das Fenster schliesst, der Kontext stirbt, Cookies und Token verlassen
        den Arbeitsspeicher. In die Datenbank sind sie nie gelangt.
      */
      await browser?.schliessen();
      await lauf.anmeldung?.schliessen();
      lauf.anmeldung = null;
      /*
        `fertig` kommt in jedem Fall, auch nach einem Fehler.

        Der Ereignisstrom endet an diesem Ereignis (ARCHITEKTUR 6). Wuerde
        stattdessen nur `fehler` gemeldet, bliebe die Verbindung offen und die
        Oberflaeche haenge in der Fortschrittsansicht fest.
      */
      if (lauf.fehler) lauf.melde('fehler', { text: lauf.fehler });
      lauf.melde('fertig', {
        zustand: lauf.zustand,
        ...(lauf.fehler ? { text: lauf.fehler } : {}),
      });
    }
  }

  /**
   * Oeffnet das Anmeldefenster und wartet auf die Bestaetigung (S-01, S-02).
   *
   * Liefert `true`, wenn der Scan beginnen darf. Andernfalls ist der Lauf
   * bereits beendet und gemeldet — ein Scan hinter einer nicht abgeschlossenen
   * Anmeldung wuerde nur Anmeldemasken pruefen.
   */
  async #warteAufAnmeldung(lauf: Lauf, url: string): Promise<boolean> {
    const anmeldung = await Anmeldung.oeffne({ url, protokoll: this.#protokoll });
    lauf.anmeldung = anmeldung;

    lauf.melde('anmeldung-noetig', {
      url,
      text:
        'Ein sichtbares Browserfenster ist geöffnet. Melden Sie sich dort an und bestätigen Sie anschließend hier, ' +
        'dass die Prüfung beginnen kann. Das Werkzeug erfasst keine Zugangsdaten.',
    });

    const zustand = await anmeldung.warteAufBestaetigung();
    if (zustand === 'bestaetigt') {
      lauf.geschuetzt = true;
      try {
        markiereGeschuetzt(this.#db, lauf.scanId);
      } catch (e) {
        this.#protokoll.warnung('scanverwaltung', `Schutzvermerk nicht gesetzt: ${(e as Error).message}`);
      }
      return true;
    }

    const grund =
      zustand === 'zeitueberschreitung'
        ? 'Es kam keine Bestätigung der Anmeldung. Die Prüfung wurde nicht begonnen.'
        : 'Die Anmeldung wurde abgebrochen. Die Prüfung wurde nicht begonnen.';

    lauf.zustand = zustand === 'abgebrochen' ? 'abgebrochen' : 'fehler';
    lauf.fehler = grund;
    await anmeldung.schliessen();
    lauf.anmeldung = null;
    // Das Abschlussereignis kommt aus dem `finally` des Laufs — hier nur den
    // Zustand setzen, sonst kaeme es doppelt.
    return false;
  }

  /**
   * Sucht die Seiten der Gesamtpruefung zusammen (K-08, K-09).
   *
   * Der Crawl meldet jeden Fund einzeln weiter: Er dauert bei 50 Seiten
   * Minuten, und eine Oberflaeche, die dabei nur „bitte warten" zeigt, ist von
   * einer haengenden nicht zu unterscheiden.
   */
  async #crawleSeiten(
    lauf: Lauf,
    browser: Browser,
    vorgabe: CrawlEingang,
  ): Promise<{ url: string; bezeichnung?: string }[]> {
    lauf.melde('fortschritt', { phase: 'crawl', gefunden: 0, text: 'Seiten werden gesucht …' });

    const ergebnis = await crawle({
      browser,
      protokoll: this.#protokoll,
      abbruch: lauf.abbruchsignal,
      start: vorgabe.start,
      ...(vorgabe.hoechsttiefe !== undefined ? { hoechsttiefe: vorgabe.hoechsttiefe } : {}),
      ...(vorgabe.hoechstzahl !== undefined ? { hoechstzahl: vorgabe.hoechstzahl } : {}),
      ...(vorgabe.einschluss ? { einschluss: vorgabe.einschluss } : {}),
      ...(vorgabe.ausschluss ? { ausschluss: vorgabe.ausschluss } : {}),
      ...(vorgabe.verzoegerungMs !== undefined ? { verzoegerungMs: vorgabe.verzoegerungMs } : {}),
      ...(vorgabe.robotsBeachten !== undefined ? { robotsBeachten: vorgabe.robotsBeachten } : {}),
      beiFund: (gefunden) => {
        lauf.melde('fortschritt', { phase: 'crawl', url: gefunden.url, tiefe: gefunden.tiefe });
      },
    });

    this.#protokoll.info(
      'crawl',
      `${ergebnis.seiten.length} Seiten gefunden` +
        (ergebnis.grenzeErreicht ? ` (Grenze erreicht: ${ergebnis.grenzeErreicht})` : ''),
    );

    if (ergebnis.durchRobotsAusgeschlossen.length > 0) {
      lauf.melde('fortschritt', {
        phase: 'crawl',
        text: `${ergebnis.durchRobotsAusgeschlossen.length} Adressen wurden ausgelassen, weil robots.txt sie untersagt.`,
      });
    }

    return ergebnis.seiten.map((seite) => ({
      url: seite.url,
      ...(seite.vermuteterZweck ? { bezeichnung: seite.vermuteterZweck } : {}),
    }));
  }
}
