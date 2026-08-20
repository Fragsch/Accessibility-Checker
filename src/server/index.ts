/**
 * Fastify-Server (ARCHITEKTUR 6).
 *
 * Kein Authentifizierungsverfahren: der Server lauscht ausschliesslich auf
 * 127.0.0.1. Es gibt nichts zu schuetzen, was nicht schon dem gehoerte, der am
 * Rechner sitzt — und ein Anmeldeverfahren waere eine weitere Stelle, an der
 * Zugangsdaten anfallen koennten (S-03).
 *
 * Routen, die zu spaeteren Phasen gehoeren, sind angelegt und antworten mit
 * 501 samt Angabe der Phase. Das haelt die Schnittstelle aus Abschnitt 6
 * sichtbar, ohne etwas vorzutaeuschen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Katalog } from '../katalog/laden.js';
import { ladeAbdeckung } from '../katalog/abdeckung.js';
import { Browser } from '../scan/browser.js';
import { crawle } from '../scan/crawl.js';
import { Protokoll } from '../protokoll.js';
import { oeffneDatenbank } from '../db/index.js';
import type { Database } from 'better-sqlite3';
import { lesSeitenabbild, listeScans } from '../db/scan-speichern.js';
import { istEntwurf } from '../scan/statusableitung.js';
import { projektWurzel, protokollDatei } from '../plattform/pfade.js';
import { erkenneHardware, schlageModellVor } from '../plattform/hardware.js';
import { erstelleBericht, messeGeschwindigkeit } from '../stufe2/einrichtung.js';
import { ladePrompts } from '../stufe2/prompts.js';
import { fasseZusammen } from '../stufe3/fragen.js';
import { lesAntworten, loescheAntwort, speichereAntwort } from '../stufe3/antworten.js';
import { Scanverwaltung } from './scanverwaltung.js';
import type { CrawlEingang } from './scanverwaltung.js';
import {
  aendereProfil,
  alsAustausch,
  ausAustausch,
  findeProfil,
  legeProfilAn,
  listeProfile,
  loescheProfil,
  ProfilFehler,
} from '../profil/index.js';
import { erkenneMuster, ranglisteSeiten } from '../bericht/muster.js';
import { baueBerichtsdaten } from '../bericht/daten.js';
import { alsHtml } from '../bericht/html.js';
import { alsPdf } from '../bericht/pdf.js';
import { alsEarl } from '../bericht/earl.js';
import { baueErklaerung, erklaerungAlsHtml } from '../bericht/erklaerung.js';
import { bereinigeAdresse, pruefeAdresse } from '../scan/adressen.js';

export interface ServerOptionen {
  db?: Database;
  katalog?: Katalog;
  protokoll?: Protokoll;
}

const crawlVorgabe = z.object({
  start: z.string().min(1),
  hoechsttiefe: z.number().int().min(0).max(6).default(2),
  hoechstzahl: z.number().int().min(1).max(200).default(30),
  einschluss: z.array(z.string()).optional(),
  ausschluss: z.array(z.string()).optional(),
  verzoegerungMs: z.number().int().min(0).max(10_000).default(500),
  robotsBeachten: z.boolean().default(true),
});

/**
 * Ein Prüfauftrag (K-01 bis K-13).
 *
 * Drei Wege führen zu einer Seitenliste: freie Adressen, ein gespeichertes
 * Profil oder ein Crawl. Genau einer davon wird gebraucht — deshalb sind
 * `urls` hier auch leer zulässig und die Prüfung erfolgt in der Route.
 */
const scanAnfrage = z.object({
  urls: z.array(z.string().min(1)).max(200).default([]),
  standard: z.enum(['2.1', '2.2']).default('2.1'),
  betriebsart: z.enum(['einzelseite', 'profil', 'gesamt']).optional(),
  /** Scan aus einem gespeicherten Prüfprofil (K-03). */
  profilId: z.number().int().positive().optional(),
  /** Gesamtprüfung: Seitenliste aus einem Crawl (K-08, K-09). */
  crawl: crawlVorgabe.optional(),
  /** Anmeldung durch den Nutzer vor dem Scan (S-01, S-02). */
  anmeldung: z.object({ url: z.string().min(1) }).optional(),
  /** Sprachmodell-Stufe fuer diesen Lauf zuschalten (L-46). */
  stufe2: z.boolean().default(false),
  /** Abweichendes Modell; sonst der Vorschlag nach Hardware (L-29). */
  modell: z.string().min(1).optional(),
});

