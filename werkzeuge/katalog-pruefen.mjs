#!/usr/bin/env node
/**
 * Prüft den Katalog auf Schemakonformität und Vollständigkeit.
 *
 *   node werkzeuge/katalog-pruefen.mjs
 *
 * Läuft ohne Abhängigkeiten. Beendet sich mit Code 1, wenn etwas nicht stimmt —
 * damit als Test und in einer Prüfstrecke verwendbar.
 *
 * Bezug: katalog/README.md, katalog/schema.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const katalogPfad = path.join(wurzel, 'katalog');
const promptPfad = path.join(wurzel, 'prompts', 'stufe2.md');

const DATEIEN = ['1-wahrnehmbarkeit', '2-bedienbarkeit', '3-verstaendlichkeit', '4-robustheit'];
const PRINZIPIEN = ['wahrnehmbarkeit', 'bedienbarkeit', 'verstaendlichkeit', 'robustheit'];
const ENGINES = ['axe', 'ibm', 'html', 'sprache', 'ocr', 'pixel', 'eigen'];

const ERWARTET = { gesamt: 56, wcag21: 50, wcag22: 55, levelA: 30, levelAA: 20 };

const fehler = [];
const kriterien = [];

// ---------------------------------------------------------------- einlesen

for (const datei of DATEIEN) {
  const pfad = path.join(katalogPfad, `${datei}.json`);
  let inhalt;
  try {
    inhalt = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  } catch (e) {
    fehler.push(`${datei}.json: nicht lesbar oder kein gültiges JSON — ${e.message}`);
    continue;
  }

  if (!PRINZIPIEN.includes(inhalt.prinzip)) {
    fehler.push(`${datei}.json: unbekanntes Prinzip "${inhalt.prinzip}"`);
  }
  if (!Array.isArray(inhalt.kriterien) || inhalt.kriterien.length === 0) {
    fehler.push(`${datei}.json: keine Kriterien enthalten`);
    continue;
  }

  for (const k of inhalt.kriterien) {
    pruefeKriterium(k, inhalt.prinzip, `${datei}.json/${k.id ?? '?'}`);
    kriterien.push(k);
  }

  console.log(`  ${datei}.json — ${inhalt.kriterien.length} Kriterien`);
}

function pruefeKriterium(k, prinzipDerDatei, ort) {
  const melde = (t) => fehler.push(`${ort}: ${t}`);

  if (!/^[1-4]\.\d+\.\d+$/.test(k.id ?? '')) melde('id entspricht nicht dem Muster N.N.N');
  if (!['A', 'AA'].includes(k.level)) melde(`level "${k.level}" ungültig`);
  if (k.prinzip !== prinzipDerDatei) melde('prinzip weicht vom Prinzip der Datei ab');
  if (!k.titel || k.titel.length < 3) melde('titel fehlt oder zu kurz');

  if (!['2.0', '2.1', '2.2'].includes(k.standard?.eingefuehrtMit)) melde('standard.eingefuehrtMit ungültig');
  if (!(k.standard?.entfallenAb === null || k.standard?.entfallenAb === '2.2')) melde('standard.entfallenAb ungültig');

  if (!k.beschreibung || k.beschreibung.length < 20) melde('beschreibung fehlt oder zu kurz');
  if (!(k.anwendbarWenn === null || typeof k.anwendbarWenn === 'string')) melde('anwendbarWenn muss Zeichenkette oder null sein');

  if (!Array.isArray(k.pruefungen) || k.pruefungen.length === 0) {
    melde('pruefungen fehlen');
  } else {
    for (const p of k.pruefungen) {
      if (!['auto', 'llm', 'manuell'].includes(p.typ)) { melde(`pruefung typ "${p.typ}" ungültig`); continue; }
      if (p.typ === 'auto') {
        if (!ENGINES.includes(p.engine)) melde(`engine "${p.engine}" unbekannt`);
        if (!Array.isArray(p.regelIds) || p.regelIds.length === 0) melde('regelIds fehlen bei typ=auto');
      }
      if (p.typ === 'llm') {
        if (!/^[a-z0-9-]+$/.test(p.pruefungsId ?? '')) melde('pruefungsId fehlt oder ungültig');
        if (!Number.isInteger(p.buendelGroesse)) melde('buendelGroesse fehlt');
      }
      if (p.typ === 'manuell' && (!p.frage || p.frage.length < 10)) melde('frage fehlt oder zu kurz');
    }
  }

  const e = k.empfehlung;
  if (!e?.text || e.text.length < 20) melde('empfehlung.text fehlt oder zu kurz');
  if (!Array.isArray(e?.referenzen) || e.referenzen.length === 0) melde('empfehlung.referenzen fehlen');
  for (const r of e?.referenzen ?? []) {
    if (!r.titel || !/^https?:\/\//.test(r.url ?? '')) melde('referenz unvollständig');
  }
  if (e?.codeBeispiel && !('vorher' in e.codeBeispiel && 'nachher' in e.codeBeispiel)) {
    melde('codeBeispiel braucht vorher und nachher');
  }
}

// ---------------------------------------------------------------- Zählung

const wcag21 = kriterien.filter((k) => ['2.0', '2.1'].includes(k.standard?.eingefuehrtMit));
const wcag22 = kriterien.filter((k) => k.standard?.entfallenAb !== '2.2');

const zaehlung = [
  ['Kriterien gesamt', kriterien.length, ERWARTET.gesamt],
  ['gültig unter WCAG 2.1', wcag21.length, ERWARTET.wcag21],
  ['gültig unter WCAG 2.2', wcag22.length, ERWARTET.wcag22],
  ['davon Level A (2.1)', wcag21.filter((k) => k.level === 'A').length, ERWARTET.levelA],
  ['davon Level AA (2.1)', wcag21.filter((k) => k.level === 'AA').length, ERWARTET.levelAA],
];

console.log('');
for (const [bez, ist, soll] of zaehlung) {
  const gut = ist === soll;
  console.log(`  ${gut ? '✓' : '✗'} ${bez.padEnd(24)} ${String(ist).padStart(3)}  (erwartet ${soll})`);
  if (!gut) fehler.push(`Zählung: ${bez} ist ${ist}, erwartet ${soll}`);
}

// doppelte Kennungen
const ids = kriterien.map((k) => k.id);
const doppelt = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
if (doppelt.length) fehler.push(`doppelte Kriterien-IDs: ${doppelt.join(', ')}`);

// ------------------------------------------------ Abgleich mit den Prompts

if (fs.existsSync(promptPfad)) {
  const md = fs.readFileSync(promptPfad, 'utf8');
  const inPrompts = [...md.matchAll(/^## \d+\. `([a-z0-9-]+)`/gm)].map((m) => m[1]);
  const imKatalog = [...new Set(
    kriterien.flatMap((k) => (k.pruefungen ?? []).filter((p) => p.typ === 'llm').map((p) => p.pruefungsId))
  )];

  const fehlend = imKatalog.filter((id) => !inPrompts.includes(id));
  const ueberzaehlig = inPrompts.filter((id) => !imKatalog.includes(id));

  if (fehlend.length) fehler.push(`Prompt fehlt in prompts/stufe2.md: ${fehlend.join(', ')}`);
  if (ueberzaehlig.length) fehler.push(`Prompt ohne Verwendung im Katalog: ${ueberzaehlig.join(', ')}`);

  console.log(`\n  ${fehlend.length + ueberzaehlig.length === 0 ? '✓' : '✗'} Prompts abgeglichen — ${imKatalog.length} Prüfungen der Stufe 2`);
} else {
  console.log('\n  ! prompts/stufe2.md nicht gefunden — Abgleich übersprungen');
}

// ---------------------------------------------------------------- Ergebnis

console.log('');
if (fehler.length) {
  console.error(`${fehler.length} Beanstandung${fehler.length === 1 ? '' : 'en'}:\n`);
  for (const f of fehler) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('Katalog in Ordnung.');
