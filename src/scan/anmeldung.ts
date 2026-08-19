/**
 * Anmeldung durch den Nutzer (PRD 6.1.1, S-01 bis S-05).
 *
 * **Grundsatz: Das Werkzeug erfasst, verarbeitet und speichert keine
 * Zugangsdaten.** Es kennt weder Benutzernamen noch Kennwörter, es füllt keine
 * Anmeldeformulare aus und es zeichnet keine Anmeldevorgänge auf (S-03).
 *
 * Stattdessen eine Übergabe: Das Werkzeug öffnet ein **sichtbares**
 * Browserfenster und wartet. Der Mensch meldet sich selbst an — mit Kennwort,
 * Zwei-Faktor-Verfahren, SSO oder was auch immer die Anwendung verlangt.
 * Danach bestätigt er, dass die Prüfung beginnen kann.
 *
 * Das löst drei Probleme zugleich: Es entstehen keine schützenswerten Daten,
 * es funktioniert mit jedem Anmeldeverfahren ohne Sonderbehandlung, und der
 * ganze Aufwand für sichere Speicherung entfällt.
 *
 * **Die Sitzung bleibt im Arbeitsspeicher (S-04).** Playwrights
 * `storageState` wird nie auf die Platte geschrieben; der Browserkontext lebt,
 * solange der Scan läuft, und stirbt mit ihm.
 */

import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';

import type { Protokoll } from '../protokoll.js';
import { stillesProtokoll } from '../protokoll.js';
import type { Viewport } from './browser.js';
import { VIEWPORT_SCHREIBTISCH } from './browser.js';

export type AnmeldeZustand = 'wartet' | 'bestaetigt' | 'abgebrochen' | 'zeitueberschreitung';

export interface AnmeldeOptionen {
  /** Seite, auf der sich der Mensch anmeldet. */
  url: string;
  viewport?: Viewport;
  protokoll?: Protokoll;
  /** Wie lange auf die Bestätigung gewartet wird. Voreinstellung: 15 Minuten. */
  zeitlimitMs?: number;
}

/** Voreinstellung: reichlich Zeit für Zwei-Faktor-Verfahren und SSO. */
const ZEITLIMIT_VORGABE = 15 * 60 * 1000;

/**
 * Eine laufende Anmeldung.
 *
 * Sie hält ein sichtbares Browserfenster offen und wartet auf die Bestätigung
 * durch den Menschen (S-02). Erst danach gibt sie den Kontext für den Scan
 * frei — vorher ist nicht sicher, ob die Anmeldung abgeschlossen ist.
 */
export class Anmeldung {
  readonly url: string;

  #zustand: AnmeldeZustand = 'wartet';
  #kontext: BrowserContext | null = null;
  #seite: Page | null = null;
  #browser: import('playwright').Browser | null = null;
  #protokoll: Protokoll;
  #zeitlimit: ReturnType<typeof setTimeout> | null = null;
  #bestaetigt: (() => void) | null = null;
  #warten: Promise<AnmeldeZustand>;

