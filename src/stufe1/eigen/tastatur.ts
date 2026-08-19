/**
 * Tastatur-Durchlauf (A-05, A-06).
 *
 * Es wird tatsaechlich durchgetabbt — Schritt fuer Schritt, mit Auslesen des
 * jeweils fokussierten Elements. Das ist die einzige Art, die folgenden Fragen
 * zu beantworten, weil sie alle vom Verhalten abhaengen und nicht vom Markup:
 *
 *   2.4.3  Kommt der Fokus in einer sinnvollen Reihenfolge?
 *   2.1.2  Kommt er ueberall wieder heraus?
 *   2.4.7  Ist er zu sehen?
 *   2.4.11 Wird er von festen Leisten verdeckt?
 *   3.2.1  Aendert sich beim Fokussieren unerwartet der Zusammenhang?
 *
 * Der Durchlauf ist begrenzt: Seiten mit hunderten Bedienelementen wuerden ihn
 * sonst zur laengsten Pruefung des ganzen Werkzeugs machen. Wird die Grenze
 * erreicht, entsteht ein Hinweis — kein stilles Abschneiden.
 */

import type { EngineKontext, RohBefund, RohHinweis } from '../engine.js';

export const TASTATUR_REGELN = [
  'tab-durchlauf-reihenfolge',
  'tastaturfalle',
  'fokus-sichtbarkeit',
  'fokus-verdeckt',
  'aenderung-bei-fokus',
] as const;

/** Hoechstzahl der Tab-Schritte. Darueber wird abgebrochen und vermerkt. */
const HOECHSTZAHL_SCHRITTE = 150;

/** Ab wie vielen Wiederholungen desselben Elements eine Falle angenommen wird. */
const FALLE_AB = 3;

export interface Halt {
  selektor: string;
  /**
   * Eindeutige Kennung dieses Halts.
   *
   * Nicht der Selektor: der ist bewusst grob gehalten und trifft auf mehrere
   * Elemente zugleich zu. Drei Links in derselben Liste haetten denselben
   * Selektor — und saehen damit aus wie eine Tastaturfalle, obwohl der Fokus
   * ordentlich weiterwandert. Genau dieser Fehlalarm ist so entstanden.
   */
  kennung: string;
  beschriftung: string;
  /** Seitenbereich, in dem der Halt liegt — Kopf, Navigation, Inhalt, Fuss. */
  bereich: string;
  oben: number;
  links: number;
  imBild: boolean;
  verdeckt: boolean;
  fokusSichtbar: boolean;
  /**
   * Das Element bringt seine Fokusanzeige im eigenen Schattenbaum mit.
   *
   * Bei `audio` und `video` mit `controls` zeichnet der Browser den Fokusring
   * an der Abspieltaste — innerhalb seines eigenen Schattenbaums. Von aussen
   * aendert sich kein einziger gerechneter Stil, und die Messung unten sieht
   * deshalb nichts. Gefunden in Phase 8 an `bedienung-sauber.html`: ein
   * Fehlalarm, der auf jeder Seite mit einem eingebauten Abspieler
   * losgegangen waere.
   */
  eigeneFokusanzeige: boolean;
  urlGeaendert: boolean;
}

/**
 * Fuehrt den Tab-Durchlauf aus und gibt die Halte zurueck.
 *
 * Ausgelagert, weil die Stufe 2 dieselben Stopps braucht: Der Prompt
 * `fokusreihenfolge` beurteilt die Bedienlogik der Reihenfolge, und die muss
 * dieselbe sein, die die Automatik gemessen hat. Zweimal tabben hiesse, ueber
 * zwei verschiedene Dinge zu reden.
 */
export async function sammleFokusStopps(
  seite: import('playwright').Page,
  protokoll: import('../../protokoll.js').Protokoll,
  hoechstzahl = HOECHSTZAHL_SCHRITTE,
): Promise<Halt[]> {
  const stopps: Halt[] = [];

  try {
    await seite.evaluate(() => {
      const anfang = document.body;
      anfang.setAttribute('tabindex', '-1');
      anfang.focus();
      anfang.removeAttribute('tabindex');
    });

    for (let schritt = 0; schritt < hoechstzahl; schritt += 1) {
      await seite.keyboard.press('Tab');
      const halt = await lesFokus(seite, protokoll);
      if (!halt) break;

      const letzter = stopps[stopps.length - 1];
      if (letzter && letzter.kennung === halt.kennung) break;

      if (stopps.length > 2 && halt.kennung === stopps[0]?.kennung) break;
      stopps.push(halt);
    }
  } catch (e) {
    protokoll.info('eigen', `Fokus-Durchlauf abgebrochen: ${(e as Error).message.split('\n')[0]}`);
  }

  return stopps;
}

