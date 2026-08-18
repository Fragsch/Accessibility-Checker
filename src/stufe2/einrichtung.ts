/**
 * Einrichtung, Erkennung und Geschwindigkeitsmessung der Stufe 2
 * (PRD 6.3.1, L-40 bis L-45).
 *
 * **Es wird nichts stillschweigend installiert.** Ein Modelldownload liegt bei
 * mehreren Gigabyte; das ist eine Entscheidung des Menschen, keine des
 * Werkzeugs (L-41). Diese Datei stellt deshalb nur fest, was vorhanden ist,
 * und liefert die Befehle, die der Mensch ausführt.
 *
 * Bewusst wird `ollama pull` **nicht** aus dem Werkzeug heraus angestoßen:
 * Ein Download über Minuten, den eine Anwendung ohne sichtbaren Fortschritt im
 * Hintergrund fährt, ist genau die Art von Verhalten, die Vertrauen kostet.
 */

import { erkenneHardware, schaetzeLaufzeit, schlageModellVor } from '../plattform/hardware.js';
import type { Hardware, Laufzeitschaetzung, Modellvorschlag } from '../plattform/hardware.js';
import { OllamaAdapter, OLLAMA_ADRESSE } from './adapter/ollama.js';
import type { AdapterZustand } from './adapter/typ.js';
import type { Protokoll } from '../protokoll.js';
import { stillesProtokoll } from '../protokoll.js';

export interface Stufe2Bericht {
  hardware: Hardware;
  vorschlag: Modellvorschlag;
  ollama: AdapterZustand;
  /** Ist das vorgeschlagene Modell schon geladen? */
  modellVorhanden: boolean;
  /** Betriebsbereit — Dienst erreichbar und ein brauchbares Modell da. */
  einsatzbereit: boolean;
  /** Was der Mensch tun muss, in der Reihenfolge. Leer, wenn alles bereit ist. */
  schritte: Einrichtungsschritt[];
  /** Kriterien, die ohne Stufe 2 nicht automatisch bewertet werden (L-47). */
  entfaelltOhneStufe2: string[];
}

export interface Einrichtungsschritt {
  text: string;
  befehl: string | null;
}

/**
 * Kriterien, die von der Sprachmodell-Stufe abhängen (PRD 6.3.1).
 * Die Liste stammt aus dem Katalog, nicht aus dieser Datei — hier steht nur,
 * wie sie ermittelt wird.
 */
export function betroffeneKriterien(kriterien: readonly { id: string; pruefungen: { typ: string }[] }[]): string[] {
  return kriterien.filter((k) => k.pruefungen.some((p) => p.typ === 'llm')).map((k) => k.id);
}

export interface BerichtOptionen {
  modell?: string;
  adresse?: string;
  protokoll?: Protokoll;
  kriterien?: readonly { id: string; pruefungen: { typ: string }[] }[];
}

/** Stellt fest, wie es um die Stufe 2 steht. */
export async function erstelleBericht(optionen: BerichtOptionen = {}): Promise<Stufe2Bericht> {
  const protokoll = optionen.protokoll ?? stillesProtokoll;
  const hardware = erkenneHardware();
  const vorschlag = schlageModellVor(hardware);
  const modell = optionen.modell ?? vorschlag.modell;

  const adapter = new OllamaAdapter({
    modell,
    ...(optionen.adresse ? { adresse: optionen.adresse } : {}),
    protokoll,
  });
  const ollama = await adapter.zustand();

  // Ollama fuehrt Modelle mit Kennzeichnung ("phi4-mini:latest"). Beim
  // Vergleich zaehlt der Name vor dem Doppelpunkt.
  const modellVorhanden = ollama.modelle.some((vorhanden) => grundname(vorhanden) === grundname(modell));

  const schritte: Einrichtungsschritt[] = [];
  if (!ollama.erreichbar) {
    schritte.push({
      text: 'Ollama installieren, falls noch nicht geschehen',
      befehl: installationsbefehl(hardware),
    });
    schritte.push({
      text: 'Ollama als Dienst starten',
      befehl: dienstbefehl(hardware),
    });
  }
  if (!modellVorhanden) {
    schritte.push({
      text:
        `Modell ${modell} laden (${vorschlag.groesseGb} GB Download). ${vorschlag.begruendung}` +
        (vorschlag.warnung ? ` ${vorschlag.warnung}` : ''),
      befehl: `ollama pull ${modell}`,
    });
  }

  return {
    hardware,
    vorschlag: { ...vorschlag, modell },
    ollama,
    modellVorhanden,
    einsatzbereit: ollama.erreichbar && modellVorhanden,
    schritte,
    entfaelltOhneStufe2: optionen.kriterien ? betroffeneKriterien(optionen.kriterien) : [],
  };
}

