/**
 * Engine „pixel" — Kontrast auf Verläufen und Bildern (A-10, A-14).
 *
 * axe rechnet den Kontrast aus den CSS-Farbwerten. Das geht so lange gut, wie
 * es eine einzelne Hintergrundfarbe gibt. Steht Text auf einem Farbverlauf oder
 * auf einem Foto, gibt axe auf und meldet den Fall als unentschieden — genau
 * dort setzt diese Engine an: Sie schaut auf die Bildpunkte.
 *
 * Verfahren: Screenshot des Bereichs, hellsten und dunkelsten Hintergrundwert
 * bestimmen, Kontrast gegen die Textfarbe rechnen. Gemeldet wird der
 * **schlechteste** Punkt — bei einem Verlauf ist genau der ausschlaggebend.
 *
 * Grenze des Verfahrens: Der Screenshot zeigt Text und Hintergrund gemeinsam.
 * Reine Hintergrundpunkte sind deshalb nur naeherungsweise zu bestimmen; das
 * Verfahren arbeitet mit dem Randbereich um den Text herum und mit einem
 * Sicherheitsabstand, um Fehlalarme zu vermeiden.
 */

import type { Schwere } from '../typen/index.js';
import type { EngineErgebnis, EngineKontext, PruefEngine, RohBefund, RohHinweis } from './engine.js';

/** Der aufrufbare Teil von `sharp` — das Vorgabe-Ausfuhrstueck, nicht das Modul. */
type SharpFabrik = (typeof import('sharp'))['default'];

export const PIXEL_REGELN = [
  'kontrast-auf-verlauf',
  'kontrast-auf-bild',
  'bedienelement-kontrast',
  'grafik-kontrast',
] as const;

/** Schwellen nach 1.4.3 und 1.4.11. */
const SCHWELLE_TEXT = 4.5;
const SCHWELLE_GROSSER_TEXT = 3;
const SCHWELLE_NICHT_TEXT = 3;

/**
 * Sicherheitsabstand. Erst ab dieser Unterschreitung wird gemeldet — die
 * Messung aus Bildpunkten ist naturgemaess ungenauer als eine Rechnung aus
 * Farbwerten, und ein Grenzfall soll kein Fehlalarm werden.
 */
const SPIELRAUM = 0.15;

/** Hoechstzahl untersuchter Stellen je Regel — Screenshots sind teuer. */
const HOECHSTZAHL = 25;

interface Kandidat {
  selektor: string;
  html: string;
  vordergrund: [number, number, number];
  grossText: boolean;
  art: 'verlauf' | 'bild';
  masse: { x: number; y: number; breite: number; hoehe: number };
}

interface NichtTextKandidat {
  selektor: string;
  html: string;
  art: 'bedienelement' | 'grafik';
  /**
   * Kontrast des in CSS angegebenen Rahmens gegen den Hintergrund des
   * naechsten deckenden Vorfahren. `null`, wenn er sich aus den Stilwerten
   * nicht bestimmen laesst — etwa bei Verlaufs- oder Bildhintergruenden.
   */
  cssKontrast: number | null;
  masse: { x: number; y: number; breite: number; hoehe: number };
}

