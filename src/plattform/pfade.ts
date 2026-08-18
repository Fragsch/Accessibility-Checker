/**
 * Auffinden der Projektverzeichnisse.
 *
 * Der Code laeuft an zwei Orten: im Quellbaum (`src/…`, ueber tsx) und nach dem
 * Bau (`dist/src/…`). Ein festes Hochzaehlen von Verzeichnisebenen geht dabei
 * schief. Deshalb wird die Wurzel gesucht, nicht gerechnet: das naechste
 * Verzeichnis oberhalb, das eine `package.json` enthaelt.
 *
 * Bezug: ARCHITEKTUR 3 (Ordnerstruktur), NF-13 (drei Betriebssysteme)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let zwischenspeicher: string | null = null;

export function projektWurzel(): string {
  if (zwischenspeicher !== null) return zwischenspeicher;

  let verzeichnis = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (fs.existsSync(path.join(verzeichnis, 'package.json'))) {
      zwischenspeicher = verzeichnis;
      return verzeichnis;
    }
    const darueber = path.dirname(verzeichnis);
    if (darueber === verzeichnis) {
      throw new Error('Projektwurzel nicht gefunden — keine package.json oberhalb des Werkzeugs.');
    }
    verzeichnis = darueber;
  }
}

/** Der Pruefkatalog. Liegt als Daten neben dem Code, nicht darin (Regel 1). */
export function katalogVerzeichnis(): string {
  return path.join(projektWurzel(), 'katalog');
}

/** Betriebsdaten: Datenbank, Belege, Protokoll. Nicht versioniert. */
export function datenVerzeichnis(): string {
  return path.join(projektWurzel(), 'daten');
}

export function protokollDatei(): string {
  return path.join(datenVerzeichnis(), 'protokoll.jsonl');
}