/** Antwort auf eine geführte Frage (M-02). */
const antwortAnfrage = z.object({
  url: z.string().min(1),
  kriterium: z.string().regex(/^[1-4]\.[0-9]+\.[0-9]+$/),
  frageHash: z.string().min(8),
  antwort: z.enum(['erfuellt', 'nicht_erfuellt', 'nicht_anwendbar']),
  notiz: z.string().max(2000).nullable().default(null),
});

const viewportSchema = z.object({ breite: z.number().int().min(200).max(4000), hoehe: z.number().int().min(200).max(4000) });

const profilAnfrage = z.object({
  name: z.string().min(1).max(200),
  standard: z.enum(['2.1', '2.2']).default('2.1'),
  viewports: z.array(viewportSchema).optional(),
  seiten: z
    .array(
      z.object({
        url: z.string().min(1),
        bezeichnung: z.string().max(200).default(''),
        zweck: z.string().max(500).nullable().default(null),
      }),
    )
    .min(1)
    .max(500),
});

const standardAnfrage = z.object({
  standard: z.enum(['2.1', '2.2']).default('2.1'),
});

/**
 * Was beim Warten auf die Anmeldung auf dem Bildschirm stehen muss (S-01).
 *
 * Der letzte Satz ist kein Beiwerk: Wer sein Kennwort in ein Fenster tippt,
 * das ein Prüfwerkzeug geöffnet hat, soll wissen, woran er ist.
 */
const HINWEIS_ANMELDUNG =
  'Ein sichtbares Browserfenster ist geöffnet. Melden Sie sich dort an und bestätigen Sie anschließend hier, ' +
  'dass die Prüfung beginnen kann. Das Werkzeug erfasst keine Zugangsdaten.';

/**
 * Ausgabewege des Berichts (X-02 bis X-06).
 *
 * `daten` ist die Zugabe: dasselbe Modell als JSON, damit die Oberfläche die
 * Kennzahlen anzeigen kann, ohne den ganzen Bericht zu erzeugen und wieder zu
 * zerlegen.
 */
const berichtAnfrage = z.object({
  format: z.enum(['html', 'pdf', 'earl', 'erklaerung', 'daten']).default('html'),
  /** Projektbericht oder Bericht über eine einzelne Seite (X-05). */
  umfang: z.enum(['projekt', 'seite']).default('projekt'),
  /** Bei `umfang=seite`: welche. */
  url: z.string().min(1).optional(),
  /** Name der prüfenden Person für das Deckblatt. */
  person: z.string().max(200).optional(),
});

