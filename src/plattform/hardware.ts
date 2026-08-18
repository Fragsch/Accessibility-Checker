/**
 * Erkennung der Ausstattung und Modellvorschlag (L-42, ARCHITEKTUR 8.1).
 *
 * Einer der drei gekapselten Plattform-Adapter. Alles Systemabhängige steht
 * hier; der Rest des Werkzeugs fragt nur nach dem Ergebnis.
 *
 * **Apple Silicon ist kein Rechner ohne Grafikkarte.** Das PRD hält das
 * ausdrücklich fest: Gemeinsamer Speicher und Metal-Beschleunigung lassen
 * Sprachmodelle dort deutlich flüssiger laufen als auf x86 ohne Grafikkarte.
 * Wer das gleichsetzt, schlägt ein zu kleines Modell vor.
 */

import os from 'node:os';

export type Beschleunigung = 'apple-silicon' | 'grafikkarte' | 'nur-prozessor';

export interface Hardware {
  betriebssystem: NodeJS.Platform;
  prozessor: string;
  kerne: number;
  /** Gesamter Arbeitsspeicher in Gigabyte. */
  speicherGb: number;
  /** Derzeit freier Arbeitsspeicher in Gigabyte. */
  freiGb: number;
  beschleunigung: Beschleunigung;
}

export interface Modellvorschlag {
  modell: string;
  /** Ungefährer Speicherbedarf des Modells in Gigabyte. */
  groesseGb: number;
  begruendung: string;
  /** Erwartetes Tempo als Fließtext, nicht als Zahl — gemessen wird später. */
  erwartetesTempo: string;
  /**
   * Warnung, wenn der Speicher knapp ist. Kein Ausschluss: Der Betrieb bleibt
   * möglich, aber der Mensch soll wissen, worauf er sich einlässt.
   */
  warnung: string | null;
}

export function erkenneHardware(): Hardware {
  const speicherGb = os.totalmem() / 1024 ** 3;
  const freiGb = os.freemem() / 1024 ** 3;
  const prozessoren = os.cpus();
  const prozessor = prozessoren[0]?.model ?? 'unbekannt';

  return {
    betriebssystem: os.platform(),
    prozessor,
    kerne: prozessoren.length,
    speicherGb: Math.round(speicherGb * 10) / 10,
    freiGb: Math.round(freiGb * 10) / 10,
    beschleunigung: erkenneBeschleunigung(prozessor),
  };
}

function erkenneBeschleunigung(prozessor: string): Beschleunigung {
  if (os.platform() === 'darwin' && os.arch() === 'arm64') return 'apple-silicon';

  // Eine gesonderte Grafikkarte laesst sich ohne native Abfrage nicht
  // zuverlaessig feststellen. Statt zu raten, gilt der vorsichtigere Fall —
  // und der Mensch kann ihn in der Oberflaeche richtigstellen (L-43).
  if (/nvidia|radeon|geforce/i.test(prozessor)) return 'grafikkarte';
  return 'nur-prozessor';
}

/**
 * Schlägt ein Modell vor.
 *
 * Die Werte stammen aus ANLEITUNG-OLLAMA.md 1 und PRD 6.3.1. Maßgeblich ist
 * der Arbeitsspeicher, nicht die Rechenleistung: Ein Modell, das nicht in den
 * Speicher passt, wird ausgelagert und dann unbrauchbar langsam.
 *
 * Beachtet wird dabei, dass Browser und Playwright während des Scans
 * gleichzeitig laufen — das Modell darf nicht den ganzen Speicher belegen.
 */
export function schlageModellVor(hardware: Hardware): Modellvorschlag {
  const { speicherGb, beschleunigung } = hardware;

  if (speicherGb >= 30) {
    return {
      modell: 'phi4:14b',
      groesseGb: 9,
      begruendung: `${speicherGb} GB Arbeitsspeicher tragen auch ein großes Modell.`,
      erwartetesTempo: '10–15 Token/s, beste Urteilsqualität',
      warnung: null,
    };
  }

  if (speicherGb >= 15) {
    return {
      modell: 'qwen3:8b',
      groesseGb: 5,
      begruendung: `${speicherGb} GB Arbeitsspeicher reichen für ein 8B-Modell neben Browser und Prüfwerkzeug.`,
      erwartetesTempo: '10–15 Token/s',
      warnung: null,
    };
  }

  const knapp = speicherGb < 9;
  return {
    modell: 'phi4-mini',
    groesseGb: 2.3,
    begruendung:
      `${speicherGb} GB Arbeitsspeicher lassen nur ein kleines Modell zu. Ein 8B-Modell wäre zwar ladbar, ` +
      'verdrängt aber Browser und Prüfwerkzeug aus dem Speicher.',
    erwartetesTempo:
      beschleunigung === 'apple-silicon' ? '15–20 Token/s über Metal' : 'etwa 12 Token/s ohne Grafikbeschleunigung',
    warnung: knapp
      ? 'Der Speicher ist knapp. Schließen Sie während eines Scans andere Anwendungen, und nutzen Sie die ' +
        'Sprachmodell-Stufe eher für Einzelseiten als für Prüfprofile.'
      : null,
  };
}

/**
 * Schätzt die Laufzeit der Stufe 2 je Seite (L-44).
 *
 * Grundlage sind gemessene Werte, keine Annahmen — deshalb nimmt die Funktion
 * die Messung entgegen. Liegt keine vor, gibt sie `null` zurück; die
 * Oberfläche zeigt dann keine Schätzung statt einer erfundenen.
 *
 * Die Kennzahlen je Seite stammen aus ANLEITUNG-OLLAMA.md 7: rund zehn Aufrufe
 * mit je etwa 1500 Eingabe- und 250 Ausgabetoken, durch die Vorfilterung etwa
 * halbiert.
 */
export interface Laufzeitschaetzung {
  sekundenJeSeite: number;
  /** Ob die Schwelle aus L-45 überschritten wird. */
  ueberSchwelle: boolean;
  text: string;
}

/** Schwelle nach L-45, einstellbar; Voreinstellung fünf Minuten. */
export const SCHWELLE_SEKUNDEN_VORGABE = 300;

export function schaetzeLaufzeit(
  eingabeTempo: number,
  ausgabeTempo: number,
  optionen: { aufrufeJeSeite?: number; schwelleSekunden?: number } = {},
): Laufzeitschaetzung | null {
  if (eingabeTempo <= 0 || ausgabeTempo <= 0) return null;

  const aufrufe = optionen.aufrufeJeSeite ?? 5;
  const schwelle = optionen.schwelleSekunden ?? SCHWELLE_SEKUNDEN_VORGABE;

  const sekunden = aufrufe * (1500 / eingabeTempo + 250 / ausgabeTempo);
  const gerundet = Math.round(sekunden);

  return {
    sekundenJeSeite: gerundet,
    ueberSchwelle: gerundet > schwelle,
    text: alsDauer(gerundet),
  };
}

export function alsDauer(sekunden: number): string {
  if (sekunden < 90) return `etwa ${Math.round(sekunden)} Sekunden`;
  const minuten = Math.round(sekunden / 60);
  return `etwa ${minuten} Minute${minuten === 1 ? '' : 'n'}`;
}
