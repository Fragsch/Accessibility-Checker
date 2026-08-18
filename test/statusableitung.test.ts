/**
 * Statusableitung, Verdichtung und ACR-Abbildung.
 * Bezug: ARCHITEKTUR 5.2 bis 5.4 — diese Regeln sind bindend.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aufAcr, baueBewertung, istEntwurf, leiteStatusAb, verdichte } from '../src/scan/statusableitung.js';
import type { AbleitungEingabe } from '../src/scan/statusableitung.js';
import type { Befund, Hinweis, Kriterium, OffeneFrage, SeitenErgebnis, Status } from '../src/typen/index.js';

const KRITERIUM: Kriterium = {
  id: '1.1.1',
  titel: 'Nicht-Text-Inhalte',
  level: 'A',
  prinzip: 'wahrnehmbarkeit',
  standard: { eingefuehrtMit: '2.0', entfallenAb: null },
  beschreibung: 'Beschreibung, die lang genug fuer das Schema ist.',
  anwendbarWenn: 'img',
  pruefungen: [{ typ: 'auto', engine: 'axe', regelIds: ['image-alt'] }],
  empfehlung: { text: 'Empfehlung, die lang genug fuer das Schema ist.', referenzen: [] },
};

const BEFUND: Befund = {
  kriterium: '1.1.1',
  regelId: 'image-alt',
  engine: 'axe',
  selektor: 'img',
  htmlAusschnitt: '<img>',
  beschreibung: 'Abbildung ohne Alternativtext',
  schwere: 'kritisch',
};

const HINWEIS: Hinweis = { kriterium: '1.1.1', text: 'nicht pruefbar', herkunft: 'axe' };
const FRAGE: OffeneFrage = {
  id: 'abc123',
  kriterium: '1.1.1',
  frage: 'Stimmt der Text?',
  kontextSelektor: null,
  betroffeneElemente: null,
  herkunft: 'katalog',
};

function eingabe(teil: Partial<AbleitungEingabe> = {}): AbleitungEingabe {
  return {
    kriterium: KRITERIUM,
    anwendbar: true,
    befunde: [],
    hinweise: [],
    offeneFragen: [],
    autoPruefungGelaufen: true,
    herkunft: 'auto/axe',
    ...teil,
  };
}

describe('Statusableitung je Seite (5.2)', () => {
  it('nicht anwendbar schlaegt alles andere', () => {
    const status = leiteStatusAb(eingabe({ anwendbar: false, befunde: [BEFUND], offeneFragen: [FRAGE] }));
    assert.equal(status, 'nicht_anwendbar');
  });

  it('ein automatischer Verstoss schlaegt offene Fragen und Hinweise', () => {
    const status = leiteStatusAb(eingabe({ befunde: [BEFUND], hinweise: [HINWEIS], offeneFragen: [FRAGE] }));
    assert.equal(status, 'nicht_erfuellt');
  });

  it('eine offene Frage fuehrt zu pruefung_erforderlich', () => {
    assert.equal(leiteStatusAb(eingabe({ offeneFragen: [FRAGE] })), 'pruefung_erforderlich');
  });

  it('ein Hinweis fuehrt zu pruefung_erforderlich', () => {
    assert.equal(leiteStatusAb(eingabe({ hinweise: [HINWEIS] })), 'pruefung_erforderlich');
  });

  it('ein LLM-Urteil "problem" oder "unsicher" fuehrt zu pruefung_erforderlich', () => {
    assert.equal(leiteStatusAb(eingabe({ llmUrteile: ['problem'] })), 'pruefung_erforderlich');
    assert.equal(leiteStatusAb(eingabe({ llmUrteile: ['unsicher'] })), 'pruefung_erforderlich');
    assert.equal(leiteStatusAb(eingabe({ llmUrteile: ['ok'] })), 'erfuellt');
  });

  it('erfuellt nur, wenn tatsaechlich eine Pruefung gelaufen ist', () => {
    assert.equal(leiteStatusAb(eingabe()), 'erfuellt');
    assert.equal(
      leiteStatusAb(eingabe({ autoPruefungGelaufen: false })),
      'pruefung_erforderlich',
      'ohne gelaufene Pruefung darf nie erfuellt herauskommen',
    );
  });

  it('haelt den Grund der Nichtanwendbarkeit als Hinweis fest', () => {
    const bewertung = baueBewertung(eingabe({ anwendbar: false, grund: 'kein Bild vorhanden' }));
    assert.equal(bewertung.status, 'nicht_anwendbar');
    assert.equal(bewertung.hinweise[0]?.text, 'kein Bild vorhanden');
  });
});

describe('Verdichtung auf Projektebene (5.3)', () => {
  function seite(url: string, status: Status): SeitenErgebnis {
    return {
      url,
      bezeichnung: null,
      titel: null,
      zustand: 'fertig',
      fehler: null,
      bewertungen: [{ kriterium: '1.1.1', status, herkunft: 'auto/axe', befunde: [], hinweise: [], offeneFragen: [] }],
    };
  }

  it('nicht anwendbar nur, wenn es das auf allen Seiten ist', () => {
    const alle = verdichte([seite('a', 'nicht_anwendbar'), seite('b', 'nicht_anwendbar')], [KRITERIUM]);
    assert.equal(alle[0]?.status, 'nicht_anwendbar');

    const gemischt = verdichte([seite('a', 'nicht_anwendbar'), seite('b', 'erfuellt')], [KRITERIUM]);
    assert.equal(gemischt[0]?.status, 'erfuellt');
  });

  it('nicht erfuellt, sobald eine Seite betroffen ist', () => {
    const ergebnis = verdichte([seite('a', 'erfuellt'), seite('b', 'nicht_erfuellt')], [KRITERIUM]);
    assert.equal(ergebnis[0]?.status, 'nicht_erfuellt');
    assert.deepEqual(ergebnis[0]?.betroffeneSeiten, ['b']);
  });

  it('offen schlaegt erfuellt, aber nicht nicht_erfuellt', () => {
    assert.equal(verdichte([seite('a', 'erfuellt'), seite('b', 'pruefung_erforderlich')], [KRITERIUM])[0]?.status, 'pruefung_erforderlich');
    assert.equal(verdichte([seite('a', 'nicht_erfuellt'), seite('b', 'pruefung_erforderlich')], [KRITERIUM])[0]?.status, 'nicht_erfuellt');
  });

  it('laesst fehlgeschlagene Seiten aussen vor', () => {
    const kaputt: SeitenErgebnis = {
      url: 'c', bezeichnung: null, titel: null, zustand: 'fehler', fehler: 'Zeitueberschreitung', bewertungen: [],
    };
    const ergebnis = verdichte([seite('a', 'erfuellt'), kaputt], [KRITERIUM]);
    assert.equal(ergebnis[0]?.status, 'erfuellt');
  });

  it('gilt als offen, wenn keine Seite ausgewertet werden konnte', () => {
    const ergebnis = verdichte([], [KRITERIUM]);
    assert.equal(ergebnis[0]?.status, 'pruefung_erforderlich');
    assert.equal(ergebnis[0]?.acr, 'nicht_abschliessend_bewertet');
  });
});

describe('ACR-Abbildung (5.4)', () => {
  it('bildet die vier Status ab', () => {
    assert.equal(aufAcr('erfuellt', 0, 3), 'unterstuetzt');
    assert.equal(aufAcr('nicht_anwendbar', 0, 0), 'nicht_anwendbar');
    assert.equal(aufAcr('nicht_erfuellt', 3, 3), 'unterstuetzt_nicht');
    assert.equal(aufAcr('nicht_erfuellt', 1, 3), 'teilweise_unterstuetzt');
  });

  it('bildet pruefung_erforderlich niemals auf unterstuetzt ab (X-14)', () => {
    for (let betroffen = 0; betroffen <= 3; betroffen += 1) {
      assert.equal(aufAcr('pruefung_erforderlich', betroffen, 3), 'nicht_abschliessend_bewertet');
    }
  });

  it('erkennt einen Entwurf an offenen Kriterien (Regel 4)', () => {
    assert.equal(istEntwurf([{ kriterium: '1.1.1', status: 'erfuellt', acr: 'unterstuetzt', betroffeneSeiten: [], anwendbareSeiten: 1 }]), false);
    assert.equal(istEntwurf([{ kriterium: '1.1.1', status: 'pruefung_erforderlich', acr: 'nicht_abschliessend_bewertet', betroffeneSeiten: [], anwendbareSeiten: 1 }]), true);
  });
});
