/**
 * Crawl für die Gesamtprüfung und die Profil-Vorschlagsfunktion
 * (K-06, K-08, K-09).
 *
 * Zwei Verwendungen, ein Verfahren:
 *
 *   **Gesamtprüfung** — alle gefundenen Seiten werden geprüft.
 *   **Vorschlagsfunktion** — der Crawl liefert nur eine Kandidatenliste, aus
 *   der ein Mensch Seiten in ein Prüfprofil übernimmt.
 *
 * **`robots.txt` wird beachtet (K-09).** Das ist keine Formalität: Wer ein
 * Werkzeug baut, das fremde Server abfragt, hat sich an deren Ansagen zu
 * halten — auch wenn niemand ihn dazu zwingt. Zwischen den Aufrufen liegt eine
 * einstellbare Verzögerung; die Voreinstellung ist bewusst nicht null.
 */

import type { Browser } from './browser.js';
import { gleicheHerkunft, ohneFragment, pruefeAdresse } from './adressen.js';
import type { Protokoll } from '../protokoll.js';

export interface CrawlOptionen {
  /** Adresse, bei der begonnen wird. */
  start: string;
  /** Wie viele Ebenen tief verfolgt wird (K-08). */
  hoechsttiefe?: number | undefined;
  /** Wie viele Seiten höchstens besucht werden (K-08). */
  hoechstzahl?: number | undefined;
  /** Nur Pfade, die auf eines dieser Muster passen (K-08). */
  einschluss?: string[] | undefined;
  /** Pfade, die ausgelassen werden (K-08). */
  ausschluss?: string[] | undefined;
  /** Wartezeit zwischen zwei Aufrufen in Millisekunden (K-09). */
  verzoegerungMs?: number | undefined;
  /** `robots.txt` beachten. Voreinstellung: ja (K-09). */
  robotsBeachten?: boolean | undefined;
  browser: Browser;
  protokoll: Protokoll;
  abbruch?: AbortSignal;
  beiFund?: (gefunden: GefundeneSeite) => void;
}

export interface GefundeneSeite {
  url: string;
  titel: string;
  tiefe: number;
  /** Woher der Verweis kam. `null` bei der Startseite. */
  gefundenAuf: string | null;
  /** Vermuteter Zweck, aus Adresse und Inhalt geraten — als Vorschlag (K-06). */
  vermuteterZweck: string | null;
}

export interface CrawlErgebnis {
  seiten: GefundeneSeite[];
  /** Wurde abgebrochen, weil eine Grenze erreicht war? */
  grenzeErreicht: 'tiefe' | 'anzahl' | null;
  /** Adressen, die `robots.txt` untersagt. */
  durchRobotsAusgeschlossen: string[];
}

const HOECHSTTIEFE_VORGABE = 3;
const HOECHSTZAHL_VORGABE = 50;

/**
 * Verzögerung zwischen zwei Aufrufen.
 *
 * Eine halbe Sekunde ist nicht viel, aber sie ist nicht null. Ein Crawl ohne
 * Pause ist aus Sicht des Zielservers von einem Angriff kaum zu unterscheiden.
 */
const VERZOEGERUNG_VORGABE = 500;

/** Endungen, hinter denen keine prüfbare Seite steckt. */
const KEINE_SEITE = /\.(pdf|zip|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|mp4|mp3|css|js|json|xml|rss)$/i;

