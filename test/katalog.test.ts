/**
 * Katalog: Einlesen, Schemapruefung, Filter nach Standard, Regelzuordnung.
 * Bezug: ARCHITEKTUR 9 Schritt 1, katalog/README.md
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { projektWurzel } from '../src/plattform/pfade.js';
import { Katalog, KatalogFehler, standardKatalogPfad } from '../src/katalog/laden.js';
import { ENGINES, LEVEL, PRINZIPIEN, kriteriumSchema } from '../src/katalog/schema.js';

const WURZEL = projektWurzel();

describe('Katalog laden', () => {
  const katalog = Katalog.laden();

  it('liest alle 56 Kriterien ein', () => {
    assert.equal(katalog.kriterien.length, 56);
  });

  it('filtert nach WCAG 2.1 auf 50 Kriterien', () => {
    assert.equal(katalog.fuerStandard('2.1').length, 50);
  });

  it('filtert nach WCAG 2.2 auf 55 Kriterien', () => {
    assert.equal(katalog.fuerStandard('2.2').length, 55);
  });

  it('laesst 4.1.1 unter 2.2 entfallen, unter 2.1 nicht', () => {
    assert.ok(katalog.fuerStandard('2.1').some((k) => k.id === '4.1.1'));
    assert.ok(!katalog.fuerStandard('2.2').some((k) => k.id === '4.1.1'));
  });

  it('findet ein Kriterium ueber seine Kennung', () => {
    const kriterium = katalog.findeKriterium('1.1.1');
    assert.equal(kriterium?.titel, 'Nicht-Text-Inhalte');
  });

  it('meldet einen kaputten Katalog als Fehler, statt ihn zu ueberspringen', () => {
    assert.throws(() => Katalog.laden(path.join(WURZEL, 'katalog-gibt-es-nicht')), KatalogFehler);
  });
});

describe('Regelzuordnung', () => {
  const katalog = Katalog.laden();

  it('ordnet jede axe-Regel mindestens einem Kriterium zu', () => {
    const zuordnung = katalog.regelZuordnung('axe', '2.1');
    assert.ok(zuordnung.size > 50, `nur ${zuordnung.size} Regeln zugeordnet`);
    for (const [regel, kriterien] of zuordnung) {
      assert.ok(kriterien.length > 0, `Regel ${regel} ohne Kriterium`);
    }
  });

  it('laesst die Regeln entfallener Kriterien mit dem Standard wegfallen', () => {
    // 4.1.1 entfaellt unter 2.2 — die dafuer zustaendigen Regeln duerfen dann
    // nicht mehr laufen, sonst erzeugen sie Befunde ohne gueltiges Kriterium.
    const unter21 = katalog.regelZuordnung('axe', '2.1');
    const unter22 = katalog.regelZuordnung('axe', '2.2');

    assert.ok(unter21.has('duplicate-id-active'));
    assert.ok(!unter22.has('duplicate-id-active'));
    assert.deepEqual(unter22.get('image-alt'), unter21.get('image-alt'), 'unveraenderte Kriterien bleiben gleich');
  });

  it('trennt die Engines', () => {
    const proEngine = (['axe', 'html', 'sprache', 'ocr', 'pixel', 'eigen'] as const).map((engine) => ({
      engine,
      regeln: katalog.regelIds(engine, '2.1'),
    }));

    for (const { engine, regeln } of proEngine) {
      assert.ok(regeln.length > 0, `Engine ${engine} hat keine Regeln im Katalog`);
    }

    // Die gemeinsame Zuordnungstabelle setzt voraus, dass Regel-IDs eindeutig
    // sind — sonst schriebe eine Engine die Zuordnung einer anderen um.
    const alle = proEngine.flatMap((p) => p.regeln);
    assert.equal(new Set(alle).size, alle.length, 'Regel-IDs verschiedener Engines duerfen sich nicht ueberschneiden');
  });

  it('fuehrt alle Regeln in der gemeinsamen Zuordnung', () => {
    const gemeinsam = katalog.alleRegelZuordnungen('2.1');
    for (const engine of ['axe', 'html', 'sprache', 'ocr', 'pixel', 'eigen'] as const) {
      for (const regel of katalog.regelIds(engine, '2.1')) {
        assert.ok(gemeinsam.has(regel), `${regel} fehlt in der gemeinsamen Zuordnung`);
      }
    }
  });
});

describe('Laufzeitschema und katalog/schema.json', () => {
  const schemaJson = JSON.parse(fs.readFileSync(path.join(standardKatalogPfad(), 'schema.json'), 'utf8'));

  it('kennt dieselben Prinzipien', () => {
    assert.deepEqual([...PRINZIPIEN], schemaJson.$defs.kriterium.properties.prinzip.enum);
  });

  it('kennt dieselben Level', () => {
    assert.deepEqual([...LEVEL], schemaJson.$defs.kriterium.properties.level.enum);
  });

  it('kennt dieselben Engines', () => {
    const ausJson = schemaJson.$defs.pruefung.allOf[0].then.properties.engine.enum;
    assert.deepEqual([...ENGINES], ausJson);
  });

  it('verlangt dieselben Pflichtfelder je Kriterium', () => {
    const ausJson: string[] = schemaJson.$defs.kriterium.required;
    const ausZod = Object.entries(kriteriumSchema.shape)
      .filter(([, feld]) => !feld.safeParse(undefined).success)
      .map(([name]) => name);
    assert.deepEqual(ausZod.sort(), [...ausJson].sort());
  });

  it('weist unbekannte Felder ab, wie additionalProperties: false es verlangt', () => {
    assert.equal(schemaJson.$defs.kriterium.additionalProperties, false);
    const kriterium = Katalog.laden().kriterien[0];
    const ergebnis = kriteriumSchema.safeParse({ ...kriterium, unbekanntesFeld: 'x' });
    assert.equal(ergebnis.success, false);
  });
});
