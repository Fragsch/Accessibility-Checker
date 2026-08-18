/**
 * Zusammenfuehren, Entdoppeln und Zuordnen von Engine-Befunden
 * (ARCHITEKTUR 5.1, Regel 8).
 *
 * Die Zuordnung Regel → Erfolgskriterium steht ausschliesslich im Katalog.
 * Ein Befund ohne Zuordnung wird protokolliert und verworfen — nie geraten,
 * auch dann nicht, wenn die Engine selbst ein Kriterium nennt.
 *
 * Entdoppelt wird erst hier, nach der Zuordnung. Zwei Engines koennen denselben
 * Mangel an derselben Stelle melden; im Ergebnis soll er einmal stehen.
 */

import type { Befund, Hinweis } from '../typen/index.js';
import { Protokoll, stillesProtokoll } from '../protokoll.js';
import type { RohBefund, RohHinweis } from './engine.js';

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
 * Ordnet Rohbefunde und Rohhinweise den Erfolgskriterien zu.
 * Ein Rohbefund kann mehrere Kriterien betreffen; dann entsteht je Kriterium
 * ein Befund.
 */
export function normalisiere(
  rohBefunde: readonly RohBefund[],
  rohHinweise: readonly RohHinweis[],
  optionen: NormalisierungOptionen,
): NormalisierungErgebnis {
  const protokoll = optionen.protokoll ?? stillesProtokoll;
  const verworfene = new Set<string>();
  const befunde: Befund[] = [];
  const hinweise: Hinweis[] = [];

  for (const roh of rohBefunde) {
    for (const kriterium of zuordne(roh.regelId, roh.engine, optionen, protokoll, verworfene, 'Verstoss')) {
      befunde.push({
        kriterium,
        regelId: roh.regelId,
        engine: roh.engine,
        selektor: roh.selektor,
        htmlAusschnitt: roh.htmlAusschnitt,
        beschreibung: roh.beschreibung,
        schwere: roh.schwere,
        ...(roh.hilfeUrl ? { hilfeUrl: roh.hilfeUrl } : {}),
      });
    }
  }

  for (const roh of rohHinweise) {
    for (const kriterium of zuordne(roh.regelId, roh.engine, optionen, protokoll, verworfene, 'Zweifelsfall')) {
      hinweise.push({ kriterium, herkunft: `${roh.engine}/${roh.regelId}`, text: roh.text });
    }
  }

  return {
    befunde: entdopple(befunde, (b) => `${b.kriterium}|${b.selektor ?? ''}|${b.beschreibung}`),
    hinweise: entdopple(hinweise, (h) => `${h.kriterium}|${h.herkunft}|${h.text}`),
    verworfeneRegeln: [...verworfene],
  };
}

function zuordne(
  regelId: string,
  engine: string,
  optionen: NormalisierungOptionen,
  protokoll: Protokoll,
  verworfene: Set<string>,
  art: string,
): string[] {
  const kriterien = optionen.zuordnung.get(regelId);

  if (!kriterien || kriterien.length === 0) {
    const schluessel = `${engine}/${regelId}`;
    if (!verworfene.has(schluessel)) {
      verworfene.add(schluessel);
      protokoll.warnung('normalisierung', `${art} der Regel "${regelId}" ohne Zuordnung im Katalog — verworfen`, {
        regelId,
        engine,
      });
    }
    return [];
  }

  // Kriterien, die auf dieser Seite nicht geprueft werden — etwa weil sie im
  // gewaehlten Standard nicht gelten —, fallen still weg.
  return kriterien.filter((id) => optionen.geprueftesKriterium(id));
}

/**
 * Entfernt Doppelungen.
 * Der erste Treffer bleibt stehen: bei gleicher Aussage ist die Herkunft
 * gleichgueltig, und die Reihenfolge der Engines ist festgelegt.
 */
function entdopple<T>(eintraege: readonly T[], schluessel: (e: T) => string): T[] {
  const gesehen = new Set<string>();
  const ergebnis: T[] = [];
  for (const eintrag of eintraege) {
    const k = schluessel(eintrag);
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    ergebnis.push(eintrag);
  }
  return ergebnis;
}
