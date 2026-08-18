/**
 * Die Sprachmodell-Stufe ohne Sprachmodell.
 *
 * Kein Test hier braucht ein laufendes Ollama. Das ist Absicht: Die Stufe muss
 * auf jedem Rechner prüfbar sein, auch auf einem ohne Modell — sonst wäre der
 * Bau von der Ausstattung des Entwicklers abhängig.
 *
 * Geprüft wird stattdessen mit einem gestellten Adapter, was sich mit einem
 * echten Modell schlecht prüfen ließe: dass ein Fehlschlag zu `unsicher` führt,
 * dass ein `problem` das Kriterium nie auf `nicht_erfuellt` setzt, und dass der
 * Zwischenspeicher greift.
 *
 * Bezug: PRD 6.3 (L-20 bis L-29, L-40 bis L-49), ARCHITEKTUR 5.7
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ladePrompts, setzeEin } from '../src/stufe2/prompts.js';
import { antwortSchema } from '../src/stufe2/adapter/typ.js';
import type { BuendelErgebnis, ModellAdapter, Urteil } from '../src/stufe2/adapter/typ.js';
import { beschreibeFehler } from '../src/stufe2/adapter/ollama.js';
import { fluechtigerSpeicher, inhaltsHash } from '../src/stufe2/cache.js';
import { teileAuf, vorfiltere } from '../src/stufe2/vorfilter.js';
import { betroffeneKriterien } from '../src/stufe2/einrichtung.js';
import { alsDauer, schaetzeLaufzeit, schlageModellVor } from '../src/plattform/hardware.js';
import type { Hardware } from '../src/plattform/hardware.js';
import { leiteStatusAb } from '../src/scan/statusableitung.js';
import { Katalog } from '../src/katalog/laden.js';
import type { Kriterium } from '../src/typen/index.js';

describe('Prompts laden', () => {
  const prompts = ladePrompts();

  it('liest alle elf Prüfungen ein', () => {
    assert.equal(prompts.nachId.size, 11);
    assert.ok(prompts.nachId.has('linkzweck'));
    assert.ok(prompts.nachId.has('lesereihenfolge'));
  });

  it('liest die gemeinsame Systemanweisung', () => {
    assert.match(prompts.systemAnweisung, /ok\s+– die Anforderung ist erfüllt/);
    assert.match(prompts.systemAnweisung, /unsicher/);
  });

  it('liest Bündelgröße, Sammelselektor und Geltungsbereich', () => {
    const linkzweck = prompts.nachId.get('linkzweck');
    assert.equal(linkzweck?.buendelGroesse, 20);
    assert.equal(linkzweck?.sammelSelektor, 'a[href]');
    assert.equal(linkzweck?.kriterium, '2.4.4');
    assert.equal(linkzweck?.nurMehrseitig, false);

    assert.equal(prompts.nachId.get('seitentitel')?.buendelGroesse, 1);
    assert.equal(prompts.nachId.get('konsistente-bezeichnung')?.nurMehrseitig, true);
    assert.equal(prompts.nachId.get('konsistente-hilfe')?.nurStandard, '2.2');
  });

  it('deckt jede llm-Prüfung des Katalogs ab', () => {
    // Faellt dieser Test, nennt der Katalog eine Pruefung, fuer die es keinen
    // Prompt gibt — dann liefe sie ins Leere.
    const katalog = Katalog.laden();
    const imKatalog = new Set(
      katalog
        .fuerStandard('2.2')
        .flatMap((k) => k.pruefungen)
        .filter((p) => p.typ === 'llm')
        .map((p) => (p.typ === 'llm' ? p.pruefungsId : '')),
    );

    for (const id of imKatalog) {
      assert.ok(prompts.nachId.has(id), `Prompt "${id}" fehlt in prompts/stufe2.md`);
    }
  });
});

describe('Werte in Vorlagen einsetzen', () => {
  it('setzt einfache Platzhalter ein', () => {
    assert.equal(setzeEin('Titel: "{{titel}}"', { titel: 'Startseite' }), 'Titel: "Startseite"');
  });

  it('wiederholt Blöcke je Eintrag', () => {
    const vorlage = '{{#elemente}}{{i}}. "{{text}}"\n{{/elemente}}';
    const ergebnis = setzeEin(vorlage, {
      elemente: [
        { i: 1, text: 'hier' },
        { i: 2, text: 'mehr' },
      ],
    });
    assert.equal(ergebnis, '1. "hier"\n2. "mehr"\n');
  });

  it('greift aus einem Block auf die Umgebung zu', () => {
    const ergebnis = setzeEin('{{#liste}}{{seite}}: {{name}}\n{{/liste}}', {
      seite: 'Start',
      liste: [{ name: 'a' }, { name: 'b' }],
    });
    assert.equal(ergebnis, 'Start: a\nStart: b\n');
  });

  it('verschachtelt Blöcke', () => {
    const vorlage = '{{#gruppen}}{{funktion}}:\n{{#vorkommen}}- {{beschriftung}}\n{{/vorkommen}}{{/gruppen}}';
    const ergebnis = setzeEin(vorlage, {
      gruppen: [{ funktion: 'Suche', vorkommen: [{ beschriftung: 'Suchen' }, { beschriftung: 'Finden' }] }],
    });
    assert.equal(ergebnis, 'Suche:\n- Suchen\n- Finden\n');
  });

  it('setzt fehlende Werte leer ein, statt den Platzhalter stehen zu lassen', () => {
    assert.equal(setzeEin('a{{fehlt}}b', {}), 'ab');
  });
});

describe('Antwortschema (L-21, L-22)', () => {
  it('nimmt nur die drei zulässigen Urteile an', () => {
    assert.ok(antwortSchema.safeParse({ ergebnisse: [{ i: 1, urteil: 'ok' }] }).success);
    assert.ok(antwortSchema.safeParse({ ergebnisse: [{ i: 1, urteil: 'problem', begruendung: 'x' }] }).success);
    assert.ok(!antwortSchema.safeParse({ ergebnisse: [{ i: 1, urteil: 'vielleicht' }] }).success);
    assert.ok(!antwortSchema.safeParse({ ergebnisse: [{ urteil: 'ok' }] }).success, 'i ist Pflicht');
  });
});

describe('Vorfilterung', () => {
  it('erkennt nichtssagende Linktexte ohne Modell', () => {
    assert.equal(vorfiltere('linkzweck', { i: 1, text: 'hier klicken' })?.urteil, 'problem');
    assert.equal(vorfiltere('linkzweck', { i: 1, text: 'Mehr' })?.urteil, 'problem');
    assert.equal(vorfiltere('linkzweck', { i: 1, text: 'https://example.org/x' })?.urteil, 'problem');
  });

  it('erkennt eindeutig brauchbare Linktexte ohne Modell', () => {
    assert.equal(vorfiltere('linkzweck', { i: 1, text: 'Datenschutzerklärung der Musterakademie lesen' })?.urteil, 'ok');
  });

  it('überlässt Zweifelsfälle dem Modell', () => {
    assert.equal(vorfiltere('linkzweck', { i: 1, text: 'BITV-Test' }), null);
    assert.equal(vorfiltere('linkzweck', { i: 1, text: 'Kursprogramm' }), null);
  });

  it('teilt eine Sammlung in vorentschieden und zu befragen', () => {
    const { vorentschieden, anModell } = teileAuf('linkzweck', [
      { i: 1, text: 'hier' },
      { i: 2, text: 'BITV' },
      { i: 3, text: 'Zum Kursprogramm der Akademie' },
    ]);

    // Nur "hier" steht auf der Sperrliste. "Zum Kursprogramm der Akademie"
    // enthaelt nach Abzug der Fuellwoerter zwei bedeutungstragende Woerter und
    // faellt damit knapp unter die Schwelle — es geht an das Modell. Das ist
    // die richtige Richtung: Der Vorfilter soll Zeit sparen, nicht urteilen.
    assert.deepEqual(
      vorentschieden.map((v) => v.element['text']),
      ['hier'],
    );
    assert.deepEqual(
      anModell.map((e) => e['text']),
      ['BITV', 'Zum Kursprogramm der Akademie'],
    );
  });
});

describe('Zwischenspeicher (L-28)', () => {
  it('bildet denselben Hash für denselben Inhalt an anderer Stelle', () => {
    const a = inhaltsHash('linkzweck', 'phi4-mini', { i: 3, text: 'Impressum', kontext: '' });
    const b = inhaltsHash('linkzweck', 'phi4-mini', { i: 47, text: ' impressum ', kontext: '' });
    assert.equal(a, b, 'Index und Schreibweise dürfen den Hash nicht ändern');
  });

  it('unterscheidet nach Modell', () => {
    const klein = inhaltsHash('linkzweck', 'phi4-mini', { i: 1, text: 'Impressum' });
    const gross = inhaltsHash('linkzweck', 'phi4:14b', { i: 1, text: 'Impressum' });
    assert.notEqual(klein, gross, 'ein anderes Modell urteilt anders');
  });

  it('unterscheidet nach Prüfung', () => {
    assert.notEqual(
      inhaltsHash('linkzweck', 'm', { i: 1, text: 'Impressum' }),
      inhaltsHash('ueberschrift-aussagekraft', 'm', { i: 1, text: 'Impressum' }),
    );
  });

  it('liefert Bekanntes zurück und zählt Treffer', () => {
    const speicher = fluechtigerSpeicher();
    const hash = inhaltsHash('linkzweck', 'm', { i: 1, text: 'x' });

    assert.equal(speicher.lies(hash), null);
    speicher.schreib(hash, 'linkzweck', 'problem', 'zu kurz');
    assert.deepEqual(speicher.lies(hash), { urteil: 'problem', begruendung: 'zu kurz' });
    assert.equal(speicher.treffer, 1);
    assert.equal(speicher.anfragen, 2);
  });
});

describe('Urteile und Statusableitung (L-23, L-25)', () => {
  const kriterium: Kriterium = {
    id: '2.4.4',
    titel: 'Linkzweck',
    level: 'A',
    prinzip: 'bedienbarkeit',
    standard: { eingefuehrtMit: '2.0', entfallenAb: null },
    beschreibung: 'Beschreibung, die lang genug fuer das Schema ist.',
    anwendbarWenn: 'a[href]',
    pruefungen: [{ typ: 'llm', pruefungsId: 'linkzweck', buendelGroesse: 20 }],
    empfehlung: { text: 'Empfehlung, die lang genug fuer das Schema ist.', referenzen: [] },
  };

  function eingabe(urteile: Urteil[]) {
    return {
      kriterium,
      anwendbar: true,
      befunde: [],
      hinweise: [],
      offeneFragen: [],
      llmUrteile: urteile,
      autoPruefungGelaufen: true,
      herkunft: 'llm',
    };
  }

  it('macht aus einem "problem" niemals einen belegten Verstoss (L-25)', () => {
    // Das ist die wichtigste Zusage der ganzen Stufe: Ein Modellurteil ist ein
    // Hinweis zur Nachpruefung. Wuerde es nicht_erfuellt erzeugen, stuende im
    // Bericht eine Feststellung, die niemand geprueft hat.
    assert.equal(leiteStatusAb(eingabe(['problem'])), 'pruefung_erforderlich');
  });

  it('überführt "unsicher" in die manuelle Liste (L-23)', () => {
    assert.equal(leiteStatusAb(eingabe(['unsicher'])), 'pruefung_erforderlich');
    assert.equal(leiteStatusAb(eingabe(['ok', 'ok', 'unsicher'])), 'pruefung_erforderlich');
  });

  it('lässt "ok" das Kriterium schließen', () => {
    assert.equal(leiteStatusAb(eingabe(['ok', 'ok'])), 'erfuellt');
  });
});

describe('Ein Adapter, der scheitert (L-26, Fallstrick 3)', () => {
  /** Adapter, der nie antwortet — wie ein nicht laufendes Ollama. */
  const kaputt: ModellAdapter = {
    name: 'kaputt',
    modell: 'keins',
    zustand: async () => ({ erreichbar: false, version: null, modelle: [], grund: 'kein Dienst' }),
    bewerte: async (): Promise<BuendelErgebnis> => ({
      urteile: new Map(),
      messung: null,
      fehlschlag: 'Unter http://127.0.0.1:11434 antwortet kein Ollama.',
    }),
    freigeben: async () => undefined,
  };

  it('meldet den Fehlschlag, statt zu werfen', async () => {
    const ergebnis = await kaputt.bewerte('system', 'aufgabe', 3);
    assert.equal(ergebnis.urteile.size, 0);
    assert.ok(ergebnis.fehlschlag);
  });

  it('übersetzt technische Fehler in verständliche Sätze', () => {
    assert.match(beschreibeFehler(new Error('fetch failed'), 'http://127.0.0.1:11434'), /Läuft der Dienst/);
    assert.match(beschreibeFehler(new Error('TimeoutError'), 'x'), /nicht rechtzeitig/);
    assert.match(beschreibeFehler(new Error('model not found'), 'x'), /nicht geladen/);
  });
});

