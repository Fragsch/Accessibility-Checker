/**
 * Die geführte manuelle Prüfliste.
 * Bezug: PRD 6.4 (M-01 bis M-07)
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type { Database } from 'better-sqlite3';

import { oeffneDatenbank } from '../src/db/index.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import { Browser, VIEWPORT_SCHREIBTISCH } from '../src/scan/browser.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { baueKatalogFragen, baueLlmFrage, fasseZusammen, frageHash } from '../src/stufe3/fragen.js';
import { lesAntworten, lesAntwortenFuer, loescheAntwort, speichereAntwort, zaehleAntworten } from '../src/stufe3/antworten.js';
import { wendeAufBewertungAn } from '../src/stufe3/uebernahme.js';
import { leiteStatusAb } from '../src/scan/statusableitung.js';
import type { Bewertung, Kriterium, ManuelleAntwort, OffeneFrage } from '../src/typen/index.js';

const WURZEL = projektWurzel();

function frage(teil: Partial<OffeneFrage> = {}): OffeneFrage {
  return {
    id: 'kennung-1',
    kriterium: '1.1.1',
    frage: 'Stimmt der Alternativtext?',
    kontextSelektor: 'img',
    betroffeneElemente: 2,
    herkunft: 'katalog',
    ...teil,
  };
}

function bewertung(teil: Partial<Bewertung> = {}): Bewertung {
  return {
    kriterium: '1.1.1',
    status: 'pruefung_erforderlich',
    herkunft: 'manuell',
    befunde: [],
    hinweise: [],
    offeneFragen: [frage()],
    ...teil,
  };
}

function antwort(teil: Partial<ManuelleAntwort> = {}): ManuelleAntwort {
  return {
    url: 'https://beispiel.test/',
    kriterium: '1.1.1',
    frageHash: 'kennung-1',
    antwort: 'erfuellt',
    notiz: null,
    beantwortetAm: '2026-01-01T10:00:00.000Z',
    ...teil,
  };
}

describe('Fragekennung (M-03, M-04)', () => {
  it('ist unabhaengig von Schreibweise und Leerraum', () => {
    assert.equal(
      frageHash('1.1.1', 'Stimmt der Text?', ['<img> Logo']),
      frageHash('1.1.1', '  stimmt DER   text? ', ['<IMG> logo']),
    );
  });

  it('aendert sich, wenn sich der Kontext aendert', () => {
    // Das ist der Kern von M-04: Eine Antwort gilt nur so lange, wie sie sich
    // auf denselben Inhalt bezieht. Sonst stuende ein Urteil ueber einen Text
    // im Bericht, den es nicht mehr gibt.
    assert.notEqual(frageHash('1.1.1', 'Frage', ['alter Text']), frageHash('1.1.1', 'Frage', ['neuer Text']));
  });

  it('unterscheidet Kriterien', () => {
    assert.notEqual(frageHash('1.1.1', 'Frage', []), frageHash('1.4.1', 'Frage', []));
  });

  it('enthaelt die Adresse nicht — dieselbe Frage auf zwanzig Seiten ist eine Frage', () => {
    // Voraussetzung fuer M-07.
    const a = frageHash('2.4.4', 'Ist der Linktext aussagekraeftig?', ['<a> Impressum']);
    const b = frageHash('2.4.4', 'Ist der Linktext aussagekraeftig?', ['<a> Impressum']);
    assert.equal(a, b);
  });
});

describe('Fragen aus der Sprachmodell-Stufe (M-06)', () => {
  it('nimmt die Begruendung des Modells als Entscheidungshilfe mit', () => {
    const f = baueLlmFrage('2.4.4', 'linkzweck', '"BITV"', 'Abkürzung, im Kontext möglicherweise klar.');

    assert.equal(f.kriterium, '2.4.4');
    assert.equal(f.herkunft, 'llm');
    assert.equal(f.begruendung, 'Abkürzung, im Kontext möglicherweise klar.');
    assert.match(f.frage, /nicht abschließend beurteilen/);
  });

  it('gibt gleichen Stellen gleiche Kennungen', () => {
    const a = baueLlmFrage('2.4.4', 'linkzweck', '"BITV"', 'Grund');
    const b = baueLlmFrage('2.4.4', 'linkzweck', '"BITV"', 'Grund');
    assert.equal(a.id, b.id);
  });
});

describe('Zusammenfassung ueber Seiten (M-07)', () => {
  it('fasst gleichlautende Fragen zusammen', () => {
    const gemeinsam = frage({ id: 'kopfbereich' });
    const einzeln = frage({ id: 'nur-hier', kriterium: '1.4.1' });

    const gebuendelt = fasseZusammen([
      { url: 'https://a.test/', fragen: [gemeinsam, einzeln] },
      { url: 'https://b.test/', fragen: [gemeinsam] },
      { url: 'https://c.test/', fragen: [gemeinsam] },
    ]);

    assert.equal(gebuendelt.length, 2);
    assert.equal(gebuendelt[0]?.frage.id, 'kopfbereich', 'die haeufigste Frage steht oben');
    assert.deepEqual(gebuendelt[0]?.seiten, ['https://a.test/', 'https://b.test/', 'https://c.test/']);
    assert.deepEqual(gebuendelt[1]?.seiten, ['https://a.test/']);
  });

  it('zaehlt dieselbe Seite nicht doppelt', () => {
    const gebuendelt = fasseZusammen([{ url: 'https://a.test/', fragen: [frage(), frage()] }]);
    assert.deepEqual(gebuendelt[0]?.seiten, ['https://a.test/']);
  });
});

describe('Antworten speichern (M-02, M-03)', () => {
  let db: Database;

  before(() => {
    db = oeffneDatenbank({ pfad: ':memory:' });
  });

  after(() => {
    db.close();
  });

  it('speichert und liest eine Antwort', () => {
    speichereAntwort(db, antwort({ notiz: 'Von Hand geprüft.' }));

    const gelesen = lesAntworten(db, 'https://beispiel.test/');
    assert.equal(gelesen.size, 1);
    assert.equal(gelesen.get('kennung-1')?.antwort, 'erfuellt');
    assert.equal(gelesen.get('kennung-1')?.notiz, 'Von Hand geprüft.');
  });

  it('ersetzt eine fruehere Antwort, statt sie zu doppeln', () => {
    speichereAntwort(db, antwort({ antwort: 'nicht_erfuellt', notiz: 'Doch nicht.' }));

    const gelesen = lesAntworten(db, 'https://beispiel.test/');
    assert.equal(gelesen.size, 1, 'eine Frage, eine Antwort');
    assert.equal(gelesen.get('kennung-1')?.antwort, 'nicht_erfuellt');
    assert.equal(zaehleAntworten(db, 'https://beispiel.test/'), 1);
  });

  it('haelt Adressen auseinander', () => {
    speichereAntwort(db, antwort({ url: 'https://andere.test/', antwort: 'nicht_anwendbar' }));

    assert.equal(lesAntworten(db, 'https://beispiel.test/').get('kennung-1')?.antwort, 'nicht_erfuellt');
    assert.equal(lesAntworten(db, 'https://andere.test/').get('kennung-1')?.antwort, 'nicht_anwendbar');
  });

  it('liest mehrere Adressen in einem Zug', () => {
    const alle = lesAntwortenFuer(db, ['https://beispiel.test/', 'https://andere.test/', 'https://leer.test/']);

    assert.equal(alle.size, 2, 'eine Adresse ohne Antworten taucht nicht auf');
    assert.equal(alle.get('https://beispiel.test/')?.size, 1);
  });

  it('nimmt eine Antwort zurueck', () => {
    assert.equal(loescheAntwort(db, 'https://andere.test/', 'kennung-1'), true);
    assert.equal(lesAntworten(db, 'https://andere.test/').size, 0);
    assert.equal(loescheAntwort(db, 'https://andere.test/', 'kennung-1'), false, 'zweimal loeschen aendert nichts');
  });
});

describe('Antworten wirken auf den Status (M-02)', () => {
  it('macht aus "nicht erfuellt" einen Verstoss', () => {
    const b = bewertung();
    wendeAufBewertungAn(b, new Map([['kennung-1', antwort({ antwort: 'nicht_erfuellt' })]]));

    assert.equal(b.status, 'nicht_erfuellt');
    assert.equal(b.offeneFragen.length, 0);
    assert.equal(b.beantworteteFragen?.length, 1);
  });

  it('schliesst ein Kriterium mit "erfuellt"', () => {
    const b = bewertung();
    wendeAufBewertungAn(b, new Map([['kennung-1', antwort({ antwort: 'erfuellt' })]]));
    assert.equal(b.status, 'erfuellt');
  });

  it('macht ein Kriterium mit "nicht anwendbar" gegenstandslos', () => {
    const b = bewertung();
    wendeAufBewertungAn(b, new Map([['kennung-1', antwort({ antwort: 'nicht_anwendbar' })]]));
    assert.equal(b.status, 'nicht_anwendbar');
  });

  it('laesst einen belegten Verstoss unberuehrt', () => {
    // Die wichtigste Zusage: Ein Mensch kann die Automatik nicht wegantworten.
    // Wer den Befund loswerden will, aendert die Seite.
    const b = bewertung({
      status: 'nicht_erfuellt',
      befunde: [
        {
          kriterium: '1.1.1',
          regelId: 'image-alt',
          engine: 'axe',
          selektor: 'img',
          htmlAusschnitt: null,
          beschreibung: 'Bild ohne Alternativtext',
          schwere: 'kritisch',
        },
      ],
    });

    wendeAufBewertungAn(b, new Map([['kennung-1', antwort({ antwort: 'erfuellt' })]]));
    assert.equal(b.status, 'nicht_erfuellt');
  });

  it('bleibt offen, solange ein Hinweis besteht', () => {
    const b = bewertung({ hinweise: [{ kriterium: '1.1.1', text: 'Engine fehlt', herkunft: 'auto/pixel' }] });
    wendeAufBewertungAn(b, new Map([['kennung-1', antwort({ antwort: 'erfuellt' })]]));
    assert.equal(b.status, 'pruefung_erforderlich');
  });

  it('bleibt offen, solange eine weitere Frage offen ist', () => {
    const b = bewertung({ offeneFragen: [frage(), frage({ id: 'kennung-2' })] });
    wendeAufBewertungAn(b, new Map([['kennung-1', antwort({ antwort: 'erfuellt' })]]));

    assert.equal(b.status, 'pruefung_erforderlich');
    assert.equal(b.offeneFragen.length, 1);
  });

  it('nimmt eine zurueckgenommene Antwort wieder heraus', () => {
    const b = bewertung();
    wendeAufBewertungAn(b, new Map([['kennung-1', antwort()]]));
    assert.equal(b.status, 'erfuellt');

    wendeAufBewertungAn(b, new Map());
    assert.equal(b.status, 'pruefung_erforderlich');
    assert.equal(b.offeneFragen.length, 1);
  });
});

describe('Statusableitung mit Antworten (ARCHITEKTUR 5.2)', () => {
  const kriterium: Kriterium = {
    id: '1.1.1',
    titel: 'Nicht-Text-Inhalte',
    level: 'A',
    prinzip: 'wahrnehmbarkeit',
    standard: { eingefuehrtMit: '2.0', entfallenAb: null },
    beschreibung: 'Beschreibung, die lang genug fuer das Schema ist.',
    anwendbarWenn: 'img',
    pruefungen: [{ typ: 'manuell', frage: 'Stimmt der Alternativtext?' }],
    empfehlung: { text: 'Empfehlung, die lang genug fuer das Schema ist.', referenzen: [] },
  };

  function eingabe(teil: Record<string, unknown> = {}) {
    return {
      kriterium,
      anwendbar: true,
      befunde: [],
      hinweise: [],
      offeneFragen: [],
      autoPruefungGelaufen: false,
      herkunft: 'manuell',
      ...teil,
    };
  }

  it('zaehlt eine menschliche Antwort als gelaufene Pruefung', () => {
    // Ohne Antwort gilt: keine Pruefung gelaufen, also offen.
    assert.equal(leiteStatusAb(eingabe()), 'pruefung_erforderlich');

    // Mit Antwort hat ein Mensch hingesehen — das ist eine Pruefung.
    assert.equal(
      leiteStatusAb(
        eingabe({
          beantworteteFragen: [{ frage: frage(), antwort: 'erfuellt', notiz: null, beantwortetAm: 'x' }],
        }),
      ),
      'erfuellt',
    );
  });

  it('haelt die bindende Reihenfolge ein: Befund schlaegt Antwort', () => {
    const status = leiteStatusAb(
      eingabe({
        befunde: [
          {
            kriterium: '1.1.1',
            regelId: 'image-alt',
            engine: 'axe',
            selektor: 'img',
            htmlAusschnitt: null,
            beschreibung: 'x',
            schwere: 'kritisch',
          },
        ],
        beantworteteFragen: [{ frage: frage(), antwort: 'erfuellt', notiz: null, beantwortetAm: 'x' }],
      }),
    );
    assert.equal(status, 'nicht_erfuellt');
  });
});

describe('Fragen mit Kontext aus einer echten Seite (M-01)', { timeout: 120_000 }, () => {
  const katalog = Katalog.laden();
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });
  let browser: Browser;
  let geladen: Awaited<ReturnType<Browser['ladeSeite']>>;

  before(async () => {
    browser = await Browser.starten({ protokoll });
    geladen = await browser.ladeSeite(pathToFileURL(path.join(WURZEL, 'test/referenzseiten/mangelhaft.html')).href, {
      viewport: VIEWPORT_SCHREIBTISCH,
    });
  });

  after(async () => {
    await geladen.schliessen();
    await browser.schliessen();
  });

  it('liefert Textproben der betroffenen Stellen mit', async () => {
    const kriterium = katalog.findeKriterium('1.1.1')!;
    const fragen = await baueKatalogFragen(kriterium, { seite: geladen.seite, protokoll });

    assert.equal(fragen.length, 1);
    const einzige = fragen[0]!;
    assert.equal(einzige.herkunft, 'katalog');
    assert.ok(einzige.betroffeneElemente && einzige.betroffeneElemente > 0);
    assert.ok(einzige.kontext && einzige.kontext.length > 0, 'ohne Kontext ist die Frage kaum beantwortbar');
    assert.match(einzige.kontext[0] ?? '', /^<\w+>/, 'jede Probe nennt das Element');
  });

  it('stellt keine Frage, wo der Kontextselektor nichts findet', async () => {
    const kriterium = katalog.findeKriterium('1.2.4');
    if (!kriterium) return;

    const fragen = await baueKatalogFragen(kriterium, { seite: geladen.seite, protokoll });
    for (const f of fragen) {
      assert.notEqual(f.betroffeneElemente, 0, 'eine Frage ohne Gegenstand gehoert nicht in die Liste');
    }
  });
});
