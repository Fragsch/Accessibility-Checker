/**
 * Engine „ocr" — Bilder eines Textes über Tesseract (A-13).
 *
 * Erfolgskriterium 1.4.5 verlangt, Text als Text zu liefern und nicht als Bild.
 * Ob ein Bild Text enthaelt, ist mit Texterkennung deterministisch feststellbar
 * — dafuer braucht es kein Sprachmodell (PRD 6.2, Hinweis zu A-12 bis A-14).
 *
 * **Läuft vollständig lokal.** tesseract.js laedt seine Sprachdaten sonst von
 * einem fremden Server nach; das waere ein Datenabfluss und verstiesse gegen
 * NF-02. Deshalb wird `langPath` auf das mitinstallierte Paket
 * `@tesseract.js-data/deu` gezeigt. Fehlt es, laeuft die Pruefung nicht, und es
 * entsteht ein Hinweis — es wird nichts nachgeladen.
 *
 * Die Pruefung ist die langsamste der Stufe 1. Sie ueberspringt deshalb alles,
 * was von vornherein nicht in Frage kommt: Symbole, Miniaturbilder, Grafiken
 * mit leerem alt-Attribut.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import type { EngineErgebnis, EngineKontext, PruefEngine, RohBefund, RohHinweis } from './engine.js';

const erfordere = createRequire(import.meta.url);

export const OCR_REGELN = ['text-in-bild'] as const;

/** Kleinste Kantenlaenge, ab der ein Bild ueberhaupt Fliesstext tragen kann. */
const MINDESTBREITE = 120;
const MINDESTHOEHE = 40;

/** Ab welcher Sicherheit die Texterkennung ernst genommen wird. */
const MINDESTSICHERHEIT = 70;

/** Ab wie vielen erkannten Zeichen von einem Bild eines Textes auszugehen ist. */
const MINDESTZEICHEN = 12;

/** Hoechstzahl untersuchter Bilder je Seite — jedes kostet Sekunden. */
const HOECHSTZAHL = 12;

interface Bildkandidat {
  selektor: string;
  html: string;
  alt: string | null;
  /** Bild konnte nicht geladen werden — dann ist nichts zu erkennen. */
  kaputt: boolean;
  masse: { x: number; y: number; breite: number; hoehe: number };
}

