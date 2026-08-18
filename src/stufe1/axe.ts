/**
 * Engine „axe" — Anbindung von axe-core.
 *
 * Die Hauptquelle der Stufe 1. Dieses Modul fuehrt axe aus und liefert
 * Rohbefunde; die Zuordnung zu Erfolgskriterien passiert in
 * `normalisierung.ts` anhand des Katalogs.
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

import type { Schwere, Standard } from '../typen/index.js';
import { kuerzeHtml } from './engine.js';
import type { EngineErgebnis, EngineKontext, PruefEngine, RohBefund, RohHinweis } from './engine.js';

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
  verstoesse: Result[];
  unentschieden: Result[];
  bestandenRegelIds: string[];
  nichtAnwendbarRegelIds: string[];
  axeVersion: string;
}

/** Fuehrt axe auf der geladenen Seite aus, einschliesslich erreichbarer iframes. */
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
export function uebersetzeSchwere(impact: ImpactValue | null | undefined): Schwere {
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

export const axeEngine: PruefEngine = {
  name: 'axe',

  regeln(): readonly string[] {
    // axe meldet seine Regeln erst zur Laufzeit; die Liste steht in
    // `vorhandeneRegeln()`. Hier bleibt sie leer, weil der Aufrufer die
    // gewuenschten Regeln ohnehin aus dem Katalog mitgibt.
    return [];
  },

  async ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis> {
    const lauf = await fuehreAxeAus(kontext.seite, {
      standard: kontext.standard,
      zusatzRegeln: gewuenschteRegeln,
    });

    const befunde: RohBefund[] = [];
    for (const verstoss of lauf.verstoesse) {
      for (const stelle of verstoss.nodes) {
        befunde.push({
          regelId: verstoss.id,
          engine: 'axe',
          selektor: selektorAlsText(stelle.target),
          htmlAusschnitt: kuerzeHtml(stelle.html),
          beschreibung: beschreibe(verstoss, stelle.failureSummary),
          schwere: uebersetzeSchwere(stelle.impact ?? verstoss.impact),
          ...(verstoss.helpUrl ? { hilfeUrl: verstoss.helpUrl } : {}),
        });
      }
    }

    // `incomplete` sind Faelle, die axe nicht entscheiden kann. Sie werden zu
    // Hinweisen, nie zu Befunden — und nie zu einem stillen Bestehen.
    const hinweise: RohHinweis[] = lauf.unentschieden.map((fall) => {
      const stellen = fall.nodes.map((n) => selektorAlsText(n.target)).filter((s): s is string => s !== null);
      return {
        regelId: fall.id,
        engine: 'axe' as const,
        text:
          `axe konnte "${fall.help}" nicht abschliessend beurteilen` +
          (stellen.length ? ` (${stellen.length} Stelle${stellen.length === 1 ? '' : 'n'}, z. B. ${stellen[0]})` : '') +
          '. Bitte von Hand nachsehen.',
      };
    });

    return {
      befunde,
      hinweise,
      ausgefuehrteRegeln: [
        ...new Set([
          ...lauf.verstoesse.map((v) => v.id),
          ...lauf.unentschieden.map((v) => v.id),
          ...lauf.bestandenRegelIds,
          ...lauf.nichtAnwendbarRegelIds,
        ]),
      ],
    };
  },
};

function beschreibe(verstoss: Result, zusammenfassung: string | undefined): string {
  const kern = verstoss.help.trim();
  if (!zusammenfassung) return kern;
  const bereinigt = zusammenfassung
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
    .join(' ');
  return `${kern} — ${bereinigt}`;
}

/** axe liefert Selektoren verschachtelt, wenn die Stelle in einem iframe liegt. */
export function selektorAlsText(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    const teile = target.map((t) => selektorAlsText(t)).filter((t): t is string => Boolean(t));
    return teile.length ? teile.join(' >>> ') : null;
  }
  return null;
}
