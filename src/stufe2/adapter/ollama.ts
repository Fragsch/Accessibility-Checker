/**
 * Adapter für Ollama — der Standard der Stufe 2 (L-20).
 *
 * Vollständig lokal: Der Dienst lauscht auf 127.0.0.1, geprüfte Seiteninhalte
 * verlassen den Rechner nicht (NF-02). Die Adresse ist einstellbar, aber die
 * Voreinstellung bleibt die Rückschleife — `OLLAMA_HOST=0.0.0.0` öffnet den
 * Dienst ohne jede Zugangskontrolle für das ganze Netz.
 *
 * Drei Fallstricke aus ANLEITUNG-OLLAMA.md sind hier verbindlich behandelt:
 *
 *   1. `num_ctx` wird ausdrücklich gesetzt. Ohne das schneidet Ollama die
 *      Anfrage stillschweigend ab — meist die Systemanweisung — und das Modell
 *      antwortet auf eine Aufgabe, die es nur halb gesehen hat. Das Ergebnis
 *      sieht gültig aus und ist falsch.
 *   2. `keep_alive` hält das Modell über den Scan hinweg geladen; danach wird
 *      es freigegeben.
 *   3. Ein nicht erreichbarer Dienst ist kein Absturz, sondern eine
 *      abgeschaltete Stufe 2 (L-26).
 */

import { z } from 'zod';

import { antwortSchema } from './typ.js';
import type { AdapterZustand, BuendelErgebnis, Messung, ModellAdapter, Urteil } from './typ.js';
import { Protokoll, stillesProtokoll } from '../../protokoll.js';

/** Voreinstellung nach ANLEITUNG-OLLAMA.md 9. */
export const OLLAMA_ADRESSE = 'http://127.0.0.1:11434';

/**
 * Kontextfenster. 8192 reicht laut Anleitung für Bündel von 20 Elementen.
 * Wer größere Bündel fährt, muss den Wert anheben — und beachten, dass ein
 * größeres Fenster mehr Speicher belegt.
 */
const KONTEXTFENSTER = 8192;

/** Wie lange das Modell nach einem Aufruf geladen bleibt. */
const GELADEN_HALTEN = '30m';

/** Höchstdauer eines einzelnen Aufrufs. Danach gilt das Bündel als unsicher. */
const ZEITLIMIT_MS = 180_000;

export interface OllamaOptionen {
  modell: string;
  adresse?: string;
  protokoll?: Protokoll;
  /** Kontextfenster; nur anheben, wenn die Bündel größer werden. */
  kontextfenster?: number;
}

