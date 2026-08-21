/**
 * Typen der Oberflaeche.
 *
 * Aus `src/` wird ausschliesslich mit `import type` eingebunden. Diese Importe
 * verschwinden beim Bauen, sodass kein Node-Code im Browser landet — und die
 * Oberflaeche trotzdem dieselben Begriffe benutzt wie der Server.
 */

import type {
  Antwortwert,
  BeantworteteFrage,
  Betriebsart,
  Bewertung,
  Kriterium,
  OffeneFrage,
  ProjektBewertung,
  ScanErgebnis,
  SeitenErgebnis,
  Standard,
  Status,
} from '../src/typen/index';
import type { Profil, ProfilSeite, Viewport } from '../src/profil/index';
import type { GefundeneSeite } from '../src/scan/crawl';
import type { Baustein, Muster, SeitenRang } from '../src/bericht/muster';
import type { Berichtsdaten, Kennzahlen, Konformitaetszeile, Massnahme, Vermerk } from '../src/bericht/daten';
import type { Abdeckungsmatrix, Einstufung, KriteriumAbdeckung } from '../src/katalog/abdeckung';
import type { ScanUebersicht } from '../src/db/scan-speichern';

export type {
  Abdeckungsmatrix,
  Antwortwert,
  Baustein,
  BeantworteteFrage,
  Berichtsdaten,
  Betriebsart,
  Bewertung,
  Einstufung,
  GefundeneSeite,
  Kennzahlen,
  Konformitaetszeile,
  Kriterium,
  KriteriumAbdeckung,
  Massnahme,
  Muster,
  OffeneFrage,
  Profil,
  ProfilSeite,
  ProjektBewertung,
  ScanErgebnis,
  ScanUebersicht,
  SeitenErgebnis,
  SeitenRang,
  Standard,
  Status,
  Vermerk,
  Viewport,
};

/** Ausgabewege des Berichts (X-02 bis X-06). */
export type Berichtsformat = 'html' | 'pdf' | 'earl' | 'erklaerung' | 'daten';

/** Projektbericht oder Bericht über eine einzelne Seite (X-05). */
export type Berichtsumfang = { art: 'projekt' } | { art: 'seite'; url: string };

/** Eine Frage, die auf mehreren Seiten gleich lautet (M-07). */
export interface GebuendelteFrage {
  frage: OffeneFrage;
  seiten: string[];
}

/** Die geführte Prüfliste eines Scans. */
export interface Fragenliste {
  scanId: number;
  offen: GebuendelteFrage[];
  beantwortet: (BeantworteteFrage & { url: string })[];
  fortschritt: { offen: number; beantwortet: number; gesamt: number };
}

export interface Stufe2Zustand {
  hardware: {
    speicherGb: number;
    freiGb: number;
    beschleunigung: string;
    prozessor: string;
  };
  vorschlag: {
    modell: string;
    groesseGb: number;
    begruendung: string;
    erwartetesTempo: string;
    warnung: string | null;
  };
  ollama: { erreichbar: boolean; version: string | null; modelle: string[]; grund: string | null };
  modellVorhanden: boolean;
  einsatzbereit: boolean;
  schritte: { text: string; befehl: string | null }[];
  entfaelltOhneStufe2: string[];
}

/** Eine wartende Anmeldung (S-01, S-02). */
export interface AnmeldeStand {
  url: string;
  zustand: 'wartet' | 'bestaetigt' | 'abgebrochen' | 'zeitueberschreitung';
}

export interface ScanZustand {
  scanId: number;
  zustand: 'laeuft' | 'fertig' | 'abgebrochen' | 'fehler';
  standard: Standard;
  seitenGesamt: number;
  seitenFertig: number;
  aktuelleUrl: string | null;
  fehler: string | null;
  laeuft: boolean;
  ergebnis: ScanErgebnis | null;
  entwurf: boolean;
  anmeldung?: AnmeldeStand | null;
  /** Der Scan lief in einem geschützten Bereich (S-22). */
  geschuetzt?: boolean;
}

/** Verdichtete Sicht über alle Seiten eines Scans (E-20 bis E-26). */
export interface Projektansicht {
  projektebene: ProjektBewertung[];
  muster: Muster[];
  rangliste: SeitenRang[];
  seiten: { url: string; bezeichnung: string | null; titel: string | null; zustand: string; fehler: string | null }[];
}

/** Kandidatenliste eines Crawls (K-06). */
export interface Crawlergebnis {
  seiten: GefundeneSeite[];
  grenzeErreicht: 'tiefe' | 'anzahl' | null;
  durchRobotsAusgeschlossen: string[];
}

