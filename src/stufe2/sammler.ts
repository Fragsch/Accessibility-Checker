/**
 * Sammeln der Elemente, die dem Sprachmodell vorgelegt werden.
 *
 * Je Prompt aus `prompts/stufe2.md` genau das, was seine Vorlage braucht —
 * nicht mehr. Jedes überflüssige Zeichen kostet Kontextfenster und Zeit, und
 * auf schwacher Hardware ist beides knapp.
 *
 * **Es geht ausschließlich Text an das Modell.** Keine Bilder, keine
 * Screenshots, keine Zugangsdaten. Passwortfelder werden hier nicht
 * eingesammelt, und Feldwerte gehen nie mit — nur Beschriftungen (Regel 2).
 */

import type { Page } from 'playwright';

import type { Protokoll } from '../protokoll.js';
import { sammleFokusStopps } from '../stufe1/eigen/tastatur.js';

/** Ein Element, wie es in eine Prompt-Vorlage eingesetzt wird. */
export type Element = Record<string, unknown> & { i: number };

/** Ergebnis des Sammelns für einen Prompt. */
export interface Sammlung {
  /** Wiederholte Einträge; leer, wenn die Vorlage keine Liste hat. */
  elemente: Element[];
  /** Werte, die für die ganze Seite gelten (etwa Titel und Einleitung). */
  seitenwerte: Record<string, unknown>;
  /** Name des Listenplatzhalters in der Vorlage. */
  listenName: string;
}

const LEER: Sammlung = { elemente: [], seitenwerte: {}, listenName: 'elemente' };

/** Höchstzahl gesammelter Elemente je Prompt — deckelt Zeit und Kontext. */
const HOECHSTZAHL = 60;

/** Höchstlänge eines Textstücks im Prompt. */
const TEXT_GRENZE = 300;

export interface SammelKontext {
  seite: Page;
  protokoll: Protokoll;
}

/**
 * Sammelt die Elemente für einen Prompt.
 * Unbekannte Prompt-Kennungen liefern eine leere Sammlung; die Prüfung fällt
 * dann aus und erzeugt einen Hinweis — sie gilt nie als bestanden.
 */
export async function sammle(pruefungsId: string, kontext: SammelKontext): Promise<Sammlung> {
  switch (pruefungsId) {
    case 'linkzweck':
      return { ...LEER, elemente: await imBrowser(kontext, sammleLinks) };
    case 'seitentitel':
      return { elemente: [], seitenwerte: await seitenAngaben(kontext), listenName: 'elemente' };
    case 'ueberschrift-aussagekraft':
      return { ...LEER, elemente: await imBrowser(kontext, sammleUeberschriftenMitText) };
    case 'ueberschriftenhierarchie':
      return { ...LEER, elemente: await imBrowser(kontext, sammleUeberschriften) };
    case 'sensorische-anweisungen':
      return { ...LEER, elemente: await imBrowser(kontext, sammleAnweisungen) };
    case 'feldbeschriftung':
      return { ...LEER, elemente: await imBrowser(kontext, sammleFelder) };
    case 'fehlerempfehlung':
      return { ...LEER, elemente: await imBrowser(kontext, sammleFehlermeldungen) };
    case 'fokusreihenfolge':
      return { elemente: [], seitenwerte: { stopps: await sammleStopps(kontext) }, listenName: 'stopps' };
    case 'lesereihenfolge':
      return { elemente: [], seitenwerte: { bloecke: await imBrowser(kontext, sammleTextbloecke) }, listenName: 'bloecke' };
    // konsistente-bezeichnung und konsistente-hilfe entstehen erst aus dem
    // Vergleich mehrerer Seiten; sie werden in `mehrseitig.ts` gebildet.
    default:
      return LEER;
  }
}

async function imBrowser(kontext: SammelKontext, sammler: () => unknown[]): Promise<Element[]> {
  try {
    const roh = (await kontext.seite.evaluate(sammler)) as Record<string, unknown>[];
    return roh.slice(0, HOECHSTZAHL).map((eintrag, nummer) => ({ ...eintrag, i: nummer + 1 }));
  } catch (e) {
    kontext.protokoll.warnung('stufe2', `Sammeln fehlgeschlagen: ${(e as Error).message.split('\n')[0]}`);
    return [];
  }
}

