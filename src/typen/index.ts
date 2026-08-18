/**
 * Gemeinsame Typen des Werkzeugs.
 *
 * Bezug: ARCHITEKTUR.md 4.1. Die dort festgelegten Typen sind verbindlich und
 * werden hier unveraendert uebernommen; ergaenzt wird nur, was der Ablauf
 * zusaetzlich braucht.
 */

export type Standard = '2.1' | '2.2';
export type Level = 'A' | 'AA';
export type Prinzip = 'wahrnehmbarkeit' | 'bedienbarkeit' | 'verstaendlichkeit' | 'robustheit';

export type Stufe = 'auto' | 'llm' | 'manuell';

export type Status = 'erfuellt' | 'nicht_erfuellt' | 'pruefung_erforderlich' | 'nicht_anwendbar';

export type AcrBewertung =
  | 'unterstuetzt'
  | 'teilweise_unterstuetzt'
  | 'unterstuetzt_nicht'
  | 'nicht_anwendbar'
  | 'nicht_abschliessend_bewertet';

/** Betriebsarten eines Scans (PRD 6.5, ARCHITEKTUR 4.2). */
export type Betriebsart = 'einzelseite' | 'profil' | 'gesamt';

/** Pruef-Engines der Stufe 1. Nicht alle sind vor Phase 3 vorhanden. */
export type Engine = 'axe' | 'ibm' | 'html' | 'sprache' | 'ocr' | 'pixel' | 'eigen';

/** Schweregrade eines Befundes, abgeleitet aus der Einstufung der Engine. */
export type Schwere = 'kritisch' | 'ernst' | 'maessig' | 'gering';

/** Zustand einer geprueften Seite (ARCHITEKTUR 4.2, Tabelle scan_seite). */
export type SeitenZustand = 'offen' | 'fertig' | 'fehler';

// ------------------------------------------------------------ Prüfkatalog

export interface StandardVermerk {
  /** Fassung, mit der das Kriterium eingefuehrt wurde. */
  eingefuehrtMit: '2.0' | '2.1' | '2.2';
  /** Fassung, ab der es entfaellt. `null`, wenn es weiter gilt. */
  entfallenAb: '2.2' | null;
}

export interface AutoPruefung {
  typ: 'auto';
  engine: Engine;
  regelIds: string[];
  hinweis?: string;
}

export interface LlmPruefung {
  typ: 'llm';
  pruefungsId: string;
  buendelGroesse: number;
  sammelSelektor?: string;
  hinweis?: string;
}

export interface ManuellePruefung {
  typ: 'manuell';
  frage: string;
  kontextSelektor?: string;
  hinweis?: string;
}

export type Pruefung = AutoPruefung | LlmPruefung | ManuellePruefung;

export interface Referenz {
  titel: string;
  url: string;
}

export interface CodeBeispiel {
  vorher: string;
  nachher: string;
}

export interface Empfehlung {
  text: string;
  codeBeispiel?: CodeBeispiel;
  referenzen: Referenz[];
}

export interface Kriterium {
  id: string;
  titel: string;
  level: Level;
  prinzip: Prinzip;
  standard: StandardVermerk;
  beschreibung: string;
  /** CSS-Selektor; `null` bedeutet: immer anwendbar (ARCHITEKTUR 5.5). */
  anwendbarWenn: string | null;
  /** Nur bei Pruefprofil oder Gesamtpruefung auswertbar. */
  nurMehrseitig?: boolean;
  pruefungen: Pruefung[];
  empfehlung: Empfehlung;
}

// ------------------------------------------------------------ Prüfergebnis

/** Ein belegter Verstoss gegen ein Erfolgskriterium. */
export interface Befund {
  kriterium: string;
  /** Regel-ID der meldenden Engine, fuer die Nachvollziehbarkeit. */
  regelId: string;
  engine: Engine;
  selektor: string | null;
  htmlAusschnitt: string | null;
  beschreibung: string;
  schwere: Schwere;
  /** Verweis auf weiterfuehrende Erlaeuterung der Engine, falls vorhanden. */
  hilfeUrl?: string;
}

/**
 * Etwas konnte nicht geprueft werden (ARCHITEKTUR 5.6).
 * Ein Hinweis fuehrt immer zu `pruefung_erforderlich`, nie zu `erfuellt`.
 */
