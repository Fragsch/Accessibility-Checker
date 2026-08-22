/**
 * Datenbankschema und Ablage eines Scans.
 * Bezug: ARCHITEKTUR 4.2 und 9 Schritt 3
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oeffneDatenbank } from '../src/db/index.js';
import {
  ladeScan,
  legeScanAn,
  lesSeitenabbild,
  listeScans,
  speichereScan,
  speichereSeitenErgebnis,
} from '../src/db/scan-speichern.js';
import { Katalog } from '../src/katalog/laden.js';
import type { ScanErgebnis } from '../src/typen/index.js';

const ERWARTETE_TABELLEN = [
  'befund',
  'bewertung',
  'hinweis',
  'llm_cache',
  'manuelle_antwort',
  'profil',
  'profil_seite',
  'qualitaetshinweis',
  'scan',
  'scan_seite',
];

function beispielScan(): ScanErgebnis {
  return {
    scanId: null,
    betriebsart: 'einzelseite',
    standard: '2.1',
    gestartetAm: '2026-01-01T10:00:00.000Z',
    beendetAm: '2026-01-01T10:01:00.000Z',
    stufe2Aktiv: false,
    werkzeugVersion: '0.1.0',
    seiten: [
      {
        url: 'https://example.org/',
        bezeichnung: 'Startseite',
        titel: 'Beispiel',
        zustand: 'fertig',
        fehler: null,
        bewertungen: [
          {
            kriterium: '1.1.1',
            status: 'nicht_erfuellt',
            herkunft: 'auto/axe',
            befunde: [
              {
                kriterium: '1.1.1',
                regelId: 'image-alt',
                engine: 'axe',
                selektor: 'img',
                htmlAusschnitt: '<img src="x.png">',
                beschreibung: 'Abbildung ohne Alternativtext',
                schwere: 'kritisch',
              },
            ],
            hinweise: [{ kriterium: '1.1.1', text: 'Alternativtexte inhaltlich pruefen', herkunft: 'manuell' }],
            offeneFragen: [],
          },
        ],
      },
    ],
    projektebene: [],
  };
}

describe('Datenbank', () => {
  it('legt das Grundschema an', () => {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    const tabellen = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[];
    assert.deepEqual(
      tabellen.map((t) => t.name),
      ERWARTETE_TABELLEN,
    );
    db.close();
  });

  it('vermerkt die Schemafassung', () => {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    assert.ok(Number(db.pragma('user_version', { simple: true })) >= 1);
    db.close();
  });

  it('setzt Fremdschluessel durch', () => {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    assert.throws(() =>
      db.prepare(`INSERT INTO scan_seite (scan_id, url, status) VALUES (999, 'https://x', 'fertig')`).run(),
    );
    db.close();
  });

  it('speichert einen Scan samt Befunden und Hinweisen', () => {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    const scanId = speichereScan(db, beispielScan());

    const seiten = db.prepare(`SELECT * FROM scan_seite WHERE scan_id = ?`).all(scanId) as { id: number; url: string }[];
    assert.equal(seiten.length, 1);
    assert.equal(seiten[0]?.url, 'https://example.org/');

    const bewertungen = db.prepare(`SELECT * FROM bewertung WHERE scan_seite_id = ?`).all(seiten[0]?.id) as {
      id: number;
      kriterium: string;
      status: string;
    }[];
    assert.equal(bewertungen[0]?.kriterium, '1.1.1');
    assert.equal(bewertungen[0]?.status, 'nicht_erfuellt');

    const befunde = db.prepare(`SELECT * FROM befund WHERE bewertung_id = ?`).all(bewertungen[0]?.id);
    const hinweise = db.prepare(`SELECT * FROM hinweis WHERE bewertung_id = ?`).all(bewertungen[0]?.id);
    assert.equal(befunde.length, 1);
    assert.equal(hinweise.length, 1);
    db.close();
  });

  it('loescht abhaengige Zeilen mit dem Scan (S-24)', () => {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    const scanId = speichereScan(db, beispielScan());
    db.prepare(`DELETE FROM scan WHERE id = ?`).run(scanId);

    for (const tabelle of ['scan_seite', 'bewertung', 'befund', 'hinweis']) {
      const anzahl = db.prepare(`SELECT COUNT(*) AS n FROM ${tabelle}`).get() as { n: number };
      assert.equal(anzahl.n, 0, `${tabelle} enthaelt noch Zeilen`);
    }
    db.close();
  });

  /*
    Das Abbild der geprueften Seite (Fassung 3).

    Es beantwortet die Frage, ob ueberhaupt das geprueft wurde, was geprueft
    werden sollte — der Anlass war ein Cookie-Hinweis, der sich ueber die Seite
    legte und statt ihrer gemessen wurde.
  */
  describe('Abbild der geprueften Seite', () => {
    const abbild = Buffer.from('89504e470d0a1a0a-tut-so-als-waere-es-ein-png', 'utf8');

    function scanMitAbbild(db: ReturnType<typeof oeffneDatenbank>): number {
      const scanId = legeScanAn(db, {
        betriebsart: 'einzelseite',
        standard: '2.1',
        stufe2Aktiv: false,
        werkzeugVersion: '0.1.0',
        gestartetAm: '2026-01-01T10:00:00.000Z',
        seiten: [{ url: 'https://example.org/' }],
      });
      speichereSeitenErgebnis(db, scanId, 0, beispielScan().seiten[0]!, abbild);
      return scanId;
    }

    it('legt es ab und gibt es unveraendert zurueck', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const scanId = scanMitAbbild(db);

      assert.deepEqual(lesSeitenabbild(db, scanId, 0), abbild);
      assert.equal(lesSeitenabbild(db, scanId, 1), null, 'eine zweite Seite gibt es nicht');
      db.close();
    });

    it('haelt ein vorhandenes Bild fest, wenn ohne eines fortgeschrieben wird', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const scanId = scanMitAbbild(db);

      speichereSeitenErgebnis(db, scanId, 0, beispielScan().seiten[0]!);

      assert.deepEqual(lesSeitenabbild(db, scanId, 0), abbild, 'das alte Bild ist der bessere Beleg als keiner');
      db.close();
    });

    it('vermerkt das Vorhandensein, liefert das Bild aber nicht im JSON mit', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const scanId = scanMitAbbild(db);
      const geladen = ladeScan(db, scanId, Katalog.laden().fuerStandard('2.1'));

      assert.equal(geladen?.seiten[0]?.hatAbbild, true);
      assert.ok(
        !JSON.stringify(geladen).includes('tut-so-als-waere-es-ein-png'),
        'ein geladener Scan darf das Bild nicht mitschleppen',
      );
      assert.equal(listeScans(db).scans[0]?.hatAbbild, true);
      db.close();
    });

    it('verschwindet mit dem Scan (S-24)', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const scanId = scanMitAbbild(db);
      db.prepare(`DELETE FROM scan WHERE id = ?`).run(scanId);

      const uebrig = db.prepare(`SELECT COUNT(*) AS n FROM scan_seite WHERE abbild IS NOT NULL`).get() as {
        n: number;
      };
      assert.equal(uebrig.n, 0, 'ein Bild aus einem geschuetzten Bereich darf nichts ueberdauern');
      db.close();
    });
  });

  /*
    Die Liste der bisherigen Pruefungen.

    Bis zur Namensvergabe gab `listeScans` unbesehen die fuenfzig juengsten
    Laeufe zurueck; alles davor war ueber die Oberflaeche nicht erreichbar.
    Geprueft wird hier beides, was an die Stelle getreten ist: das Blaettern
    ueber `versatz` und die Suche.
  */
  describe('Liste der bisherigen Pruefungen', () => {
    /** Legt `anzahl` Laeufe an, der aelteste zuerst. */
    function fuelle(db: ReturnType<typeof oeffneDatenbank>, namen: (string | null)[]): number[] {
      return namen.map((name, nummer) =>
        legeScanAn(db, {
          betriebsart: 'einzelseite',
          standard: '2.1',
          stufe2Aktiv: false,
          werkzeugVersion: '0.1.0',
          gestartetAm: `2026-01-0${(nummer % 9) + 1}T10:00:00.000Z`,
          seiten: [{ url: 'https://example.org/' }],
          name,
        }),
      );
    }

    it('zaehlt alle Treffer, auch die nicht ausgelieferten', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      fuelle(db, Array.from({ length: 120 }, (_, i) => `Lauf ${i + 1}`));

      const erste = listeScans(db, { hoechstzahl: 50 });
      assert.equal(erste.scans.length, 50, 'ein Abschnitt bringt hoechstens so viele Zeilen wie verlangt');
      assert.equal(erste.gesamt, 120, 'gesamt zaehlt unabhaengig vom Ausschnitt — sonst weiss niemand, was fehlt');
      db.close();
    });

    it('blaettert lueckenlos und ohne Dopplung', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      fuelle(db, Array.from({ length: 120 }, (_, i) => `Lauf ${i + 1}`));

      const gesehen = new Set<number>();
      for (let versatz = 0; versatz < 120; versatz += 50) {
        for (const scan of listeScans(db, { hoechstzahl: 50, versatz }).scans) {
          assert.ok(!gesehen.has(scan.scanId), `Scan ${scan.scanId} kam zweimal — beim Blaettern verrutscht`);
          gesehen.add(scan.scanId);
        }
      }
      assert.equal(gesehen.size, 120, 'ueber alle Abschnitte muss jede Pruefung genau einmal auftauchen');
      db.close();
    });

    it('findet ueber den Namen, ohne Ruecksicht auf Gross- und Kleinschreibung', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      fuelle(db, ['Relaunch Startseite', 'Kontaktformular', 'relaunch Shop']);

      const treffer = listeScans(db, { suche: 'RELAUNCH' });
      assert.equal(treffer.gesamt, 2);
      assert.deepEqual(
        treffer.scans.map((s) => s.name).sort(),
        ['Relaunch Startseite', 'relaunch Shop'],
      );
      db.close();
    });

    it('findet einen namenlosen Lauf unter dem Namen, den die Liste ihm gibt', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const ids = fuelle(db, [null, null, null]);
      const gesucht = ids[1]!;

      /*
        Namenlose Laeufe heissen in der Anzeige „Pruefung 2". Wer das abliest
        und eingibt, muss die Zeile finden — sonst sucht er nach einem Text,
        den die Anzeige erfunden hat und der nirgends gespeichert ist. Die
        blosse Nummer muss ebenso greifen: Sie ist ein Teil dieses Namens.
      */
      for (const eingabe of [`Prüfung ${gesucht}`, String(gesucht)]) {
        const treffer = listeScans(db, { suche: eingabe });
        assert.equal(treffer.gesamt, 1, `„${eingabe}" muss genau eine Zeile finden`);
        assert.equal(treffer.scans[0]?.scanId, gesucht);
      }
      db.close();
    });

    it('findet einen benannten Lauf nicht unter „Pruefung <Nummer>"', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const ids = fuelle(db, ['Relaunch Startseite']);

      /*
        Der Rueckfall gilt nur, wo die Liste ihn zeigt. Bei einem benannten
        Lauf steht die Nummer in keiner Spalte — ein Treffer darauf kaeme aus
        einem Merkmal, das niemand ablesen kann.
      */
      assert.equal(listeScans(db, { suche: `Prüfung ${ids[0]!}` }).gesamt, 0);
      db.close();
    });

    it('nimmt Prozentzeichen als Zeichen, nicht als Platzhalter', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      fuelle(db, ['Rabatt 20% Seite', 'Startseite']);

      /*
        Ohne Maskierung waere „%" der Platzhalter von LIKE und faende jeden
        Lauf. Eine Suche, die bei einem Sonderzeichen alles zurueckgibt, sieht
        aus wie ein Treffer und ist keiner.
      */
      const treffer = listeScans(db, { suche: '%' });
      assert.equal(treffer.gesamt, 1, 'nur der Lauf mit dem Prozentzeichen im Namen darf passen');
      assert.equal(treffer.scans[0]?.name, 'Rabatt 20% Seite');
      db.close();
    });

    it('durchsucht auch den Namen des Profils', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const profil = db
        .prepare(`INSERT INTO profil (name, standard, viewports, angelegt_am) VALUES (?, '2.1', '[]', ?)`)
        .run('Onlineshop', '2026-01-01T00:00:00.000Z');

      legeScanAn(db, {
        betriebsart: 'profil',
        standard: '2.1',
        stufe2Aktiv: false,
        werkzeugVersion: '0.1.0',
        gestartetAm: '2026-01-01T10:00:00.000Z',
        seiten: [{ url: 'https://example.org/' }],
        profilId: Number(profil.lastInsertRowid),
      });

      // Laeufe aus einem Profil tragen keinen eigenen Namen; in der Liste
      // stehen sie unter dem des Profils und muessen darueber zu finden sein.
      const treffer = listeScans(db, { suche: 'shop' });
      assert.equal(treffer.gesamt, 1);
      assert.equal(treffer.scans[0]?.profilName, 'Onlineshop');
      db.close();
    });

    it('behandelt einen Namen aus Leerzeichen wie keinen', () => {
      const db = oeffneDatenbank({ pfad: ':memory:' });
      fuelle(db, ['   ']);

      // Sonst stuende in der Liste eine leere Zeile, und der Rueckfall auf
      // Profilname oder Nummer griffe nicht.
      assert.equal(listeScans(db).scans[0]?.name, null);
      db.close();
    });
  });
});
