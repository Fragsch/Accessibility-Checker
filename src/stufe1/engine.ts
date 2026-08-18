/**
 * Gemeinsamer Vertrag aller Prüf-Engines der Stufe 1.
 *
 * Eine Engine meldet Regelverstoesse — mehr nicht. Welches Erfolgskriterium
 * davon betroffen ist, entscheidet allein der Katalog (ARCHITEKTUR 5.1). Keine
 * Engine kennt hier ein Kriterium.
 *
 * Zwei Angaben sind fuer die Ehrlichkeit des Ergebnisses entscheidend:
 *
 *   `ausgefuehrteRegeln` belegt, welche Regeln tatsaechlich gelaufen sind. Ohne
 *   diesen Beleg gibt es kein `erfuellt` — eine Regel, die stillschweigend
 *   ausfaellt, sieht sonst aus wie eine bestandene Pruefung.
 *
 *   `hinweise` haelt fest, was nicht geprueft werden konnte. Ein Hinweis fuehrt
 *   immer zu `pruefung_erforderlich`, nie zu `erfuellt` (ARCHITEKTUR 5.6).
 */

import type { Page } from 'playwright';

import type { Engine as EngineName, Schwere, Standard } from '../typen/index.js';
import type { Browser, Viewport } from '../scan/browser.js';
import type { Protokoll } from '../protokoll.js';

/** Ein Regelverstoss, noch ohne Zuordnung zu einem Erfolgskriterium. */
export interface RohBefund {
  regelId: string;
  engine: EngineName;
  selektor: string | null;
  htmlAusschnitt: string | null;
  beschreibung: string;
  schwere: Schwere;
  hilfeUrl?: string;
  /** Viewportbreite, bei der der Verstoss auftrat — falls einschlaegig. */
  breite?: number;
}

/** Etwas konnte nicht geprueft werden, bezogen auf eine Regel. */
export interface RohHinweis {
  regelId: string;
  engine: EngineName;
  text: string;
}

export interface EngineErgebnis {
  befunde: RohBefund[];
  hinweise: RohHinweis[];
  /** Regeln, die tatsaechlich ausgefuehrt wurden — Beleg fuer die Pruefung. */
  ausgefuehrteRegeln: string[];
}

export interface EngineKontext {
  seite: Page;
  browser: Browser;
  url: string;
  standard: Standard;
  viewport: Viewport;
  /** Quelltext, wie der Server ihn geliefert hat — vor jedem JavaScript. */
  quelltext: string | null;
  protokoll: Protokoll;
}

export interface PruefEngine {
  readonly name: EngineName;
  /** Alle Regeln, die diese Engine kennt. */
  regeln(): readonly string[];
  /**
   * Fuehrt die verlangten Regeln aus.
   * Regeln, die die Engine nicht kennt, ignoriert sie stillschweigend — der
   * Aufrufer merkt es daran, dass sie nicht in `ausgefuehrteRegeln` stehen.
   */
  ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis>;
}

export const LEERES_ERGEBNIS: EngineErgebnis = { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

/** Fuegt mehrere Engine-Ergebnisse zusammen. */
export function fuegeZusammen(ergebnisse: readonly EngineErgebnis[]): EngineErgebnis {
  return {
    befunde: ergebnisse.flatMap((e) => e.befunde),
    hinweise: ergebnisse.flatMap((e) => e.hinweise),
    ausgefuehrteRegeln: [...new Set(ergebnisse.flatMap((e) => e.ausgefuehrteRegeln))],
  };
}

/** Kuerzt einen HTML-Ausschnitt auf ein anzeigbares Mass. */
export function kuerzeHtml(html: string | null | undefined, hoechstlaenge = 400): string | null {
  if (!html) return null;
  const einzeilig = html.replace(/\s+/g, ' ').trim();
  return einzeilig.length > hoechstlaenge ? `${einzeilig.slice(0, hoechstlaenge)}…` : einzeilig;
}