export interface Hinweis {
  kriterium: string;
  text: string;
  /** Woher der Hinweis stammt, etwa `axe` oder `anwendbarkeit`. */
  herkunft: string;
}

/** Woher eine offene Frage stammt. */
export type FrageHerkunft = 'katalog' | 'llm';

/**
 * Eine offene Frage der Stufe 3 an den Menschen (PRD 6.4).
 *
 * Zwei Quellen speisen die Liste: die manuellen Pruefungen des Katalogs und
 * jeder mit `unsicher` bewertete Punkt der Sprachmodell-Stufe (M-06). Beide
 * landen in derselben Liste — fuer den, der sie abarbeitet, ist die Herkunft
 * nachrangig.
 */
export interface OffeneFrage {
  /**
   * Stabile Kennung der Frage.
   *
   * Sie bildet sich aus Kriterium, Fragetext und Kontext — nicht aus der
   * Reihenfolge. Nur so laesst sich eine Antwort bei einem spaeteren Scan
   * wiederfinden (M-03, M-04).
   */
  id: string;
  kriterium: string;
  frage: string;
  kontextSelektor: string | null;
  /** Anzahl der Elemente, auf die sich die Frage bezieht; `null`, wenn unbekannt. */
  betroffeneElemente: number | null;
  herkunft: FrageHerkunft;
  /** Begruendung des Sprachmodells als Entscheidungshilfe (M-06). */
  begruendung?: string | null;
  /** Vorbereiteter Kontext: Textproben der betroffenen Stellen (M-01). */
  kontext?: string[];
}

/** Antwortmoeglichkeiten der manuellen Pruefung (M-02). */
export type Antwortwert = 'erfuellt' | 'nicht_erfuellt' | 'nicht_anwendbar';

/** Eine gegebene Antwort, dauerhaft gespeichert je Adresse (M-03). */
export interface ManuelleAntwort {
  url: string;
  kriterium: string;
  frageHash: string;
  antwort: Antwortwert;
  notiz: string | null;
  beantwortetAm: string;
}

/** Bewertung eines Kriteriums auf genau einer Seite. */
export interface Bewertung {
  kriterium: string;
  status: Status;
  /** E-05: aus welchen Stufen und Engines das Ergebnis stammt. */
  herkunft: string;
  befunde: Befund[];
  hinweise: Hinweis[];
  offeneFragen: OffeneFrage[];
  /** Bereits beantwortete Fragen samt Antwort (M-03, M-04). */
  beantworteteFragen?: BeantworteteFrage[];
}

/** Eine Frage, die bereits beantwortet wurde. */
export interface BeantworteteFrage {
  frage: OffeneFrage;
  antwort: Antwortwert;
  notiz: string | null;
  beantwortetAm: string;
}

/** Ergebnis einer einzelnen geprueften Seite. */
export interface SeitenErgebnis {
  url: string;
  bezeichnung: string | null;
  titel: string | null;
  zustand: SeitenZustand;
  /** Grund, falls `zustand === 'fehler'`. */
  fehler: string | null;
  bewertungen: Bewertung[];
}

/** Ergebnis eines vollstaendigen Scans ueber eine oder mehrere Seiten. */
export interface ScanErgebnis {
  scanId: number | null;
  betriebsart: Betriebsart;
  standard: Standard;
  gestartetAm: string;
  beendetAm: string | null;
  stufe2Aktiv: boolean;
  werkzeugVersion: string;
  seiten: SeitenErgebnis[];
  /** Verdichtung ueber alle Seiten nach ARCHITEKTUR 5.3. */
  projektebene: ProjektBewertung[];
}

/** Verdichtete Bewertung eines Kriteriums ueber alle Seiten (ARCHITEKTUR 5.3). */
export interface ProjektBewertung {
  kriterium: string;
  status: Status;
  acr: AcrBewertung;
  /** URLs der Seiten, auf denen das Kriterium nicht erfuellt ist. */
  betroffeneSeiten: string[];
  /** Anzahl der Seiten, auf denen das Kriterium ueberhaupt anwendbar war. */
  anwendbareSeiten: number;
}