interface OllamaAntwort {
  message?: { content?: string };
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaAdapter implements ModellAdapter {
  readonly name = 'ollama';
  readonly modell: string;

  readonly #adresse: string;
  readonly #protokoll: Protokoll;
  readonly #kontextfenster: number;

  constructor(optionen: OllamaOptionen) {
    this.modell = optionen.modell;
    this.#adresse = optionen.adresse ?? OLLAMA_ADRESSE;
    this.#protokoll = optionen.protokoll ?? stillesProtokoll;
    this.#kontextfenster = optionen.kontextfenster ?? KONTEXTFENSTER;
  }

  async zustand(): Promise<AdapterZustand> {
    try {
      const version = await this.#hole<{ version?: string }>('/api/version', 4000);
      const modelle = await this.#hole<{ models?: { name?: string }[] }>('/api/tags', 4000);

      return {
        erreichbar: true,
        version: version.version ?? null,
        modelle: (modelle.models ?? []).map((m) => m.name ?? '').filter(Boolean),
        grund: null,
      };
    } catch (e) {
      return {
        erreichbar: false,
        version: null,
        modelle: [],
        grund: beschreibeFehler(e, this.#adresse),
      };
    }
  }

  /**
   * Bewertet ein Bündel.
   *
   * Wirft unter keinen Umständen. Jeder Fehlschlag — kein Dienst, kaputtes
   * JSON, Schemaverstoß, Zeitüberschreitung — führt dazu, dass die Elemente
   * als `unsicher` gelten und in die manuelle Liste wandern (L-23). Ein
   * erneuter Versuch findet nicht statt: Bei Temperatur 0 käme dasselbe heraus.
   */
  async bewerte(systemAnweisung: string, aufgabe: string, anzahlElemente: number): Promise<BuendelErgebnis> {
    const leer = (grund: string): BuendelErgebnis => ({ urteile: new Map(), messung: null, fehlschlag: grund });
    const begonnen = Date.now();

    let roh: OllamaAntwort;
    try {
      roh = await this.#sende(systemAnweisung, aufgabe);
    } catch (e) {
      const grund = beschreibeFehler(e, this.#adresse);
      this.#protokoll.warnung('stufe2', `Modellaufruf fehlgeschlagen: ${grund}`, { modell: this.modell });
      return leer(grund);
    }

    const inhalt = roh.message?.content ?? '';
    let gelesen: unknown;
    try {
      gelesen = JSON.parse(inhalt);
    } catch {
      // Verbindliche Protokollierung nach ARCHITEKTUR 5.6.
      this.#protokoll.warnung('stufe2', 'Modellantwort ist kein gueltiges JSON', {
        modell: this.modell,
        anfang: inhalt.slice(0, 200),
      });
      return leer('Die Antwort des Modells war kein gültiges JSON.');
    }

    const geprueft = antwortSchema.safeParse(gelesen);
    if (!geprueft.success) {
      this.#protokoll.warnung('stufe2', 'Modellantwort entspricht nicht dem Schema', {
        modell: this.modell,
        maengel: geprueft.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return leer('Die Antwort des Modells entsprach nicht dem vorgegebenen Schema.');
    }

    const urteile = new Map<number, { urteil: Urteil; begruendung: string | null }>();
    for (const eintrag of geprueft.data.ergebnisse) {
      // Indizes ausserhalb des Bündels sind eine Halluzination und werden
      // verworfen — nicht auf ein anderes Element umgedeutet.
      if (eintrag.i < 1 || eintrag.i > anzahlElemente) continue;
      urteile.set(eintrag.i, { urteil: eintrag.urteil, begruendung: eintrag.begruendung ?? null });
    }

    return { urteile, messung: messungAus(roh, Date.now() - begonnen), fehlschlag: null };
  }

  /** Gibt das Modell frei, damit es den Speicher nicht dauerhaft belegt. */
  async freigeben(): Promise<void> {
    try {
      await this.#anfrage('/api/chat', { model: this.modell, messages: [], keep_alive: 0 }, 5000);
      this.#protokoll.info('stufe2', `Modell ${this.modell} freigegeben`);
    } catch {
      // Nicht schlimm: Ollama entlaedt das Modell ohnehin nach einer Weile.
    }
  }

  async #sende(systemAnweisung: string, aufgabe: string): Promise<OllamaAntwort> {
    return this.#anfrage<OllamaAntwort>(
      '/api/chat',
      {
        model: this.modell,
        stream: false,
        // Erzwungenes Schema (L-21). zod 4 erzeugt es unmittelbar aus dem
        // Laufzeitschema; ein zweites Schema von Hand wuerde davon abweichen.
        format: z.toJSONSchema(antwortSchema),
        keep_alive: GELADEN_HALTEN,
        options: {
          temperature: 0,
          num_ctx: this.#kontextfenster,
          num_predict: 1024,
        },
        messages: [
          { role: 'system', content: systemAnweisung },
          { role: 'user', content: aufgabe },
        ],
      },
      ZEITLIMIT_MS,
    );
  }

  async #hole<T>(pfad: string, zeitlimitMs: number): Promise<T> {
    const abbruch = AbortSignal.timeout(zeitlimitMs);
    const antwort = await fetch(`${this.#adresse}${pfad}`, { signal: abbruch });
    if (!antwort.ok) throw new Error(`Ollama antwortet mit Status ${antwort.status}`);
    return (await antwort.json()) as T;
  }

  async #anfrage<T>(pfad: string, koerper: unknown, zeitlimitMs: number): Promise<T> {
    const abbruch = AbortSignal.timeout(zeitlimitMs);
    const antwort = await fetch(`${this.#adresse}${pfad}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(koerper),
      signal: abbruch,
    });

    if (!antwort.ok) {
      const text = await antwort.text().catch(() => '');
      throw new Error(`Ollama antwortet mit Status ${antwort.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    return (await antwort.json()) as T;
  }
}

/** Rechnet die Zählwerte von Ollama in Geschwindigkeiten um (L-44). */
function messungAus(roh: OllamaAntwort, dauerMs: number): Messung | null {
  const eingabeToken = roh.prompt_eval_count ?? 0;
  const ausgabeToken = roh.eval_count ?? 0;
  const eingabeDauer = (roh.prompt_eval_duration ?? 0) / 1e9;
  const ausgabeDauer = (roh.eval_duration ?? 0) / 1e9;

  if (eingabeToken === 0 && ausgabeToken === 0) return null;

  return {
    eingabeToken,
    ausgabeToken,
    eingabeTempo: eingabeDauer > 0 ? eingabeToken / eingabeDauer : 0,
    ausgabeTempo: ausgabeDauer > 0 ? ausgabeToken / ausgabeDauer : 0,
    dauerMs,
  };
}

/** Übersetzt technische Fehler in etwas, das in der Oberfläche stehen kann. */
export function beschreibeFehler(e: unknown, adresse: string): string {
  const meldung = e instanceof Error ? e.message : String(e);

  if (/timeout|aborted|TimeoutError/i.test(meldung)) {
    return 'Ollama hat nicht rechtzeitig geantwortet.';
  }
  if (/ECONNREFUSED|fetch failed|Failed to fetch/i.test(meldung)) {
    return `Unter ${adresse} antwortet kein Ollama. Läuft der Dienst? (brew services start ollama)`;
  }
  if (/not found|status 404/i.test(meldung)) {
    return 'Das gewählte Modell ist nicht geladen. Mit "ollama pull <modell>" nachholen.';
  }
  return meldung;
}
