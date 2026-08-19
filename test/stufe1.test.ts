/**
 * Die Prüf-Engines der Stufe 1 einzeln.
 *
 * Der Scan-Test prueft das Zusammenspiel; hier geht es um die einzelne Regel.
 * Faellt einer dieser Tests, zeigt er unmittelbar auf die Ursache — im
 * Gesamtlauf waere nur zu sehen, dass irgendein Kriterium den Status wechselt.
 *
 * Bezug: PRD 6.2 (A-04 bis A-14), ARCHITEKTUR 2
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { Browser, VIEWPORT_SCHREIBTISCH } from '../src/scan/browser.js';
import { Protokoll } from '../src/protokoll.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import { ENGINES, findeEngine, vorhandeneEngines } from '../src/stufe1/index.js';
import type { EngineErgebnis, EngineKontext } from '../src/stufe1/engine.js';
import { fuegeZusammen, kuerzeHtml } from '../src/stufe1/engine.js';
import { htmlEngine } from '../src/stufe1/html.js';
import { kontrast, relativeHelligkeit } from '../src/stufe1/pixel.js';
import { findeSprachdaten } from '../src/stufe1/ocr.js';
import type { GeladeneSeite } from '../src/scan/browser.js';

const WURZEL = projektWurzel();
const ZEITLIMIT = 180_000;

function adresse(relativ: string): string {
  return pathToFileURL(path.join(WURZEL, relativ)).href;
}

describe('Engine-Verzeichnis', () => {
  it('fuehrt jede gebaute Engine genau einmal', () => {
    const namen = ENGINES.map((e) => e.name);
    assert.deepEqual([...new Set(namen)].length, namen.length);
    assert.deepEqual([...vorhandeneEngines()].sort(), ['axe', 'eigen', 'html', 'ocr', 'pixel', 'sprache']);
  });

  it('laesst axe zuerst und eigen zuletzt laufen', () => {
    // Reihenfolge ist nicht beliebig: eigen bewegt den Fokus, sendet Formulare
    // ab und veraendert den Viewport. Was danach laeuft, prueft eine Seite,
    // die das Werkzeug selbst umgebaut hat.
    assert.equal(ENGINES[0]?.name, 'axe');
    assert.equal(ENGINES[ENGINES.length - 1]?.name, 'eigen');
  });

  it('findet Engines ueber ihren Namen', () => {
    assert.equal(findeEngine('html')?.name, 'html');
    assert.equal(findeEngine('ibm' as 'axe'), undefined, 'ibm ist bewusst nicht gebaut');
  });

  it('fuegt Ergebnisse ohne doppelte Regeln zusammen', () => {
    const a: EngineErgebnis = { befunde: [], hinweise: [], ausgefuehrteRegeln: ['x', 'y'] };
    const b: EngineErgebnis = { befunde: [], hinweise: [], ausgefuehrteRegeln: ['y', 'z'] };
    assert.deepEqual(fuegeZusammen([a, b]).ausgefuehrteRegeln, ['x', 'y', 'z']);
  });

  it('kuerzt HTML-Ausschnitte auf ein anzeigbares Mass', () => {
    assert.equal(kuerzeHtml('<p>  viel\n  Leerraum </p>'), '<p> viel Leerraum </p>');
    assert.equal(kuerzeHtml(null), null);
    assert.equal(kuerzeHtml('x'.repeat(500))?.length, 401, '400 Zeichen plus Auslassungszeichen');
  });
});

describe('Kontrastrechnung', () => {
  it('rechnet die Grenzwerte der Norm richtig', () => {
    const weiss = relativeHelligkeit([255, 255, 255]);
    const schwarz = relativeHelligkeit([0, 0, 0]);
    assert.equal(Math.round(kontrast(weiss, schwarz)), 21, 'Schwarz auf Weiss ergibt 21:1');
    assert.equal(kontrast(weiss, weiss), 1);

    // #767676 auf Weiss ist der klassische Grenzfall knapp ueber 4,5:1.
    const grau = relativeHelligkeit([118, 118, 118]);
    const wert = kontrast(weiss, grau);
    assert.ok(wert > 4.5 && wert < 4.6, `erwartet knapp ueber 4,5, gemessen ${wert}`);
  });
});

describe('Engine "html"', () => {
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });

  function kontextMit(quelltext: string | null): EngineKontext {
    return {
      seite: null as never,
      browser: null as never,
      url: 'https://beispiel.test/',
      standard: '2.1',
      viewport: VIEWPORT_SCHREIBTISCH,
      quelltext,
      protokoll,
    };
  }

  it('findet doppelte Kennungen im Quelltext', async () => {
    const ergebnis = await htmlEngine.ausfuehren(
      kontextMit('<!doctype html><html lang="de"><head><title>x</title></head><body><p id="a">1</p><p id="a">2</p></body></html>'),
      ['no-dup-id'],
    );

    assert.equal(ergebnis.befunde.length, 1);
    assert.equal(ergebnis.befunde[0]?.regelId, 'no-dup-id');
    assert.match(ergebnis.befunde[0]?.beschreibung ?? '', /Kennung/);
    assert.deepEqual(ergebnis.ausgefuehrteRegeln, ['no-dup-id']);
  });

  it('laesst eine saubere Seite unbeanstandet', async () => {
    const ergebnis = await htmlEngine.ausfuehren(
      kontextMit(
        `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Ordentlich</title></head>` +
          `<body><main><h1>Titel</h1><p>${'Genug Text, damit die Seite nicht als leer gilt. '.repeat(60)}</p></main></body></html>`,
      ),
      ['no-dup-id', 'close-order', 'void-content'],
    );

    assert.deepEqual(ergebnis.befunde, []);
    assert.deepEqual(ergebnis.hinweise, [], 'kein Hinweis auf zu kurzen Quelltext');
  });

  it('meldet einen Hinweis, wenn kein Quelltext vorliegt — und kein Bestehen', async () => {
    const ergebnis = await htmlEngine.ausfuehren(kontextMit(null), ['no-dup-id']);

    assert.deepEqual(ergebnis.befunde, []);
    assert.equal(ergebnis.hinweise.length, 1);
    assert.deepEqual(ergebnis.ausgefuehrteRegeln, [], 'ohne Quelltext ist nichts gelaufen');
  });

  it('vermerkt, wenn die Seite ihren Inhalt erst im Browser aufbaut', async () => {
    const ergebnis = await htmlEngine.ausfuehren(
      kontextMit('<!doctype html><html lang="de"><head><title>App</title></head><body><div id="wurzel"></div></body></html>'),
      ['no-dup-id'],
    );

    assert.equal(ergebnis.hinweise.length, 1);
    assert.match(ergebnis.hinweise[0]?.text ?? '', /erst im Browser/);
  });
});

describe('Engine "ocr"', () => {
  it('hat die Sprachdaten lokal vorliegen — ohne Nachladen aus dem Netz', () => {
    const pfad = findeSprachdaten();
    assert.ok(pfad, 'Paket @tesseract.js-data/deu fehlt; ohne es laeuft die Texterkennung nicht');
    assert.match(pfad, /tesseract\.js-data/);
  });
});

describe('Engines an einer Beispielseite', { timeout: ZEITLIMIT }, () => {
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });
  let browser: Browser;
  let geladen: GeladeneSeite;
  let kontext: EngineKontext;

  before(async () => {
    browser = await Browser.starten({ protokoll });
    geladen = await browser.ladeSeite(adresse('test/beispielseiten/verhalten.html'), {
      viewport: VIEWPORT_SCHREIBTISCH,
    });
    kontext = {
      seite: geladen.seite,
      browser,
      url: geladen.url,
      standard: '2.2',
      viewport: VIEWPORT_SCHREIBTISCH,
      quelltext: geladen.quelltext,
      protokoll,
    };
  });

  after(async () => {
    await geladen.schliessen();
    await browser.schliessen();
  });

  async function regeln(...ids: string[]): Promise<EngineErgebnis> {
    return findeEngine('eigen')!.ausfuehren(kontext, ids);
  }

  it('erkennt ein klickbares Element ohne Tastaturzugang (2.1.1)', async () => {
    const ergebnis = await regeln('klickbar-ohne-fokus');
    assert.ok(ergebnis.befunde.length >= 1);
    assert.match(ergebnis.befunde[0]?.beschreibung ?? '', /Tastatur/);
  });

  it('erkennt dauerhafte Bewegung ohne Schalter (2.2.2)', async () => {
    const ergebnis = await regeln('dauerhafte-animation');
    assert.ok(ergebnis.befunde.some((b) => b.regelId === 'dauerhafte-animation'));
  });

  it('erkennt Zusatzinhalt im title-Attribut (1.4.13)', async () => {
    const ergebnis = await regeln('tooltip-escape');
    assert.ok(ergebnis.befunde.some((b) => b.regelId === 'tooltip-escape'));
  });

  it('erkennt einen leeren Statusbereich ohne Live-Kennzeichnung (4.1.3)', async () => {
    const ergebnis = await regeln('statusmeldung-live-region');
    assert.ok(ergebnis.befunde.some((b) => b.selektor === '#statusbereich'));
  });

  it('haelt eine Anmeldung nicht fuer eine Meldung (4.1.3)', async () => {
    // "Anmeldung" enthaelt "meldung". Ohne Ausnahme meldet die Regel auf jeder
    // deutschen Seite mit Anmeldung einen Fehlalarm — in der eigenen
    // Oberflaeche traf es den Hilfetext unter dem Ankreuzfeld.
    const ergebnis = await regeln('statusmeldung-live-region');
    assert.ok(
      !ergebnis.befunde.some((b) => b.selektor?.includes('anmeldung-hilfe')),
      'ein Hilfetext zur Anmeldung ist keine Statusmeldung',
    );
  });

  it('erkennt zu kleine, dicht beieinanderliegende Ziele (2.5.8)', async () => {
    const ergebnis = await regeln('zielgroesse-24');
    assert.ok(ergebnis.befunde.length >= 2, `nur ${ergebnis.befunde.length} Ziele beanstandet`);
  });

  it('erkennt seitliches Scrollen bei 320 Pixeln (1.4.10)', async () => {
    const ergebnis = await regeln('reflow-320');
    assert.equal(ergebnis.befunde.length, 1);
    assert.match(ergebnis.befunde[0]?.beschreibung ?? '', /320 Pixeln/);
  });

  it('erkennt abgeschnittenen Text bei erhoehtem Abstand (1.4.12)', async () => {
    const ergebnis = await regeln('textabstand-test');
    assert.ok(ergebnis.befunde.some((b) => b.regelId === 'textabstand-test'));
  });

  it('erkennt fehlende Fokusanzeige und Verdeckung (2.4.7, 2.4.11)', async () => {
    const ergebnis = await regeln('fokus-sichtbarkeit', 'fokus-verdeckt');
    assert.ok(
      ergebnis.befunde.some((b) => b.regelId === 'fokus-sichtbarkeit'),
      'outline: none ohne Ersatz muss auffallen',
    );
    assert.ok(
      ergebnis.befunde.some((b) => b.regelId === 'fokus-verdeckt'),
      'die feste Kopfzeile verdeckt fokussierte Elemente',
    );
  });

  it('meldet keine Tastaturfalle, wo keine ist (2.1.2)', async () => {
    // Grober Selektor trifft mehrere Elemente zugleich; frueher sah das aus
    // wie eine Falle. Der Test haelt diesen Fehlalarm fern.
    const ergebnis = await regeln('tastaturfalle');
    assert.deepEqual(ergebnis.befunde, []);
  });

  it('erkennt eine fremdsprachige Passage (3.1.2)', async () => {
    const ergebnis = await findeEngine('sprache')!.ausfuehren(kontext, ['fremdsprachige-passage']);
    const treffer = ergebnis.befunde.filter((b) => b.regelId === 'fremdsprachige-passage');

    assert.equal(treffer.length, 1, 'genau der englische Absatz, nicht der deutsche');
    assert.match(treffer[0]?.beschreibung ?? '', /Englisch/);
  });

  it('haelt Regeln auseinander: was nicht verlangt wird, laeuft nicht', async () => {
    const ergebnis = await regeln('tooltip-escape');
    assert.deepEqual(ergebnis.ausgefuehrteRegeln, ['tooltip-escape']);
    assert.ok(ergebnis.befunde.every((b) => b.regelId === 'tooltip-escape'));
  });
});
