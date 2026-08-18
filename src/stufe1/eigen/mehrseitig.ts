/**
 * Prüfungen, die erst über mehrere Seiten hinweg beantwortbar sind.
 *
 *   2.4.5 Verschiedene Methoden      — gibt es mehr als einen Weg zu einer Seite?
 *   3.2.3 Konsistente Navigation     — steht die Navigation ueberall gleich?
 *   3.2.6 Konsistente Hilfe          — steht der Hilfezugang ueberall gleich?
 *
 * Diese drei Kriterien tragen im Katalog `nurMehrseitig: true`. Bei der
 * Pruefung einer Einzelseite sind sie `nicht_anwendbar` (ARCHITEKTUR 5.5) —
 * dieser Teil laeuft also nur bei Pruefprofil und Gesamtpruefung.
 *
 * Ausgewertet wird nicht waehrend, sondern nach dem Scan: Erst wenn alle Seiten
 * vorliegen, laesst sich vergleichen. Deshalb sammelt die Seitenpruefung nur
 * Merkmale ein; das Urteil faellt hier.
 */

import type { Page } from 'playwright';

import type { Befund, Hinweis } from '../../typen/index.js';

export const MEHRSEITIGE_REGELN = [
  'navigationswege',
  'navigation-reihenfolge-vergleich',
  'hilfe-position-vergleich',
] as const;

/** Was je Seite eingesammelt wird, um es spaeter zu vergleichen. */
export interface SeitenMerkmale {
  url: string;
  /** Beschriftungen der Navigationseintraege, in Reihenfolge. */
  navigation: string[];
  /** Beschriftungen der Hilfezugaenge samt ihrer Lage. */
  hilfe: { text: string; oben: number; links: number }[];
  hatSuche: boolean;
  hatSitemap: boolean;
  /** Anzahl der Links auf andere Seiten derselben Herkunft. */
  interneLinks: number;
}

