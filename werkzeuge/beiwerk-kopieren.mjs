#!/usr/bin/env node
/**
 * Kopiert Dateien nach dist/, die kein TypeScript sind und die der Compiler
 * daher nicht mitnimmt — derzeit die SQL-Dateien des Datenbankschemas.
 *
 * Bewusst in Node geschrieben statt als cp-Aufruf: das Werkzeug soll auf
 * Windows, macOS und Linux gleich gebaut werden koennen (NF-13).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quelle = path.join(wurzel, 'src');
const ziel = path.join(wurzel, 'dist', 'src');

const ENDUNGEN = ['.sql'];

let anzahl = 0;

function kopiere(verzeichnis) {
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      kopiere(pfad);
      continue;
    }
    if (!ENDUNGEN.includes(path.extname(eintrag.name))) continue;

    const zielpfad = path.join(ziel, path.relative(quelle, pfad));
    fs.mkdirSync(path.dirname(zielpfad), { recursive: true });
    fs.copyFileSync(pfad, zielpfad);
    anzahl += 1;
  }
}

if (!fs.existsSync(ziel)) {
  console.error('dist/src fehlt — zuerst tsc laufen lassen.');
  process.exit(1);
}

kopiere(quelle);
console.log(`${anzahl} Datei(en) nach dist/src kopiert.`);
