/**
 * Prüfprofile, Adressen und die Routen dazu.
 * Bezug: PRD 6.1 (K-03 bis K-07, K-13, S-07, S-30 bis S-33), ARCHITEKTUR 6
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

import { oeffneDatenbank } from '../src/db/index.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { baueServer } from '../src/server/index.js';
import {
  ProfilFehler,
  aendereProfil,
  alsAustausch,
  ausAustausch,
  findeProfil,
  legeProfilAn,
  listeProfile,
  loescheProfil,
} from '../src/profil/index.js';
import { bereinigeAdresse, gleicheHerkunft, ohneFragment, pruefeAdresse } from '../src/scan/adressen.js';

function leereDatenbank() {
  return oeffneDatenbank({ pfad: ':memory:' });
}

describe('Prüfprofile (K-03 bis K-05)', () => {
  it('legt ein Profil mit Bezeichnung und Zweckvermerk an', () => {
    const db = leereDatenbank();
    const profil = legeProfilAn(db, {
      name: 'Schnellprüfung',
      standard: '2.2',
      seiten: [
        { url: 'beispiel.de', bezeichnung: 'Startseite', zweck: 'Einstieg' },
        { url: 'beispiel.de/kontakt', bezeichnung: 'Kontakt', zweck: 'Formular' },
      ],
    });

    assert.equal(profil.name, 'Schnellprüfung');
    assert.equal(profil.standard, '2.2', 'der Standard gehoert ins Profil (K-13)');
    assert.equal(profil.seiten.length, 2);
    assert.equal(profil.seiten[0]?.url, 'https://beispiel.de/', 'fehlendes Schema wird ergaenzt');
    assert.equal(profil.seiten[1]?.zweck, 'Formular');
    assert.deepEqual(
      profil.seiten.map((s) => s.reihenfolge),
      [0, 1],
      'die Reihenfolge bleibt erhalten',
    );
    db.close();
  });

  it('vergibt eine Ersatzbezeichnung, statt eine Adresse allein stehen zu lassen', () => {
    const db = leereDatenbank();
    const profil = legeProfilAn(db, { name: 'P', seiten: [{ url: 'beispiel.de', bezeichnung: '  ' }] });
    assert.equal(profil.seiten[0]?.bezeichnung, 'Seite 1');
    db.close();
  });

  it('laesst doppelte Adressen aus, statt sie zweimal zu pruefen', () => {
    const db = leereDatenbank();
    const profil = legeProfilAn(db, {
      name: 'P',
      seiten: [
        { url: 'beispiel.de', bezeichnung: 'A' },
        { url: 'https://beispiel.de/', bezeichnung: 'B' },
      ],
    });
    assert.equal(profil.seiten.length, 1);
    db.close();
  });

  it('weist ein Profil ohne Namen, ohne Seiten oder mit unbrauchbarer Adresse ab', () => {
    const db = leereDatenbank();

    assert.throws(() => legeProfilAn(db, { name: '  ', seiten: [{ url: 'a.de', bezeichnung: 'A' }] }), ProfilFehler);
    assert.throws(() => legeProfilAn(db, { name: 'P', seiten: [] }), ProfilFehler);
    assert.throws(
      () => legeProfilAn(db, { name: 'P', seiten: [{ url: 'javascript:alert(1)', bezeichnung: 'A' }] }),
      ProfilFehler,
    );
    db.close();
  });

  it('aendert, listet und loescht Profile', () => {
    const db = leereDatenbank();
    const angelegt = legeProfilAn(db, { name: 'Erst', seiten: [{ url: 'a.de', bezeichnung: 'A' }] });

    const geaendert = aendereProfil(db, angelegt.id, {
      name: 'Danach',
      standard: '2.1',
      seiten: [
        { url: 'a.de', bezeichnung: 'A' },
        { url: 'b.de', bezeichnung: 'B' },
      ],
    });

    assert.equal(geaendert?.name, 'Danach');
    assert.equal(geaendert?.seiten.length, 2, 'die Seitenliste wird vollstaendig ersetzt');
    assert.equal(listeProfile(db).length, 1);

    assert.equal(aendereProfil(db, 9999, { name: 'X', seiten: [{ url: 'a.de', bezeichnung: 'A' }] }), null);
    assert.equal(loescheProfil(db, angelegt.id), true);
    assert.equal(findeProfil(db, angelegt.id), null);
    assert.equal(loescheProfil(db, angelegt.id), false);
    db.close();
  });

  it('nimmt Seiten mit, wenn das Profil geloescht wird', () => {
    const db = leereDatenbank();
    const profil = legeProfilAn(db, { name: 'P', seiten: [{ url: 'a.de', bezeichnung: 'A' }] });
    loescheProfil(db, profil.id);

    const uebrig = db.prepare(`SELECT COUNT(*) AS n FROM profil_seite`).get() as { n: number };
    assert.equal(uebrig.n, 0);
    db.close();
  });
});

describe('Profil-Austausch als JSON (K-07)', () => {
  it('behaelt die Adressen vollstaendig', () => {
    const db = leereDatenbank();
    const profil = legeProfilAn(db, {
      name: 'Vollabnahme',
      standard: '2.2',
      seiten: [{ url: 'https://beispiel.de/konto/12345/?bestellung=9876', bezeichnung: 'Bestellung' }],
    });

    const austausch = alsAustausch(profil);
    assert.equal(austausch.werkzeug, 'accessibility-checker');
    assert.equal(austausch.seiten[0]?.url, 'https://beispiel.de/konto/12345/?bestellung=9876');

    const zurueck = ausAustausch(austausch);
    assert.equal(zurueck.name, 'Vollabnahme');
    assert.equal(zurueck.standard, '2.2');
    assert.equal(zurueck.seiten.length, 1);
    db.close();
  });

  it('weist fremde oder unbekannte Dateien ab', () => {
    assert.throws(() => ausAustausch(null), ProfilFehler);
    assert.throws(() => ausAustausch({ werkzeug: 'etwas-anderes' }), ProfilFehler);
    assert.throws(() => ausAustausch({ werkzeug: 'accessibility-checker', fassung: 99 }), ProfilFehler);
    assert.throws(() => ausAustausch({ werkzeug: 'accessibility-checker', fassung: 1, seiten: [] }), ProfilFehler);
  });
});

describe('Adressen (S-07, S-30 bis S-33)', () => {
  it('haelt Pfad- und Abfrageparameter unangetastet (S-30)', () => {
    const bereinigt = bereinigeAdresse('https://beispiel.de/konto/12345/?bestellung=9876&seite=2');
    assert.equal(bereinigt.adresse, 'https://beispiel.de/konto/12345/?bestellung=9876&seite=2');
    assert.deepEqual(bereinigt.entfernt, []);
  });

  it('entfernt Sitzungskennungen und Token (S-07, S-32)', () => {
    const bereinigt = bereinigeAdresse('https://beispiel.de/seite?sid=abc&bestellung=9876&access_token=xyz');
    assert.equal(bereinigt.adresse, 'https://beispiel.de/seite?bestellung=9876');
    assert.deepEqual(bereinigt.entfernt.sort(), ['access_token', 'sid']);
  });

  it('entfernt Token auch aus dem Fragment und aus dem Pfad', () => {
    const imFragment = bereinigeAdresse('https://beispiel.de/#id_token=abc&zustand=offen');
    assert.ok(imFragment.entfernt.includes('#id_token'));
    assert.ok(!imFragment.adresse.includes('id_token'));

    const imPfad = bereinigeAdresse('https://beispiel.de/shop;jsessionid=ABC123/warenkorb');
    assert.ok(!imPfad.adresse.includes('jsessionid'));
    assert.ok(imPfad.adresse.includes('/shop/warenkorb'));
  });

  it('laesst unbrauchbare Adressen unveraendert, statt sie zu verstuemmeln', () => {
    const roh = bereinigeAdresse('keine adresse');
    assert.equal(roh.adresse, 'keine adresse');
    assert.deepEqual(roh.entfernt, []);
  });

  it('erkennt Herkunft und Fragment', () => {
    assert.equal(gleicheHerkunft('https://a.de/x', 'https://a.de/y'), true);
    assert.equal(gleicheHerkunft('https://a.de/x', 'https://b.de/x'), false);
    assert.equal(ohneFragment('https://a.de/x#abschnitt'), 'https://a.de/x');
    assert.equal(pruefeAdresse('beispiel.de'), 'https://beispiel.de/');
  });
});

describe('Profil-Routen (ARCHITEKTUR 6)', () => {
  function baueUmgebung(): { server: FastifyInstance; schliessen: () => Promise<void> } {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    const server = baueServer({
      db,
      katalog: Katalog.laden(),
      protokoll: new Protokoll({ datei: null, konsoleAb: null }),
    });
    return {
      server,
      schliessen: async () => {
        await server.close();
        db.close();
      },
    };
  }

  it('legt an, liest, aendert und loescht ueber die Schnittstelle', async () => {
    const { server, schliessen } = baueUmgebung();

    const angelegt = await server.inject({
      method: 'POST',
      url: '/api/profile',
      payload: {
        name: 'Schnellprüfung',
        standard: '2.2',
        seiten: [{ url: 'beispiel.de', bezeichnung: 'Startseite', zweck: null }],
      },
    });
    assert.equal(angelegt.statusCode, 201);
    const { profil } = angelegt.json() as { profil: { id: number; standard: string } };
    assert.equal(profil.standard, '2.2');

    const gelesen = await server.inject({ method: 'GET', url: `/api/profile/${profil.id}` });
    assert.equal(gelesen.statusCode, 200);
    assert.equal((gelesen.json() as { austausch: { fassung: number } }).austausch.fassung, 1);

    const liste = await server.inject({ method: 'GET', url: '/api/profile' });
    assert.equal((liste.json() as { profile: unknown[] }).profile.length, 1);

    const geaendert = await server.inject({
      method: 'PUT',
      url: `/api/profile/${profil.id}`,
      payload: { name: 'Umbenannt', standard: '2.1', seiten: [{ url: 'beispiel.de', bezeichnung: 'S', zweck: null }] },
    });
    assert.equal((geaendert.json() as { profil: { name: string } }).profil.name, 'Umbenannt');

    const geloescht = await server.inject({ method: 'DELETE', url: `/api/profile/${profil.id}` });
    assert.equal(geloescht.statusCode, 200);
    assert.equal((await server.inject({ method: 'GET', url: `/api/profile/${profil.id}` })).statusCode, 404);

    await schliessen();
  });

  it('meldet ein unbrauchbares Profil als Fehler des Auftrags, nicht als Serverfehler', async () => {
    const { server, schliessen } = baueUmgebung();

    const ohneSeiten = await server.inject({ method: 'POST', url: '/api/profile', payload: { name: 'P', seiten: [] } });
    assert.equal(ohneSeiten.statusCode, 400);

    const schlechteAdresse = await server.inject({
      method: 'POST',
      url: '/api/profile',
      payload: { name: 'P', seiten: [{ url: 'javascript:alert(1)', bezeichnung: 'A' }] },
    });
    assert.equal(schlechteAdresse.statusCode, 400);
    assert.match((schlechteAdresse.json() as { fehler: string }).fehler, /Adresse/);

    const fremdeDatei = await server.inject({ method: 'POST', url: '/api/profile/import', payload: { werkzeug: 'x' } });
    assert.equal(fremdeDatei.statusCode, 400);

    await schliessen();
  });

  it('uebernimmt beim Scan aus dem Profil dessen Standard (K-13)', async () => {
    const { server, schliessen } = baueUmgebung();

    const angelegt = await server.inject({
      method: 'POST',
      url: '/api/profile',
      payload: {
        name: 'Mit 2.2',
        standard: '2.2',
        seiten: [{ url: 'https://beispiel.test/', bezeichnung: 'Start', zweck: null }],
      },
    });
    const { profil } = angelegt.json() as { profil: { id: number } };

    // `standard` im Auftrag steht bewusst auf 2.1 — das Profil muss gewinnen.
    const gestartet = await server.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { profilId: profil.id, standard: '2.1' },
    });

    assert.equal(gestartet.statusCode, 201);
    const antwort = gestartet.json() as { scanId: number; standard: string; urls: string[] };
    assert.equal(antwort.standard, '2.2');
    assert.deepEqual(antwort.urls, ['https://beispiel.test/']);

    await server.inject({ method: 'POST', url: `/api/scan/${antwort.scanId}/abbrechen` });
    await schliessen();
  });

  it('weist einen Scan auf ein unbekanntes Profil ab', async () => {
    const { server, schliessen } = baueUmgebung();
    const antwort = await server.inject({ method: 'POST', url: '/api/scan', payload: { profilId: 9999 } });
    assert.equal(antwort.statusCode, 404);
    await schliessen();
  });

  it('meldet 409, wenn zu einem Scan gar keine Anmeldung aussteht (S-02)', async () => {
    const { server, schliessen } = baueUmgebung();

    const gestartet = await server.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { urls: ['https://beispiel.test/'] },
    });
    const { scanId } = gestartet.json() as { scanId: number };

    const bestaetigt = await server.inject({ method: 'POST', url: `/api/scan/${scanId}/anmeldung-fertig` });
    assert.equal(bestaetigt.statusCode, 409);

    const unbekannt = await server.inject({ method: 'POST', url: '/api/scan/9999/anmeldung-fertig' });
    assert.equal(unbekannt.statusCode, 404);

    await server.inject({ method: 'POST', url: `/api/scan/${scanId}/abbrechen` });
    await schliessen();
  });
});
