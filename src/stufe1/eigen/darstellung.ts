/**
 * Prüfungen, die die Darstellung verändern und danach messen (A-04, A-08).
 *
 *   1.4.10 Reflow          — 320 CSS-Pixel Breite ohne seitliches Scrollen
 *   1.4.4  Textgroesse     — 200 Prozent Vergroesserung ohne Verlust
 *   1.4.12 Textabstand     — erhoehte Abstaende ohne abgeschnittenen Inhalt
 *
 * Alle drei arbeiten nach demselben Muster: Zustand herstellen, messen,
 * Zustand zuruecknehmen. Die Seite bleibt danach so, wie sie war — sonst
 * verfaelschte die eine Pruefung die naechste.
 *
 * Gemessen wird nicht „sieht komisch aus", sondern nachweisbarer Verlust:
 * seitliches Scrollen oder abgeschnittener Text. Beides ist eindeutig
 * feststellbar und damit fehlalarmarm.
 */

import type { EngineKontext, RohBefund } from '../engine.js';

export const DARSTELLUNG_REGELN = ['reflow-320', 'zoom-200-prozent', 'textabstand-test'] as const;

/** Breite nach 1.4.10 in CSS-Pixeln. */
const REFLOW_BREITE = 320;
const REFLOW_HOEHE = 640;

/**
 * 200 Prozent Zoom werden durch Halbieren des Viewports nachgestellt: eine
 * Seite in 640 Pixeln Breite zeigt dasselbe wie 1280 Pixel bei doppelter
 * Vergroesserung. Der Weg ueber `deviceScaleFactor` waere falsch — der
 * veraendert nur die Bildpunktdichte, nicht das Layout.
 */
const ZOOM_BREITE = 640;
const ZOOM_HOEHE = 512;

/** Werte aus Erfolgskriterium 1.4.12. */
const TEXTABSTAND_CSS = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p, li, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6 {
    margin-bottom: 2em !important;
  }
