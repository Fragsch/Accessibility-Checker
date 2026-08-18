/**
 * Technisches Protokoll (ARCHITEKTUR 5.6, dritte Ebene).
 *
 * Nicht zu verwechseln mit `befund` (Ergebnis einer Pruefung, sichtbar in der
 * Oberflaeche) und `hinweis` (etwas konnte nicht geprueft werden, sichtbar beim
 * Kriterium). Was hier landet, sieht nur, wer die Protokolldatei oeffnet.
 *
 * Verbindlich zu protokollieren sind nach ARCHITEKTUR 5.6:
 *   - jeder Engine-Befund ohne Katalogzuordnung
 *   - jeder ungueltige Selektor aus `anwendbarWenn`
 *   - jede Modellantwort, die dem Schema nicht entspricht
 *   - jeder Abbruch einer Seitenpruefung samt Ursache
 */

import fs from 'node:fs';
import path from 'node:path';

export type Protokollstufe = 'info' | 'warnung' | 'fehler';

const STUFEN_RANG: Record<Protokollstufe, number> = { info: 0, warnung: 1, fehler: 2 };

export interface ProtokollEintrag {
  zeitpunkt: string;
  stufe: Protokollstufe;
  bereich: string;
  text: string;
  daten?: Record<string, unknown>;
}

export interface ProtokollOptionen {
  /** Zieldatei. `null` schaltet das Schreiben ab. */
  datei?: string | null;
  /** Ab welcher Stufe auf die Konsole geschrieben wird. `null` schaltet ab. */
  konsoleAb?: Protokollstufe | null;
  /** Eintraege zusaetzlich im Speicher halten — fuer Tests und Berichte. */
  imSpeicher?: boolean;
}

export class Protokoll {
  readonly eintraege: ProtokollEintrag[] = [];

  #datei: string | null;
  #konsoleAb: Protokollstufe | null;
  #imSpeicher: boolean;

  constructor(optionen: ProtokollOptionen = {}) {
    this.#datei = optionen.datei ?? null;
    this.#konsoleAb = optionen.konsoleAb === undefined ? 'warnung' : optionen.konsoleAb;
    this.#imSpeicher = optionen.imSpeicher ?? true;

    if (this.#datei) fs.mkdirSync(path.dirname(this.#datei), { recursive: true });
  }

  info(bereich: string, text: string, daten?: Record<string, unknown>): void {
    this.#schreibe('info', bereich, text, daten);
  }

  warnung(bereich: string, text: string, daten?: Record<string, unknown>): void {
    this.#schreibe('warnung', bereich, text, daten);
  }

  fehler(bereich: string, text: string, daten?: Record<string, unknown>): void {
    this.#schreibe('fehler', bereich, text, daten);
  }

  /** Eintraege einer Stufe — vor allem fuer Tests. */
  gefiltert(stufe: Protokollstufe): ProtokollEintrag[] {
    return this.eintraege.filter((e) => e.stufe === stufe);
  }

  #schreibe(stufe: Protokollstufe, bereich: string, text: string, daten?: Record<string, unknown>): void {
    const eintrag: ProtokollEintrag = {
      zeitpunkt: new Date().toISOString(),
      stufe,
      bereich,
      text,
      ...(daten ? { daten } : {}),
    };

    if (this.#imSpeicher) this.eintraege.push(eintrag);

    if (this.#datei) {
      try {
        fs.appendFileSync(this.#datei, JSON.stringify(eintrag) + '\n', 'utf8');
      } catch {
        // Ein nicht schreibbares Protokoll darf den Scan nicht anhalten.
      }
    }

    if (this.#konsoleAb && STUFEN_RANG[stufe] >= STUFEN_RANG[this.#konsoleAb]) {
      const zeile = `[${stufe}] ${bereich}: ${text}`;
      if (stufe === 'fehler') console.error(zeile);
      else console.warn(zeile);
    }
  }
}

/** Protokoll, das nichts tut — Vorgabe fuer Aufrufe ohne eigenes Protokoll. */
export const stillesProtokoll = new Protokoll({ datei: null, konsoleAb: null, imSpeicher: true });
