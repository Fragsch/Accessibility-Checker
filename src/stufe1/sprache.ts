/**
 * Engine „sprache" — fremdsprachige Passagen über `franc-min` (A-12).
 *
 * Erfolgskriterium 3.1.2 verlangt, dass anderssprachige Abschnitte als solche
 * ausgezeichnet sind. Diese Pruefung ist bewusst deterministisch geloest und
 * nicht dem Sprachmodell ueberlassen: Spracherkennung ist ein geloestes
 * Problem, schneller und ohne Modellrisiko (PRD 6.2, Hinweis zu A-12 bis A-14).
 *
 * Zwei Vorsichtsmassnahmen halten die Fehlalarmquote niedrig:
 *
 *   Kurze Textstuecke werden uebersprungen. Unter etwa 60 Zeichen raet jede
 *   Spracherkennung mehr, als sie erkennt — „Read more" ist kein Beleg fuer
 *   eine englische Passage.
 *
 *   Nur eine deutliche Abweichung zaehlt. Erkennt franc die Seitensprache
 *   selbst nicht sicher, entsteht ein Hinweis statt eines Befundes.
 */

import { kuerzeHtml } from './engine.js';
import type { EngineErgebnis, EngineKontext, PruefEngine, RohBefund, RohHinweis } from './engine.js';

export const SPRACHE_REGELN = ['fremdsprachige-passage'] as const;

/**
 * Kuerzester Text, bei dem eine Erkennung belastbar ist.
 *
 * Zuerst standen hier 60 Zeichen. Damit hielt franc den deutschen Titel
 * „W3C: Entscheidungsbaum fuer Alternativtexte" fuer Niederlaendisch — die
 * beiden Sprachen liegen dicht beieinander, und bei kurzen Texten entscheidet
 * der Zufall. 120 Zeichen sind der Preis dafuer, dass ein Befund etwas wert ist.
 */
const MINDESTLAENGE = 120;

/** Wie deutlich die erkannte Sprache vor der zweitbesten liegen muss. */
const VORSPRUNG = 0.12;

/** Sprachen, auf die die Erkennung beschraenkt wird — das schaerft sie deutlich. */
const INFRAGE_KOMMEND = ['deu', 'eng', 'fra', 'spa', 'ita', 'nld', 'pol', 'por', 'rus', 'tur'];

/** ISO-639-3 (franc) auf die zweibuchstabigen Kennungen des lang-Attributs. */
const SPRACHNAMEN: Record<string, { kurz: string; name: string }> = {
  deu: { kurz: 'de', name: 'Deutsch' },
  eng: { kurz: 'en', name: 'Englisch' },
  fra: { kurz: 'fr', name: 'Franzoesisch' },
  spa: { kurz: 'es', name: 'Spanisch' },
  ita: { kurz: 'it', name: 'Italienisch' },
  nld: { kurz: 'nl', name: 'Niederlaendisch' },
  pol: { kurz: 'pl', name: 'Polnisch' },
  por: { kurz: 'pt', name: 'Portugiesisch' },
  rus: { kurz: 'ru', name: 'Russisch' },
  tur: { kurz: 'tr', name: 'Tuerkisch' },
};

interface TextStueck {
  text: string;
  selektor: string;
  /** Nächstgelegene lang-Angabe im Elternpfad, bereits aufgeloest. */
  sprache: string | null;
}