`;

export async function pruefeDarstellung(
  kontext: EngineKontext,
  gewuenschteRegeln: readonly string[],
): Promise<{ befunde: RohBefund[]; ausgefuehrteRegeln: string[] }> {
  const regeln = DARSTELLUNG_REGELN.filter((r) => gewuenschteRegeln.includes(r));
  if (regeln.length === 0) return { befunde: [], ausgefuehrteRegeln: [] };

  const befunde: RohBefund[] = [];
  const seite = kontext.seite;
  const urspruenglich = seite.viewportSize() ?? {
    width: kontext.viewport.breite,
    height: kontext.viewport.hoehe,
  };

  try {
    if (regeln.includes('reflow-320')) {
      await seite.setViewportSize({ width: REFLOW_BREITE, height: REFLOW_HOEHE });
      await seite.waitForTimeout(300);

      const ueberbreite = await messUeberbreite(seite, kontext.protokoll);
      if (ueberbreite) {
        befunde.push({
          regelId: 'reflow-320',
          engine: 'eigen',
          selektor: ueberbreite.selektor,
          htmlAusschnitt: ueberbreite.html,
          beschreibung:
            `Bei ${REFLOW_BREITE} Pixeln Breite muss seitlich gescrollt werden: der Inhalt ist ` +
            `${ueberbreite.inhaltsbreite} Pixel breit, das Fenster ${ueberbreite.fensterbreite}. ` +
            `Verursacher ist unter anderem dieses Element mit ${ueberbreite.elementbreite} Pixeln Breite. ` +
            'Waagerechtes und senkrechtes Scrollen zugleich macht das Lesen sehr muehsam.',
          schwere: 'ernst',
          breite: REFLOW_BREITE,
        });
      }
    }

    if (regeln.includes('zoom-200-prozent')) {
      await seite.setViewportSize({ width: ZOOM_BREITE, height: ZOOM_HOEHE });
      await seite.waitForTimeout(300);

      const ueberbreite = await messUeberbreite(seite, kontext.protokoll);
      if (ueberbreite) {
        befunde.push({
          regelId: 'zoom-200-prozent',
          engine: 'eigen',
          selektor: ueberbreite.selektor,
          htmlAusschnitt: ueberbreite.html,
          beschreibung:
            'Bei 200 Prozent Vergroesserung muss seitlich gescrollt werden. ' +
            `Der Inhalt braucht ${ueberbreite.inhaltsbreite} Pixel, verfuegbar sind ${ueberbreite.fensterbreite}. ` +
            'Text muss sich auf das Doppelte vergroessern lassen, ohne dass etwas verloren geht.',
          schwere: 'ernst',
          breite: ZOOM_BREITE,
        });
      }

      // Zusaetzlich: Verhindert die Seite das Vergroessern von vornherein?
      const gesperrt = await seite
        .evaluate(() => {
          const angabe = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
          return /user-scalable\s*=\s*(no|0)/i.test(angabe) || /maximum-scale\s*=\s*(1(\.0)?|0)/i.test(angabe);
        })
        .catch(() => false);

      if (gesperrt) {
        befunde.push({
          regelId: 'zoom-200-prozent',
          engine: 'eigen',
          selektor: 'meta[name=viewport]',
          htmlAusschnitt: null,
          beschreibung:
            'Die Seite untersagt das Vergroessern (user-scalable=no oder maximum-scale=1). ' +
            'Damit ist 1.4.4 unabhaengig vom Layout verletzt.',
          schwere: 'ernst',
        });
      }
    }

    if (regeln.includes('textabstand-test')) {
      await seite.setViewportSize(urspruenglich);
      await seite.waitForTimeout(200);

      const vorher = await messAbschnitte(seite);
      const kennung = await seite.evaluate((css) => {
        const stil = document.createElement('style');
        stil.id = 'pruefwerkzeug-textabstand';
        stil.textContent = css;
        document.head.appendChild(stil);
        return stil.id;
      }, TEXTABSTAND_CSS);

      await seite.waitForTimeout(300);
      const nachher = await messAbschnitte(seite);

      await seite.evaluate((id) => document.getElementById(id)?.remove(), kennung);
      await seite.waitForTimeout(150);

      // Abgeschnitten ist, was bei mehr Abstand ueber seinen Rahmen hinauslaeuft,
      // obwohl es das vorher nicht tat.
      const abgeschnitten = nachher.filter((n) => {
        const alt = vorher.find((v) => v.selektor === n.selektor);
        return n.abgeschnitten && alt !== undefined && !alt.abgeschnitten;
      });

      for (const fall of abgeschnitten.slice(0, 10)) {
        befunde.push({
          regelId: 'textabstand-test',
          engine: 'eigen',
          selektor: fall.selektor,
          htmlAusschnitt: fall.html,
          beschreibung:
            'Bei erhoehtem Zeilen-, Wort- und Zeichenabstand wird der Text hier abgeschnitten. ' +
            'Meist steckt eine feste Hoehe dahinter, wo eine Mindesthoehe genuegen wuerde.',
          schwere: 'ernst',
        });
      }
    }
  } finally {
    await seite.setViewportSize(urspruenglich).catch(() => undefined);
    await seite
      .evaluate(() => document.getElementById('pruefwerkzeug-textabstand')?.remove())
      .catch(() => undefined);
    await seite.waitForTimeout(150).catch(() => undefined);
  }

  return { befunde, ausgefuehrteRegeln: [...regeln] };
}

interface Ueberbreite {
  selektor: string;
  html: string | null;
  inhaltsbreite: number;
  fensterbreite: number;
  elementbreite: number;
}

/** Ermittelt, ob und wodurch die Seite breiter ist als das Fenster. */
async function messUeberbreite(
  seite: import('playwright').Page,
  protokoll: import('../../protokoll.js').Protokoll,
): Promise<Ueberbreite | null> {
  return seite
    .evaluate(() => {
      const wurzel = document.documentElement;
      const fensterbreite = wurzel.clientWidth;
      const inhaltsbreite = Math.max(wurzel.scrollWidth, document.body?.scrollWidth ?? 0);

      // Ein Pixel Spielraum: Rundungen bei gebrochenen Breiten sind kein Mangel.
      if (inhaltsbreite <= fensterbreite + 1) return null;

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

      /*
        Wer ist schuld?

        Zwei Faelle. Entweder ragt ein Element sichtbar ueber den rechten Rand —
        dann ist der schmalste solche Uebeltaeter der Verursacher, denn seine
        Eltern ragen nur seinetwegen mit. Oder ein Element ist innerlich zu
        breit, ohne selbst hinauszuragen: ein Raster mit zu grosser
        Mindestspaltenbreite etwa. Der zweite Fall fiel zunaechst durch und
        lieferte nur ein nutzloses "body" ohne Fundstelle.
      */
      let schuldiger: Element | null = null;
      let schuldigeBreite = Infinity;

      for (const element of Array.from(document.body?.querySelectorAll('*') ?? [])) {
        const masse = element.getBoundingClientRect();
        const stil = getComputedStyle(element);
        if (stil.position === 'fixed' || stil.display === 'none') continue;
        // Bewusst ausserhalb geschobene Elemente (Sprunglinks) zaehlen nicht.
        if (masse.left < 0 && masse.right < 0) continue;
        // Ebenso wenig die fuer Screenreader versteckten Schnipsel: Sie sind
        // auf einen Bildpunkt geklippt und koennen nichts breiter machen.
        if (stil.clipPath !== 'none' || masse.width <= 1 || masse.height <= 1) continue;

        const ragtHinaus = masse.width > 0 && masse.height > 0 && masse.right > fensterbreite + 1;
        const innerlichZuBreit = element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0;
        if (!ragtHinaus && !innerlichZuBreit) continue;

        const breite = ragtHinaus ? masse.width : element.scrollWidth;
        if (breite < schuldigeBreite) {
          schuldigeBreite = breite;
          schuldiger = element;
        }
      }

      return {
        selektor: schuldiger ? selektorFuer(schuldiger) : 'body',
        html: schuldiger ? schuldiger.outerHTML.replace(/\s+/g, ' ').slice(0, 300) : null,
        inhaltsbreite: Math.round(inhaltsbreite),
        fensterbreite: Math.round(fensterbreite),
        elementbreite: Math.round(Number.isFinite(schuldigeBreite) ? schuldigeBreite : 0),
      };
    })
    .catch((e: unknown) => {
      protokoll.warnung('eigen', `Breitenmessung fehlgeschlagen: ${(e as Error).message.split('\n')[0]}`);
      return null;
    });
}

interface Abschnitt {
  selektor: string;
  html: string | null;
  abgeschnitten: boolean;
}

/** Misst je Textblock, ob sein Inhalt ueber den sichtbaren Rahmen hinauslaeuft. */
async function messAbschnitte(seite: import('playwright').Page): Promise<Abschnitt[]> {
  return seite
    .evaluate(() => {
      function selektorFuer(el: Element): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const teile: string[] = [];
        let lauf: Element | null = el;
        while (lauf && teile.length < 4 && lauf !== document.documentElement) {
          let teil = lauf.tagName.toLowerCase();
          const klasse = Array.from(lauf.classList).find((k) => !/^\d/.test(k));
          if (klasse) teil += `.${CSS.escape(klasse)}`;
          else if (lauf.parentElement) {
            const gleiche = Array.from(lauf.parentElement.children).filter((g) => g.tagName === lauf!.tagName);
            if (gleiche.length > 1) teil += `:nth-of-type(${gleiche.indexOf(lauf) + 1})`;
          }
          teile.unshift(teil);
          lauf = lauf.parentElement;
        }
        return teile.join(' > ');
      }

      // Auch div, section und Konsorten: Ein abgeschnittener Text steckt
      // erfahrungsgemaess genau dort, wo jemand einem Behaelter eine feste
      // Hoehe gegeben hat — und das ist meist ein div.
      const auswahl =
        'p, li, dd, dt, h1, h2, h3, h4, h5, h6, td, th, button, a, label, figcaption, blockquote, ' +
        'div, section, article, aside, header, footer, span';
      const ergebnis: { selektor: string; html: string | null; abgeschnitten: boolean }[] = [];

      for (const element of Array.from(document.querySelectorAll(auswahl))) {
        const stil = getComputedStyle(element);
        if (stil.display === 'none' || stil.visibility === 'hidden') continue;

        // Nur Elemente mit unmittelbarem eigenem Text: sonst zaehlte jeder
        // Vorfahr mit, und ein einziger enger Kasten erzeugte zwanzig Befunde.
        const eigenerText = Array.from(element.childNodes)
          .filter((k) => k.nodeType === Node.TEXT_NODE)
          .map((k) => k.textContent ?? '')
          .join('')
          .trim();
        if (!eigenerText) continue;

        const versteckt = stil.overflowY === 'hidden' || stil.overflowX === 'hidden' || stil.overflow === 'hidden';
        const laeuftUeber = element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2;

        ergebnis.push({
          selektor: selektorFuer(element),
          html: element.outerHTML.replace(/\s+/g, ' ').slice(0, 250),
          // Nur wo der Ueberlauf auch versteckt wird, geht wirklich Text
          // verloren. Ein scrollbarer Bereich zeigt weiterhin alles.
          abgeschnitten: versteckt && laeuftUeber,
        });
      }

      return ergebnis;
    })
    .catch(() => []);
}
