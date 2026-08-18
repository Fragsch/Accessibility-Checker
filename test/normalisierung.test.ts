/**
 * Zuordnung von Engine-Befunden zu Erfolgskriterien.
 * Bezug: ARCHITEKTUR 5.1, CLAUDE.md Regel 8
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Result } from 'axe-core';

import { normalisiereAxe } from '../src/stufe1/normalisierung.js';
import { Protokoll } from '../src/protokoll.js';

function verstoss(id: string, teil: Partial<Result> = {}): Result {
  return {
    id,
    impact: 'serious',
    tags: ['wcag2a'],
    description: `Beschreibung ${id}`,
    help: `Hilfe ${id}`,
    helpUrl: `https://example.org/${id}`,
    nodes: [
      {
        html: '<img src="x.png">',
        target: ['img'],
        any: [],
        all: [],
        none: [],
        impact: 'critical',
        failureSummary: 'Behebe eines davon:\n  Kein alt-Attribut',
      },
    ],
    ...teil,
  } as Result;
}

function stillesProtokoll(): Protokoll {
  return new Protokoll({ datei: null, konsoleAb: null });
}

describe('Normalisierung von axe-Befunden', () => {
  it('ordnet einen Befund dem Kriterium aus dem Katalog zu', () => {
    const ergebnis = normalisiereAxe([verstoss('image-alt')], [], {
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
    const ergebnis = normalisiereAxe([verstoss('label')], [], {
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
    const ergebnis = normalisiereAxe([verstoss('unbekannte-regel')], [], {
      zuordnung: new Map(),
      geprueftesKriterium: () => true,
      protokoll,
    });

    assert.equal(ergebnis.befunde.length, 0);
    assert.deepEqual(ergebnis.verworfeneRegeln, ['unbekannte-regel']);

    const warnungen = protokoll.gefiltert('warnung');
    assert.equal(warnungen.length, 1);
    assert.match(warnungen[0]?.text ?? '', /unbekannte-regel/);
  });

  it('laesst Kriterien aus, die im gewaehlten Standard nicht gelten', () => {
    const ergebnis = normalisiereAxe([verstoss('duplicate-id-active')], [], {
      zuordnung: new Map([['duplicate-id-active', ['4.1.1']]]),
      geprueftesKriterium: (id) => id !== '4.1.1',
      protokoll: stillesProtokoll(),
    });
    assert.equal(ergebnis.befunde.length, 0);
    assert.equal(ergebnis.verworfeneRegeln.length, 0, 'kein Protokolleintrag — die Regel ist ja zugeordnet');
  });

  it('macht aus einem Zweifelsfall einen Hinweis, keinen Befund', () => {
    const ergebnis = normalisiereAxe([], [verstoss('color-contrast')], {
      zuordnung: new Map([['color-contrast', ['1.4.3']]]),
      geprueftesKriterium: () => true,
      protokoll: stillesProtokoll(),
    });

    assert.equal(ergebnis.befunde.length, 0);
    assert.equal(ergebnis.hinweise.length, 1);
    assert.equal(ergebnis.hinweise[0]?.kriterium, '1.4.3');
    assert.equal(ergebnis.hinweise[0]?.herkunft, 'axe/color-contrast');
  });

  it('setzt verschachtelte Selektoren aus iframes zusammen', () => {
    const ergebnis = normalisiereAxe(
      [verstoss('image-alt', { nodes: [{ html: '<img>', target: [['iframe#a', 'img']], any: [], all: [], none: [] }] as Result['nodes'] })],
      [],
      { zuordnung: new Map([['image-alt', ['1.1.1']]]), geprueftesKriterium: () => true, protokoll: stillesProtokoll() },
    );
    assert.equal(ergebnis.befunde[0]?.selektor, 'iframe#a >>> img');
  });
});
