/**
 * Anbindung von axe-core (ARCHITEKTUR 9 Schritt 6).
 *
 * Dieses Modul fuehrt axe aus und gibt das Rohergebnis weiter. Die Zuordnung zu
 * Erfolgskriterien passiert in `normalisierung.ts` — hier wird nichts bewertet
 * und nichts geraten.
 *
 * Welche Regeln laufen, ergibt sich aus zwei Quellen:
 *   1. alle Regeln mit einem Kennzeichen des gewaehlten Standards,
 *   2. alle Regeln, die der Katalog fuer diesen Standard zuordnet.
 *
 * Der zweite Punkt ist noetig, weil der Katalog auch Regeln verwendet, die axe
 * als blosse Empfehlung fuehrt. Der erste ist noetig, damit Regeln ohne
 * Zuordnung ueberhaupt auffallen und nach Regel 8 protokolliert werden koennen.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';

import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';
import type { AxeResults, ImpactValue, Result } from 'axe-core';

import type { Standard } from '../typen/index.js';

const erfordere = createRequire(import.meta.url);

/** Kennzeichen, mit denen axe die geprueften Stufen markiert. */
export function axeKennzeichen(standard: Standard): string[] {
  const gemeinsam = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
  return standard === '2.2' ? [...gemeinsam, 'wcag22a', 'wcag22aa'] : gemeinsam;
}

/** Regel-IDs, die axe in der installierten Fassung fuer diese Kennzeichen kennt. */
export async function regelnFuerStandard(standard: Standard): Promise<string[]> {
  const axe = (await import('axe-core')).default;
  const kennzeichen = new Set(axeKennzeichen(standard));
  return axe
    .getRules()
    .filter((regel) => (regel.tags ?? []).some((t) => kennzeichen.has(t)))
    .map((regel) => regel.ruleId);
}

/** Regel-IDs, die es in der installierten axe-Fassung gibt. */
export async function vorhandeneRegeln(): Promise<Set<string>> {
  const axe = (await import('axe-core')).default;
  return new Set(axe.getRules().map((regel) => regel.ruleId));
}

/**
 * axe-Quelltext mit eingeschalteter deutscher Sprachdatei.
 *
 * axe meldet sonst auf Englisch. Da Befundtexte in der Oberflaeche und im
 * Bericht erscheinen, muessen sie deutsch sein (NF-05). axe-core liefert die
 * Uebersetzung mit; sie wird beim Einspritzen ueber `axe.configure` gesetzt.
 * Faellt die Sprachdatei aus, laeuft die Pruefung auf Englisch weiter — ein
 * englischer Befund ist besser als kein Befund.
 */
let quelleMitSprache: string | null = null;

async function axeQuelle(): Promise<string> {
  if (quelleMitSprache !== null) return quelleMitSprache;

  const axe = (await import('axe-core')).default;
  try {
    const pfad = erfordere.resolve('axe-core/locales/de.json');
    const locale: unknown = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    quelleMitSprache = `${axe.source};axe.configure(${JSON.stringify({ locale })});`;
  } catch {
    quelleMitSprache = axe.source;
  }
  return quelleMitSprache;
}

export interface AxeLaufOptionen {
  standard: Standard;
  /** Zusaetzliche Regeln aus dem Katalog, etwa Empfehlungsregeln. */
  zusatzRegeln?: readonly string[];
}

export interface AxeLaufErgebnis {
  /** Belegte Verstoesse. */
  verstoesse: Result[];
  /** Faelle, die axe nicht entscheiden kann — fuehren zu `pruefung_erforderlich`. */
  unentschieden: Result[];
  /** Bestandene Regeln — Beleg dafuer, dass tatsaechlich geprueft wurde. */
  bestandenRegelIds: string[];
  /** Regeln, die auf dieser Seite gegenstandslos waren. */
  nichtAnwendbarRegelIds: string[];
  axeVersion: string;
}

/**
 * Fuehrt axe auf der geladenen Seite aus, einschliesslich erreichbarer iframes.
 * Ein Fehler wird nicht abgefangen — der Aufrufer entscheidet, ob daraus ein
 * Hinweis oder ein Abbruch wird.
 */
export async function fuehreAxeAus(seite: Page, optionen: AxeLaufOptionen): Promise<AxeLaufErgebnis> {
  const vorhanden = await vorhandeneRegeln();
  const ausStandard = await regelnFuerStandard(optionen.standard);

  // Regeln aus dem Katalog, die es nicht mehr gibt, hier stillschweigend
  // auslassen — `npm run axe:abgleich` meldet sie lautstark und bricht ab.
  const zusatz = (optionen.zusatzRegeln ?? []).filter((id) => vorhanden.has(id));
  const regeln = [...new Set([...ausStandard, ...zusatz])];

  const ergebnis: AxeResults = await new AxeBuilder({ page: seite, axeSource: await axeQuelle() })
    .options({ runOnly: { type: 'rule', values: regeln } })
    .analyze();

  return {
    verstoesse: ergebnis.violations,
    unentschieden: ergebnis.incomplete,
    bestandenRegelIds: ergebnis.passes.map((r) => r.id),
    nichtAnwendbarRegelIds: ergebnis.inapplicable.map((r) => r.id),
    axeVersion: ergebnis.testEngine?.version ?? 'unbekannt',
  };
}

/** Uebersetzt die Einstufung von axe in die eigene Schwereskala. */
export function uebersetzeSchwere(impact: ImpactValue | null | undefined): 'kritisch' | 'ernst' | 'maessig' | 'gering' {
  switch (impact) {
    case 'critical':
      return 'kritisch';
    case 'serious':
      return 'ernst';
    case 'moderate':
      return 'maessig';
    case 'minor':
      return 'gering';
    default:
      return 'maessig';
  }
}