export async function pruefeTastatur(
  kontext: EngineKontext,
  gewuenschteRegeln: readonly string[],
): Promise<{ befunde: RohBefund[]; hinweise: RohHinweis[]; ausgefuehrteRegeln: string[] }> {
  const regeln = TASTATUR_REGELN.filter((r) => gewuenschteRegeln.includes(r));
  if (regeln.length === 0) return { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

  const befunde: RohBefund[] = [];
  const hinweise: RohHinweis[] = [];
  const seite = kontext.seite;

  const urlVorher = seite.url();
  const haltestellen: Halt[] = [];
  let abgeschnitten = false;
  let falle: { selektor: string; wiederholungen: number } | null = null;

  try {
    await seite.evaluate(() => {
      const anfang = document.body;
      anfang.setAttribute('tabindex', '-1');
      anfang.focus();
      anfang.removeAttribute('tabindex');
    });

    const gesehen = new Map<string, number>();

    for (let schritt = 0; schritt < HOECHSTZAHL_SCHRITTE; schritt += 1) {
      await seite.keyboard.press('Tab');

      const halt = await lesFokus(seite, kontext.protokoll);
      if (!halt) break;

      // Eine Falle erkennt man daran, dass derselbe Halt immer wiederkehrt,
      // obwohl weitergetabbt wird.
      const bisher = (gesehen.get(halt.kennung) ?? 0) + 1;
      gesehen.set(halt.kennung, bisher);

      const letzter = haltestellen[haltestellen.length - 1];
      if (letzter && letzter.kennung === halt.kennung && bisher >= FALLE_AB) {
        falle = { selektor: halt.selektor, wiederholungen: bisher };
        break;
      }

      haltestellen.push(halt);

      // Ein Durchlauf ist voll, sobald der erste Halt wiederkehrt.
      if (haltestellen.length > 2 && halt.kennung === haltestellen[0]?.kennung) {
        haltestellen.pop();
        break;
      }

      if (schritt === HOECHSTZAHL_SCHRITTE - 1) abgeschnitten = true;
    }
  } catch (e) {
    kontext.protokoll.warnung('eigen', `Tastatur-Durchlauf abgebrochen: ${(e as Error).message}`);
    return {
      befunde: [],
      hinweise: regeln.map((regelId) => ({
        regelId,
        engine: 'eigen' as const,
        text: 'Der Tastatur-Durchlauf liess sich auf dieser Seite nicht ausfuehren. Bitte von Hand pruefen.',
      })),
      ausgefuehrteRegeln: [],
    };
  }

  // --------------------------------------------------- 2.1.2 Tastaturfalle

  if (regeln.includes('tastaturfalle') && falle) {
    befunde.push({
      regelId: 'tastaturfalle',
      engine: 'eigen',
      selektor: falle.selektor,
      htmlAusschnitt: null,
      beschreibung:
        `Der Fokus bleibt an diesem Element haengen — nach ${falle.wiederholungen} Tab-Anschlaegen steht er ` +
        'immer noch dort. Wer nur die Tastatur benutzt, kommt hier nicht mehr weiter und muss die Seite verlassen.',
      schwere: 'kritisch',
    });
  }

  // ----------------------------------------------- 2.4.7 Fokus sichtbar

  if (regeln.includes('fokus-sichtbarkeit')) {
    for (const halt of haltestellen) {
      if (halt.fokusSichtbar || halt.eigeneFokusanzeige) continue;
      befunde.push({
        regelId: 'fokus-sichtbarkeit',
        engine: 'eigen',
        selektor: halt.selektor,
        htmlAusschnitt: null,
        beschreibung:
          `Beim Fokussieren von "${halt.beschriftung}" ist nichts zu sehen. ` +
          'Ohne sichtbaren Fokus weiss niemand, wo er sich gerade befindet. ' +
          'Meist steht ein "outline: none" ohne Ersatz dahinter.',
        schwere: 'ernst',
      });
    }
  }

  // ------------------------------------------ 2.4.11 Fokus nicht verdeckt

  /*
    Rueckwaerts nachfassen. Beim Vorwaertstabben scrollt der Browser das
    fokussierte Element an den unteren Rand — dort verdeckt es keine feste
    Kopfzeile, und die Pruefung liefe ins Leere. Beim Zurueckgehen mit
    Umschalt+Tab richtet er es am oberen Rand aus, und genau dann verschwindet
    es unter einer festen Leiste. Beides ist normale Bedienung; geprueft werden
    muss deshalb beides.
  */
  const rueckwaerts: Halt[] = [];
  if (regeln.includes('fokus-verdeckt') && haltestellen.length > 0) {
    try {
      for (let schritt = 0; schritt < Math.min(haltestellen.length, HOECHSTZAHL_SCHRITTE); schritt += 1) {
        await seite.keyboard.press('Shift+Tab');
        const halt = await lesFokus(seite, kontext.protokoll);
        if (!halt) break;
        rueckwaerts.push(halt);
      }
    } catch (e) {
      kontext.protokoll.info('eigen', `Rueckwaerts-Durchlauf abgebrochen: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  if (regeln.includes('fokus-verdeckt')) {
    const gesehen = new Set<string>();
    for (const halt of [...haltestellen, ...rueckwaerts]) {
      if (!halt.verdeckt) continue;
      if (gesehen.has(halt.kennung)) continue;
      gesehen.add(halt.kennung);
      befunde.push({
        regelId: 'fokus-verdeckt',
        engine: 'eigen',
        selektor: halt.selektor,
        htmlAusschnitt: null,
        beschreibung:
          `Das fokussierte Element "${halt.beschriftung}" wird von einem anderen Element verdeckt — ` +
          'typischerweise von einer festen Kopf- oder Fusszeile. Der Fokus ist dann zwar da, aber nicht zu sehen.',
        schwere: 'ernst',
      });
    }
  }

  // ------------------------------------------- 2.4.3 Fokus-Reihenfolge

  if (regeln.includes('tab-durchlauf-reihenfolge')) {
    let rueckspruenge = 0;
    let erster: Halt | null = null;

    for (let i = 1; i < haltestellen.length; i += 1) {
      const vorher = haltestellen[i - 1];
      const jetzt = haltestellen[i];
      if (!vorher || !jetzt) continue;

      // Ein Sprung nach oben um mehr als eine Zeilenhoehe, ohne dass es eine
      // neue Spalte waere: das laeuft der Lesereihenfolge zuwider.
      if (jetzt.oben < vorher.oben - 80 && jetzt.links <= vorher.links) {
        rueckspruenge += 1;
        erster ??= jetzt;
      }
    }

    if (rueckspruenge >= 2 && erster) {
      befunde.push({
        regelId: 'tab-durchlauf-reihenfolge',
        engine: 'eigen',
        selektor: erster.selektor,
        htmlAusschnitt: null,
        beschreibung:
          `Der Fokus springt an ${rueckspruenge} Stellen entgegen der Lesereihenfolge zurueck nach oben. ` +
          'Meist stecken positive tabindex-Werte oder eine per CSS umgestellte Anordnung dahinter.',
        schwere: 'ernst',
      });
    }
  }

  // ------------------------------------------------- 3.2.1 Bei Fokus

  if (regeln.includes('aenderung-bei-fokus')) {
    const gewandert = haltestellen.find((h) => h.urlGeaendert);
    if (gewandert) {
      befunde.push({
        regelId: 'aenderung-bei-fokus',
        engine: 'eigen',
        selektor: gewandert.selektor,
        htmlAusschnitt: null,
        beschreibung:
          'Das blosse Fokussieren dieses Elements hat die Seite gewechselt. ' +
          'Ein Wechsel des Zusammenhangs darf erst auf eine bewusste Handlung folgen, nicht schon auf den Fokus.',
        schwere: 'kritisch',
      });
    }

    if (seite.url() !== urlVorher && !gewandert) {
      befunde.push({
        regelId: 'aenderung-bei-fokus',
        engine: 'eigen',
        selektor: 'body',
        htmlAusschnitt: null,
        beschreibung:
          `Waehrend des reinen Durchtabbens hat die Seite gewechselt (von ${urlVorher} nach ${seite.url()}). ` +
          'Es wurde nichts angeklickt und nichts bestaetigt.',
        schwere: 'kritisch',
      });
    }
  }

  // ------------------------------------------------------------ Hinweise

  if (haltestellen.length === 0) {
    hinweise.push({
      regelId: 'tab-durchlauf-reihenfolge',
      engine: 'eigen',
      text: 'Der Tastatur-Durchlauf fand kein einziges fokussierbares Element. Bitte von Hand nachsehen.',
    });
  }

  if (abgeschnitten) {
    hinweise.push({
      regelId: 'tab-durchlauf-reihenfolge',
      engine: 'eigen',
      text:
        `Der Durchlauf wurde nach ${HOECHSTZAHL_SCHRITTE} Schritten abgebrochen — die Seite hat mehr ` +
        'Bedienelemente. Der hintere Teil wurde nicht geprueft.',
    });
  }

  return { befunde, hinweise, ausgefuehrteRegeln: [...regeln] };
}

/**
 * Liest das gerade fokussierte Element aus.
 *
 * Die Sichtbarkeit des Fokus wird ueber die gerechneten Stile bestimmt: ein
 * eigener Umriss, ein Rahmen, ein Schatten oder eine geaenderte Hintergrundfarbe
 * zaehlen alle. Verglichen wird gegen den Zustand ohne Fokus, denn ein Umriss,
 * den das Element ohnehin immer traegt, ist keine Fokusanzeige.
 */
async function lesFokus(seite: import('playwright').Page, protokoll: import('../../protokoll.js').Protokoll): Promise<Halt | null> {
  return seite
    .evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body || element === document.documentElement) return null;

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

      const masse = element.getBoundingClientRect();
      const stil = getComputedStyle(element);

      // Fokusanzeige: Umriss, Rahmenbreite oder Schatten muessen sich vom
      // Zustand ohne Fokus unterscheiden. Vergleichsmassstab ist ein Klon.
      const klon = element.cloneNode(false) as HTMLElement;
      klon.style.position = 'absolute';
      klon.style.left = '-99999px';
      klon.removeAttribute('id');
      document.body.appendChild(klon);
      const ohneFokus = getComputedStyle(klon);

      const umrissDa = stil.outlineStyle !== 'none' && Number.parseFloat(stil.outlineWidth) > 0;
      const umrissAnders = stil.outlineWidth !== ohneFokus.outlineWidth || stil.outlineStyle !== ohneFokus.outlineStyle;
      const rahmenAnders = stil.borderColor !== ohneFokus.borderColor || stil.borderWidth !== ohneFokus.borderWidth;
      const schattenAnders = stil.boxShadow !== ohneFokus.boxShadow && stil.boxShadow !== 'none';
      const grundAnders = stil.backgroundColor !== ohneFokus.backgroundColor;

      klon.remove();

      const fokusSichtbar = (umrissDa && umrissAnders) || rahmenAnders || schattenAnders || grundAnders;

      // Der Fokusring des eingebauten Abspielers steckt im Schattenbaum des
      // Browsers und ist von aussen weder auslesbar noch abschaltbar.
      const eigeneFokusanzeige = element.matches('audio[controls], video[controls]');

      // Verdeckung (2.4.11): Ueberlappt eine fest stehende Leiste das fokussierte
      // Element — und liegt sie tatsaechlich darueber?
      //
      // Nicht ueber einen einzelnen Messpunkt am oberen Rand: ob der Fokus dort
      // gerade zufaellig unter der Leiste landet, haengt am Scrollverhalten.
      // Geprueft wird stattdessen jede fest oder klebend positionierte Leiste.
      const imBild = masse.width > 0 && masse.height > 0 && masse.bottom > 0 && masse.top < window.innerHeight;
      let verdeckt = false;

      if (imBild) {
        const feste = Array.from(document.querySelectorAll('*')).filter((kandidat) => {
          const s = getComputedStyle(kandidat);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
          return !kandidat.contains(element) && !element.contains(kandidat);
        });

        verdeckt = feste.some((leiste) => {
          const r = leiste.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;

          const links = Math.max(r.left, masse.left);
          const rechts = Math.min(r.right, masse.right);
          const oben = Math.max(r.top, masse.top);
          const unten = Math.min(r.bottom, masse.bottom);
          if (rechts <= links || unten <= oben) return false;

          // Ueberlappung allein genuegt nicht — die Leiste muss obenauf liegen.
          const darueber = document.elementFromPoint((links + rechts) / 2, (oben + unten) / 2);
          return darueber !== null && (darueber === leiste || leiste.contains(darueber));
        });
      }

      const beschriftung = (
        element.getAttribute('aria-label') ??
        element.textContent ??
        element.getAttribute('title') ??
        element.tagName
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);

      const landmarke = element.closest('header, nav, main, aside, footer, form, [role=banner], [role=navigation], [role=main], [role=contentinfo], [role=search]');
      const bereich = landmarke
        ? (landmarke.getAttribute('role') ?? landmarke.tagName.toLowerCase())
        : 'ohne Bereich';

      return {
        selektor: selektorFuer(element),
        kennung: `${selektorFuer(element)}@${Math.round(masse.left)},${Math.round(masse.top + window.scrollY)}`,
        bereich,
        beschriftung: beschriftung || element.tagName.toLowerCase(),
        oben: masse.top + window.scrollY,
        links: masse.left + window.scrollX,
        imBild,
        verdeckt,
        fokusSichtbar,
        eigeneFokusanzeige,
        urlGeaendert: false,
      };
    })
    .catch((e: unknown) => {
      // Nicht stillschweigend verschlucken: Ein Fehler hier beendet den
      // Durchlauf, und ohne Eintrag im Protokoll waere nicht zu erkennen,
      // warum die Seite ploetzlich kein fokussierbares Element mehr hat.
      protokoll.warnung('eigen', `Fokus nicht auslesbar: ${(e as Error).message.split('\n')[0]}`);
      return null;
    });
}
