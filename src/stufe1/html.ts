/**
 * Engine „html" — Gültigkeit des Markups über `html-validate`.
 *
 * Reines JavaScript. Der Nu-Validator waere die bekanntere Wahl, braucht aber
 * Java und scheidet damit aus (NF-14, ARCHITEKTUR 2).
 *
 * **Geprueft wird der Quelltext, nicht das gerenderte DOM.** Das ist keine
 * Bequemlichkeit, sondern der Kern von 4.1.1: Es geht um die Auslieferung.
 * Der Browser repariert falsch verschachtelte Elemente beim Parsen — im
 * serialisierten DOM waere jeder Verschachtelungsfehler bereits verschwunden,
 * und die Pruefung meldete stets „in Ordnung".
 *
 * Die Kehrseite: Bei Seiten, die ihren Inhalt erst per JavaScript aufbauen,
 * steht im Quelltext wenig. Das wird als Hinweis vermerkt, nicht verschwiegen.
 */

import type { Schwere } from '../typen/index.js';
import { kuerzeHtml } from './engine.js';
import type { EngineErgebnis, EngineKontext, PruefEngine, RohBefund, RohHinweis } from './engine.js';

/** Regeln, die diese Engine anbietet. Namen wie in html-validate. */
export const HTML_REGELN = [
  'close-order',
  'no-dup-id',
  'void-content',
  'element-permitted-content',
  'element-required-content',
  'attribute-allowed-values',
] as const;

/** Ab wie wenig Text im Quelltext von einer JavaScript-Anwendung auszugehen ist. */
const QUELLTEXT_MINDESTLAENGE = 2000;

export const htmlEngine: PruefEngine = {
  name: 'html',

  regeln(): readonly string[] {
    return HTML_REGELN;
  },

  async ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis> {
    const regeln = HTML_REGELN.filter((r) => gewuenschteRegeln.includes(r));
    if (regeln.length === 0) return { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

    if (!kontext.quelltext) {
      return {
        befunde: [],
        hinweise: regeln.map((regelId) => ({
          regelId,
          engine: 'html' as const,
          text: 'Der Quelltext der Seite war nicht abrufbar. Die Gueltigkeit des Markups wurde nicht geprueft.',
        })),
        ausgefuehrteRegeln: [],
      };
    }

    const { HtmlValidate } = await import('html-validate');
    const pruefer = new HtmlValidate({
      // Bewusst ohne voreingestellte Regelsammlung: es laufen genau die Regeln,
      // die der Katalog einem Erfolgskriterium zuordnet — nicht mehr.
      extends: [],
      rules: Object.fromEntries(regeln.map((r) => [r, 'error'])),
    });

    const bericht = await pruefer.validateString(kontext.quelltext, 'seite.html');
    const meldungen = bericht.results.flatMap((ergebnis) => ergebnis.messages);

    const befunde: RohBefund[] = meldungen.map((meldung) => ({
      regelId: meldung.ruleId,
      engine: 'html' as const,
      selektor: meldung.selector ?? null,
      htmlAusschnitt: kuerzeHtml(ausschnitt(kontext.quelltext ?? '', meldung.offset ?? 0)),
      beschreibung: `${uebersetze(meldung.ruleId)} — ${meldung.message} (Zeile ${meldung.line})`,
      schwere: schwereZu(meldung.ruleId),
      ...(meldung.ruleUrl ? { hilfeUrl: meldung.ruleUrl } : {}),
    }));

    const hinweise: RohHinweis[] = [];
    if (kontext.quelltext.length < QUELLTEXT_MINDESTLAENGE) {
      hinweise.push({
        regelId: regeln[0] ?? 'close-order',
        engine: 'html',
        text:
          'Der ausgelieferte Quelltext ist sehr kurz — die Seite baut ihren Inhalt offenbar erst im Browser auf. ' +
          'Geprueft werden konnte nur das Geruest, nicht das nachgeladene Markup.',
      });
    }

    return { befunde, hinweise, ausgefuehrteRegeln: [...regeln] };
  },
};

/**
 * html-validate meldet auf Englisch. Die Regelnamen bekommen hier einen
 * deutschen Vorspann, damit der Befundtext ohne Fachenglisch verstaendlich ist
 * (NF-05).
 */
function uebersetze(regelId: string): string {
  const texte: Record<string, string> = {
    'close-order': 'Elemente sind falsch verschachtelt oder nicht geschlossen',
    'no-dup-id': 'Eine Kennung (id) kommt mehrfach vor',
    'void-content': 'Ein Element ohne Inhalt hat Inhalt bekommen',
    'element-permitted-content': 'Ein Element steht an einer Stelle, an der es nicht stehen darf',
    'element-required-content': 'Einem Element fehlt vorgeschriebener Inhalt',
    'attribute-allowed-values': 'Ein Attribut hat einen unzulaessigen Wert',
  };
  return texte[regelId] ?? regelId;
}

function schwereZu(regelId: string): Schwere {
  // Doppelte Kennungen brechen die Verknuepfung von Beschriftung und Feld —
  // das wiegt schwerer als ein formaler Verschachtelungsfehler.
  return regelId === 'no-dup-id' ? 'ernst' : 'maessig';
}

function ausschnitt(quelltext: string, versatz: number): string {
  const von = Math.max(0, versatz - 40);
  return quelltext.slice(von, von + 200);
}
