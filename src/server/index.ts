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
import { Protokoll } from '../protokoll.js';
import { oeffneDatenbank } from '../db/index.js';
import type { Database } from 'better-sqlite3';
import { listeScans } from '../db/scan-speichern.js';
import { istEntwurf } from '../scan/statusableitung.js';
import { projektWurzel, protokollDatei } from '../plattform/pfade.js';
import { erkenneHardware, schlageModellVor } from '../plattform/hardware.js';
import { erstelleBericht, messeGeschwindigkeit } from '../stufe2/einrichtung.js';
import { ladePrompts } from '../stufe2/prompts.js';
import { fasseZusammen } from '../stufe3/fragen.js';
import { lesAntworten, loescheAntwort, speichereAntwort } from '../stufe3/antworten.js';
import { Scanverwaltung } from './scanverwaltung.js';

export interface ServerOptionen {
  db?: Database;
  katalog?: Katalog;
  protokoll?: Protokoll;
}

const scanAnfrage = z.object({
  urls: z.array(z.string().min(1)).min(1).max(200),
  standard: z.enum(['2.1', '2.2']).default('2.1'),
  betriebsart: z.enum(['einzelseite', 'profil', 'gesamt']).optional(),
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

const standardAnfrage = z.object({
  standard: z.enum(['2.1', '2.2']).default('2.1'),
});

/** Routen, die es laut ARCHITEKTUR 6 geben wird — mit der Phase, die sie bringt. */
const SPAETERE_ROUTEN: { methode: 'GET' | 'POST' | 'PUT' | 'DELETE'; pfad: string; phase: string }[] = [
  { methode: 'GET', pfad: '/api/profile', phase: '6 — Pruefprofile' },
  { methode: 'POST', pfad: '/api/profile', phase: '6 — Pruefprofile' },
  { methode: 'PUT', pfad: '/api/profile/:id', phase: '6 — Pruefprofile' },
  { methode: 'DELETE', pfad: '/api/profile/:id', phase: '6 — Pruefprofile' },
  { methode: 'POST', pfad: '/api/profile/vorschlag', phase: '6 — Gesamtpruefung per Crawl' },
  { methode: 'POST', pfad: '/api/scan/:id/anmeldung-fertig', phase: '6 — Anmeldung durch den Nutzer' },
  { methode: 'GET', pfad: '/api/scan/:id/bericht', phase: '7 — Bericht nach WCAG-EM' },
];

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

  // ---------------------------------------------------------------- Scan

  server.post('/api/scan', async (anfrage, antwort) => {
    const gelesen = scanAnfrage.safeParse(anfrage.body);
    if (!gelesen.success) {
      return antwort.code(400).send({ fehler: 'Der Auftrag ist unvollständig. Mindestens eine Adresse wird gebraucht.' });
    }

    const urls: string[] = [];
    for (const eingabe of gelesen.data.urls) {
      const geprueft = pruefeAdresse(eingabe);
      if (!geprueft) return antwort.code(400).send({ fehler: `Keine gültige Adresse: ${eingabe}` });
      urls.push(geprueft);
    }

    const scanId = verwaltung.starte({
      urls,
      standard: gelesen.data.standard,
      stufe2Aktiv: gelesen.data.stufe2,
      ...(gelesen.data.modell ? { modell: gelesen.data.modell } : {}),
      ...(gelesen.data.betriebsart ? { betriebsart: gelesen.data.betriebsart } : {}),
    });

    return antwort.code(201).send({ scanId, urls, standard: gelesen.data.standard, stufe2: gelesen.data.stufe2 });
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

  // ------------------------------------------------------ Spaetere Phasen

  for (const route of SPAETERE_ROUTEN) {
    server.route({
      method: route.methode,
      url: route.pfad,
      handler: async (_anfrage, antwort) =>
        antwort.code(501).send({
          fehler: 'Diese Funktion ist noch nicht gebaut.',
          phase: route.phase,
        }),
    });
  }

  server.addHook('onClose', async () => {
    if (!optionen.db) db.close();
  });

  return server;
}

/**
 * Prueft und ergaenzt eine Adresse.
 * Ohne Schema wird `https://` angenommen — die haeufigste Eingabe ist
 * `beispiel.de`, und ein Tippfehler soll nicht als Dateipfad enden.
 */
export function pruefeAdresse(eingabe: string): string | null {
  const roh = eingabe.trim();
  if (!roh) return null;

  const mitSchema = /^[a-z]+:\/\//i.test(roh) ? roh : `https://${roh}`;
  try {
    const adresse = new URL(mitSchema);
    if (!['http:', 'https:', 'file:'].includes(adresse.protocol)) return null;
    if (adresse.protocol !== 'file:' && !adresse.hostname) return null;
    return adresse.href;
  } catch {
    return null;
  }
}

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