export const pixelEngine: PruefEngine = {
  name: 'pixel',

  regeln(): readonly string[] {
    return PIXEL_REGELN;
  },

  async ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis> {
    const regeln = PIXEL_REGELN.filter((r) => gewuenschteRegeln.includes(r));
    if (regeln.length === 0) return { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

    let sharp: SharpFabrik;
    try {
      sharp = (await import('sharp')).default;
    } catch (e) {
      kontext.protokoll.warnung('pixel', `sharp nicht verfuegbar: ${(e as Error).message}`);
      return {
        befunde: [],
        hinweise: regeln.map((regelId) => ({
          regelId,
          engine: 'pixel' as const,
          text: 'Die Bildauswertung steht auf diesem Rechner nicht zur Verfuegung. Kontraste auf Verläufen und Bildern wurden nicht geprueft.',
        })),
        ausgefuehrteRegeln: [],
      };
    }

    const befunde: RohBefund[] = [];
    const hinweise: RohHinweis[] = [];
    const ausgefuehrt: string[] = [];

    const seitenbild = await hleSeitenbild(kontext, sharp);
    if (!seitenbild) {
      return {
        befunde: [],
        hinweise: regeln.map((regelId) => ({
          regelId,
          engine: 'pixel' as const,
          text: 'Von dieser Seite liess sich kein Bild erstellen. Kontraste auf Verläufen, Bildern und an Bedienelementen wurden nicht geprüft.',
        })),
        ausgefuehrteRegeln: [],
      };
    }

    const textRegeln = regeln.filter((r) => r === 'kontrast-auf-verlauf' || r === 'kontrast-auf-bild');
    if (textRegeln.length > 0) {
      const kandidaten = await findeTextKandidaten(kontext);
      for (const kandidat of kandidaten.slice(0, HOECHSTZAHL)) {
        const regelId = kandidat.art === 'verlauf' ? 'kontrast-auf-verlauf' : 'kontrast-auf-bild';
        if (!textRegeln.includes(regelId)) continue;

        const gemessen = messeSchlechtestenKontrast(seitenbild, kandidat.masse, kandidat.vordergrund);
        if (gemessen === null) continue;

        const schwelle = kandidat.grossText ? SCHWELLE_GROSSER_TEXT : SCHWELLE_TEXT;
        if (gemessen >= schwelle - SPIELRAUM) continue;

        befunde.push({
          regelId,
          engine: 'pixel',
          selektor: kandidat.selektor,
          htmlAusschnitt: kandidat.html,
          beschreibung:
            `Der Text steht auf ${kandidat.art === 'verlauf' ? 'einem Farbverlauf' : 'einem Bild'}. ` +
            `An der unguenstigsten Stelle betraegt der Kontrast ${gemessen.toFixed(2)}:1, ` +
            `verlangt sind ${schwelle}:1. Gemessen wurde am Bildpunkt, nicht an den CSS-Werten — ` +
            'ein Verlauf ist genau dort zu pruefen, wo er am hellsten wird.',
          schwere: schwereZu(gemessen, schwelle),
          breite: kontext.viewport.breite,
        });
      }
      ausgefuehrt.push(...textRegeln);
    }

    const nichtTextRegeln = regeln.filter((r) => r === 'bedienelement-kontrast' || r === 'grafik-kontrast');
    if (nichtTextRegeln.length > 0) {
      const kandidaten = await findeNichtTextKandidaten(kontext);
      for (const kandidat of kandidaten.slice(0, HOECHSTZAHL)) {
        const regelId = kandidat.art === 'bedienelement' ? 'bedienelement-kontrast' : 'grafik-kontrast';
        if (!nichtTextRegeln.includes(regelId)) continue;

        const gemessen = messeEigenkontrast(seitenbild, kandidat.masse);
        if (gemessen === null) continue;
        if (gemessen >= SCHWELLE_NICHT_TEXT - SPIELRAUM) continue;

        /*
          Zweite Meinung aus den Stilwerten.

          Die Messung am Bildpunkt ist auf sich allein gestellt nicht belastbar
          genug: Eine Seite kann waehrend des Scans ihre Hoehe aendern, dann
          passen Bild und Koordinaten nicht mehr genau zusammen, und ein sauber
          umrandetes Eingabefeld faellt mit 1,00:1 durch. Ein Befund entsteht
          deshalb nur, wenn beide Verfahren zum selben Schluss kommen. Was die
          Stilwerte fuer ausreichend halten, wird nicht gemeldet.
        */
        if (kandidat.cssKontrast !== null && kandidat.cssKontrast >= SCHWELLE_NICHT_TEXT) continue;

        befunde.push({
          regelId,
          engine: 'pixel',
          selektor: kandidat.selektor,
          htmlAusschnitt: kandidat.html,
          beschreibung:
            `${kandidat.art === 'bedienelement' ? 'Dieses Bedienelement' : 'Diese Grafik'} hebt sich mit nur ` +
            `${gemessen.toFixed(2)}:1 von seiner Umgebung ab, verlangt sind ${SCHWELLE_NICHT_TEXT}:1. ` +
            'Wer Kontraste schlecht wahrnimmt, erkennt die Umrisse dann nicht.',
          schwere: 'maessig',
          breite: kontext.viewport.breite,
        });
      }
      ausgefuehrt.push(...nichtTextRegeln);
    }

    return { befunde, hinweise, ausgefuehrteRegeln: ausgefuehrt };
  },
};

function schwereZu(gemessen: number, schwelle: number): Schwere {
  return gemessen < schwelle / 2 ? 'ernst' : 'maessig';
}

/** Textelemente vor Verlauf oder Bild — genau die, an denen axe aussteigt. */
async function findeTextKandidaten(kontext: EngineKontext): Promise<Kandidat[]> {
  return kontext.seite
    .evaluate(() => {
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

      function zerlegeFarbe(wert: string): [number, number, number] | null {
        const treffer = /rgba?\(([^)]+)\)/.exec(wert);
        if (!treffer?.[1]) return null;
        const teile = treffer[1].split(/[,/\s]+/).filter(Boolean).map(Number);
        const [r, g, b] = teile;
        if (r === undefined || g === undefined || b === undefined) return null;
        return [r, g, b];
      }

      const ergebnis: {
        selektor: string;
        html: string;
        vordergrund: [number, number, number];
        grossText: boolean;
        art: 'verlauf' | 'bild';
        masse: { x: number; y: number; breite: number; hoehe: number };
      }[] = [];

      const auswahl = 'p, li, h1, h2, h3, h4, h5, h6, a, span, button, label, td, th, dd, dt, figcaption, blockquote';

      for (const element of Array.from(document.querySelectorAll(auswahl))) {
        const text = (element.textContent ?? '').trim();
        if (text.length < 3) continue;
        if (element.querySelector(auswahl)) continue;

        const stil = getComputedStyle(element);
        if (stil.display === 'none' || stil.visibility === 'hidden' || stil.opacity === '0') continue;

        const masse = element.getBoundingClientRect();
        if (masse.width < 8 || masse.height < 8) continue;

        // Welcher Vorfahr traegt den Hintergrund?
        let art: 'verlauf' | 'bild' | null = null;
        let lauf: Element | null = element;
        while (lauf) {
          const s = getComputedStyle(lauf);
          const bild = s.backgroundImage;
          if (bild && bild !== 'none') {
            art = /gradient/i.test(bild) ? 'verlauf' : 'bild';
            break;
          }
          const eigen = zerlegeFarbe(s.backgroundColor);
          // Eine deckende eigene Farbe beendet die Suche — dann rechnet axe.
          if (eigen && !/rgba\([^)]*,\s*0\s*\)/.test(s.backgroundColor)) break;
          lauf = lauf.parentElement;
        }
        if (!art) continue;

        const vordergrund = zerlegeFarbe(stil.color);
        if (!vordergrund) continue;

        const groesse = Number.parseFloat(stil.fontSize);
        const fett = Number.parseInt(stil.fontWeight, 10) >= 700;
        const grossText = groesse >= 24 || (fett && groesse >= 18.66);

        ergebnis.push({
          selektor: selektorFuer(element),
          html: element.outerHTML.replace(/\s+/g, ' ').slice(0, 250),
          vordergrund,
          grossText,
          art,
          // Seitenkoordinaten, nicht Fensterkoordinaten: Der Ausschnitt wird
          // spaeter aus einem Bild der ganzen Seite geschnitten, damit auch
          // Elemente unterhalb des sichtbaren Bereichs messbar sind.
          masse: {
            x: Math.max(0, Math.round(masse.left + window.scrollX)),
            y: Math.max(0, Math.round(masse.top + window.scrollY)),
            breite: Math.round(masse.width),
            hoehe: Math.round(masse.height),
          },
        });
      }

      return ergebnis;
    })
    .catch(() => []);
}

