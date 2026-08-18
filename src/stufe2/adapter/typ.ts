/**
 * Vertrag der Modell-Adapter (L-27).
 *
 * Der Rest der Stufe 2 kennt kein Ollama. Er kennt einen Adapter, der ein
 * Bündel bewertet und dabei nur die drei zulässigen Urteile zurückgibt. Ein
 * Cloud-Anbieter wäre damit eine Konfigurationsänderung, kein Umbau — und
 * ebenso der Modellwechsel, den Phase 8 für den Vergleich braucht.
 */

import { z } from 'zod';

/** Die einzigen zulässigen Urteile (L-22). */
export const URTEILE = ['ok', 'problem', 'unsicher'] as const;
export type Urteil = (typeof URTEILE)[number];

/**
 * Antwortschema, wie es `prompts/stufe2.md` festlegt.
 *
 * Es wird dem Modell über den `format`-Parameter aufgezwungen (L-21) *und*
 * hinterher noch einmal geprüft. Beides ist nötig: Das Erzwingen bringt kleine
 * Modelle überhaupt erst zu brauchbaren Antworten, die Nachprüfung fängt ab,
 * was trotzdem durchrutscht.
 */
export const antwortSchema = z.object({
  ergebnisse: z.array(
    z.object({
      i: z.number().int(),
      urteil: z.enum(URTEILE),
      begruendung: z.string().max(400).optional(),
    }),
  ),
});

export type Antwort = z.infer<typeof antwortSchema>;

export interface BuendelErgebnis {
  /** Urteil je Index des Bündels. Fehlende Indizes gelten als `unsicher`. */
  urteile: Map<number, { urteil: Urteil; begruendung: string | null }>;
  /** Messwerte des Aufrufs, soweit der Adapter sie liefert (L-44). */
  messung: Messung | null;
  /**
   * Grund, falls der Aufruf nichts Verwertbares ergab. Führt nicht zu einem
   * Fehler, sondern dazu, dass alles als `unsicher` gilt (L-23).
   */
  fehlschlag: string | null;
}

export interface Messung {
  eingabeToken: number;
  ausgabeToken: number;
  /** Verarbeitete Eingabetoken je Sekunde. */
  eingabeTempo: number;
  /** Erzeugte Ausgabetoken je Sekunde. */
  ausgabeTempo: number;
  dauerMs: number;
}

export interface AdapterZustand {
  /** Ist der Dienst erreichbar? */
  erreichbar: boolean;
  /** Fassung des Dienstes, falls ermittelbar. */
  version: string | null;
  /** Lokal vorhandene Modelle. */
  modelle: string[];
  /** Grund der Nichterreichbarkeit, für die Anzeige. */
  grund: string | null;
}

export interface ModellAdapter {
  readonly name: string;
  /** Modell, das dieser Adapter benutzt. */
  readonly modell: string;

  /** Erreichbarkeit und vorhandene Modelle (L-40, Fallstrick 3). */
  zustand(): Promise<AdapterZustand>;

  /** Bewertet ein Bündel. Wirft nicht — Fehlschläge stehen im Ergebnis. */
  bewerte(systemAnweisung: string, aufgabe: string, anzahlElemente: number): Promise<BuendelErgebnis>;

  /** Gibt belegten Speicher frei, wenn der Scan vorbei ist (Fallstrick 2). */
  freigeben(): Promise<void>;
}
