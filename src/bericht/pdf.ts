/**
 * Der Bericht als PDF (X-03).
 *
 * Gedruckt wird derselbe HTML-Baum — nur mit aufgeklappten Detailbefunden und
 * dem Druckstil aus `html.ts`. Eine zweite Erzeugung fuer das PDF haette
 * unweigerlich zur Folge, dass beide Fassungen auseinanderlaufen; dann stuende
 * im PDF eine andere Zahl als in der HTML-Datei, und der Bericht waere als
 * Aussage gegenueber Dritten wertlos.
 *
 * **Keine zusaetzliche Bibliothek.** Chromium ist ohnehin installiert und
 * druckt selbst. Ein PDF-Erzeuger mehr hiesse: eine zweite Schriftbehandlung,
 * ein zweiter Zeilenumbruch, ein zweites Ergebnis — bei gleichem Zweck.
 */

import { chromium } from 'playwright';

import type { Berichtsdaten } from './daten.js';
import { alsHtml, datum } from './html.js';

export interface PdfOptionen {
  /** Bereits erzeugtes HTML weiterverwenden, statt es erneut zu bauen. */
  html?: string;
}

/**
 * Erzeugt das PDF.
 *
 * Der Fusszeilenbereich traegt Seitenzahl und Entwurfsvermerk: Ein
 * ausgedrucktes Blatt, das aus dem Zusammenhang geraet, muss weiterhin sagen,
 * dass der Bericht keine Konformitaet behauptet (X-14).
 */
export async function alsPdf(daten: Berichtsdaten, optionen: PdfOptionen = {}): Promise<Buffer> {
  const html = optionen.html ?? alsHtml(daten, { alleAufgeklappt: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const seite = await browser.newPage();
    // `domcontentloaded` genuegt: Das Dokument laedt nichts nach — es gibt
    // nichts von aussen, worauf zu warten waere.
    await seite.setContent(html, { waitUntil: 'domcontentloaded' });
    await seite.emulateMedia({ media: 'print' });

    return await seite.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: kopfzeile(daten),
      footerTemplate: fusszeile(daten),
    });
  } finally {
    await browser.close();
  }
}

/*
  Kopf- und Fusszeile sind eigene kleine Dokumente ohne Zugriff auf den Stil
  der Seite. Die Angaben stehen deshalb direkt darin.
*/

function kopfzeile(daten: Berichtsdaten): string {
  return (
    '<div style="width:100%;font-size:8pt;color:#55595e;padding:0 18mm;font-family:sans-serif;">' +
    `${escAttr(daten.deckblatt.angebot)} — ${escAttr(daten.deckblatt.standardText)}` +
    '</div>'
  );
}

function fusszeile(daten: Berichtsdaten): string {
  const vermerk = daten.deckblatt.entwurf
    ? `Entwurf — ${daten.deckblatt.offeneKriterien} von ${daten.deckblatt.kriterienGesamt} Kriterien offen`
    : escAttr(datum(daten.deckblatt.erstelltAm));

  return (
    '<div style="width:100%;font-size:8pt;color:#55595e;padding:0 18mm;font-family:sans-serif;' +
    'display:flex;justify-content:space-between;">' +
    `<span>${vermerk}</span>` +
    '<span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>' +
    '</div>'
  );
}

function escAttr(wert: string): string {
  return wert.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