function grundname(modell: string): string {
  return modell.split(':')[0] ?? modell;
}

function installationsbefehl(hardware: Hardware): string {
  switch (hardware.betriebssystem) {
    case 'darwin':
      return 'brew install ollama';
    case 'win32':
      return 'winget install Ollama.Ollama';
    default:
      return 'curl -fsSL https://ollama.com/install.sh | sh';
  }
}

function dienstbefehl(hardware: Hardware): string {
  switch (hardware.betriebssystem) {
    case 'darwin':
      return 'brew services start ollama';
    case 'win32':
      return 'Ollama startet nach der Installation von selbst als Dienst';
    default:
      return 'systemctl start ollama';
  }
}

// ------------------------------------------------- Geschwindigkeit messen

export interface Messergebnis {
  eingabeTempo: number;
  ausgabeTempo: number;
  schaetzung: Laufzeitschaetzung | null;
  gemessenAm: string;
  fehlschlag: string | null;
}

/**
 * Misst die tatsächliche Geschwindigkeit einmalig (L-44).
 *
 * Gemessen wird mit einer echten Prüfaufgabe, nicht mit einem Kunstsatz: Ein
 * kurzer Prompt liefert Werte, die im Betrieb nicht erreicht werden, und eine
 * Schätzung auf falscher Grundlage ist schlechter als gar keine.
 */
export async function messeGeschwindigkeit(
  modell: string,
  systemAnweisung: string,
  optionen: { adresse?: string; protokoll?: Protokoll; schwelleSekunden?: number } = {},
): Promise<Messergebnis> {
  const adapter = new OllamaAdapter({
    modell,
    ...(optionen.adresse ? { adresse: optionen.adresse } : {}),
    ...(optionen.protokoll ? { protokoll: optionen.protokoll } : {}),
  });

  const probe = [
    'Beurteile für jeden Link, ob sein Text allein den Zweck erkennen lässt.',
    '',
    'Links:',
    '1. Linktext: "hier klicken"',
    '   Umgebung: "Unsere Datenschutzerklärung finden Sie hier klicken."',
    '2. Linktext: "Datenschutzerklärung lesen"',
    '   Umgebung: "Weitere Angaben in der Datenschutzerklärung lesen."',
    '3. Linktext: "mehr"',
    '   Umgebung: "Über unsere Kurse erfahren Sie mehr."',
  ].join('\n');

  const antwort = await adapter.bewerte(systemAnweisung, probe, 3);
  const jetzt = new Date().toISOString();

  if (antwort.fehlschlag || !antwort.messung) {
    return {
      eingabeTempo: 0,
      ausgabeTempo: 0,
      schaetzung: null,
      gemessenAm: jetzt,
      fehlschlag: antwort.fehlschlag ?? 'Ollama hat keine Messwerte geliefert.',
    };
  }

  const { eingabeTempo, ausgabeTempo } = antwort.messung;
  return {
    eingabeTempo: Math.round(eingabeTempo),
    ausgabeTempo: Math.round(ausgabeTempo * 10) / 10,
    schaetzung: schaetzeLaufzeit(eingabeTempo, ausgabeTempo, {
      ...(optionen.schwelleSekunden !== undefined ? { schwelleSekunden: optionen.schwelleSekunden } : {}),
    }),
    gemessenAm: jetzt,
    fehlschlag: null,
  };
}

export { OLLAMA_ADRESSE };
