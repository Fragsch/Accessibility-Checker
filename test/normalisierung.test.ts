/**
 * Zuordnung von Engine-Befunden zu Erfolgskriterien.
 * Bezug: ARCHITEKTUR 5.1, CLAUDE.md Regel 8
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalisiere } from '../src/stufe1/normalisierung.js';
import type { RohBefund, RohHinweis } from '../src/stufe1/engine.js';
import { Protokoll } from '../src/protokoll.js';

function roh(regelId: string, teil: Partial<RohBefund> = {}): RohBefund {
  return {
    regelId,
    engine: 'axe',
    selektor: 'img',
    htmlAusschnitt: '<img src="x.png">',
    beschreibung: `Beschreibung zu ${regelId}`,
    schwere: 'kritisch',
    ...teil,
  };
}

function stillesProtokoll(): Protokoll {
  return new Protokoll({ datei: null, konsoleAb: null });
}

describe('Normalisierung von Engine-Befunden', () => {
  it('ordnet einen Befund dem Kriterium aus dem Katalog zu', () => {
    const ergebnis = normalisiere([roh('image-alt')], [], {
      zuordnung: new Map([['image-alt', ['1.1.1']]]),
      geprueftesKriterium: () => true,
      protokoll: stillesProtokoll(),
    });

    assert.equal(ergebnis.befunde.length, 1);
    assert.equal(ergebnis.befunde[0]?.kriterium, '1.1.1');
    assert.equal(ergebnis.befunde[0]?.regelId, 'image-alt');
    assert.equal(ergebnis.befunde[0]?.schwere, 'kritisch');
    assert.equal(ergebnis.befunde[0]?.selektor, 'img');
  });

  it('erzeugt je zugeordnetem Kriterium einen Befund', () => {
    const ergebnis = normalisiere([roh('label')], [], {
      zuordnung: new Map([['label', ['1.3.1', '3.3.2', '4.1.2']]]),
      geprueftesKriterium: () => true,
      protokoll: stillesProtokoll(),
    });
    assert.deepEqual(
      ergebnis.befunde.map((b) => b.kriterium),
      ['1.3.1', '3.3.2', '4.1.2'],
    );
  });

  it('verwirft einen Befund ohne Katalogzuordnung und protokolliert ihn (Regel 8)', () => {
    const protokoll = stillesProtokoll();
    const ergebnis = normalisiere([roh('unbekannte-regel')], [], {
      zuordnung: new Map(),
      geprueftesKriterium: () => true,
      protokoll,
    });

    assert.equal(ergebnis.befunde.length, 0);
    assert.deepEqual(ergebnis.verworfeneRegeln, ['axe/unbekannte-regel']);

    const warnungen = protokoll.gefiltert('warnung');
    assert.equal(warnungen.length, 1);
    assert.match(warnungen[0]?.text ?? '', /unbekannte-regel/);
  });

  it('laesst Kriterien aus, die im gewaehlten Standard nicht gelten', () => {
    const ergebnis = normalisiere([roh('duplicate-id-active')], [], {
      zuordnung: new Map([['duplicate-id-active', ['4.1.1']]]),
      geprueftesKriterium: (id) => id !== '4.1.1',
      protokoll: stillesProtokoll(),
    });
    assert.equal(ergebnis.befunde.length, 0);
    assert.equal(ergebnis.verworfeneRegeln.length, 0, 'kein Protokolleintrag — die Regel ist ja zugeordnet');
  });

  it('macht aus einem Zweifelsfall einen Hinweis, keinen Befund', () => {
    const hinweis: RohHinweis = {
      regelId: 'color-contrast',
      engine: 'axe',
      text: 'axe konnte den Kontrast nicht bestimmen.',
    };

    const ergebnis = normalisiere([], [hinweis], {
      zuordnung: new Map([['color-contrast', ['1.4.3']]]),
      geprueftesKriterium: () => true,
      protokoll: stillesProtokoll(),
    });

    assert.equal(ergebnis.befunde.length, 0);
    assert.equal(ergebnis.hinweise.length, 1);
    assert.equal(ergebnis.hinweise[0]?.kriterium, '1.4.3');
    assert.equal(ergebnis.hinweise[0]?.herkunft, 'axe/color-contrast');
  });

  it('ordnet Befunde verschiedener Engines nach derselben Regel zu', () => {
    const ergebnis = normalisiere(
      [roh('image-alt'), roh('text-in-bild', { engine: 'ocr', selektor: 'img.aktion', beschreibung: 'Text im Bild' })],
      [],
      {
        zuordnung: new Map([
          ['image-alt', ['1.1.1']],
          ['text-in-bild', ['1.4.5']],
        ]),
        geprueftesKriterium: () => true,
        protokoll: stillesProtokoll(),
      },
    );

    assert.deepEqual(
      ergebnis.befunde.map((b) => `${b.engine}:${b.kriterium}`),
      ['axe:1.1.1', 'ocr:1.4.5'],
    );
  });

  it('entdoppelt gleiche Aussagen zur selben Stelle', () => {
    // Derselbe Mangel, von zwei Engines gemeldet — im Ergebnis steht er einmal.
    const ergebnis = normalisiere(
      [
        roh('no-dup-id', { engine: 'html', selektor: '#box', beschreibung: 'Kennung doppelt' }),
        roh('duplicate-id-active', { engine: 'axe', selektor: '#box', beschreibung: 'Kennung doppelt' }),
      ],
      [],
      {
        zuordnung: new Map([
          ['no-dup-id', ['4.1.1']],
          ['duplicate-id-active', ['4.1.1']],
        ]),
        geprueftesKriterium: () => true,
        protokoll: stillesProtokoll(),
      },
    );

    assert.equal(ergebnis.befunde.length, 1);
    assert.equal(ergebnis.befunde[0]?.engine, 'html', 'der erste Treffer bleibt stehen');
  });

  it('setzt verschachtelte Selektoren aus iframes zusammen', async () => {
    const { selektorAlsText } = await import('../src/stufe1/axe.js');
    assert.equal(selektorAlsText([['iframe#a', 'img']]), 'iframe#a >>> img');
    assert.equal(selektorAlsText(['img']), 'img');
    assert.equal(selektorAlsText(undefined), null);
  });
});
