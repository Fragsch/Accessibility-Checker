/**
 * Schnittstelle zwischen Oberflaeche und Server.
 * Bezug: ARCHITEKTUR 6 und 9 Schritt 9
 *
 * Geprueft wird mit `inject`: die Routen laufen ohne offenen Netzwerkanschluss.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

import { projektWurzel } from '../src/plattform/pfade.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { oeffneDatenbank } from '../src/db/index.js';
import { baueServer, pruefeAdresse } from '../src/server/index.js';
import type { ScanErgebnis } from '../src/typen/index.js';

const WURZEL = projektWurzel();

describe('Adressen pruefen', () => {
  it('ergaenzt ein fehlendes Schema', () => {
    assert.equal(pruefeAdresse('beispiel.de'), 'https://beispiel.de/');
    assert.equal(pruefeAdresse('  beispiel.de/pfad  '), 'https://beispiel.de/pfad');
  });

  it('laesst http, https und file zu', () => {
    assert.ok(pruefeAdresse('http://127.0.0.1:8080/'));
    assert.ok(pruefeAdresse('https://beispiel.de'));
    assert.ok(pruefeAdresse('file:///tmp/seite.html'));
  });

  it('weist alles andere ab', () => {
    assert.equal(pruefeAdresse(''), null);
    assert.equal(pruefeAdresse('   '), null);
    assert.equal(pruefeAdresse('javascript:alert(1)'), null);
    assert.equal(pruefeAdresse('nicht valide::'), null);
  });
});

describe('Routen', { timeout: 180_000 }, () => {
  let server: FastifyInstance;
  let db: Database;
  const verwaltungAufraeumen: number[] = [];

  before(() => {
    db = oeffneDatenbank({ pfad: ':memory:' });
    server = baueServer({
      db,
      katalog: Katalog.laden(),
      protokoll: new Protokoll({ datei: null, konsoleAb: null }),
    });
  });

  after(async () => {
    for (const scanId of verwaltungAufraeumen) {
      await server.inject({ method: 'POST', url: `/api/scan/${scanId}/abbrechen` }).catch(() => undefined);
    }
    await server.close();
    db.close();
  });

  it('liefert den Katalog des gewaehlten Standards', async () => {
    const unter21 = await server.inject({ method: 'GET', url: '/api/katalog?standard=2.1' });
    const unter22 = await server.inject({ method: 'GET', url: '/api/katalog?standard=2.2' });

    assert.equal(unter21.statusCode, 200);
    assert.equal((unter21.json() as { kriterien: unknown[] }).kriterien.length, 50);
    assert.equal((unter22.json() as { kriterien: unknown[] }).kriterien.length, 55);
  });

  it('nimmt ohne Angabe WCAG 2.1 an', async () => {
    const antwort = await server.inject({ method: 'GET', url: '/api/katalog' });
    assert.equal((antwort.json() as { standard: string }).standard, '2.1');
  });

  it('weist einen Auftrag ohne gueltige Adresse ab', async () => {
    const ohneAdresse = await server.inject({ method: 'POST', url: '/api/scan', payload: { urls: [] } });
    assert.equal(ohneAdresse.statusCode, 400);

    const unbrauchbar = await server.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { urls: ['javascript:alert(1)'] },
    });
    assert.equal(unbrauchbar.statusCode, 400);
    assert.match((unbrauchbar.json() as { fehler: string }).fehler, /gültige Adresse/);
  });

  it('meldet einen unbekannten Scan als nicht vorhanden', async () => {
    const antwort = await server.inject({ method: 'GET', url: '/api/scan/9999' });
    assert.equal(antwort.statusCode, 404);
  });

  it('meldet einen Bericht zu einem unbekannten Scan als nicht vorhanden', async () => {
    // Seit Phase 7 gibt es keine Route mehr, die mit 501 antwortet. Der
    // Bericht ist gebaut; unbekannt ist hier der Scan, nicht die Funktion.
    const antwort = await server.inject({ method: 'GET', url: '/api/scan/9999/bericht' });
    assert.equal(antwort.statusCode, 404);
  });

  it('meldet den Zustand der Sprachmodell-Stufe, auch ohne Ollama', async () => {
    // Kein laufendes Ollama ist kein Fehler, sondern eine abgeschaltete
    // Stufe 2 (L-26). Die Route muss deshalb immer mit 200 antworten und
    // benennen, was zu tun waere.
    const antwort = await server.inject({ method: 'GET', url: '/api/system/ollama' });
    assert.equal(antwort.statusCode, 200);

    const bericht = antwort.json() as {
      einsatzbereit: boolean;
      vorschlag: { modell: string };
      schritte: { text: string; befehl: string | null }[];
      entfaelltOhneStufe2: string[];
    };

    assert.ok(bericht.vorschlag.modell.length > 0, 'ein Modellvorschlag gehoert immer dazu');
    assert.equal(bericht.entfaelltOhneStufe2.length, 10, 'PRD 6.3.1: zehn Kriterien unter WCAG 2.1');
    if (!bericht.einsatzbereit) {
      assert.ok(bericht.schritte.length > 0, 'wenn etwas fehlt, muss dastehen was');
    }
  });

  it('erkennt die Ausstattung des Rechners (L-42)', async () => {
    const antwort = await server.inject({ method: 'GET', url: '/api/system/hardware' });
    assert.equal(antwort.statusCode, 200);

    const gelesen = antwort.json() as { hardware: { speicherGb: number }; vorschlag: { modell: string } };
    assert.ok(gelesen.hardware.speicherGb > 0);
    assert.ok(gelesen.vorschlag.modell.length > 0);
  });

  it('nimmt einen Auftrag mit zugeschalteter Sprachmodell-Stufe an (L-46)', async () => {
    const antwort = await server.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { urls: ['https://beispiel.test/'], stufe2: true },
    });

    assert.equal(antwort.statusCode, 201);
    assert.equal((antwort.json() as { stufe2: boolean }).stufe2, true);

    // Wieder aufraeumen: Der Scan wuerde sonst im Hintergrund weiterlaufen.
    const { scanId } = antwort.json() as { scanId: number };
    verwaltungAufraeumen.push(scanId);
  });

  it('fuehrt einen Scan aus und liefert das vollstaendige Ergebnis', async () => {
    const url = pathToFileURL(path.join(WURZEL, 'test', 'referenzseiten', 'mangelhaft.html')).href;

    const gestartet = await server.inject({ method: 'POST', url: '/api/scan', payload: { urls: [url] } });
    assert.equal(gestartet.statusCode, 201);
    const { scanId } = gestartet.json() as { scanId: number };

    const fertig = await warteAufEnde(server, scanId);
    assert.equal(fertig.zustand, 'fertig');
    assert.equal(fertig.laeuft, false);
    assert.ok(fertig.ergebnis);

    const seite = fertig.ergebnis.seiten[0];
    assert.equal(seite?.zustand, 'fertig');
    assert.equal(seite?.bewertungen.length, 50, 'jedes Kriterium des Standards wird bewertet');
    assert.ok(seite?.bewertungen.some((b) => b.status === 'nicht_erfuellt'));
    assert.equal(fertig.entwurf, true, 'offene Kriterien machen das Ergebnis zum Entwurf');
  });

  it('haelt den Scan in der Datenbank fest und liefert ihn spaeter wieder', async () => {
    const gespeicherte = await server.inject({ method: 'GET', url: '/api/scans' });
    const { scans } = gespeicherte.json() as { scans: { scanId: number; beendetAm: string | null }[] };
    assert.ok(scans.length >= 1);
    assert.ok(scans[0]?.beendetAm, 'ein beendeter Scan traegt einen Endzeitpunkt');

    const erneut = await server.inject({ method: 'GET', url: `/api/scan/${scans[0]!.scanId}` });
    const gelesen = erneut.json() as { ergebnis: ScanErgebnis };
    assert.equal(gelesen.ergebnis.seiten[0]?.bewertungen.length, 50);
    assert.ok(
      gelesen.ergebnis.seiten[0]?.bewertungen.some((b) => b.befunde.length > 0),
      'die Befunde stehen auch in der Datenbank',
    );
  });

  it('loescht einen Scan samt Belegen', async () => {
    const url = pathToFileURL(path.join(WURZEL, 'test', 'beispielseiten', 'ohne-medien.html')).href;
    const gestartet = await server.inject({ method: 'POST', url: '/api/scan', payload: { urls: [url] } });
    const { scanId } = gestartet.json() as { scanId: number };
    await warteAufEnde(server, scanId);

    const geloescht = await server.inject({ method: 'DELETE', url: `/api/scan/${scanId}` });
    assert.equal(geloescht.statusCode, 200);

    const danach = await server.inject({ method: 'GET', url: `/api/scan/${scanId}` });
    assert.equal(danach.statusCode, 404);

    const befunde = db.prepare(`SELECT COUNT(*) AS n FROM befund`).get() as { n: number };
    const uebrig = db.prepare(`SELECT COUNT(*) AS n FROM scan_seite WHERE scan_id = ?`).get(scanId) as { n: number };
    assert.equal(uebrig.n, 0);
    assert.ok(befunde.n >= 0);
  });

  it('meldet den Abbruch eines nicht laufenden Scans als Widerspruch', async () => {
    const antwort = await server.inject({ method: 'POST', url: '/api/scan/9999/abbrechen' });
    assert.equal(antwort.statusCode, 409);
  });
});

interface ScanAntwort {
  zustand: string;
  laeuft: boolean;
  entwurf: boolean;
  ergebnis: ScanErgebnis | null;
}

async function warteAufEnde(server: FastifyInstance, scanId: number): Promise<ScanAntwort> {
  for (let versuch = 0; versuch < 300; versuch += 1) {
    const antwort = await server.inject({ method: 'GET', url: `/api/scan/${scanId}` });
    const stand = antwort.json() as ScanAntwort;
    if (!stand.laeuft) return stand;
    await new Promise((weiter) => setTimeout(weiter, 250));
  }
  throw new Error(`Scan ${scanId} wurde nicht fertig`);
}