  private constructor(url: string, protokoll: Protokoll) {
    this.url = url;
    this.#protokoll = protokoll;
    this.#warten = new Promise<AnmeldeZustand>((aufloesen) => {
      this.#bestaetigt = () => aufloesen(this.#zustand);
    });
  }

  get zustand(): AnmeldeZustand {
    return this.#zustand;
  }

  /**
   * Öffnet ein sichtbares Browserfenster auf der Zielseite (S-01).
   *
   * Sichtbar ist hier keine Bequemlichkeit, sondern die Voraussetzung: Der
   * Mensch muss sehen, wo er seine Zugangsdaten eingibt. Ein unsichtbares
   * Fenster, das im Hintergrund eine Anmeldemaske zeigt, wäre genau das
   * Verhalten, das man von einem Prüfwerkzeug nicht erwartet.
   */
  static async oeffne(optionen: AnmeldeOptionen): Promise<Anmeldung> {
    const protokoll = optionen.protokoll ?? stillesProtokoll;
    const anmeldung = new Anmeldung(optionen.url, protokoll);
    const viewport = optionen.viewport ?? VIEWPORT_SCHREIBTISCH;

    anmeldung.#browser = await chromium.launch({ headless: false });
    anmeldung.#kontext = await anmeldung.#browser.newContext({
      viewport: { width: viewport.breite, height: viewport.hoehe },
      // Kein storageState, weder gelesen noch geschrieben: Die Sitzung bleibt
      // im Arbeitsspeicher und stirbt mit dem Kontext (S-04).
      acceptDownloads: false,
    });

    anmeldung.#seite = await anmeldung.#kontext.newPage();
    await anmeldung.#seite.goto(optionen.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    protokoll.info('anmeldung', `Sichtbares Fenster geoeffnet auf ${optionen.url} — es wird auf die Bestaetigung gewartet`);

    anmeldung.#zeitlimit = setTimeout(() => {
      if (anmeldung.#zustand !== 'wartet') return;
      anmeldung.#zustand = 'zeitueberschreitung';
      protokoll.warnung('anmeldung', 'Zeitueberschreitung — es kam keine Bestaetigung');
      anmeldung.#bestaetigt?.();
    }, optionen.zeitlimitMs ?? ZEITLIMIT_VORGABE);

    return anmeldung;
  }

  /** Wartet, bis der Mensch bestätigt oder abbricht. */
  async warteAufBestaetigung(): Promise<AnmeldeZustand> {
    return this.#warten;
  }

  /**
   * Der Mensch bestätigt, dass die Prüfung beginnen kann (S-02).
   * Ohne diesen Schritt startet kein Scan — das Werkzeug rät nicht, ob eine
   * Anmeldung abgeschlossen ist.
   */
  bestaetige(): boolean {
    if (this.#zustand !== 'wartet') return false;
    this.#zustand = 'bestaetigt';
    if (this.#zeitlimit) clearTimeout(this.#zeitlimit);
    this.#protokoll.info('anmeldung', 'Bestaetigt — der Scan kann beginnen');
    this.#bestaetigt?.();
    return true;
  }

  abbrechen(): void {
    if (this.#zustand === 'wartet') this.#zustand = 'abgebrochen';
    if (this.#zeitlimit) clearTimeout(this.#zeitlimit);
    this.#bestaetigt?.();
  }

  /**
   * Der angemeldete Kontext für den Scan.
   * Nur nach bestätigter Anmeldung — sonst liefe der Scan auf einer
   * Anmeldemaske und meldete lauter Befunde, die niemanden betreffen.
   */
  kontext(): BrowserContext | null {
    return this.#zustand === 'bestaetigt' ? this.#kontext : null;
  }

  /** Adresse, auf der das Fenster gerade steht — nach der Anmeldung oft eine andere. */
  aktuelleAdresse(): string | null {
    return this.#seite?.url() ?? null;
  }

  /**
   * Schließt alles und verwirft die Sitzung (S-04).
   * Cookies und Token verlassen den Arbeitsspeicher damit endgültig; in die
   * Datenbank sind sie nie gelangt.
   */
  async schliessen(): Promise<void> {
    if (this.#zeitlimit) clearTimeout(this.#zeitlimit);
    await this.#kontext?.close().catch(() => undefined);
    await this.#browser?.close().catch(() => undefined);
    this.#kontext = null;
    this.#seite = null;
    this.#browser = null;
    this.#protokoll.info('anmeldung', 'Fenster geschlossen, Sitzungsdaten verworfen');
  }
}

// ------------------------------------------------- Sitzungsverlust (S-05)

/**
 * Merkmale, an denen sich erkennen lässt, dass die Anmeldung verloren ging.
 *
 * Warum das eine eigene Prüfung braucht: Ohne sie prüft das Werkzeug ab dem
 * Moment des Sitzungsverlusts lauter Anmeldemasken und meldet deren Mängel als
 * Mängel der eigentlichen Anwendung. Das Ergebnis sähe vollständig aus und
 * wäre falsch — ein stiller Fehlschlag der schlimmsten Sorte.
 */
const ANMELDEMERKMALE = [
  'input[type=password]',
  'form[action*="login" i]',
  'form[action*="anmeld" i]',
  '[id*="login" i][id*="form" i]',
];

export interface Sitzungspruefung {
  verloren: boolean;
  grund: string | null;
}

/**
 * Satz, an dem der Runner einen Sitzungsverlust wiedererkennt (S-05).
 *
 * Er steht hier und nicht als Zeichenkette im Runner: Sonst haenge das
 * Anhalten des Scans an einer Formulierung, die jemand beim Ueberarbeiten
 * gutgläubig ändert — und der Scan liefe stillschweigend weiter.
 */
export const SITZUNGSVERLUST_MERKSATZ = 'Die Sitzung ist offenbar abgelaufen.';

/**
 * Prüft, ob die Sitzung noch steht (S-05).
 *
 * Angeschlagen wird nur, wenn eine Seite **unerwartet** wie eine Anmeldemaske
 * aussieht: Ein Passwortfeld auf der Anmeldeseite selbst ist kein Verlust.
 * Deshalb wird die Ausgangsadresse mitgegeben.
 */
export async function pruefeSitzung(
  seite: Page,
  anmeldeAdresse: string | null,
): Promise<Sitzungspruefung> {
  try {
    const jetzt = seite.url();

    // Auf der Anmeldeseite selbst ist eine Anmeldemaske zu erwarten.
    if (anmeldeAdresse && jetzt.startsWith(anmeldeAdresse)) return { verloren: false, grund: null };

    const merkmal = await seite.evaluate(
      (auswahl) => auswahl.find((s) => document.querySelector(s) !== null) ?? null,
      ANMELDEMERKMALE,
    );

    if (!merkmal) return { verloren: false, grund: null };

    return {
      verloren: true,
      grund:
        `Die Seite ${jetzt} zeigt eine Anmeldemaske (${merkmal}). ${SITZUNGSVERLUST_MERKSATZ} ` +
        'Die Pruefung wurde angehalten — bitte erneut anmelden.',
    };
  } catch {
    // Eine nicht auswertbare Seite ist kein Sitzungsverlust.
    return { verloren: false, grund: null };
  }
}