export const spracheEngine: PruefEngine = {
  name: 'sprache',

  regeln(): readonly string[] {
    return SPRACHE_REGELN;
  },

  async ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis> {
    const regelId = SPRACHE_REGELN[0];
    if (!gewuenschteRegeln.includes(regelId)) return { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

    const stuecke = await sammleTextStuecke(kontext);
    const { franc, francAll } = await import('franc-min');

    const angegebeneSeitenSprache = await kontext.seite
      .evaluate(() => document.documentElement.getAttribute('lang'))
      .catch(() => null);

    const befunde: RohBefund[] = [];
    const hinweise: RohHinweis[] = [];

    /*
      Fehlt die Sprachangabe der Seite ganz, ist zunaechst 3.1.1 verletzt — das
      meldet axe. Fuer 3.1.2 braucht es trotzdem einen Vergleichsmassstab,
      sonst bliebe jede fremdsprachige Passage unbemerkt, nur weil obendrein
      die Seitensprache fehlt. Als Massstab dient dann die vorherrschende
      Sprache der laengsten Textbloecke.
    */
    const seitenSprache =
      angegebeneSeitenSprache ?? vorherrschendeSprache(stuecke, franc) ?? null;

    if (!angegebeneSeitenSprache && seitenSprache) {
      hinweise.push({
        regelId,
        engine: 'sprache',
        text:
          `Die Seite gibt keine Sprache an. Fuer den Vergleich anderssprachiger Abschnitte wurde ` +
          `"${seitenSprache}" als vorherrschende Sprache angenommen.`,
      });
    }

    let beurteilt = 0;
    let zuKurz = 0;
    let unsicher = 0;

    for (const stueck of stuecke) {
      if (stueck.text.length < MINDESTLAENGE) {
        // Nur zaehlen, was ueberhaupt ein Satz sein koennte. Ein Wort auf einer
        // Schaltflaeche muss niemand nachpruefen.
        if (stueck.text.length >= 25) zuKurz += 1;
        continue;
      }

      const rangfolge = francAll(stueck.text, { only: INFRAGE_KOMMEND });
      const erkannt = rangfolge[0]?.[0] ?? 'und';
      if (erkannt === 'und') continue;

      /*
        Nur ein deutlicher Vorsprung zaehlt.

        francAll liefert Werte zwischen 0 und 1; der beste ist immer 1. Liegt
        der Zweitplatzierte dicht dahinter, hat die Erkennung geschwankt und
        nicht entschieden. Deutsch und Niederlaendisch trennen sich bei kurzen
        Texten oft nur um Haaresbreite — dann lieber schweigen.
      */
      const zweiter = rangfolge[1]?.[1] ?? 0;
      if (1 - zweiter < VORSPRUNG) {
        unsicher += 1;
        continue;
      }

      beurteilt += 1;

      const angegeben = (stueck.sprache ?? seitenSprache ?? '').toLowerCase().split('-')[0] ?? '';
      const erkanntKurz = SPRACHNAMEN[erkannt]?.kurz ?? erkannt;

      if (!angegeben) {
        // Ohne jede Sprachangabe ist 3.1.1 zustaendig, nicht 3.1.2. Hier nur
        // vermerken, damit der Fall nicht doppelt gemeldet wird.
        continue;
      }
      if (angegeben === erkanntKurz) continue;

      befunde.push({
        regelId,
        engine: 'sprache',
        selektor: stueck.selektor,
        htmlAusschnitt: kuerzeHtml(stueck.text, 200),
        beschreibung:
          `Dieser Abschnitt ist offenbar ${SPRACHNAMEN[erkannt]?.name ?? erkannt} verfasst, ` +
          `ausgezeichnet ist er aber als "${angegeben}". Anderssprachige Passagen brauchen ein eigenes ` +
          `lang-Attribut, sonst spricht die Sprachausgabe sie falsch aus.`,
        schwere: 'maessig',
      });
    }

    /*
      Was die Erkennung nicht beurteilen konnte, muss offen bleiben.

      Sonst entstuende der gefaehrlichste Fall des ganzen Werkzeugs: Die Regel
      lief, fand nichts — und das Kriterium gilt als erfuellt, obwohl in
      Wahrheit kein einziger Abschnitt lang genug fuer ein Urteil war. Genau das
      ist bei der Verifikation gegen die Referenzseiten passiert.
    */
    if (beurteilt === 0) {
      hinweise.push({
        regelId,
        engine: 'sprache',
        text:
          'Auf dieser Seite war kein Textabschnitt lang genug, um seine Sprache verlaesslich zu bestimmen. ' +
          'Fremdsprachige Passagen sind daher von Hand zu pruefen.',
      });
    } else if (zuKurz + unsicher > 0) {
      hinweise.push({
        regelId,
        engine: 'sprache',
        text:
          `${zuKurz + unsicher} Abschnitt(e) waren fuer eine verlaessliche Spracherkennung zu kurz oder zu ` +
          'uneindeutig. Kurze fremdsprachige Einschuebe — Zitate, Fachbegriffe, Slogans — koennen dabei ' +
          'unbemerkt geblieben sein.',
      });
    }

    return { befunde, hinweise, ausgefuehrteRegeln: [regelId] };
  },
};

/**
 * Bestimmt die vorherrschende Sprache aus den laengsten Textbloecken.
 * Gewichtet nach Textlaenge: ein langer Absatz wiegt schwerer als eine
 * Ueberschrift.
 */
function vorherrschendeSprache(
  stuecke: readonly TextStueck[],
  franc: (text: string, optionen?: { only?: string[] }) => string,
): string | null {
  const gewicht = new Map<string, number>();

  for (const stueck of stuecke) {
    if (stueck.text.length < MINDESTLAENGE) continue;
    const erkannt = franc(stueck.text, { only: INFRAGE_KOMMEND });
    if (erkannt === 'und') continue;
    const kurz = SPRACHNAMEN[erkannt]?.kurz ?? erkannt;
    gewicht.set(kurz, (gewicht.get(kurz) ?? 0) + stueck.text.length);
  }

  let beste: string | null = null;
  let bestesGewicht = 0;
  for (const [sprache, wert] of gewicht) {
    if (wert > bestesGewicht) {
      bestesGewicht = wert;
      beste = sprache;
    }
  }
  return beste;
}

/**
 * Sammelt zusammenhaengende Textbloecke samt der fuer sie geltenden
 * Sprachangabe. Ausgewertet wird das gerenderte DOM, damit nachgeladener Text
 * mitzaehlt.
 */
async function sammleTextStuecke(kontext: EngineKontext): Promise<TextStueck[]> {
  return kontext.seite
    .evaluate(() => {
      const auswahl = 'p, li, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6, td, th';

      function selektorFuer(element: Element): string {
        const teile: string[] = [];
        let lauf: Element | null = element;
        while (lauf && teile.length < 4) {
          let teil = lauf.tagName.toLowerCase();
          if (lauf.id) {
            teile.unshift(`#${lauf.id}`);
            break;
          }
          const klasse = lauf.classList[0];
          if (klasse) teil += `.${klasse}`;
          teile.unshift(teil);
          lauf = lauf.parentElement;
        }
        return teile.join(' > ');
      }

      function sichtbar(element: Element): boolean {
        const stil = getComputedStyle(element);
        if (stil.display === 'none' || stil.visibility === 'hidden') return false;
        const masse = element.getBoundingClientRect();
        return masse.width > 0 && masse.height > 0;
      }

      const ergebnis: { text: string; selektor: string; sprache: string | null }[] = [];

      for (const element of Array.from(document.querySelectorAll(auswahl))) {
        // Nur Bloecke ohne verschachtelte Bloecke — sonst zaehlt Text mehrfach.
        if (element.querySelector(auswahl)) continue;
        if (!sichtbar(element)) continue;

        /*
          Quelltext ist keine Sprache.

          Ein Codebeispiel wie <img src="warnung.svg" alt="..."> hat eine
          Buchstabenverteilung, die jede Spracherkennung fuer irgendeine
          romanische Sprache haelt. Die Selbstpruefung der eigenen Oberflaeche
          meldete so sechs Abschnitte als franzoesisch, italienisch und
          portugiesisch — allesamt Codebeispiele.
        */
        if (element.closest('pre, code, samp, kbd, script, style')) continue;
        if (element.querySelector('pre, code, samp, kbd')) continue;

        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;

        // Viel Satzzeichen, wenig Wort: ebenfalls kein Fliesstext.
        const buchstaben = text.replace(/[^\p{L}\s]/gu, '').length;
        if (buchstaben / text.length < 0.7) continue;

        const mitLang = element.closest('[lang]');
        ergebnis.push({
          text,
          selektor: selektorFuer(element),
          sprache: mitLang ? mitLang.getAttribute('lang') : null,
        });
      }

      return ergebnis;
    })
    .catch(() => []);
}