export const ocrEngine: PruefEngine = {
  name: 'ocr',

  regeln(): readonly string[] {
    return OCR_REGELN;
  },

  async ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis> {
    const regelId = OCR_REGELN[0];
    if (!gewuenschteRegeln.includes(regelId)) return { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

    const sprachPfad = findeSprachdaten();
    if (!sprachPfad) {
      return {
        befunde: [],
        hinweise: [
          {
            regelId,
            engine: 'ocr',
            text:
              'Die Sprachdaten für die Texterkennung fehlen (Paket @tesseract.js-data/deu). ' +
              'Bilder wurden nicht auf enthaltenen Text geprüft. Nachinstallieren mit: npm install @tesseract.js-data/deu',
          },
        ],
        ausgefuehrteRegeln: [],
      };
    }

    const alleKandidaten = await findeBilder(kontext);
    const kandidaten = alleKandidaten.filter((k) => !k.kaputt);
    const kaputte = alleKandidaten.filter((k) => k.kaputt);

    const befunde: RohBefund[] = [];
    const hinweise: RohHinweis[] = [];

    // Ein Bild, das nicht laedt, laesst sich nicht auf Text untersuchen. Das
    // als "keine Beanstandung" auszugeben waere die gefaehrlichste Art von
    // Fehler — es saehe aus wie eine bestandene Pruefung.
    for (const kaputt of kaputte) {
      hinweise.push({
        regelId,
        engine: 'ocr',
        text:
          `Das Bild "${kaputt.selektor}" konnte nicht geladen werden und wurde daher nicht auf enthaltenen ` +
          'Text untersucht. Bitte von Hand nachsehen, ob es Text zeigt.',
      });
    }

    if (kandidaten.length === 0) return { befunde, hinweise, ausgefuehrteRegeln: [regelId] };

    let tesseract: typeof import('tesseract.js');
    try {
      tesseract = await import('tesseract.js');
    } catch (e) {
      kontext.protokoll.warnung('ocr', `tesseract.js nicht ladbar: ${(e as Error).message}`);
      return {
        befunde: [],
        hinweise: [{ regelId, engine: 'ocr', text: 'Die Texterkennung liess sich nicht starten. Bilder wurden nicht geprüft.' }],
        ausgefuehrteRegeln: [],
      };
    }

    const arbeiter = await tesseract.createWorker('deu', 1, {
      langPath: sprachPfad,
      // Kein Nachladen aus dem Netz: Was lokal fehlt, fehlt (NF-02).
      cachePath: sprachPfad,
      logger: () => undefined,
    });

    try {
      for (const kandidat of kandidaten.slice(0, HOECHSTZAHL)) {
        const bild = await kontext.seite
          .screenshot({
            clip: {
              x: kandidat.masse.x,
              y: kandidat.masse.y,
              width: kandidat.masse.breite,
              height: kandidat.masse.hoehe,
            },
            type: 'png',
          })
          .catch(() => null);
        if (!bild) continue;

        const { data } = await arbeiter.recognize(bild);
        const erkannt = (data.text ?? '').replace(/\s+/g, ' ').trim();

        if (data.confidence < MINDESTSICHERHEIT) continue;
        if (erkannt.replace(/[^\p{L}\p{N}]/gu, '').length < MINDESTZEICHEN) continue;

        // Steht derselbe Text schon im alt-Attribut, ist er zugaenglich — das
        // Kriterium verlangt trotzdem echten Text, aber der Fall ist milder und
        // haeufig zulaessig (Logos, Wortmarken). Deshalb kein Befund.
        if (kandidat.alt && aehnlich(kandidat.alt, erkannt)) continue;

        befunde.push({
          regelId,
          engine: 'ocr',
          selektor: kandidat.selektor,
          htmlAusschnitt: kandidat.html,
          beschreibung:
            `Dieses Bild enthaelt Text: "${erkannt.slice(0, 120)}". ` +
            'Text gehoert als Text auf die Seite — als Bild laesst er sich nicht vergroessern, ' +
            'nicht umfaerben und nicht durchsuchen. Ausgenommen sind Logos und Wortmarken.',
          schwere: 'maessig',
        });
      }
    } catch (e) {
      kontext.protokoll.warnung('ocr', `Texterkennung abgebrochen: ${(e as Error).message}`);
      hinweise.push({
        regelId,
        engine: 'ocr',
        text: 'Die Texterkennung wurde abgebrochen. Nicht alle Bilder konnten geprüft werden.',
      });
    } finally {
      await arbeiter.terminate().catch(() => undefined);
    }

    if (kandidaten.length > HOECHSTZAHL) {
      hinweise.push({
        regelId,
        engine: 'ocr',
        text: `Die Seite hat ${kandidaten.length} in Frage kommende Bilder; geprüft wurden die ersten ${HOECHSTZAHL}.`,
      });
    }

    return { befunde, hinweise, ausgefuehrteRegeln: [regelId] };
  },
};

/** Verzeichnis der lokal installierten Sprachdaten, oder `null`. */
export function findeSprachdaten(): string | null {
  try {
    const eintrag = erfordere.resolve('@tesseract.js-data/deu/package.json');
    const verzeichnis = path.dirname(eintrag);
    // Das Paket legt die Daten unter 4.0.0_best_int bzw. 4.0.0 ab.
    for (const unterordner of ['4.0.0_best_int', '4.0.0', '.']) {
      const kandidat = path.join(verzeichnis, unterordner);
      if (fs.existsSync(kandidat) && fs.readdirSync(kandidat).some((d) => d.startsWith('deu.traineddata'))) {
        return kandidat;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Bilder, bei denen Text ueberhaupt in Frage kommt. */
async function findeBilder(kontext: EngineKontext): Promise<Bildkandidat[]> {
  return kontext.seite
    .evaluate(
      ({ mindestbreite, mindesthoehe }) => {
        function selektorFuer(el: Element): string {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const teile: string[] = [];
          let lauf: Element | null = el;
          while (lauf && teile.length < 3 && lauf !== document.documentElement) {
            let teil = lauf.tagName.toLowerCase();
            const klasse = Array.from(lauf.classList).find((k) => !/^\d/.test(k));
            if (klasse) teil += `.${CSS.escape(klasse)}`;
            teile.unshift(teil);
            lauf = lauf.parentElement;
          }
          return teile.join(' > ');
        }

        const ergebnis: {
          selektor: string;
          html: string;
          alt: string | null;
          kaputt: boolean;
          masse: { x: number; y: number; breite: number; hoehe: number };
        }[] = [];

        for (const bild of Array.from(document.querySelectorAll('img, [role=img]'))) {
          const stil = getComputedStyle(bild);
          if (stil.display === 'none' || stil.visibility === 'hidden') continue;

          const alt = bild.getAttribute('alt');
          // Rein schmueckende Bilder tragen keinen Text, der jemandem fehlt.
          if (alt === '') continue;

          const masse = bild.getBoundingClientRect();
          if (masse.width < mindestbreite || masse.height < mindesthoehe) continue;

          const kaputt = bild instanceof HTMLImageElement && bild.complete && bild.naturalWidth === 0;

          ergebnis.push({
            selektor: selektorFuer(bild),
            html: bild.outerHTML.replace(/\s+/g, ' ').slice(0, 250),
            alt,
            kaputt,
            masse: {
              x: Math.max(0, Math.round(masse.left)),
              y: Math.max(0, Math.round(masse.top)),
              breite: Math.round(masse.width),
              hoehe: Math.round(masse.height),
            },
          });
        }

        return ergebnis;
      },
      { mindestbreite: MINDESTBREITE, mindesthoehe: MINDESTHOEHE },
    )
    .catch(() => []);
}

/** Grober Vergleich zweier Texte — genuegt, um „steht schon im alt" zu erkennen. */
function aehnlich(a: string, b: string): boolean {
  const saeubere = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const x = saeubere(a);
  const y = saeubere(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}