export async function crawle(optionen: CrawlOptionen): Promise<CrawlErgebnis> {
  const hoechsttiefe = optionen.hoechsttiefe ?? HOECHSTTIEFE_VORGABE;
  const hoechstzahl = optionen.hoechstzahl ?? HOECHSTZAHL_VORGABE;
  const verzoegerung = optionen.verzoegerungMs ?? VERZOEGERUNG_VORGABE;

  const start = pruefeAdresse(optionen.start);
  if (!start) throw new Error(`Keine gültige Startadresse: ${optionen.start}`);

  const robots = (optionen.robotsBeachten ?? true) ? await ladeRobots(start, optionen.protokoll) : null;

  const gefunden: GefundeneSeite[] = [];
  const gesehen = new Set<string>([ohneFragment(start)]);
  const durchRobots: string[] = [];
  let grenze: 'tiefe' | 'anzahl' | null = null;

  let warteschlange: { url: string; tiefe: number; gefundenAuf: string | null }[] = [
    { url: start, tiefe: 0, gefundenAuf: null },
  ];

  while (warteschlange.length > 0) {
    if (optionen.abbruch?.aborted) break;
    if (gefunden.length >= hoechstzahl) {
      grenze = 'anzahl';
      break;
    }

    const naechste = warteschlange.shift();
    if (!naechste) break;

    if (robots && !robots.erlaubt(naechste.url)) {
      durchRobots.push(naechste.url);
      optionen.protokoll.info('crawl', `robots.txt untersagt ${naechste.url}`);
      continue;
    }

    let geladen;
    try {
      geladen = await optionen.browser.ladeSeite(naechste.url, { zeitlimit: 20_000 });
    } catch (e) {
      optionen.protokoll.info('crawl', `${naechste.url} nicht erreichbar: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }

    try {
      const eintrag: GefundeneSeite = {
        url: geladen.url,
        titel: geladen.titel,
        tiefe: naechste.tiefe,
        gefundenAuf: naechste.gefundenAuf,
        vermuteterZweck: rateZweck(geladen.url, geladen.titel),
      };
      gefunden.push(eintrag);
      optionen.beiFund?.(eintrag);

      if (naechste.tiefe >= hoechsttiefe) {
        grenze ??= 'tiefe';
      } else {
        const verweise = await lesVerweise(geladen.seite);
        for (const verweis of verweise) {
          if (!gleicheHerkunft(verweis, start)) continue;
          if (KEINE_SEITE.test(new URL(verweis).pathname)) continue;
          if (!passt(verweis, optionen.einschluss, optionen.ausschluss)) continue;

          const schluessel = ohneFragment(verweis);
          if (gesehen.has(schluessel)) continue;
          gesehen.add(schluessel);

          warteschlange.push({ url: verweis, tiefe: naechste.tiefe + 1, gefundenAuf: geladen.url });
        }
      }
    } finally {
      await geladen.schliessen();
    }

    // Verzoegerung nur zwischen den Aufrufen, nicht nach dem letzten.
    if (warteschlange.length > 0 && verzoegerung > 0) {
      await new Promise((weiter) => setTimeout(weiter, robots?.verzoegerungMs ?? verzoegerung));
    }

    // Die Warteschlange kann bei grossen Seiten schnell wachsen; sie zu
    // deckeln haelt den Speicher in Grenzen.
    if (warteschlange.length > hoechstzahl * 4) warteschlange = warteschlange.slice(0, hoechstzahl * 4);
  }

  return { seiten: gefunden, grenzeErreicht: grenze, durchRobotsAusgeschlossen: durchRobots };
}

/** Passt eine Adresse auf die Ein- und Ausschlussmuster (K-08)? */
export function passt(url: string, einschluss?: readonly string[], ausschluss?: readonly string[]): boolean {
  let pfad: string;
  try {
    pfad = new URL(url).pathname;
  } catch {
    return false;
  }

  if (ausschluss?.some((muster) => passtAufMuster(pfad, muster))) return false;
  if (einschluss && einschluss.length > 0) return einschluss.some((muster) => passtAufMuster(pfad, muster));
  return true;
}

/**
 * Vergleicht einen Pfad mit einem Muster.
 * `*` steht für beliebig viele Zeichen — mehr braucht es hier nicht, und ein
 * vollwertiger regulärer Ausdruck in der Oberfläche wäre eine Stolperfalle.
 */
function passtAufMuster(pfad: string, muster: string): boolean {
  const alsRegel = muster
    .split('*')
    .map((teil) => teil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${alsRegel}$`).test(pfad) || pfad.includes(muster.replace(/\*/g, ''));
}

/**
 * Alle Verweise einer Seite, absolut aufgelöst.
 *
 * Mitgenommen werden `http`, `https` und `file` — dieselben Schemata, die auch
 * `pruefeAdresse` zulässt. `mailto:`, `tel:` und `javascript:` führen zu keiner
 * Seite und haben im Crawl nichts verloren.
 */
async function lesVerweise(seite: import('playwright').Page): Promise<string[]> {
  return seite
    .evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => /^(https?|file):/.test(href)),
    )
    .catch(() => []);
}

/**
 * Rät den Zweck einer Seite aus Adresse und Titel (K-06).
 *
 * Ausdrücklich ein **Vorschlag**, keine Feststellung: Der Mensch übernimmt die
 * Seite ins Profil und korrigiert die Bezeichnung. Ein falscher Vorschlag
 * kostet einen Klick, ein fehlender kostet Nachdenken bei jeder Zeile.
 */
