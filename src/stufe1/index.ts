/**
 * Verzeichnis der Prüf-Engines der Stufe 1.
 *
 * Der Runner kennt keine einzelne Engine namentlich — er fragt hier nach, was
 * vorhanden ist. Eine neue Engine wird eingetragen und laeuft mit; eine
 * fehlende erzeugt beim betroffenen Kriterium einen Hinweis und damit
 * `pruefung_erforderlich`, nie ein stilles Bestehen.
 *
 * Die Reihenfolge zaehlt. Zuerst laufen die Engines, die nur lesen; danach
 * die, die die Seite anfassen. `eigen` kommt deshalb an den Schluss: Der
 * Tastatur-Durchlauf verschiebt den Fokus, die Formularpruefung loest
 * Zustandsaenderungen aus, die Darstellungspruefung veraendert den Viewport.
 */

import type { Engine as EngineName } from '../typen/index.js';
import type { PruefEngine } from './engine.js';
import { axeEngine } from './axe.js';
import { htmlEngine } from './html.js';
import { spracheEngine } from './sprache.js';
import { ocrEngine } from './ocr.js';
import { pixelEngine } from './pixel.js';
import { eigenEngine } from './eigen/index.js';

/** Alle gebauten Engines, in Ausfuehrungsreihenfolge. */
export const ENGINES: readonly PruefEngine[] = [
  axeEngine,
  htmlEngine,
  spracheEngine,
  pixelEngine,
  ocrEngine,
  eigenEngine,
];

const NACH_NAME = new Map<EngineName, PruefEngine>(ENGINES.map((e) => [e.name, e]));

export function findeEngine(name: EngineName): PruefEngine | undefined {
  return NACH_NAME.get(name);
}

/** Namen aller vorhandenen Engines. */
export function vorhandeneEngines(): Set<EngineName> {
  return new Set(NACH_NAME.keys());
}

export type { EngineErgebnis, EngineKontext, PruefEngine, RohBefund, RohHinweis } from './engine.js';