describe('Hardware und Laufzeit (L-42, L-44, L-45)', () => {
  function hardware(speicherGb: number, beschleunigung: Hardware['beschleunigung'] = 'apple-silicon'): Hardware {
    return {
      betriebssystem: 'darwin',
      prozessor: 'Apple M1',
      kerne: 8,
      speicherGb,
      freiGb: 2,
      beschleunigung,
    };
  }

  it('schlägt nach Arbeitsspeicher vor', () => {
    assert.equal(schlageModellVor(hardware(8)).modell, 'phi4-mini');
    assert.equal(schlageModellVor(hardware(16)).modell, 'qwen3:8b');
    assert.equal(schlageModellVor(hardware(32)).modell, 'phi4:14b');
  });

  it('warnt bei knappem Speicher, ohne den Betrieb auszuschliessen', () => {
    const knapp = schlageModellVor(hardware(8));
    assert.ok(knapp.warnung, 'bei 8 GB gehört eine Warnung dazu');
    assert.equal(schlageModellVor(hardware(16)).warnung, null);
  });

  it('nennt Apple Silicon nicht "ohne Grafikbeschleunigung"', () => {
    // PRD 8.1: Apple Silicon ist ausdruecklich kein Rechner ohne Grafikkarte.
    assert.match(schlageModellVor(hardware(8, 'apple-silicon')).erwartetesTempo, /Metal/);
    assert.match(schlageModellVor(hardware(8, 'nur-prozessor')).erwartetesTempo, /ohne Grafikbeschleunigung/);
  });

  it('schätzt die Laufzeit aus gemessenen Werten', () => {
    // Gemessen auf einem M1 mit phi4-mini: rund 150 und 18 Token/s.
    const schaetzung = schaetzeLaufzeit(150, 18);
    assert.ok(schaetzung);
    assert.ok(schaetzung.sekundenJeSeite > 60 && schaetzung.sekundenJeSeite < 300);
    assert.equal(schaetzung.ueberSchwelle, false);
  });

  it('erkennt das Überschreiten der Schwelle (L-45)', () => {
    const langsam = schaetzeLaufzeit(20, 2);
    assert.ok(langsam);
    assert.equal(langsam.ueberSchwelle, true);
  });

  it('schätzt nicht ohne Messung', () => {
    assert.equal(schaetzeLaufzeit(0, 0), null);
  });

  it('schreibt Dauern in Worten', () => {
    assert.equal(alsDauer(45), 'etwa 45 Sekunden');
    assert.equal(alsDauer(60), 'etwa 60 Sekunden', 'unter anderthalb Minuten bleibt es bei Sekunden');
    assert.equal(alsDauer(120), 'etwa 2 Minuten');
    assert.equal(alsDauer(95), 'etwa 2 Minuten');
  });
});

describe('Was ohne Stufe 2 entfällt (L-47)', () => {
  it('nennt genau die Kriterien mit Sprachmodell-Prüfung', () => {
    const katalog = Katalog.laden();
    const betroffen = betroffeneKriterien(katalog.fuerStandard('2.1'));

    assert.deepEqual(betroffen.sort(), ['1.3.1', '1.3.2', '1.3.3', '2.4.2', '2.4.3', '2.4.4', '2.4.6', '3.2.4', '3.3.2', '3.3.3']);
    assert.equal(betroffen.length, 10, 'PRD 6.3.1 nennt zehn betroffene Kriterien');
  });
});
