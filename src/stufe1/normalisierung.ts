/**
 * Zusammenfuehren, Entdoppeln und Zuordnen von Engine-Befunden
 * (ARCHITEKTUR 5.1, Regel 8).
 *
 * Die Zuordnung Regel → Erfolgskriterium steht ausschliesslich im Katalog.
 * Ein Befund ohne Zuordnung wird protokolliert und verworfen — nie geraten,
 * auch dann nicht, wenn die Engine selbst ein Kriterium nennt.
 */

import type { Result } from 'axe-core';

import type { Befund, Engine, Hinweis, Schwere } from '../typen/index.js';
import { Protokoll, stillesProtokoll } from '../protokoll.js';
import { uebersetzeSchwere } from './axe.js';

const HTML_HOECHSTLAENGE = 400;

export interface NormalisierungErgebnis {
  befunde: Befund[];
  hinweise: Hinweis[];
  /** Regel-IDs, die kein Kriterium im Katalog kennt. */
  verworfeneRegeln: string[];
}

export interface NormalisierungOptionen {
  /** Regel-ID → Kriterien, aus dem Katalog (ARCHITEKTUR 5.1). */
  zuordnung: Map<string, string[]>;
  /** Kriterien, die auf dieser Seite ueberhaupt geprueft werden. */
  geprueftesKriterium: (id: string) => boolean;
  protokoll?: Protokoll;
}

/**
 * Wandelt axe-Ergebnisse in Befunde und Hinweise um.
 *
 * `violations` werden zu Befunden — sie belegen einen Verstoss.
 * `incomplete` werden zu Hinweisen — axe konnte nicht entscheiden, das Kriterium
 * bleibt offen. Ein unentschiedener Fall darf nie als bestanden gelten
 * (ARCHITEKTUR 5.6).
 */
export function normalisiereAxe(
  verstoesse: readonly Result[],
  unentschieden: readonly Result[],
  optionen: NormalisierungOptionen,
): NormalisierungErgebnis {
  const protokoll = optionen.protokoll ?? stillesProtokoll;
  const befunde: Befund[] = [];
  const hinweise: Hinweis[] = [];
  const verworfene = new Set<string>();

  for (const verstoss of verstoesse) {
    const kriterien = zuordne(verstoss.id, optionen, protokoll, verworfene, 'Verstoss');
    for (const kriterium of kriterien) {
      for (const stelle of verstoss.nodes) {
        befunde.push({
          kriterium,
          regelId: verstoss.id,
          engine: 'axe' satisfies Engine,
          selektor: selektorAlsText(stelle.target),
          htmlAusschnitt: kuerze(stelle.html),
          beschreibung: beschreibe(verstoss, stelle.failureSummary),
          schwere: uebersetzeSchwere(stelle.impact ?? verstoss.impact) as Schwere,
          ...(verstoss.helpUrl ? { hilfeUrl: verstoss.helpUrl } : {}),
        });
      }
    }
  }

  for (const fall of unentschieden) {
    const kriterien = zuordne(fall.id, optionen, protokoll, verworfene, 'Zweifelsfall');
    for (const kriterium of kriterien) {
      const stellen = fall.nodes.map((n) => selektorAlsText(n.target)).filter((s): s is string => s !== null);
      hinweise.push({
        kriterium,
        herkunft: `axe/${fall.id}`,
        text:
          `axe konnte "${fall.help}" nicht abschliessend beurteilen` +
          (stellen.length ? ` (${stellen.length} Stelle${stellen.length === 1 ? '' : 'n'}, z. B. ${stellen[0]})` : '') +
          '. Bitte von Hand nachsehen.',
      });
    }
  }

  return { befunde, hinweise: entdoppleHinweise(hinweise), verworfeneRegeln: [...verworfene] };
}

function zuordne(
  regelId: string,
  optionen: NormalisierungOptionen,
  protokoll: Protokoll,
  verworfene: Set<string>,
  art: string,
): string[] {
  const kriterien = optionen.zuordnung.get(regelId);

  if (!kriterien || kriterien.length === 0) {
    if (!verworfene.has(regelId)) {
      verworfene.add(regelId);
      protokoll.warnung('normalisierung', `${art} der Regel "${regelId}" ohne Zuordnung im Katalog — verworfen`, {
        regelId,
        engine: 'axe',
      });
    }
    return [];
  }

  // Kriterien, die auf dieser Seite nicht geprueft werden — etwa weil sie im
  // gewaehlten Standard nicht gelten —, fallen still weg.
  return kriterien.filter((id) => optionen.geprueftesKriterium(id));
}

function beschreibe(verstoss: Result, zusammenfassung: string | undefined): string {
  const kern = verstoss.help.trim();
  if (!zusammenfassung) return kern;
  // axe liefert die Zusammenfassung mehrzeilig mit fuehrenden Aufzaehlungen.
  const bereinigt = zusammenfassung
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
    .join(' ');
  return `${kern} — ${bereinigt}`;
}

/** axe liefert Selektoren verschachtelt, wenn die Stelle in einem iframe liegt. */
function selektorAlsText(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    const teile = target.map((t) => selektorAlsText(t)).filter((t): t is string => Boolean(t));
    return teile.length ? teile.join(' >>> ') : null;
  }
  return null;
}

function kuerze(html: string | undefined): string | null {
  if (!html) return null;
  const einzeilig = html.replace(/\s+/g, ' ').trim();
  return einzeilig.length > HTML_HOECHSTLAENGE ? `${einzeilig.slice(0, HTML_HOECHSTLAENGE)}…` : einzeilig;
}

function entdoppleHinweise(hinweise: readonly Hinweis[]): Hinweis[] {
  const gesehen = new Set<string>();
  const ergebnis: Hinweis[] = [];
  for (const h of hinweise) {
    const schluessel = `${h.kriterium}|${h.herkunft}|${h.text}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    ergebnis.push(h);
  }
  return ergebnis;
}