/** Bedienelemente und Grafiken, deren Umrisse sich abheben muessen (1.4.11). */
async function findeNichtTextKandidaten(kontext: EngineKontext): Promise<NichtTextKandidat[]> {
  return kontext.seite
    .evaluate(() => {
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

      function zerlege(wert: string): [number, number, number] | null {
        const treffer = /rgba?\(([^)]+)\)/.exec(wert);
        if (!treffer?.[1]) return null;
        const teile = treffer[1].split(/[,/\s]+/).filter(Boolean).map(Number);
        const [r, g, b, a] = teile;
        if (r === undefined || g === undefined || b === undefined) return null;
        if (a !== undefined && a < 0.9) return null;
        return [r, g, b];
      }

      function helligkeit(farbe: [number, number, number]): number {
        const anteile = farbe.map((wert) => {
          const anteil = wert / 255;
          return anteil <= 0.04045 ? anteil / 12.92 : ((anteil + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * (anteile[0] ?? 0) + 0.7152 * (anteile[1] ?? 0) + 0.0722 * (anteile[2] ?? 0);
      }

      function verhaeltnis(a: number, b: number): number {
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }

      /** Kontrast des angegebenen Rahmens gegen den Hintergrund darunter. */
      function cssKontrastVon(element: Element): number | null {
        const stil = getComputedStyle(element);
        if (stil.borderStyle === 'none' || Number.parseFloat(stil.borderWidth) === 0) return null;

        const rahmen = zerlege(stil.borderTopColor);
        if (!rahmen) return null;

        let lauf: Element | null = element.parentElement;
        while (lauf) {
          const s = getComputedStyle(lauf);
          if (s.backgroundImage && s.backgroundImage !== 'none') return null;
          const grund = zerlege(s.backgroundColor);
          if (grund) return verhaeltnis(helligkeit(rahmen), helligkeit(grund));
          lauf = lauf.parentElement;
        }
        // Kein deckender Hintergrund gefunden: Weiss ist die Vorgabe des Browsers.
        return verhaeltnis(helligkeit(rahmen), helligkeit([255, 255, 255]));
      }

      const ergebnis: {
        selektor: string;
        html: string;
        art: 'bedienelement' | 'grafik';
        cssKontrast: number | null;
        masse: { x: number; y: number; breite: number; hoehe: number };
      }[] = [];

      const bedienelemente = 'input:not([type=hidden]), select, textarea';
      const grafiken = 'svg[role=img], svg[aria-label], canvas';

      for (const [auswahl, art] of [
        [bedienelemente, 'bedienelement'],
        [grafiken, 'grafik'],
      ] as const) {
        for (const element of Array.from(document.querySelectorAll(auswahl))) {
          const stil = getComputedStyle(element);
          if (stil.display === 'none' || stil.visibility === 'hidden') continue;

          const masse = element.getBoundingClientRect();
          if (masse.width < 6 || masse.height < 6) continue;
          // Ein Feld ohne eigenen Rahmen wird ueber seine Umgebung erkennbar
          // gemacht; das ist zulaessig und hier nicht messbar.
          if (art === 'bedienelement' && stil.borderStyle === 'none' && stil.backgroundColor === 'rgba(0, 0, 0, 0)') {
            continue;
          }

          ergebnis.push({
            selektor: selektorFuer(element),
            html: element.outerHTML.replace(/\s+/g, ' ').slice(0, 200),
            art,
            cssKontrast: art === 'bedienelement' ? cssKontrastVon(element) : null,
            masse: {
              x: Math.max(0, Math.round(masse.left)),
              y: Math.max(0, Math.round(masse.top)),
              breite: Math.round(masse.width),
              hoehe: Math.round(masse.height),
            },
          });
        }
      }

      return ergebnis;
    })
    .catch(() => []);
}

/**
 * Misst den schlechtesten Kontrast der Textfarbe gegen den Hintergrund.
 *
 * Als Hintergrund gelten die hellsten und dunkelsten Bildpunkte des Bereichs,
 * die sich deutlich von der Textfarbe unterscheiden. Der schlechtere der
 * beiden Werte zaehlt.
 */
function messeSchlechtestenKontrast(
  bild: Seitenbild,
  masse: { x: number; y: number; breite: number; hoehe: number },
  vordergrund: [number, number, number],
): number | null {
  const punkte = schneide(bild, masse);
  if (!punkte) return null;

  const vordergrundHelligkeit = relativeHelligkeit(vordergrund);
  let schlechtester = Infinity;

  for (const punkt of punkte) {
    // Punkte, die dem Text selbst entsprechen, sind kein Hintergrund.
    if (farbabstand(punkt, vordergrund) < 40) continue;

    const wert = kontrast(vordergrundHelligkeit, relativeHelligkeit(punkt));
    if (wert < schlechtester) schlechtester = wert;
  }

  return Number.isFinite(schlechtester) ? schlechtester : null;
}

/**
 * Misst, wie deutlich sich der Umriss eines Elements von seiner Umgebung abhebt.
 *
 * Entscheidend ist die Wahl des Vergleichspaares. Ein erster Versuch verglich
 * den Mittelwert der Innenflaeche mit der Flaeche darueber — und meldete jedes
 * weisse Eingabefeld auf weissem Grund als Verstoss, obwohl es einen sauberen
 * grauen Rahmen hatte. Der Rahmen ging im Mittelwert schlicht unter.
 *
 * Richtig ist: Der **guenstigste Punkt des Umrisses** zaehlt. Ein Feld erfuellt
 * 1.4.11, wenn sich irgendein Teil seiner Begrenzung ausreichend abhebt — nicht
 * erst, wenn die ganze Flaeche das tut.
 */
function messeEigenkontrast(
  bild: Seitenbild,
  masse: { x: number; y: number; breite: number; hoehe: number },
): number | null {
  const rand = 4;

  // Umgebung: ein schmaler Streifen ueber dem Element.
  const aussen = schneide(bild, {
    x: Math.max(0, masse.x),
    y: Math.max(0, masse.y - rand - 2),
    breite: masse.breite,
    hoehe: rand,
  });
  if (!aussen?.length) return null;

  // Umriss: die oberste Zeile des Elements selbst.
  const umriss = schneide(bild, {
    x: masse.x,
    y: masse.y,
    breite: masse.breite,
    hoehe: Math.min(rand, masse.hoehe),
  });
  if (!umriss?.length) return null;

  // Nicht der Mittelwert der Umgebung, sondern ihre haeufigste Farbe.
  // Bei schmalen Fenstern rueckt die Beschriftung dicht an das Feld; ihr
  // dunkler Text zog den Mittelwert nach unten und liess ein sauber umrandetes
  // Feld durchfallen. Der haeufigste Wert ist der Hintergrund.
  const haeufigste = haeufigsteFarbe(aussen);
  if (!haeufigste) return null;

  const umgebung = relativeHelligkeit(haeufigste.farbe);
  let bester = 0;
  for (const punkt of umriss) {
    const wert = kontrast(relativeHelligkeit(punkt), umgebung);
    if (wert > bester) bester = wert;
  }

  return bester > 0 ? bester : null;
}

/**
 * Ein einziges Bild der ganzen Seite, aus dem alle Ausschnitte geschnitten
 * werden.
 *
 * Der erste Entwurf machte je Messstelle eine eigene Aufnahme — bei fünfzig
 * Stellen also fünfzig Aufnahmen. Das war nicht nur langsam: Playwright scrollt
 * für eine Ganzseitenaufnahme kurz durch das Dokument, sodass aufeinander
 * folgende Aufnahmen nicht denselben Zustand zeigten. Daraus entstanden
 * sporadische Fehlalarme, die sich nicht zuverlässig nachstellen liessen.
 */
interface Seitenbild {
  daten: Buffer;
  breite: number;
  hoehe: number;
  kanaele: number;
}

async function hleSeitenbild(kontext: EngineKontext, sharp: SharpFabrik): Promise<Seitenbild | null> {
  try {
    const aufnahme = await kontext.seite.screenshot({ fullPage: true, type: 'png' });
    const { data, info } = await sharp(aufnahme).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { daten: data, breite: info.width, hoehe: info.height, kanaele: info.channels };
  } catch (e) {
    kontext.protokoll.warnung('pixel', `Seitenbild nicht erstellbar: ${(e as Error).message.split('\n')[0]}`);
    return null;
  }
}

/**
 * Bildpunkte eines Ausschnitts.
 * Liegt der Ausschnitt ganz oder teilweise ausserhalb des Bildes, wird er
 * beschnitten; bleibt nichts uebrig, gibt es kein Urteil.
 */
function schneide(
  bild: Seitenbild,
  masse: { x: number; y: number; breite: number; hoehe: number },
): [number, number, number][] | null {
  const links = Math.max(0, Math.round(masse.x));
  const oben = Math.max(0, Math.round(masse.y));
  const rechts = Math.min(bild.breite, links + Math.round(masse.breite));
  const unten = Math.min(bild.hoehe, oben + Math.round(masse.hoehe));

  if (rechts <= links || unten <= oben) return null;

  const punkte: [number, number, number][] = [];
  for (let y = oben; y < unten; y += 1) {
    for (let x = links; x < rechts; x += 1) {
      const i = (y * bild.breite + x) * bild.kanaele;
      const r = bild.daten[i];
      const g = bild.daten[i + 1];
      const b = bild.daten[i + 2];
      if (r === undefined || g === undefined || b === undefined) continue;
      punkte.push([r, g, b]);
    }
  }
  return punkte.length > 0 ? punkte : null;
}

/**
 * Haeufigste Farbe einer Punktmenge, grob gerastert.
 *
 * Gibt `null` zurueck, wenn keine Farbe deutlich ueberwiegt: Dann ist die
 * Umgebung uneinheitlich — etwa weil ein Bild oder Text hineinragt — und ein
 * Urteil waere geraten. Im Zweifel lieber kein Befund (PRD 10: Fehlalarmquote
 * unter 5 Prozent).
 */
function haeufigsteFarbe(
  punkte: readonly [number, number, number][],
): { farbe: [number, number, number]; anteil: number } | null {
  if (punkte.length === 0) return null;

  const raster = 16;
  const zaehlung = new Map<string, { farbe: [number, number, number]; anzahl: number }>();

  for (const punkt of punkte) {
    const schluessel = punkt.map((w) => Math.round(w / raster)).join(',');
    const vorhanden = zaehlung.get(schluessel);
    if (vorhanden) vorhanden.anzahl += 1;
    else zaehlung.set(schluessel, { farbe: punkt, anzahl: 1 });
  }

  let beste: { farbe: [number, number, number]; anzahl: number } | null = null;
  for (const eintrag of zaehlung.values()) {
    if (!beste || eintrag.anzahl > beste.anzahl) beste = eintrag;
  }
  if (!beste) return null;

  const anteil = beste.anzahl / punkte.length;
  return anteil >= 0.5 ? { farbe: beste.farbe, anteil } : null;
}

function mittelwert(punkte: readonly [number, number, number][]): [number, number, number] {
  const summe = punkte.reduce<[number, number, number]>(
    (a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]],
    [0, 0, 0],
  );
  return [summe[0] / punkte.length, summe[1] / punkte.length, summe[2] / punkte.length];
}

function farbabstand(a: readonly number[], b: readonly number[]): number {
  return Math.abs((a[0] ?? 0) - (b[0] ?? 0)) + Math.abs((a[1] ?? 0) - (b[1] ?? 0)) + Math.abs((a[2] ?? 0) - (b[2] ?? 0));
}

/** Relative Helligkeit nach WCAG. */
export function relativeHelligkeit(farbe: readonly [number, number, number]): number {
  const anteile = farbe.map((wert) => {
    const anteil = wert / 255;
    return anteil <= 0.04045 ? anteil / 12.92 : ((anteil + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (anteile[0] ?? 0) + 0.7152 * (anteile[1] ?? 0) + 0.0722 * (anteile[2] ?? 0);
}

/** Kontrastverhaeltnis nach WCAG. */
export function kontrast(helligkeitA: number, helligkeitB: number): number {
  const hell = Math.max(helligkeitA, helligkeitB);
  const dunkel = Math.min(helligkeitA, helligkeitB);
  return (hell + 0.05) / (dunkel + 0.05);
}
