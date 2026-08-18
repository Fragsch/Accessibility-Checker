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
  Bewertung,
  Kriterium,
  OffeneFrage,
  ScanErgebnis,
  SeitenErgebnis,
  Standard,
  Status,
} from '../src/typen/index';

export type {
  Antwortwert,
  BeantworteteFrage,
  Bewertung,
  Kriterium,
  OffeneFrage,
  ScanErgebnis,
  SeitenErgebnis,
  Standard,
  Status,
};

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
}

/** Reihenfolge, in der die Status angezeigt werden: Dringendes zuerst. */
export const STATUS_REIHENFOLGE: Status[] = [
  'nicht_erfuellt',
  'pruefung_erforderlich',
  'erfuellt',
  'nicht_anwendbar',
];

export const STATUS_TEXT: Record<Status, string> = {
  nicht_erfuellt: 'nicht erfüllt',
  pruefung_erforderlich: 'Prüfung erforderlich',
  erfuellt: 'erfüllt',
  nicht_anwendbar: 'nicht anwendbar',
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
