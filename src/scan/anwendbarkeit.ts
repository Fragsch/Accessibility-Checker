/**
 * Auswertung von `anwendbarWenn` (ARCHITEKTUR 5.5).
 *
 *   anwendbarWenn === null       → immer anwendbar
 *   Selektor findet >= 1 Element → anwendbar
 *   Selektor findet 0 Elemente   → nicht_anwendbar
 *   Selektor ist ungueltig       → anwendbar, Warnung protokollieren
 *
 * Ausgewertet wird im gerenderten DOM nach dem Ausfuehren von JavaScript, nicht
 * im Quelltext. Inhalte von iframes zaehlen mit, sofern zugaenglich.
 *
 * Der Zweifelsfall geht immer zugunsten der Pruefung aus: Was nicht sicher
 * gegenstandslos ist, wird geprueft.
 */

import type { Frame, Page } from 'playwright';

import type { Betriebsart, Kriterium } from '../typen/index.js';
import { Protokoll, stillesProtokoll } from '../protokoll.js';

export interface AnwendbarkeitErgebnis {
  anwendbar: boolean;
  /** Gefundene Elemente ueber alle Rahmen; `null` bei ungueltigem Selektor. */
  treffer: number | null;
  /** Grund, wenn nicht anwendbar — fuer die Anzeige beim Kriterium. */
  grund: string | null;
}

export interface AnwendbarkeitOptionen {
  betriebsart: Betriebsart;
  protokoll?: Protokoll;
}

/**
 * Bestimmt fuer alle Kriterien, ob sie auf dieser Seite anwendbar sind.
 * Ein Durchlauf je Selektor, Ergebnis nach Kriteriums-ID.
 */
export async function ermittleAnwendbarkeit(
  seite: Page,
  kriterien: readonly Kriterium[],
  optionen: AnwendbarkeitOptionen,
): Promise<Map<string, AnwendbarkeitErgebnis>> {
  const protokoll = optionen.protokoll ?? stillesProtokoll;
  const ergebnis = new Map<string, AnwendbarkeitErgebnis>();

  // Gleiche Selektoren nur einmal auswerten.
  const zwischenspeicher = new Map<string, number | null>();

  for (const kriterium of kriterien) {
    if (kriterium.nurMehrseitig && optionen.betriebsart === 'einzelseite') {
      ergebnis.set(kriterium.id, {
        anwendbar: false,
        treffer: null,
        grund: 'Nur ueber mehrere Seiten hinweg beurteilbar — bei der Pruefung einer Einzelseite gegenstandslos.',
      });
      continue;
    }

    if (kriterium.anwendbarWenn === null) {
      ergebnis.set(kriterium.id, { anwendbar: true, treffer: null, grund: null });
      continue;
    }

    const selektor = kriterium.anwendbarWenn;
    let treffer = zwischenspeicher.get(selektor);
    if (treffer === undefined) {
      treffer = await zaehleTreffer(seite, selektor, kriterium.id, protokoll);
      zwischenspeicher.set(selektor, treffer);
    }

    if (treffer === null) {
      // Ungueltiger Selektor: im Zweifel pruefen, nicht ueberspringen.
      ergebnis.set(kriterium.id, { anwendbar: true, treffer: null, grund: null });
      continue;
    }

    ergebnis.set(kriterium.id, {
      anwendbar: treffer > 0,
      treffer,
      grund: treffer > 0 ? null : `Kein Element passt auf "${selektor}" — auf dieser Seite gegenstandslos.`,
    });
  }

  return ergebnis;
}

/**
 * Zaehlt passende Elemente in der Hauptseite und allen erreichbaren Rahmen.
 * Gibt `null` zurueck, wenn der Selektor ungueltig ist.
 */
async function zaehleTreffer(
  seite: Page,
  selektor: string,
  kriteriumId: string,
  protokoll: Protokoll,
): Promise<number | null> {
  const rahmen: Frame[] = seite.frames();
  let summe = 0;
  let ungueltig = false;

  for (const f of rahmen) {
    try {
      summe += await f.evaluate((s) => document.querySelectorAll(s).length, selektor);
    } catch (e) {
      const meldung = e instanceof Error ? e.message : String(e);
      // Ein nicht erreichbarer Rahmen (fremde Herkunft, zwischenzeitlich
      // entfernt) ist kein ungueltiger Selektor — nur diese Quelle faellt aus.
      if (istSelektorFehler(meldung)) {
        ungueltig = true;
        break;
      }
      protokoll.info('anwendbarkeit', `Rahmen nicht auswertbar: ${meldung.split('\n')[0]}`, {
        kriterium: kriteriumId,
      });
    }
  }

  if (ungueltig) {
    protokoll.warnung('anwendbarkeit', `Ungueltiger Selektor in anwendbarWenn: "${selektor}"`, {
      kriterium: kriteriumId,
      selektor,
    });
    return null;
  }

  return summe;
}

function istSelektorFehler(meldung: string): boolean {
  return /not a valid selector|SyntaxError|failed to execute 'queryselectorall'/i.test(meldung);
}