export function rateZweck(url: string, titel: string): string | null {
  const text = `${url} ${titel}`.toLowerCase();

  const muster: [RegExp, string][] = [
    [/kontakt|contact/, 'Kontaktformular'],
    [/such|search|ergebnis/, 'Suchergebnis'],
    [/anmeld|login|signin|sign-in/, 'Anmeldung'],
    [/registr|signup|sign-up/, 'Registrierung'],
    [/warenkorb|cart|checkout|kasse/, 'Warenkorb oder Kasse'],
    [/impressum/, 'Impressum'],
    [/datenschutz|privacy/, 'Datenschutzerklärung'],
    [/barrierefrei|accessibility/, 'Erklärung zur Barrierefreiheit'],
    [/faq|hilfe|help/, 'Hilfe'],
    [/news|aktuell|blog|artikel|beitrag/, 'Artikelansicht'],
    [/produkt|product|shop/, 'Produktseite'],
    [/formular|form|antrag/, 'Formular'],
  ];

  for (const [regel, zweck] of muster) {
    if (regel.test(text)) return zweck;
  }

  try {
    if (new URL(url).pathname === '/') return 'Startseite';
  } catch {
    // ohne Belang
  }
  return null;
}

// ------------------------------------------------------------- robots.txt

interface Robots {
  erlaubt(url: string): boolean;
  /** `Crawl-delay` aus robots.txt in Millisekunden, falls angegeben. */
  verzoegerungMs: number | null;
}

/**
 * Liest `robots.txt` (K-09).
 *
 * Ausgewertet werden die Gruppen für `*` und für den eigenen Namen. Fehlt die
 * Datei oder ist sie nicht lesbar, gilt alles als erlaubt — das entspricht der
 * Übereinkunft.
 */
export async function ladeRobots(start: string, protokoll: Protokoll): Promise<Robots> {
  const erlaubtAlles: Robots = { erlaubt: () => true, verzoegerungMs: null };

  let adresse: URL;
  try {
    adresse = new URL('/robots.txt', start);
  } catch {
    return erlaubtAlles;
  }
  if (adresse.protocol === 'file:') return erlaubtAlles;

  let text: string;
  try {
    const antwort = await fetch(adresse.href, { signal: AbortSignal.timeout(8000) });
    if (!antwort.ok) return erlaubtAlles;
    text = await antwort.text();
  } catch {
    protokoll.info('crawl', `robots.txt unter ${adresse.href} nicht abrufbar — es gilt alles als erlaubt`);
    return erlaubtAlles;
  }

  return werteRobotsAus(text);
}

/** Wertet den Inhalt einer robots.txt aus. Ausgelagert, damit prüfbar. */
export function werteRobotsAus(text: string): Robots {
  const verbote: string[] = [];
  const erlaubnisse: string[] = [];
  let verzoegerung: number | null = null;
  let gilt = false;

  for (const rohzeile of text.split('\n')) {
    const zeile = rohzeile.replace(/#.*$/, '').trim();
    if (!zeile) continue;

    const doppelpunkt = zeile.indexOf(':');
    if (doppelpunkt === -1) continue;

    const feld = zeile.slice(0, doppelpunkt).trim().toLowerCase();
    const wert = zeile.slice(doppelpunkt + 1).trim();

    if (feld === 'user-agent') {
      gilt = wert === '*' || wert.toLowerCase().includes('accessibility-checker');
      continue;
    }
    if (!gilt) continue;

    if (feld === 'disallow' && wert) verbote.push(wert);
    else if (feld === 'allow' && wert) erlaubnisse.push(wert);
    else if (feld === 'crawl-delay') {
      const sekunden = Number.parseFloat(wert);
      if (Number.isFinite(sekunden) && sekunden > 0) verzoegerung = Math.round(sekunden * 1000);
    }
  }

  return {
    verzoegerungMs: verzoegerung,
    erlaubt(url: string): boolean {
      let pfad: string;
      try {
        pfad = new URL(url).pathname;
      } catch {
        return true;
      }

      // Die laengste passende Regel gewinnt; bei Gleichstand die Erlaubnis.
      const laengsteErlaubnis = laengsterTreffer(pfad, erlaubnisse);
      const laengstesVerbot = laengsterTreffer(pfad, verbote);

      if (laengstesVerbot === null) return true;
      if (laengsteErlaubnis === null) return false;
      return laengsteErlaubnis >= laengstesVerbot;
    },
  };
}

function laengsterTreffer(pfad: string, regeln: readonly string[]): number | null {
  let beste: number | null = null;
  for (const regel of regeln) {
    const muster = regel.replace(/\*/g, '');
    if (!pfad.startsWith(muster)) continue;
    if (beste === null || muster.length > beste) beste = muster.length;
  }
  return beste;
}
