/**
 * Kapselung von Playwright.
 *
 * Der Rest des Werkzeugs kennt Playwright nicht. Wer eine Seite braucht, ruft
 * `ladeSeite` und bekommt eine geladene, gerenderte Seite oder einen klaren
 * Fehler — kein halb geladener Zustand.
 *
 * Bezug: ARCHITEKTUR.md 9 Schritt 4
 */

import { chromium } from 'playwright';
import type { Browser as PwBrowser, BrowserContext, Page } from 'playwright';

import { Protokoll, stillesProtokoll } from '../protokoll.js';

export interface Viewport {
  breite: number;
  hoehe: number;
}

/** Vorgabe-Viewport: gaengiger Schreibtischbildschirm. */
export const VIEWPORT_SCHREIBTISCH: Viewport = { breite: 1280, hoehe: 900 };

export interface BrowserOptionen {
  /** Sichtbares Fenster — noetig, sobald sich der Mensch anmelden muss (S-02). */
  sichtbar?: boolean;
  protokoll?: Protokoll;
}

export interface LadeOptionen {
  viewport?: Viewport;
  /** Hoechstdauer fuer das Laden in Millisekunden. */
  zeitlimit?: number;
  /**
   * JavaScript, das vor allem anderen in die Seite eingespritzt wird.
   * Gebraucht fuer Beobachtungen, die nachtraeglich nicht mehr moeglich sind.
   */
  spitzel?: string;
  /**
   * Wartezeit nach dem Laden, damit nachgeladene Inhalte im DOM stehen.
   * `anwendbarWenn` wird nach dem Rendern ausgewertet (ARCHITEKTUR 5.5).
   */
  ruhezeit?: number;
}

const ZEITLIMIT_VORGABE = 30_000;
const RUHEZEIT_VORGABE = 500;

export class SeitenLadeFehler extends Error {
  readonly url: string;

  constructor(url: string, ursache: string) {
    super(`Seite ${url} konnte nicht geladen werden: ${ursache}`);
    this.name = 'SeitenLadeFehler';
    this.url = url;
  }
}

/** Eine geladene Seite samt Aufraeumfunktion. */
export interface GeladeneSeite {
  seite: Page;
  url: string;
  titel: string;
  /**
   * Quelltext, wie der Server ihn geliefert hat — vor jedem JavaScript.
   * Wird fuer die Gueltigkeitspruefung des Markups gebraucht (4.1.1): Der
   * Browser repariert fehlerhafte Verschachtelung beim Parsen, im DOM waere
   * davon nichts mehr zu sehen.
   */
  quelltext: string | null;
  schliessen(): Promise<void>;
}

export class Browser {
  #browser: PwBrowser;
  #protokoll: Protokoll;

  private constructor(browser: PwBrowser, protokoll: Protokoll) {
    this.#browser = browser;
    this.#protokoll = protokoll;
  }

  static async starten(optionen: BrowserOptionen = {}): Promise<Browser> {
    const protokoll = optionen.protokoll ?? stillesProtokoll;
    const browser = await chromium.launch({ headless: !optionen.sichtbar });
    protokoll.info('browser', `Chromium gestartet (${optionen.sichtbar ? 'sichtbar' : 'unsichtbar'})`);
    return new Browser(browser, protokoll);
  }

  /**
   * Laedt eine Seite und wartet, bis das Netz zur Ruhe kommt.
   *
   * Bleibt das Netz dauerhaft in Bewegung — laufende Abfragen, Werbung,
   * Zaehlpixel —, wird das nicht als Fehler gewertet: `domcontentloaded` ist
   * erreicht, der DOM steht, die Pruefung kann laufen.
   */
  async ladeSeite(url: string, optionen: LadeOptionen = {}): Promise<GeladeneSeite> {
    const viewport = optionen.viewport ?? VIEWPORT_SCHREIBTISCH;
    const zeitlimit = optionen.zeitlimit ?? ZEITLIMIT_VORGABE;

    let kontext: BrowserContext | undefined;
    try {
      kontext = await this.#browser.newContext({
        viewport: { width: viewport.breite, height: viewport.hoehe },
        // Kein Speichern von Sitzungsdaten ueber den Scan hinaus (S-03).
        acceptDownloads: false,
      });
      const seite = await kontext.newPage();
      seite.setDefaultTimeout(zeitlimit);

      // Muss vor dem Laden geschehen: registrierte Ereignisbehandler lassen
      // sich nachtraeglich nicht mehr auslesen (2.5.4).
      if (optionen.spitzel) await seite.addInitScript(optionen.spitzel);

      const antwort = await seite.goto(url, { waitUntil: 'domcontentloaded', timeout: zeitlimit });
      const quelltext = antwort ? await antwort.text().catch(() => null) : null;

      if (antwort && !antwort.ok()) {
        this.#protokoll.warnung('browser', `${url} antwortet mit Status ${antwort.status()}`, {
          status: antwort.status(),
        });
      }

      try {
        await seite.waitForLoadState('networkidle', { timeout: Math.min(zeitlimit, 10_000) });
      } catch {
        this.#protokoll.info('browser', `${url}: Netz kam nicht zur Ruhe, Pruefung laeuft auf dem DOM weiter`);
      }

      await seite.waitForTimeout(optionen.ruhezeit ?? RUHEZEIT_VORGABE);

      const titel = await seite.title().catch(() => '');
      const kontextZumSchliessen = kontext;

      return {
        seite,
        url: seite.url(),
        titel,
        quelltext,
        schliessen: async () => {
          await kontextZumSchliessen.close().catch(() => undefined);
        },
      };
    } catch (e) {
      await kontext?.close().catch(() => undefined);
      const ursache = e instanceof Error ? e.message.split('\n')[0] ?? e.message : String(e);
      this.#protokoll.fehler('browser', `Seitenpruefung abgebrochen: ${url}`, { ursache });
      throw new SeitenLadeFehler(url, ursache);
    }
  }

  async schliessen(): Promise<void> {
    await this.#browser.close().catch(() => undefined);
  }
}

/** Screenshot der ganzen Seite als Beleg (PRD 6.1.2). */
export async function screenshot(seite: Page): Promise<Buffer> {
  return seite.screenshot({ fullPage: true, type: 'png' });
}