export function baueServer(optionen: ServerOptionen = {}): FastifyInstance {
  const protokoll = optionen.protokoll ?? new Protokoll({ datei: protokollDatei(), konsoleAb: 'warnung' });
  const katalog = optionen.katalog ?? Katalog.laden();
  const db = optionen.db ?? oeffneDatenbank();
  const verwaltung = new Scanverwaltung(db, katalog, protokoll);

  const server = Fastify({ logger: false });

  // ------------------------------------------------------------- Katalog

  server.get('/api/katalog', async (anfrage, antwort) => {
    const gelesen = standardAnfrage.safeParse(anfrage.query);
    if (!gelesen.success) return antwort.code(400).send({ fehler: 'Unbekannter Prüfstandard.' });

    return {
      standard: gelesen.data.standard,
      kriterien: katalog.fuerStandard(gelesen.data.standard),
    };
  });

  /**
   * Gemessene Abdeckung je Kriterium (PRD 10).
   *
   * Antwortet auch dann mit 200, wenn nie gemessen wurde — dann eben mit
   * `matrix: null`. Die Oberfläche sagt in dem Fall, dass keine Messung
   * vorliegt. Das ist die richtige Auskunft; eine geschätzte Zahl wäre eine
   * Behauptung, und genau die soll die Matrix ersetzen.
   */
  server.get('/api/abdeckung', async () => {
    const matrix = ladeAbdeckung();
    return {
      matrix,
      ...(matrix ? {} : { hinweis: 'Es liegt keine Messung vor. Zu erzeugen mit "npm run verifikation".' }),
    };
  });

  // ---------------------------------------------------------------- Scan

  server.post('/api/scan', async (anfrage, antwort) => {
    const gelesen = scanAnfrage.safeParse(anfrage.body);
    if (!gelesen.success) {
      return antwort.code(400).send({ fehler: 'Der Auftrag ist unvollständig. Mindestens eine Adresse wird gebraucht.' });
    }

    const auftrag = gelesen.data;

    /*
      Aus dem Profil kommen Adressen, Bezeichnungen und der Prüfstandard.

      Der Standard gehört zum Profil (K-13): Ein Wiederholungslauf, der
      plötzlich gegen eine andere Fassung misst, ist mit dem Vorlauf nicht
      vergleichbar, und eine Veränderung wäre nicht mehr der Seite zuzurechnen.
    */
    let standard = auftrag.standard;
    let bezeichnungen: (string | null)[] | null = null;
    let rohAdressen = auftrag.urls;

    if (auftrag.profilId !== undefined) {
      const profil = findeProfil(db, auftrag.profilId);
      if (!profil) return antwort.code(404).send({ fehler: 'Dieses Profil gibt es nicht.' });

      standard = profil.standard;
      rohAdressen = profil.seiten.map((s) => s.url);
      bezeichnungen = profil.seiten.map((s) => s.bezeichnung);
    }

    const urls: string[] = [];
    for (const eingabe of rohAdressen) {
      const geprueft = pruefeAdresse(eingabe);
      if (!geprueft) return antwort.code(400).send({ fehler: `Keine gültige Adresse: ${eingabe}` });
      urls.push(geprueft);
    }

    let crawl: CrawlEingang | null = null;
    if (auftrag.crawl) {
      const start = pruefeAdresse(auftrag.crawl.start);
      if (!start) return antwort.code(400).send({ fehler: `Keine gültige Adresse: ${auftrag.crawl.start}` });
      crawl = { ...auftrag.crawl, start };
    }

    if (urls.length === 0 && !crawl) {
      return antwort.code(400).send({ fehler: 'Der Auftrag ist unvollständig. Mindestens eine Adresse wird gebraucht.' });
    }

    let anmeldung: { url: string } | null = null;
    if (auftrag.anmeldung) {
      const angemeldetAuf = pruefeAdresse(auftrag.anmeldung.url);
      if (!angemeldetAuf) return antwort.code(400).send({ fehler: `Keine gültige Adresse: ${auftrag.anmeldung.url}` });
      anmeldung = { url: angemeldetAuf };
    }

    const scanId = verwaltung.starte({
      urls,
      standard,
      stufe2Aktiv: auftrag.stufe2,
      ...(bezeichnungen ? { bezeichnungen } : {}),
      ...(auftrag.profilId !== undefined ? { profilId: auftrag.profilId } : {}),
      ...(crawl ? { crawl } : {}),
      ...(anmeldung ? { anmeldung } : {}),
      ...(auftrag.modell ? { modell: auftrag.modell } : {}),
      ...(auftrag.betriebsart ? { betriebsart: auftrag.betriebsart } : {}),
    });

    return antwort.code(201).send({
      scanId,
      urls,
      standard,
      stufe2: auftrag.stufe2,
      ...(anmeldung ? { anmeldung: { url: anmeldung.url, hinweis: HINWEIS_ANMELDUNG } } : {}),
    });
  });

  server.get('/api/scans', async () => ({ scans: listeScans(db) }));

  server.get<{ Params: { id: string } }>('/api/scan/:id', async (anfrage, antwort) => {
    const scanId = Number(anfrage.params.id);
    const zustand = verwaltung.zustand(scanId);
    if (!zustand) return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });

    const ergebnis = verwaltung.ergebnis(scanId);
    return {
      ...zustand,
      laeuft: verwaltung.laeuft(scanId),
      ergebnis,
      entwurf: ergebnis ? istEntwurf(ergebnis.projektebene) : true,
    };
  });

  server.post<{ Params: { id: string } }>('/api/scan/:id/abbrechen', async (anfrage, antwort) => {
    const abgebrochen = verwaltung.abbrechen(Number(anfrage.params.id));
    if (!abgebrochen) return antwort.code(409).send({ fehler: 'Dieser Scan läuft nicht mehr.' });
    return { abgebrochen: true };
  });

  server.delete<{ Params: { id: string } }>('/api/scan/:id', async (anfrage, antwort) => {
    const geloescht = verwaltung.loesche(Number(anfrage.params.id));
    if (!geloescht) return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });
    return { geloescht: true };
  });

  /*
    Das Bildschirmfoto einer geprueften Seite.

    Eigene Route und nicht Teil des Scanzustands: Der wird waehrend eines Laufs
    im Sekundentakt abgefragt, und ein eingebettetes Bild vervielfachte jede
    dieser Antworten. So holt die Oberflaeche das Bild genau dann, wenn sie es
    zeigt — und der Browser kann es zwischenspeichern.

    `immutable` mit einem Jahr: Das Abbild einer geprueften Seite aendert sich
    nie wieder. Es entsteht einmal waehrend des Laufs und ist von da an ein
    Beleg; ein Beleg, der sich noch aendern koennte, waere keiner.
  */
  server.get<{ Params: { id: string; nummer: string } }>(
    '/api/scan/:id/seite/:nummer/abbild',
    async (anfrage, antwort) => {
      const scanId = Number(anfrage.params.id);
      const nummer = Number(anfrage.params.nummer);
      if (!Number.isInteger(scanId) || !Number.isInteger(nummer) || nummer < 0) {
        return antwort.code(400).send({ fehler: 'Scan- oder Seitennummer ist keine Zahl.' });
      }

      const abbild = lesSeitenabbild(db, scanId, nummer);
      if (!abbild) {
        return antwort.code(404).send({ fehler: `Zu Seite ${nummer + 1} von Scan ${scanId} gibt es kein Abbild.` });
      }

      return antwort.header('content-type', 'image/png').header('cache-control', 'private, max-age=31536000, immutable').send(abbild);
    },
  );

  // -------------------------------------------------- Ereignisstrom (SSE)

  server.get<{ Params: { id: string } }>('/api/scan/:id/ereignisse', (anfrage, antwort) => {
    const scanId = Number(anfrage.params.id);
    if (!verwaltung.zustand(scanId)) {
      void antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });
      return;
    }

    antwort.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sende = (ereignis: { nummer: number; art: string; daten: unknown }): void => {
      antwort.raw.write(`id: ${ereignis.nummer}\nevent: ${ereignis.art}\ndata: ${JSON.stringify(ereignis.daten)}\n\n`);
    };

    // Erst nachliefern, was schon geschehen ist, dann zuhoeren.
    const letzte = Number(anfrage.headers['last-event-id'] ?? 0);
    for (const ereignis of verwaltung.ereignisseSeit(scanId, Number.isFinite(letzte) ? letzte : 0)) sende(ereignis);

    if (!verwaltung.laeuft(scanId)) {
      antwort.raw.end();
      return;
    }

    const abmelden = verwaltung.hoere(scanId, (ereignis) => {
      sende(ereignis);
      if (ereignis.art === 'fertig') antwort.raw.end();
    });

    anfrage.raw.on('close', () => abmelden?.());
  });

  // --------------------------------------------------------- Prüfprofile

  server.get('/api/profile', async () => ({ profile: listeProfile(db) }));

  server.get<{ Params: { id: string } }>('/api/profile/:id', async (anfrage, antwort) => {
    const profil = findeProfil(db, Number(anfrage.params.id));
    if (!profil) return antwort.code(404).send({ fehler: 'Dieses Profil gibt es nicht.' });
    return { profil, austausch: alsAustausch(profil) };
  });

  server.post('/api/profile', async (anfrage, antwort) => {
    const gelesen = profilAnfrage.safeParse(anfrage.body);
    if (!gelesen.success) return antwort.code(400).send({ fehler: 'Das Profil ist unvollständig.' });

    try {
      return antwort.code(201).send({ profil: legeProfilAn(db, gelesen.data) });
    } catch (e) {
      if (e instanceof ProfilFehler) return antwort.code(400).send({ fehler: e.message });
      throw e;
    }
  });

  server.put<{ Params: { id: string } }>('/api/profile/:id', async (anfrage, antwort) => {
    const gelesen = profilAnfrage.safeParse(anfrage.body);
    if (!gelesen.success) return antwort.code(400).send({ fehler: 'Das Profil ist unvollständig.' });

    try {
      const geaendert = aendereProfil(db, Number(anfrage.params.id), gelesen.data);
      if (!geaendert) return antwort.code(404).send({ fehler: 'Dieses Profil gibt es nicht.' });
      return { profil: geaendert };
    } catch (e) {
      if (e instanceof ProfilFehler) return antwort.code(400).send({ fehler: e.message });
      throw e;
    }
  });

  server.delete<{ Params: { id: string } }>('/api/profile/:id', async (anfrage, antwort) => {
    if (!loescheProfil(db, Number(anfrage.params.id))) {
      return antwort.code(404).send({ fehler: 'Dieses Profil gibt es nicht.' });
    }
    return { geloescht: true };
  });

  /** Profil aus einer JSON-Datei übernehmen (K-07). */
  server.post('/api/profile/import', async (anfrage, antwort) => {
    try {
      return antwort.code(201).send({ profil: legeProfilAn(db, ausAustausch(anfrage.body)) });
    } catch (e) {
      if (e instanceof ProfilFehler) return antwort.code(400).send({ fehler: e.message });
      throw e;
    }
  });

  /**
   * Vorschlagsfunktion (K-06).
   *
   * Ein einmaliger Crawl liefert eine Kandidatenliste — mehr nicht. Welche
   * Seiten ins Profil kommen, entscheidet ein Mensch: Eine kuratierte Auswahl
   * ist gegenüber einem Vollcrawl schneller und aussagekräftiger, weil jede
   * Seite bewusst gewählt wurde.
   */
  server.post('/api/profile/vorschlag', async (anfrage, antwort) => {
    const gelesen = crawlVorgabe.safeParse(anfrage.body);
    if (!gelesen.success) return antwort.code(400).send({ fehler: 'Die Crawl-Angaben sind unvollständig.' });

    const start = pruefeAdresse(gelesen.data.start);
    if (!start) return antwort.code(400).send({ fehler: `Keine gültige Adresse: ${gelesen.data.start}` });

    const browser = await Browser.starten({ protokoll });
    try {
      const ergebnis = await crawle({
        ...gelesen.data,
        start,
        browser,
        protokoll,
      });
      return ergebnis;
    } finally {
      await browser.schliessen();
    }
  });

  // ---------------------------------------------- Anmeldung (S-01, S-02)

  /**
   * Bestätigung, dass die Anmeldung abgeschlossen ist (S-02).
   *
   * Der Scan wurde bereits gestartet; er hat ein sichtbares Browserfenster
   * geöffnet, `anmeldung-noetig` gemeldet und wartet. Zugangsdaten sieht das
   * Werkzeug dabei nie — es fragt nur, ob es weitergehen darf (S-03).
   */
  server.post<{ Params: { id: string } }>('/api/scan/:id/anmeldung-fertig', async (anfrage, antwort) => {
    const scanId = Number(anfrage.params.id);
    if (!verwaltung.zustand(scanId)) {
      return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });
    }

    if (!verwaltung.bestaetigeAnmeldung(scanId)) {
      return antwort.code(409).send({ fehler: 'Zu diesem Scan wird nicht auf eine Anmeldung gewartet.' });
    }
    return { bestaetigt: true };
  });

  /** Wartet dieser Scan gerade auf eine Anmeldung (S-01)? */
  server.get<{ Params: { id: string } }>('/api/scan/:id/anmeldung', async (anfrage, antwort) => {
    const anmeldung = verwaltung.anmeldung(Number(anfrage.params.id));
    if (!anmeldung) return antwort.code(404).send({ fehler: 'Zu diesem Scan wird nicht auf eine Anmeldung gewartet.' });
    return { ...anmeldung, hinweis: HINWEIS_ANMELDUNG };
  });

  // ------------------------------------- Projektebene und Musterkennung

  /**
   * Verdichtete Sicht über alle Seiten (E-20 bis E-26).
   *
   * Beides zugleich: Musterkennung, damit aus 25 Befunden eine Aufgabe wird,
   * und Seitenrangliste, damit klar ist, wo man anfängt.
   */
  server.get<{ Params: { id: string } }>('/api/scan/:id/projekt', async (anfrage, antwort) => {
    const ergebnis = verwaltung.ergebnis(Number(anfrage.params.id));
    if (!ergebnis) return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });

    return {
      projektebene: ergebnis.projektebene,
      muster: erkenneMuster(ergebnis),
      rangliste: ranglisteSeiten(ergebnis),
      seiten: ergebnis.seiten.map((s) => ({
        url: s.url,
        bezeichnung: s.bezeichnung,
        titel: s.titel,
        zustand: s.zustand,
        fehler: s.fehler,
      })),
    };
  });

  /** Bereinigt eine Adresse für Anzeige und Export (S-07, S-33). */
  server.get<{ Querystring: { url?: string } }>('/api/adresse/bereinigt', async (anfrage, antwort) => {
    if (!anfrage.query.url) return antwort.code(400).send({ fehler: 'Eine Adresse wird gebraucht.' });
    return bereinigeAdresse(anfrage.query.url);
  });

  // ----------------------------------------- Stufe 3 (geführte Prüfliste)

  /**
   * Offene Fragen eines Scans (M-01, M-06, M-07).
   *
   * Gleichlautende Fragen mehrerer Seiten werden zusammengefasst: Wer sie
   * einmal beantwortet, hat sie überall beantwortet. Ohne das ist eine Liste
   * über 25 Seiten nicht abzuarbeiten.
   */
  server.get<{ Params: { id: string } }>('/api/scan/:id/fragen', async (anfrage, antwort) => {
    const scanId = Number(anfrage.params.id);
    const ergebnis = verwaltung.ergebnis(scanId);
    if (!ergebnis) return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });

    const proSeite = ergebnis.seiten
      .filter((seite) => seite.zustand === 'fertig')
      .map((seite) => ({
        url: seite.url,
        fragen: seite.bewertungen.flatMap((b) => b.offeneFragen),
      }));

    const beantwortet = ergebnis.seiten
      .filter((seite) => seite.zustand === 'fertig')
      .flatMap((seite) =>
        seite.bewertungen.flatMap((b) =>
          (b.beantworteteFragen ?? []).map((eintrag) => ({ url: seite.url, ...eintrag })),
        ),
      );

    const offen = fasseZusammen(proSeite);

    return {
      scanId,
      offen,
      beantwortet,
      // Wie weit ist die Liste? Die Zahl steht in der Oberflaeche ueber der
      // Liste — ohne sie weiss niemand, ob sich das Abarbeiten noch lohnt.
      fortschritt: {
        offen: offen.length,
        beantwortet: beantwortet.length,
        gesamt: offen.length + beantwortet.length,
      },
    };
  });

  /**
   * Antwort auf eine Frage (M-02, M-03).
   *
   * Gespeichert wird je Adresse und Fragekennung, nicht je Scan. Ein späterer
   * Scan derselben Seite übernimmt die Antwort, solange sich der Kontext nicht
   * geändert hat (M-04).
   */
  server.post<{ Params: { id: string } }>('/api/scan/:id/antwort', async (anfrage, antwort) => {
    const gelesen = antwortAnfrage.safeParse(anfrage.body);
    if (!gelesen.success) {
      return antwort.code(400).send({ fehler: 'Die Antwort ist unvollständig oder unzulässig.' });
    }

    const scanId = Number(anfrage.params.id);
    if (!verwaltung.zustand(scanId)) {
      return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });
    }

    speichereAntwort(db, {
      url: gelesen.data.url,
      kriterium: gelesen.data.kriterium,
      frageHash: gelesen.data.frageHash,
      antwort: gelesen.data.antwort,
      notiz: gelesen.data.notiz,
      beantwortetAm: new Date().toISOString(),
    });

    verwaltung.uebernehmeAntworten(scanId);
    return { gespeichert: true };
  });

  /** Nimmt eine Antwort zurück — auch das muss möglich sein. */
  server.delete<{ Params: { id: string }; Querystring: { url?: string; frageHash?: string } }>(
    '/api/scan/:id/antwort',
    async (anfrage, antwort) => {
      const { url, frageHash } = anfrage.query;
      if (!url || !frageHash) return antwort.code(400).send({ fehler: 'Adresse und Fragekennung werden gebraucht.' });

      const geloescht = loescheAntwort(db, url, frageHash);
      if (!geloescht) return antwort.code(404).send({ fehler: 'Zu dieser Frage ist keine Antwort gespeichert.' });

      verwaltung.uebernehmeAntworten(Number(anfrage.params.id));
      return { geloescht: true };
    },
  );

  /** Alle Antworten zu einer Adresse — für die Übernahme in einen neuen Scan. */
  server.get<{ Querystring: { url?: string } }>('/api/antworten', async (anfrage, antwort) => {
    if (!anfrage.query.url) return antwort.code(400).send({ fehler: 'Eine Adresse wird gebraucht.' });
    return { antworten: [...lesAntworten(db, anfrage.query.url).values()] };
  });

  // ------------------------------------------------------ Stufe 2 (System)

  server.get('/api/system/hardware', async () => {
    const hardware = erkenneHardware();
    return { hardware, vorschlag: schlageModellVor(hardware) };
  });

  /**
   * Zustand der Sprachmodell-Stufe (L-40, L-42).
   * Antwortet auch dann mit 200, wenn Ollama fehlt — das ist kein Fehler,
   * sondern eine abgeschaltete Stufe 2 (L-26).
   */
  server.get('/api/system/ollama', async (anfrage) => {
    const abfrage = (anfrage.query ?? {}) as { modell?: string; standard?: string };
    // Welche Kriterien ohne Stufe 2 offen bleiben, haengt vom Standard ab:
    // 3.2.6 gibt es erst unter WCAG 2.2.
    const standard = abfrage.standard === '2.2' ? '2.2' : '2.1';

    return erstelleBericht({
      ...(abfrage.modell ? { modell: abfrage.modell } : {}),
      protokoll,
      kriterien: katalog.fuerStandard(standard),
    });
  });

  /**
   * Geschwindigkeitsmessung (L-44).
   *
   * Der Name der Route stammt aus ARCHITEKTUR 6. Sie installiert bewusst
   * nichts: Ein Modelldownload von mehreren Gigabyte gehoert in die Hand des
   * Menschen (L-41). Geliefert werden die noetigen Befehle und — sofern
   * alles bereitsteht — die gemessene Laufzeitschaetzung.
   */
  server.post('/api/system/ollama/einrichten', async (anfrage) => {
    const koerper = (anfrage.body ?? {}) as { modell?: string };
    const bericht = await erstelleBericht({
      ...(koerper.modell ? { modell: koerper.modell } : {}),
      protokoll,
      kriterien: katalog.fuerStandard('2.1'),
    });

    if (!bericht.einsatzbereit) return { ...bericht, messung: null };

    const prompts = ladePrompts();
    const messung = await messeGeschwindigkeit(bericht.vorschlag.modell, prompts.systemAnweisung, { protokoll });
    return { ...bericht, messung };
  });

  // --------------------------------------------------- Bericht (Phase 7)

  /**
   * Bericht nach WCAG-EM mit ACR-Bewertungssprache (X-01 bis X-22).
   *
   * Ein laufender Scan liefert keinen Bericht: Ein Zwischenstand sähe aus wie
   * ein Ergebnis, und ein Kriterium ohne Befund wäre nicht „erfüllt", sondern
   * nur noch nicht geprüft. Der Unterschied verschwindet im fertigen Dokument.
   */
  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/scan/:id/bericht',
    async (anfrage, antwort) => {
      const gelesen = berichtAnfrage.safeParse(anfrage.query);
      if (!gelesen.success) return antwort.code(400).send({ fehler: 'Unbekanntes Berichtsformat.' });

      const scanId = Number(anfrage.params.id);
      const ergebnis = verwaltung.ergebnis(scanId);
      if (!ergebnis) return antwort.code(404).send({ fehler: `Scan ${anfrage.params.id} ist nicht bekannt.` });

      if (verwaltung.laeuft(scanId)) {
        return antwort.code(409).send({
          fehler: 'Dieser Scan läuft noch. Ein Bericht entsteht erst aus einem abgeschlossenen Lauf.',
        });
      }

      const { format, umfang } = gelesen.data;

      if (umfang === 'seite') {
        if (!gelesen.data.url) return antwort.code(400).send({ fehler: 'Für einen Seitenbericht wird eine Adresse gebraucht.' });
        if (!ergebnis.seiten.some((s) => s.url === gelesen.data.url)) {
          return antwort.code(404).send({ fehler: `Zu diesem Scan gehört keine Seite ${gelesen.data.url}.` });
        }
      }

      const daten = baueBerichtsdaten({
        ergebnis,
        kriterien: katalog.fuerStandard(ergebnis.standard),
        profil: ergebnis.profilId ? findeProfil(db, ergebnis.profilId) : null,
        ...(gelesen.data.person ? { pruefendePerson: gelesen.data.person } : {}),
        ...(umfang === 'seite' && gelesen.data.url ? { nurSeite: gelesen.data.url } : {}),
      });

      const name = dateiname(daten.deckblatt.angebot, daten.deckblatt.gepruefteFassung);

      switch (format) {
        case 'daten':
          return daten;

        case 'earl':
          void antwort
            .header('Content-Type', 'application/ld+json; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${name}.earl.json"`);
          return alsEarl({ ergebnis, daten });

        case 'erklaerung':
          void antwort
            .header('Content-Type', 'text/html; charset=utf-8')
            .header('Content-Disposition', `inline; filename="Erklaerung-${name}.html"`);
          return erklaerungAlsHtml(baueErklaerung(daten), daten.deckblatt.angebot);

        case 'pdf': {
          const pdf = await alsPdf(daten);
          void antwort
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="${name}.pdf"`);
          return antwort.send(pdf);
        }

        case 'html':
          void antwort
            .header('Content-Type', 'text/html; charset=utf-8')
            .header('Content-Disposition', `inline; filename="${name}.html"`);
          return alsHtml(daten);
      }
    },
  );

  server.addHook('onClose', async () => {
    if (!optionen.db) db.close();
  });

  return server;
}

/**
 * Dateiname des Berichts.
 *
 * Umlaute und Sonderzeichen fallen heraus: Ein `Content-Disposition`-Kopf mit
 * Zeichen ausserhalb von ASCII wird von Browsern unterschiedlich ausgelegt,
 * und ein Bericht, der beim Herunterladen einen zerhackten Namen bekommt,
 * findet sich spaeter nicht wieder.
 */
function dateiname(angebot: string, zeitpunkt: string): string {
  const ersetzungen: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

  const kern = angebot
    .replace(/[äöüÄÖÜß]/g, (zeichen) => ersetzungen[zeichen] ?? zeichen)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const tag = zeitpunkt.slice(0, 10);
  return `Barrierefreiheitsbericht-${kern || 'Pruefung'}-${tag}`;
}

export { pruefeAdresse } from '../scan/adressen.js';

/** Bindet die gebaute Oberflaeche ein, sofern sie vorliegt. */
async function bindeOberflaecheEin(server: FastifyInstance): Promise<boolean> {
  const wurzel = path.join(projektWurzel(), 'dist', 'web');
  if (!fs.existsSync(path.join(wurzel, 'index.html'))) return false;

  const statisch = (await import('@fastify/static')).default;
  await server.register(statisch, { root: wurzel });

  // Alles, was keine Schnittstelle ist, beantwortet die Oberflaeche.
  server.setNotFoundHandler((anfrage, antwort) => {
    if (anfrage.url.startsWith('/api/')) {
      return antwort.code(404).send({ fehler: 'Diese Schnittstelle gibt es nicht.' });
    }
    return antwort.sendFile('index.html');
  });

  return true;
}

export async function starteServer(port = 3000): Promise<FastifyInstance> {
  const server = baueServer();
  const oberflaeche = await bindeOberflaecheEin(server);

  await server.listen({ port, host: '127.0.0.1' });

  console.log(`Prüfwerkzeug läuft auf http://127.0.0.1:${port}`);
  if (!oberflaeche) {
    console.log('Die Oberfläche ist nicht gebaut. Für die Entwicklung: npm run dev');
  }
  return server;
}

// Direkt gestartet, nicht eingebunden?
const direktGestartet =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (direktGestartet) {
  const port = Number(process.env['PORT'] ?? 3000);
  starteServer(port).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
