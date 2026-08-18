#!/usr/bin/env node
/**
 * Gleicht die axe-Regel-IDs im Prüfkatalog gegen die tatsächlich installierte
 * Fassung von axe-core ab — in beide Richtungen.
 *
 *   node werkzeuge/axe-abgleich.mjs
 *
 * Warum das nötig ist: axe-core benennt Regeln zwischen Versionen gelegentlich
 * um und ordnet sie neu zu. Eine Regel-ID im Katalog, die es nicht mehr gibt,
 * führt zu einer stillschweigend ausgelassenen Prüfung — der gefährlichste
 * Fehlerfall, weil er wie ein bestandener Test aussieht.
 *
 * Die zweite Richtung ist ebenso wichtig: Eine axe-Regel ohne Zuordnung im
 * Katalog erzeugt Befunde, die nach Regel 8 aus CLAUDE.md verworfen werden.
 * Auch das bleibt sonst unbemerkt.
 *
 * Beendet sich mit Code 1 bei fehlenden Regeln, mit Code 0 bei bloßen Lücken
 * in der Zuordnung — diese sind zu bewerten, aber kein Baufehler.
 *
 * Bezug: CLAUDE.md „Wichtig beim Einstieg“, katalog/README.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const katalogPfad = path.join(wurzel, 'katalog');

const DATEIEN = ['1-wahrnehmbarkeit', '2-bedienbarkeit', '3-verstaendlichkeit', '4-robustheit'];

/** Regeln, die axe als Empfehlung führt und die bewusst nicht zugeordnet sind. */
const BEWUSST_OHNE_ZUORDNUNG = new Set([
  'accesskeys',
  'aria-allowed-role',
  'empty-heading',
  'frame-tested',
  'heading-order',
  'identical-links-same-purpose',
  'image-redundant-alt',
  'label-title-only',
  'landmark-banner-is-top-level',
  'landmark-complementary-is-top-level',
  'landmark-contentinfo-is-top-level',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-main',
  'landmark-one-main',
  'landmark-unique',
  'meta-viewport-large',
  'p-as-heading',
  'page-has-heading-one',
  'presentation-role-conflict',
  'region',
  'scope-attr-valid',
  'skip-link',
  'tabindex',
  'table-duplicate-name',
  'table-fake-caption',
  'td-has-header',
]);

// ------------------------------------------------- axe-core laden

let axe;
try {
  axe = (await import('axe-core')).default;
} catch {
  console.error('axe-core ist nicht installiert.');
  console.error('Dieser Abgleich gehört zu Phase 1. Bis dahin:');
  console.error('  npm install axe-core');
  process.exit(0); // kein Baufehler, solange Phase 1 nicht begonnen hat
}

const axeVersion = axe.version ?? 'unbekannt';
const axeRegeln = new Map(axe.getRules().map((r) => [r.ruleId, r]));

console.log(`axe-core ${axeVersion} — ${axeRegeln.size} Regeln verfügbar\n`);

// ------------------------------------------------- Katalog laden

/** @type {Map<string, string[]>} Regel-ID → Kriterien, die sie verwenden */
const imKatalog = new Map();

for (const datei of DATEIEN) {
  const inhalt = JSON.parse(fs.readFileSync(path.join(katalogPfad, `${datei}.json`), 'utf8'));
  for (const k of inhalt.kriterien) {
    for (const p of k.pruefungen.filter((p) => p.typ === 'auto' && p.engine === 'axe')) {
      for (const id of p.regelIds) {
        if (!imKatalog.has(id)) imKatalog.set(id, []);
        imKatalog.get(id).push(k.id);
      }
    }
  }
}

// --------------------------------- Richtung 1: Katalog → axe (kritisch)

const fehlend = [];
for (const [id, kriterien] of imKatalog) {
  if (!axeRegeln.has(id)) fehlend.push({ id, kriterien });
}

if (fehlend.length) {
  console.error(`✗ ${fehlend.length} Regel-ID${fehlend.length === 1 ? '' : 's'} im Katalog gibt es in axe-core ${axeVersion} nicht:\n`);
  for (const { id, kriterien } of fehlend) {
    console.error(`    ${id.padEnd(34)} verwendet bei ${kriterien.join(', ')}`);
  }
  console.error('\n  Diese Prüfungen laufen ins Leere. Regel umbenannt oder entfallen?');
  console.error('  Katalog anpassen, nicht den Abgleich abschalten.\n');
} else {
  console.log(`✓ Alle ${imKatalog.size} Regel-IDs des Katalogs existieren in axe-core ${axeVersion}`);
}

// ------------------------- Richtung 2: axe → Katalog (zu bewerten)

const ohneZuordnung = [];
for (const [id, regel] of axeRegeln) {
  if (imKatalog.has(id)) continue;
  if (BEWUSST_OHNE_ZUORDNUNG.has(id)) continue;

  const tags = regel.tags ?? [];
  // Nur Regeln melden, die einem geprüften Level zugeordnet sind.
  const relevant = tags.some((t) => ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'].includes(t));
  if (relevant) ohneZuordnung.push({ id, tags: tags.filter((t) => t.startsWith('wcag')) });
}

if (ohneZuordnung.length) {
  console.log(`\n! ${ohneZuordnung.length} axe-Regel${ohneZuordnung.length === 1 ? '' : 'n'} ohne Zuordnung im Katalog:\n`);
  for (const { id, tags } of ohneZuordnung) {
    console.log(`    ${id.padEnd(34)} ${tags.join(' ')}`);
  }
  console.log('\n  Befunde dieser Regeln werden protokolliert und verworfen (Regel 8).');
  console.log('  Entweder im Katalog zuordnen oder in BEWUSST_OHNE_ZUORDNUNG aufnehmen.');
} else {
  console.log('✓ Jede einschlägige axe-Regel ist einem Kriterium zugeordnet');
}

// ------------------------------------------------- Ergebnis

console.log('');
if (fehlend.length) {
  console.error('Abgleich fehlgeschlagen.');
  process.exit(1);
}
console.log('Abgleich in Ordnung.');
