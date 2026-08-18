/**
 * Übernahme gegebener Antworten in ein vorliegendes Ergebnis (M-02, M-04).
 *
 * Wer eine Frage beantwortet, will das Ergebnis sofort ändern sehen — nicht
 * erst nach einem neuen Scan. Ein Scan dauert Minuten; eine Antwort dauert
 * Sekunden. Beides zu koppeln wäre der sicherste Weg, die manuelle Liste
 * unbenutzbar zu machen.
 *
 * Diese Datei rechnet den Status deshalb aus dem vorliegenden Ergebnis neu.
 * Sie hält sich dabei an dieselbe Reihenfolge wie `statusableitung.ts`:
 *
 *   1. Ein belegter Verstoss bleibt ein belegter Verstoss. **Eine Antwort kann
 *      ihn nicht wegräumen.** Wer die Automatik überstimmen will, ändert die
 *      Seite, nicht das Werkzeug.
 *   2. Eine Antwort „nicht erfüllt" macht das Kriterium nicht erfüllt.
 *   3. Sind alle Fragen mit „nicht anwendbar" beantwortet und ist nichts mehr
 *      offen, ist das Kriterium gegenstandslos.
 *   4. Bleibt etwas offen — eine Frage oder ein Hinweis —, bleibt es offen.
 *   5. Sonst erfüllt.
 */

import type { BeantworteteFrage, Bewertung, ManuelleAntwort, ScanErgebnis, Status } from '../typen/index.js';

/**
 * Wendet die gespeicherten Antworten auf ein Ergebnis an.
 * Verändert das übergebene Ergebnis; gibt zurück, wie viele Bewertungen sich
 * dadurch geändert haben.
 */
export function wendeAntwortenAn(
  ergebnis: ScanErgebnis,
  antwortenJeSeite: ReadonlyMap<string, ReadonlyMap<string, ManuelleAntwort>>,
): number {
  let geaendert = 0;

  for (const seite of ergebnis.seiten) {
    if (seite.zustand !== 'fertig') continue;
    const antworten = antwortenJeSeite.get(seite.url);
    if (!antworten) continue;

    for (const bewertung of seite.bewertungen) {
      if (wendeAufBewertungAn(bewertung, antworten)) geaendert += 1;
    }
  }

  return geaendert;
}

/** Teilt die Fragen einer Bewertung neu auf und leitet den Status neu ab. */
export function wendeAufBewertungAn(
  bewertung: Bewertung,
  antworten: ReadonlyMap<string, ManuelleAntwort>,
): boolean {
  // Alle Fragen wieder zusammenfuehren — auch die bereits beantworteten.
  // Eine Antwort kann zurueckgenommen worden sein.
  const alleFragen = [...bewertung.offeneFragen, ...(bewertung.beantworteteFragen ?? []).map((b) => b.frage)];
  if (alleFragen.length === 0) return false;

  const offen = [];
  const beantwortet: BeantworteteFrage[] = [];

  for (const frage of alleFragen) {
    const antwort = antworten.get(frage.id);
    if (antwort) {
      beantwortet.push({
        frage,
        antwort: antwort.antwort,
        notiz: antwort.notiz,
        beantwortetAm: antwort.beantwortetAm,
      });
    } else {
      offen.push(frage);
    }
  }

  const neuerStatus = leiteNeuAb(bewertung, offen.length, beantwortet);
  const hatSichGeaendert =
    neuerStatus !== bewertung.status || beantwortet.length !== (bewertung.beantworteteFragen?.length ?? 0);

  bewertung.offeneFragen = offen;
  bewertung.beantworteteFragen = beantwortet;
  bewertung.status = neuerStatus;

  return hatSichGeaendert;
}

/**
 * Leitet den Status aus dem vorliegenden Ergebnis neu ab.
 *
 * Bewusst ohne die Angabe, ob eine automatische Prüfung gelaufen ist: Die
 * steht im Ergebnis nicht mehr. Sie wird auch nicht gebraucht — hat keine
 * Prüfung stattgefunden, steht darüber ein Hinweis, und der hält das
 * Kriterium ohnehin offen.
 */
function leiteNeuAb(bewertung: Bewertung, offeneFragen: number, beantwortet: readonly BeantworteteFrage[]): Status {
  if (bewertung.status === 'nicht_anwendbar' && beantwortet.length === 0 && offeneFragen === 0) {
    return 'nicht_anwendbar';
  }

  if (bewertung.befunde.length > 0) return 'nicht_erfuellt';
  if (beantwortet.some((b) => b.antwort === 'nicht_erfuellt')) return 'nicht_erfuellt';

  if (beantwortet.length > 0 && offeneFragen === 0 && beantwortet.every((b) => b.antwort === 'nicht_anwendbar')) {
    return 'nicht_anwendbar';
  }

  if (offeneFragen > 0) return 'pruefung_erforderlich';
  if (bewertung.hinweise.length > 0) return 'pruefung_erforderlich';

  return 'erfuellt';
}
