/**
 * Abdeckungsmatrix (PRD 10, Phase 8).
 *
 * Sie beantwortet die Frage, die jedes Prüfergebnis erst einschätzbar macht:
 * **Wo ist dieses Werkzeug nachweislich zuverlässig — und wo nicht?**
 *
 * Die Zahlen darin sind gemessen, nicht behauptet. `werkzeuge/verifikation.ts`
 * lässt den vollständigen Scan über die Referenzseiten laufen, vergleicht mit
 * `test/referenzseiten/soll.json` und schreibt das Ergebnis nach
 * `katalog/abdeckung.json`. Von dort liest die Anwendung — die Oberfläche
 * zeigt sie an, der Bericht führt sie im Methodikteil (X-15).
 *
 * Die Datei ist damit *erzeugt* und trotzdem versioniert. Beides ist Absicht:
 * Wer den Katalog ändert, ohne neu zu messen, sieht im Vergleich der Fassungen
 * sofort, dass die Aussage über die Abdeckung veraltet ist.
 *
 * Fehlt die Datei, ist das kein Fehler — dann sagt die Anwendung eben, dass
 * nicht gemessen wurde. Eine unbelegte Zahl wäre schlimmer als keine.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { katalogVerzeichnis } from '../plattform/pfade.js';

/**
 * Wie belastbar die Aussage des Werkzeugs zu einem Kriterium ist.
 *
 * `luecke` ist der einzige Wert, der ein Versagen beschreibt: Dort hat das
 * Werkzeug einen eingebauten Verstoß übersehen und das Kriterium als erfüllt
 * geführt. Alle anderen Werte sind Beschreibungen, keine Noten — ein Kriterium,
 * das nur an den Menschen weitergereicht wird, ist nicht schlechter geprüft,
 * sondern anders.
 */
export type Einstufung = 'belegt' | 'teilweise' | 'nur_hinweis' | 'luecke' | 'ungeprueft';

export const EINSTUFUNG_TEXT: Record<Einstufung, string> = {
  belegt: 'Verstöße werden belegt erkannt',
  teilweise: 'Verstöße werden teilweise belegt, sonst zur Prüfung vorgelegt',
  nur_hinweis: 'Wird nie automatisch belegt, sondern immer zur Prüfung vorgelegt',
  luecke: 'Gemessene Lücke — ein eingebauter Verstoß blieb unbemerkt',
  ungeprueft: 'Nicht gemessen — es gibt keinen Testfall',
};

export const kriteriumAbdeckungSchema = z.object({
  /** Welche Prüfstufen der Katalog für dieses Kriterium vorsieht. */
  stufen: z.array(z.enum(['auto', 'llm', 'manuell'])),
  /** Zahl der Referenzseiten mit einem eingebauten Verstoß dieses Kriteriums. */
  testfaelle: z.number().int().min(0),
  /** Davon als belegter Verstoß gemeldet. */
  belegtErkannt: z.number().int().min(0),
  /** Davon nur als „Prüfung erforderlich" gemeldet — kostet manuelle Arbeit. */
  alsOffenGemeldet: z.number().int().min(0),
  /** Davon als erfüllt oder nicht anwendbar geführt. Der gefährliche Fall. */
  uebersehen: z.number().int().min(0),
  /** Meldungen auf Seiten ohne Sollwert. */
  fehlalarme: z.number().int().min(0),
  einstufung: z.enum(['belegt', 'teilweise', 'nur_hinweis', 'luecke', 'ungeprueft']),
});

export const abdeckungsmatrixSchema = z.object({
  beschreibung: z.string(),
  gemessenAm: z.string(),
  standard: z.enum(['2.1', '2.2']),
  werkzeug: z.string(),
  referenzseiten: z.array(
    z.object({
      datei: z.string(),
      zweck: z.string(),
      sollverstoesse: z.number().int().min(0),
      gepruefteKriterien: z.number().int().min(0),
    }),
  ),
  kennzahlen: z.object({
    kriterienGesamt: z.number().int().min(0),
    mitTestfall: z.number().int().min(0),
    ohneTestfall: z.number().int().min(0),
    testfaelle: z.number().int().min(0),
    belegtErkannt: z.number().int().min(0),
    alsOffenGemeldet: z.number().int().min(0),
    uebersehen: z.number().int().min(0),
    fehlalarme: z.number().int().min(0),
    /** Anteil belegt erkannter Verstöße an allen Testfällen. */
    erkennungsquote: z.number().min(0).max(1),
    /**
     * Dasselbe, aber nur für Testfälle der Stufe 1.
     *
     * Die Bezugsgröße der Zielwerte aus `soll.json`: Verstöße der Stufen `llm`
     * und `manuell` hängen am Urteil des Modells beziehungsweise des Menschen
     * und gehören nicht in eine Aussage über die Automatik.
     */
    erkennungsquoteAuto: z.number().min(0).max(1),
    testfaelleAuto: z.number().int().min(0),
    /** Fehlalarme je gemessener Seite. */
    fehlalarmquote: z.number().min(0),
  }),
  kriterien: z.record(z.string(), kriteriumAbdeckungSchema),
});

export type KriteriumAbdeckung = z.infer<typeof kriteriumAbdeckungSchema>;
export type Abdeckungsmatrix = z.infer<typeof abdeckungsmatrixSchema>;

export function standardAbdeckungsPfad(): string {
  return path.join(katalogVerzeichnis(), 'abdeckung.json');
}

/**
 * Liest die Matrix, falls sie vorhanden und gültig ist.
 *
 * Gibt `null` zurück, wenn nicht gemessen wurde oder die Datei unbrauchbar
 * ist. Ein kaputtes Messergebnis darf den Betrieb nicht anhalten — es darf nur
 * nicht als Aussage auftreten.
 */
export function ladeAbdeckung(datei: string = standardAbdeckungsPfad()): Abdeckungsmatrix | null {
  let roh: unknown;
  try {
    roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
  } catch {
    return null;
  }

  const ergebnis = abdeckungsmatrixSchema.safeParse(roh);
  return ergebnis.success ? ergebnis.data : null;
}

/**
 * Leitet die Einstufung aus den gemessenen Zahlen ab.
 *
 * Die Reihenfolge ist bindend: Eine Lücke schlägt jede andere Aussage. Ein
 * Kriterium, bei dem einmal etwas übersehen wurde, ist nicht „teilweise
 * belegt" — es ist eine Lücke, und das muss in der Anzeige stehen bleiben,
 * auch wenn neun andere Testfälle sauber liefen.
 */
export function leiteEinstufungAb(zahlen: {
  testfaelle: number;
  belegtErkannt: number;
  uebersehen: number;
}): Einstufung {
  if (zahlen.uebersehen > 0) return 'luecke';
  if (zahlen.testfaelle === 0) return 'ungeprueft';
  if (zahlen.belegtErkannt === 0) return 'nur_hinweis';
  if (zahlen.belegtErkannt === zahlen.testfaelle) return 'belegt';
  return 'teilweise';
}