/** Vorgaben für den Crawl (K-08, K-09). */
export interface Crawlvorgabe {
  start: string;
  hoechsttiefe: number;
  hoechstzahl: number;
  einschluss?: string[];
  ausschluss?: string[];
  verzoegerungMs: number;
  robotsBeachten: boolean;
}

/** Ein vollständiger Prüfauftrag, wie ihn die Oberfläche zusammenstellt. */
export interface Auftrag {
  betriebsart: Betriebsart;
  standard: Standard;
  stufe2: boolean;
  /**
   * Name der Pruefung.
   *
   * Bei freien Adressen und bei der Gesamtpruefung Pflicht — ohne ihn sind
   * zwei Laeufe ueber dieselbe Seite in der Liste nicht zu unterscheiden. Bei
   * einem Pruefprofil entfaellt er: Dort steht der Name des Profils dafuer
   * ein, und ein zweiter daneben waere eine Angabe, die dasselbe sagt.
   */
  name?: string;
  urls?: string[];
  profilId?: number;
  crawl?: Crawlvorgabe;
  anmeldung?: { url: string };
}

/**
 * Wohin ein „Zurueck" aus einer Nebenansicht fuehrt.
 *
 * Nebenansichten sind die, die man von ueberall erreicht — die bisherigen
 * Pruefungen und die Abdeckungsmatrix. Sie sind Abstecher: Wer sie verlaesst,
 * will an sein Ergebnis zurueck, solange eines offen ist.
 */
export type Rueckziel = 'ergebnis' | 'auftrag';

/*
  Die Beschriftung des Rueckwegs steht an einer Stelle, damit zwei Ansichten
  nicht verschiedene Worte fuer denselben Weg finden (3.2.4).

  Ein Knopf muss sagen, wohin er fuehrt (2.4.6) — und hier auch, wohin er
  *nicht* fuehrt: Die Kopfzeile traegt mit „Neue Pruefung" einen eigenen Weg
  zum leeren Formular, und der raeumt das Ergebnis weg. Solange eines offen
  ist, darf kein zweiter Knopf dasselbe Ziel versprechen.
*/
export const RUECKZIEL_TEXT: Record<Rueckziel, string> = {
  ergebnis: 'Zurück zum Ergebnis',
  auftrag: 'Zurück zum Prüfauftrag',
};

export const BETRIEBSART_TEXT: Record<Betriebsart, string> = {
  einzelseite: 'Einzelseite',
  profil: 'Prüfprofil',
  gesamt: 'Gesamtprüfung',
};

export const BAUSTEIN_TEXT: Record<Baustein, string> = {
  kopfbereich: 'Kopfbereich',
  navigation: 'Navigation',
  fussbereich: 'Fußbereich',
  seitenleiste: 'Seitenleiste',
  formular: 'Formular',
  inhalt: 'Inhaltsbereich',
};

/** Reihenfolge, in der die Status angezeigt werden: Dringendes zuerst. */
export const STATUS_REIHENFOLGE: Status[] = [
  'nicht_erfuellt',
  'pruefung_erforderlich',
  'erfuellt',
  'nicht_anwendbar',
];

/**
 * Die vier Status als Anzeigetext.
 *
 * Gross geschrieben, weil sie ueberall als Beschriftung stehen — auf einer
 * Kachel, an einer Kriterienzeile, an einem Ankreuzfeld — und nirgends mitten
 * im Satz.
 */
export const STATUS_TEXT: Record<Status, string> = {
  nicht_erfuellt: 'Nicht erfüllt',
  pruefung_erforderlich: 'Prüfung erforderlich',
  erfuellt: 'Erfüllt',
  nicht_anwendbar: 'Nicht anwendbar',
};

/**
 * Zeichen je Status. Sie stehen neben dem Text, nicht an seiner Stelle —
 * niemand muss ein Symbol deuten koennen, um das Ergebnis zu verstehen.
 */
export const STATUS_ZEICHEN: Record<Status, string> = {
  nicht_erfuellt: '✕',
  pruefung_erforderlich: '?',
  erfuellt: '✓',
  nicht_anwendbar: '–',
};

export const STATUS_ERLAEUTERUNG: Record<Status, string> = {
  nicht_erfuellt: 'Ein Verstoß ist belegt.',
  pruefung_erforderlich: 'Offen — von Hand nachzusehen. Gilt nicht als erfüllt.',
  erfuellt: 'Automatisch bestätigt, nichts offen.',
  nicht_anwendbar: 'Auf dieser Seite gegenstandslos.',
};

export const PRINZIP_TEXT: Record<string, string> = {
  wahrnehmbarkeit: '1 — Wahrnehmbarkeit',
  bedienbarkeit: '2 — Bedienbarkeit',
  verstaendlichkeit: '3 — Verständlichkeit',
  robustheit: '4 — Robustheit',
};
