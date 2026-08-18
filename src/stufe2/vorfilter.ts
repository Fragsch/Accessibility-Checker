/**
 * Vorfilterung — der wirksamste Hebel auf schwacher Hardware.
 *
 * `prompts/stufe2.md` (Umsetzungshinweise) beschreibt es so: Nur was weder
 * klar gut noch klar schlecht ist, geht an das Modell. Das halbiert die
 * Aufrufe je Seite und damit die Laufzeit.
 *
 * Wichtig ist die Richtung der Fehlertoleranz. Ein Vorfilter, der ein
 * Vorurteil fällt, wäre schlimmer als gar keiner:
 *
 *   `ok` vergibt der Vorfilter nur, wo der Fall zweifelsfrei in Ordnung ist.
 *   `problem` nur bei Formulierungen aus einer geschlossenen Sperrliste.
 *   Alles andere geht an das Modell.
 *
 * Ein vorgefiltertes `problem` ist dabei kein Verstoß im Sinne von Stufe 1:
 * Ergebnisse dieser Stufe sind stets Hinweise, nie Feststellungen (L-25).
 */

import type { Urteil } from './adapter/typ.js';
import type { Element } from './sammler.js';

export interface VorUrteil {
  urteil: Urteil;
  begruendung: string;
}

/**
 * Linktexte, die den Zweck nie erkennen lassen — unabhängig vom Kontext.
 * Bewusst kurz gehalten: Jeder Eintrag mehr ist ein Urteil ohne Modell.
 */
const NICHTSSAGEND = new Set([
  'hier',
  'hier klicken',
  'klicken sie hier',
  'mehr',
  'mehr...',
  'mehr erfahren',
  'weiterlesen',
  'weiter',
  'details',
  'link',
  'artikel',
  'anzeigen',
  'lesen',
  'download',
  'öffnen',
  '»',
  '>>',
  '→',
]);

/** Wörter, die für sich genommen keinen Zweck benennen. */
const FUELLWOERTER = new Set(['der', 'die', 'das', 'den', 'dem', 'und', 'oder', 'zu', 'zur', 'zum', 'für', 'von', 'im', 'in']);

/**
 * Fällt ein Vorurteil, wo es sich ohne Modell sicher fällen lässt.
 * `null` bedeutet: Das entscheidet das Modell.
 */
export function vorfiltere(pruefungsId: string, element: Element): VorUrteil | null {
  switch (pruefungsId) {
    case 'linkzweck':
      return filtereLinkzweck(element);
    case 'ueberschrift-aussagekraft':
      return filtereUeberschrift(element);
    case 'feldbeschriftung':
      return filtereFeldbeschriftung(element);
    default:
      return null;
  }
}

function filtereLinkzweck(element: Element): VorUrteil | null {
  const text = String(element['text'] ?? '').trim();
  const klein = text.toLowerCase().replace(/\s+/g, ' ');

  if (klein.length === 0) return null;

  if (NICHTSSAGEND.has(klein)) {
    return {
      urteil: 'problem',
      begruendung: `Der Linktext "${text}" benennt kein Ziel. Als Liste vorgelesen ist er wertlos.`,
    };
  }

  // Eine nackte Adresse ist nie ein brauchbarer Linktext.
  if (/^(https?:\/\/|www\.)/i.test(klein)) {
    return {
      urteil: 'problem',
      begruendung: 'Der Linktext ist eine Adresse. Vorgelesen ergibt sie keinen Sinn.',
    };
  }

  // Mehrere bedeutungstragende Wörter benennen fast immer etwas.
  const woerter = klein.split(/[\s–—-]+/).filter((w) => w.length > 2 && !FUELLWOERTER.has(w));
  if (woerter.length >= 3) {
    return { urteil: 'ok', begruendung: 'Der Linktext nennt mehrere bedeutungstragende Wörter.' };
  }

  return null;
}

function filtereUeberschrift(element: Element): VorUrteil | null {
  const text = String(element['text'] ?? '').trim().toLowerCase();

  const INHALTSLEER = new Set(['informationen', 'sonstiges', 'details', 'mehr', 'text', 'überschrift', 'inhalt', 'allgemein']);
  if (INHALTSLEER.has(text)) {
    return {
      urteil: 'problem',
      begruendung: `Die Überschrift "${String(element['text'])}" sagt nichts über den folgenden Abschnitt.`,
    };
  }
  return null;
}

function filtereFeldbeschriftung(element: Element): VorUrteil | null {
  const label = String(element['label'] ?? '').trim();
  if (!label) return null;

  if (/^(feld|wert|eingabe|input|text)\s*\d*$/i.test(label)) {
    return {
      urteil: 'problem',
      begruendung: `Die Beschriftung "${label}" benennt nicht, was einzugeben ist.`,
    };
  }
  return null;
}

/** Aufteilung einer Sammlung in vorentschiedene und zu befragende Elemente. */
export interface Aufteilung {
  vorentschieden: { element: Element; urteil: VorUrteil }[];
  anModell: Element[];
}

export function teileAuf(pruefungsId: string, elemente: readonly Element[]): Aufteilung {
  const vorentschieden: { element: Element; urteil: VorUrteil }[] = [];
  const anModell: Element[] = [];

  for (const element of elemente) {
    const urteil = vorfiltere(pruefungsId, element);
    if (urteil) vorentschieden.push({ element, urteil });
    else anModell.push(element);
  }

  return { vorentschieden, anModell };
}