/** Liest die Merkmale einer Seite aus. Veraendert nichts. */
export async function lesMerkmale(seite: Page): Promise<SeitenMerkmale | null> {
  return seite
    .evaluate(() => {
      function beschriftung(element: Element): string {
        return (element.textContent ?? element.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }

      const navigationsBereiche = Array.from(document.querySelectorAll('nav, [role=navigation]'));
      const navigation = navigationsBereiche
        .flatMap((bereich) => Array.from(bereich.querySelectorAll('a[href]')))
        .map(beschriftung)
        .filter(Boolean);

      const HILFE = /hilfe|help|kontakt|contact|faq|support|fragen|impressum/i;
      const hilfe = Array.from(document.querySelectorAll('a[href], button'))
        .filter((element) => HILFE.test(beschriftung(element)))
        .map((element) => {
          const masse = element.getBoundingClientRect();
          return {
            text: beschriftung(element),
            oben: Math.round(masse.top + window.scrollY),
            links: Math.round(masse.left + window.scrollX),
          };
        });

      const hatSuche = document.querySelector('input[type=search], [role=search], form[action*="such" i], form[action*="search" i]') !== null;
      const hatSitemap = Array.from(document.querySelectorAll('a[href]')).some((a) =>
        /sitemap|inhaltsverzeichnis|(ü|ue)bersicht/i.test(`${a.getAttribute('href')} ${beschriftung(a)}`),
      );

      const eigeneHerkunft = location.origin;
      const interneLinks = new Set(
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((href) => href.startsWith(eigeneHerkunft))
          .map((href) => href.split('#')[0] ?? href),
      ).size;

      return { url: location.href, navigation, hilfe, hatSuche, hatSitemap, interneLinks };
    })
    .catch(() => null);
}

export interface MehrseitigesErgebnis {
  befunde: Befund[];
  hinweise: Hinweis[];
}

/**
 * Vergleicht die Merkmale aller geprueften Seiten.
 *
 * `zuordnung` bestimmt wie ueberall, welches Kriterium betroffen ist — auch
 * hier wird nicht geraten (ARCHITEKTUR 5.1).
 */
export function vergleicheSeiten(
  merkmale: readonly SeitenMerkmale[],
  zuordnung: Map<string, string[]>,
  geprueftesKriterium: (id: string) => boolean,
): MehrseitigesErgebnis {
  const befunde: Befund[] = [];
  const hinweise: Hinweis[] = [];

  if (merkmale.length < 2) return { befunde, hinweise };

  const melde = (regelId: string, beschreibung: string, selektor: string | null, schwere: Befund['schwere']): void => {
    for (const kriterium of zuordnung.get(regelId) ?? []) {
      if (!geprueftesKriterium(kriterium)) continue;
      befunde.push({
        kriterium,
        regelId,
        engine: 'eigen',
        selektor,
        htmlAusschnitt: null,
        beschreibung,
        schwere,
      });
    }
  };

  // ------------------------------------------- 2.4.5 Verschiedene Methoden

  const wege: string[] = [];
  if (merkmale.some((m) => m.navigation.length > 0)) wege.push('eine Navigation');
  if (merkmale.some((m) => m.hatSuche)) wege.push('eine Suche');
  if (merkmale.some((m) => m.hatSitemap)) wege.push('ein Inhaltsverzeichnis');

  if (wege.length < 2) {
    melde(
      'navigationswege',
      `Es liess sich nur ${wege.length === 1 ? `${wege[0]} finden` : 'kein Weg finden'}, um zu einer Seite zu gelangen. ` +
        'Verlangt sind mindestens zwei voneinander unabhaengige Wege — etwa Navigation und Suche, ' +
        'oder Navigation und Inhaltsverzeichnis.',
      null,
      'maessig',
    );
  }

  // ---------------------------------------- 3.2.3 Konsistente Navigation

  const mitNavigation = merkmale.filter((m) => m.navigation.length > 0);
  if (mitNavigation.length >= 2) {
    const erste = mitNavigation[0]!;
    const abweichend = mitNavigation.slice(1).filter((m) => !gleicheReihenfolge(erste.navigation, m.navigation));

    if (abweichend.length > 0) {
      melde(
        'navigation-reihenfolge-vergleich',
        `Die Navigation steht nicht auf allen Seiten in derselben Reihenfolge. Sie weicht auf ` +
          `${abweichend.length} von ${mitNavigation.length} Seiten ab, zuerst auf ${abweichend[0]!.url}. ` +
          'Wiederkehrende Navigation muss ueberall gleich aufgebaut sein — sonst muss man sich auf jeder ' +
          'Seite neu zurechtfinden.',
        'nav',
        'maessig',
      );
    }
  } else if (merkmale.length >= 2) {
    hinweise.push({
      kriterium: '',
      herkunft: 'eigen/navigation-reihenfolge-vergleich',
      text: 'Auf den geprueften Seiten war keine wiederkehrende Navigation zu finden.',
    });
  }

  // -------------------------------------------- 3.2.6 Konsistente Hilfe

  const mitHilfe = merkmale.filter((m) => m.hilfe.length > 0);
  if (mitHilfe.length >= 2) {
    const ersteLage = lageSchluessel(mitHilfe[0]!);
    const abweichend = mitHilfe.slice(1).filter((m) => lageSchluessel(m) !== ersteLage);

    if (abweichend.length > 0) {
      melde(
        'hilfe-position-vergleich',
        `Der Zugang zur Hilfe steht nicht auf allen Seiten an derselben Stelle — er weicht auf ` +
          `${abweichend.length} von ${mitHilfe.length} Seiten ab, zuerst auf ${abweichend[0]!.url}. ` +
          'Wiederkehrende Hilfezugaenge muessen in gleicher Reihenfolge erscheinen.',
        null,
        'gering',
      );
    }
  }

  return { befunde, hinweise };
}

function gleicheReihenfolge(a: readonly string[], b: readonly string[]): boolean {
  // Verglichen wird die gemeinsame Teilmenge: Eine Seite darf zusaetzliche
  // Eintraege haben (etwa "Zurueck"), nur die Reihenfolge der gemeinsamen
  // Eintraege muss stimmen.
  const gemeinsam = new Set(a.filter((eintrag) => b.includes(eintrag)));
  if (gemeinsam.size < 2) return true;

  const ausA = a.filter((e) => gemeinsam.has(e));
  const ausB = b.filter((e) => gemeinsam.has(e));
  return ausA.join('|') === ausB.join('|');
}

/** Fasst die Lage der Hilfezugaenge zu einem vergleichbaren Schluessel zusammen. */
function lageSchluessel(merkmale: SeitenMerkmale): string {
  return merkmale.hilfe
    .map((h) => h.text.toLowerCase())
    .sort()
    .join('|');
}
