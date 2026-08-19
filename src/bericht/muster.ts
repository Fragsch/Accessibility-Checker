/**
 * Musterkennung (E-25, E-26).
 *
 * Ein fehlerhafter Sprunglink im Kopfbereich erscheint auf 25 geprüften Seiten.
 * Ohne Zusammenfassung liest sich der Bericht als 25 Probleme; tatsächlich ist
 * es *eine* Zeile Code.
 *
 * Das ist mehr als Kosmetik: Es macht aus einer unübersichtlichen Fehlerliste
 * eine priorisierte Aufgabenliste. Und es ist dieselbe Mechanik, die über den
 * Inhaltshash auch die Laufzeit der Sprachmodell-Stufe senkt (L-28).
 */

import crypto from 'node:crypto';

import type { Befund, ScanErgebnis, Schwere } from '../typen/index.js';

/** Ein Befund, der auf mehreren Seiten gleich auftritt. */
export interface Muster {
  /** Kennung des Musters — derselbe Mangel an derselben Stelle. */
  hash: string;
  /** Ein Vertreter; die übrigen sind inhaltsgleich. */
  befund: Befund;
  /** Adressen, auf denen das Muster auftritt. */
  seiten: string[];
  /** Vermuteter Ort im Seitengerüst (E-26). */
  baustein: Baustein | null;
}

/**
 * Wo im Seitengerüst ein Muster sitzt (E-26).
 *
 * Ein Mangel, der auf allen Seiten im Kopfbereich auftritt, ist mit hoher
 * Wahrscheinlichkeit ein Vorlagenfehler — und dort einmal zu beheben.
 */
export type Baustein = 'kopfbereich' | 'navigation' | 'fussbereich' | 'seitenleiste' | 'formular' | 'inhalt';

/**
 * Bildet den Musterhash eines Befundes.
 *
 * Maßgeblich sind Kriterium, Regel, Selektor und Beschreibung — **nicht** die
 * Adresse. Genau darauf beruht die Zusammenfassung.
 *
 * Der HTML-Ausschnitt fließt bewusst **nicht** ein: Derselbe Vorlagenfehler
 * trägt auf jeder Seite anderen Text, bleibt aber derselbe Fehler.
 */
export function musterHash(befund: Befund): string {
  const inhalt = [befund.kriterium, befund.engine, befund.regelId, befund.selektor ?? '', befund.beschreibung]
    .map((teil) => teil.replace(/\s+/g, ' ').trim().toLowerCase())
    .join('|');
  return crypto.createHash('sha256').update(inhalt).digest('hex').slice(0, 32);
}

/**
 * Fasst gleichartige Befunde über alle Seiten zusammen.
 * Sortiert nach Verbreitung und Schwere: Was viele Seiten betrifft und
 * schwerwiegend ist, steht oben.
 */
export function erkenneMuster(ergebnis: ScanErgebnis): Muster[] {
  const nachHash = new Map<string, Muster>();

  for (const seite of ergebnis.seiten) {
    if (seite.zustand !== 'fertig') continue;

    for (const bewertung of seite.bewertungen) {
      for (const befund of bewertung.befunde) {
        const hash = musterHash(befund);
        const vorhanden = nachHash.get(hash);

        if (vorhanden) {
          if (!vorhanden.seiten.includes(seite.url)) vorhanden.seiten.push(seite.url);
        } else {
          nachHash.set(hash, {
            hash,
            befund,
            seiten: [seite.url],
            baustein: rateBaustein(befund.selektor),
          });
        }
      }
    }
  }

  return [...nachHash.values()].sort((a, b) => {
    const nachSeiten = b.seiten.length - a.seiten.length;
    if (nachSeiten !== 0) return nachSeiten;
    return gewicht(b.befund.schwere) - gewicht(a.befund.schwere);
  });
}

/**
 * Rät aus dem Selektor, in welchem Baustein der Befund sitzt (E-26).
 *
 * Ein Vorschlag, keine Feststellung — der Selektor sagt nichts mit Sicherheit.
 * Aber er trifft oft genug, um die Aufgabenliste zu ordnen.
 */
export function rateBaustein(selektor: string | null): Baustein | null {
  if (!selektor) return null;
  const text = selektor.toLowerCase();

  if (/\bheader\b|\.kopf|#kopf|banner/.test(text)) return 'kopfbereich';
  if (/\bnav\b|navigation|menu|menü/.test(text)) return 'navigation';
  if (/\bfooter\b|\.fuss|#fuss|contentinfo/.test(text)) return 'fussbereich';
  if (/\baside\b|sidebar|seitenleiste|complementary/.test(text)) return 'seitenleiste';
  if (/\bform\b|\binput\b|\bselect\b|\btextarea\b|\blabel\b/.test(text)) return 'formular';
  if (/\bmain\b|\barticle\b|\bsection\b/.test(text)) return 'inhalt';
  return null;
}

function gewicht(schwere: Schwere): number {
  switch (schwere) {
    case 'kritisch':
      return 4;
    case 'ernst':
      return 3;
    case 'maessig':
      return 2;
    case 'gering':
      return 1;
  }
}

// ------------------------------------------------------- Seitenrangliste

/** Eine Seite mit ihrer Fehlerlast (E-24). */
export interface SeitenRang {
  url: string;
  bezeichnung: string | null;
  verstoesse: number;
  /** Summe der Schweregewichte — trennt zehn Kleinigkeiten von einem Totalausfall. */
  gewicht: number;
  offen: number;
}

/**
 * Rangliste der Seiten nach Anzahl und Schwere der Verstöße (E-24).
 *
 * Die Gewichtung ist der Punkt: Zehn geringe Mängel sind nicht dasselbe wie
 * zwei kritische. Wer die Liste von oben abarbeitet, kommt am schnellsten
 * voran.
 */
export function ranglisteSeiten(ergebnis: ScanErgebnis): SeitenRang[] {
  const raenge: SeitenRang[] = [];

  for (const seite of ergebnis.seiten) {
    if (seite.zustand !== 'fertig') continue;

    let verstoesse = 0;
    let summe = 0;
    let offen = 0;

    for (const bewertung of seite.bewertungen) {
      if (bewertung.status === 'nicht_erfuellt') verstoesse += 1;
      if (bewertung.status === 'pruefung_erforderlich') offen += 1;
      for (const befund of bewertung.befunde) summe += gewicht(befund.schwere);
    }

    raenge.push({ url: seite.url, bezeichnung: seite.bezeichnung, verstoesse, gewicht: summe, offen });
  }

  return raenge.sort((a, b) => b.gewicht - a.gewicht || b.verstoesse - a.verstoesse);
}