async function seitenAngaben(kontext: SammelKontext): Promise<Record<string, unknown>> {
  try {
    return (await kontext.seite.evaluate(() => {
      const kuerze = (t: string | null | undefined, n: number): string =>
        (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

      const einleitung = Array.from(document.querySelectorAll('main p, article p, p'))
        .map((p) => kuerze(p.textContent, 400))
        .find((t) => t.length > 40);

      return {
        titel: kuerze(document.title, 200),
        h1: kuerze(document.querySelector('h1')?.textContent, 200),
        einleitung: einleitung ?? '',
      };
    })) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function sammleStopps(kontext: SammelKontext): Promise<Element[]> {
  const stopps = await sammleFokusStopps(kontext.seite, kontext.protokoll, 60);
  return stopps.map((halt, nummer) => ({
    i: nummer + 1,
    element: halt.selektor.split(' > ').pop() ?? halt.selektor,
    beschriftung: halt.beschriftung,
    bereich: halt.bereich,
  }));
}

// ------------------------------------------------- Die Sammler im Browser
//
// Jede dieser Funktionen läuft im Browser und muss in sich geschlossen sein.
// Sie geben Rohdaten ohne Index zurück; die Nummerierung vergibt der Aufrufer,
// damit sie lückenlos zu den Bündeln passt.

function sammleLinks(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  return Array.from(document.querySelectorAll('a[href]'))
    .filter((a) => {
      const stil = getComputedStyle(a);
      if (stil.display === 'none' || stil.visibility === 'hidden') return false;
      return kuerze(a.textContent, 200).length > 0 || a.hasAttribute('aria-label');
    })
    .map((a) => {
      const eltern = a.parentElement;
      const umgebung = kuerze(eltern?.textContent, 200);
      const text = kuerze(a.getAttribute('aria-label') ?? a.textContent, 120);
      return {
        text,
        kontext: umgebung === text ? '' : umgebung,
        href: kuerze((a as HTMLAnchorElement).getAttribute('href'), 120),
      };
    });
}

function sammleUeberschriftenMitText(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, legend'))
    .map((ueberschrift) => {
      // Der Text, der auf die Überschrift folgt — bis zur nächsten Überschrift.
      let auszug = '';
      let lauf: globalThis.Element | null = ueberschrift.nextElementSibling;
      while (lauf && auszug.length < 300) {
        if (/^H[1-6]$/.test(lauf.tagName)) break;
        auszug += ` ${kuerze(lauf.textContent, 300)}`;
        lauf = lauf.nextElementSibling;
      }

      // Steht nichts daneben, im Elternbereich nachsehen.
      if (!auszug.trim()) auszug = kuerze(ueberschrift.parentElement?.textContent, 300);

      return {
        ebene: ueberschrift.tagName.toLowerCase(),
        text: kuerze(ueberschrift.textContent, 150),
        auszug: kuerze(auszug, 300),
      };
    })
    .filter((e) => (e.text as string).length > 0);
}

function sammleUeberschriften(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .map((u) => ({ ebene: Number(u.tagName.slice(1)), text: kuerze(u.textContent, 150) }))
    .filter((e) => e.text.length > 0);
}

function sammleAnweisungen(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  // Nur Texte, die überhaupt eine Anweisung sein können. Ein Prompt, der
  // fünfzig Fließtextabsätze bewerten soll, kostet Zeit ohne Ertrag.
  const ANWEISUNG = /klicke|klicken|wähl|waehl|drück|druck|siehe|beachte|nutzen sie|geben sie|tippen|tippe|wählen sie/i;

  return Array.from(document.querySelectorAll('p, li, label, [role=note]'))
    .map((element) => kuerze(element.textContent, 300))
    .filter((text) => text.length > 15 && ANWEISUNG.test(text))
    .map((text) => ({ text }));
}

function sammleFelder(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  const beschriftungVon = (feld: globalThis.Element): string => {
    const ariaLabel = feld.getAttribute('aria-label');
    if (ariaLabel) return kuerze(ariaLabel, 120);

    const verweis = feld.getAttribute('aria-labelledby');
    if (verweis) {
      const ziel = document.getElementById(verweis.split(/\s+/)[0] ?? '');
      if (ziel) return kuerze(ziel.textContent, 120);
    }
    if (feld.id) {
      const label = document.querySelector(`label[for="${CSS.escape(feld.id)}"]`);
      if (label) return kuerze(label.textContent, 120);
    }
    return kuerze(feld.closest('label')?.textContent, 120);
  };

  return Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea'))
    // Passwortfelder gehen niemals an ein Modell (Regel 2, S-03).
    .filter((feld) => feld.getAttribute('type') !== 'password')
    .filter((feld) => {
      const stil = getComputedStyle(feld);
      return stil.display !== 'none' && stil.visibility !== 'hidden';
    })
    .map((feld) => {
      const beschrieben = feld.getAttribute('aria-describedby');
      const beschreibung = beschrieben
        ? kuerze(document.getElementById(beschrieben.split(/\s+/)[0] ?? '')?.textContent, 200)
        : '';

      return {
        label: beschriftungVon(feld),
        typ: feld.getAttribute('type') ?? feld.tagName.toLowerCase(),
        placeholder: kuerze(feld.getAttribute('placeholder'), 120),
        beschreibung,
      };
    });
}

function sammleFehlermeldungen(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

  const ergebnis: { feld: string; meldung: string }[] = [];

  // Meldungen, die die Seite selbst als Fehler auszeichnet.
  for (const meldung of Array.from(document.querySelectorAll('[role=alert], .fehler, .error, [aria-invalid=true]'))) {
    const text = kuerze(meldung.textContent, 250);
    if (text.length < 5) continue;

    const feld = meldung.closest('label, .feld, .form-group')?.querySelector('label');
    ergebnis.push({ feld: kuerze(feld?.textContent, 120) || '(nicht zuzuordnen)', meldung: text });
  }

  // Meldungen der eingebauten Formularprüfung des Browsers.
  for (const feld of Array.from(document.querySelectorAll('input, select, textarea'))) {
    if (feld.getAttribute('type') === 'password') continue;
    const meldung = (feld as HTMLInputElement).validationMessage;
    if (!meldung) continue;

    const label = feld.id ? document.querySelector(`label[for="${CSS.escape(feld.id)}"]`) : null;
    ergebnis.push({
      feld: kuerze(label?.textContent ?? feld.getAttribute('name'), 120) || '(ohne Beschriftung)',
      meldung: kuerze(meldung, 250),
    });
  }

  return ergebnis;
}

function sammleTextbloecke(): unknown[] {
  const kuerze = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const auswahl = 'h1, h2, h3, h4, h5, h6, p, li, figcaption, blockquote, dt, dd, td, th, label, button';

  return Array.from(document.querySelectorAll(auswahl))
    .filter((element) => {
      if (element.querySelector(auswahl)) return false;
      const stil = getComputedStyle(element);
      return stil.display !== 'none' && stil.visibility !== 'hidden';
    })
    .map((element) => ({ element: element.tagName.toLowerCase(), text: kuerze(element.textContent, 200) }))
    .filter((e) => e.text.length > 2);
}

export { TEXT_GRENZE };
