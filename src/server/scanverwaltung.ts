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
import { ladeScan, legeScanAn, schliesseScanAb, speichereSeitenErgebnis } from '../db/scan-speichern.js';

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

export interface ScanAuftragEingang {
  urls: string[];
  standard: Standard;
  betriebsart?: Betriebsart;
}

export interface ScanZustandBericht {
  scanId: number;
  zustand: ScanZustand;
  standard: Standard;
  seitenGesamt: number;
  seitenFertig: number;
  aktuelleUrl: string | null;
  fehler: string | null;
}

type Hoerer = (ereignis: Ereignis) => void;

class Lauf {
  readonly scanId: number;
  readonly standard: Standard;
  readonly seitenGesamt: number;
  readonly ereignisse: Ereignis[] = [];

  zustand: ScanZustand = 'laeuft';
  seitenFertig = 0;
  aktuelleUrl: string | null = null;
  fehler: string | null = null;
  ergebnis: ScanErgebnis | null = null;

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
    const betriebsart: Betriebsart = eingang.betriebsart ?? (eingang.urls.length > 1 ? 'profil' : 'einzelseite');
    const gestartetAm = new Date().toISOString();

    const scanId = legeScanAn(this.#db, {
      betriebsart,
      standard: eingang.standard,
      stufe2Aktiv: false,
      werkzeugVersion: WERKZEUG_VERSION,
      gestartetAm,
      seiten: eingang.urls.map((url) => ({ url })),
    });

    const lauf = new Lauf(scanId, eingang.standard, eingang.urls.length);
    this.#laeufe.set(scanId, lauf);

    void this.#fuehreAus(lauf, eingang, betriebsart, gestartetAm);
    return scanId;
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

    try {
      const ergebnis = await fuehreScanAus({
        seiten: eingang.urls.map((url) => ({ url })),
        standard: eingang.standard,
        betriebsart,
        katalog: this.#katalog,
        protokoll: this.#protokoll,
        abbruch: lauf.abbruchsignal,
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

      lauf.ergebnis = ergebnis;
      if (lauf.zustand === 'laeuft') lauf.zustand = 'fertig';
    } catch (e) {
      lauf.zustand = 'fehler';
      lauf.fehler = e instanceof Error ? e.message : String(e);
      this.#protokoll.fehler('scanverwaltung', `Scan ${lauf.scanId} abgebrochen`, { ursache: lauf.fehler });
      lauf.ergebnis = {
        scanId: lauf.scanId,
        betriebsart,
        standard: eingang.standard,
        gestartetAm,
        beendetAm: new Date().toISOString(),
        stufe2Aktiv: false,
        werkzeugVersion: WERKZEUG_VERSION,
        seiten: seitenErgebnisse,
        projektebene: verdichte(seitenErgebnisse, this.#katalog.fuerStandard(eingang.standard)),
      };
    } finally {
      try {
        schliesseScanAb(this.#db, lauf.scanId, new Date().toISOString());
      } catch {
        // Der Scan ist gelaufen; ein Schreibfehler beim Abschluss aendert daran nichts.
      }
      lauf.melde(lauf.zustand === 'fehler' ? 'fehler' : 'fertig', {
        zustand: lauf.zustand,
        ...(lauf.fehler ? { text: lauf.fehler } : {}),
      });
    }
  }
}
