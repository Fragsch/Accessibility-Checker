/**
 * Ablaufsteuerung der Sprachmodell-Stufe.
 *
 * Je Prüfung: sammeln → vorfiltern → Zwischenspeicher befragen → bündeln →
 * Modell fragen → Urteile zuordnen.
 *
 * Drei Regeln bestimmen den Aufbau und sind nicht verhandelbar:
 *
 *   **Ergebnisse sind Hinweise, keine Feststellungen (L-25).** Ein `problem`
 *   des Modells macht ein Kriterium nie `nicht_erfuellt`. Es macht es offen —
 *   ein Mensch entscheidet.
 *
 *   **`unsicher` ist erwünscht (L-23).** Alles, was das Modell nicht beurteilen
 *   kann, wandert in die manuelle Liste. Das ist kein Mangel des Werkzeugs,
 *   sondern die richtige Antwort.
 *
 *   **Ein Fehlschlag ist kein Fehler.** Kein Ollama, kaputte Antwort,
 *   Zeitüberschreitung: Die betroffenen Elemente gelten als `unsicher`. Der
 *   Scan läuft weiter (L-26, Fallstrick 3).
 */

import type { Hinweis, Kriterium, Standard } from '../typen/index.js';
import type { Protokoll } from '../protokoll.js';
import type { Messung, ModellAdapter, Urteil } from './adapter/typ.js';
import type { Prompt, Prompts } from './prompts.js';
import { setzeEin } from './prompts.js';
import type { Element } from './sammler.js';
import { sammle } from './sammler.js';
import type { SammelKontext } from './sammler.js';
import { teileAuf } from './vorfilter.js';
import type { Zwischenspeicher } from './cache.js';
import { fluechtigerSpeicher, inhaltsHash } from './cache.js';

export interface Stufe2Ergebnis {
  /** Hinweise je Kriterium — sie halten das Kriterium offen. */
  hinweise: Hinweis[];
  /** Urteile je Kriterium, für die Statusableitung (ARCHITEKTUR 5.2). */
  urteileJeKriterium: Map<string, Urteil[]>;
  /** Prüfungen, die tatsächlich gelaufen sind. */
  gelaufenePruefungen: string[];
  /** Messwerte aller Aufrufe — Grundlage der Laufzeitschätzung (L-44). */
  messungen: Messung[];
  /** Wie oft der Zwischenspeicher gegriffen hat. */
  zwischenspeicherTreffer: number;
  modellaufrufe: number;
}

export interface Stufe2Optionen {
  adapter: ModellAdapter;
  prompts: Prompts;
  kriterien: readonly Kriterium[];
  standard: Standard;
  sammelKontext: SammelKontext;
  protokoll: Protokoll;
  speicher?: Zwischenspeicher;
  mehrseitig?: boolean;
  /** Meldung je fertiger Prüfung — die Oberfläche reicht sie nach (L-49). */
  beiFortschritt?: (pruefungsId: string, kriterium: string) => void;
  abbruch?: AbortSignal;
}

/** Führt alle Sprachmodell-Prüfungen für eine Seite aus. */
export async function fuehreStufe2Aus(optionen: Stufe2Optionen): Promise<Stufe2Ergebnis> {
  const speicher = optionen.speicher ?? fluechtigerSpeicher();
  const ergebnis: Stufe2Ergebnis = {
    hinweise: [],
    urteileJeKriterium: new Map(),
    gelaufenePruefungen: [],
    messungen: [],
    zwischenspeicherTreffer: 0,
    modellaufrufe: 0,
  };

  for (const { kriterium, pruefungsId, buendelGroesse } of gefragtePruefungen(optionen.kriterien)) {
    if (optionen.abbruch?.aborted) break;

    const prompt = optionen.prompts.nachId.get(pruefungsId);
    if (!prompt) {
      // Der Katalog nennt eine Prüfung, die es im Prompt-Verzeichnis nicht
      // gibt. Nicht raten (Regel 8) — offen lassen und protokollieren.
      optionen.protokoll.warnung('stufe2', `Prompt "${pruefungsId}" fehlt in prompts/stufe2.md`, { kriterium });
      ergaenze(ergebnis, kriterium, 'unsicher', `Für die Prüfung "${pruefungsId}" gibt es keinen Prompt.`, pruefungsId);
      continue;
    }

    if (prompt.nurMehrseitig && !optionen.mehrseitig) continue;
    if (prompt.nurStandard && prompt.nurStandard !== optionen.standard) continue;

    await fuehrePruefungAus({ ...optionen, speicher }, prompt, kriterium, buendelGroesse, ergebnis);
    optionen.beiFortschritt?.(pruefungsId, kriterium);
  }

  ergebnis.zwischenspeicherTreffer = speicher.treffer;
  return ergebnis;
}

interface GefragtePruefung {
  kriterium: string;
  pruefungsId: string;
  buendelGroesse: number;
}

/** Welche Sprachmodell-Prüfungen verlangt der Katalog? */
function gefragtePruefungen(kriterien: readonly Kriterium[]): GefragtePruefung[] {
  const gefragt: GefragtePruefung[] = [];
  for (const kriterium of kriterien) {
    for (const pruefung of kriterium.pruefungen) {
      if (pruefung.typ !== 'llm') continue;
      gefragt.push({
        kriterium: kriterium.id,
        pruefungsId: pruefung.pruefungsId,
        buendelGroesse: pruefung.buendelGroesse,
      });
    }
  }
  return gefragt;
}

async function fuehrePruefungAus(
  optionen: Stufe2Optionen & { speicher: Zwischenspeicher },
  prompt: Prompt,
  kriterium: string,
  buendelGroesseAusKatalog: number,
  ergebnis: Stufe2Ergebnis,
): Promise<void> {
  const sammlung = await sammle(prompt.id, optionen.sammelKontext);
  const listenName = sammlung.listenName;

  // Prüfungen ohne Liste — Seitentitel, Fokusreihenfolge, Lesereihenfolge —
  // legen alles auf einmal vor. Ihre Bündelgröße ist 1.
  const alsListe = sammlung.elemente.length > 0 ? sammlung.elemente : listeAusSeitenwerten(sammlung.seitenwerte, listenName);

  if (alsListe.length === 0 && Object.keys(sammlung.seitenwerte).length === 0) {
    // Nichts zu beurteilen: Das Kriterium ist insoweit gegenstandslos, aber
    // die Prüfung ist gelaufen.
    ergebnis.gelaufenePruefungen.push(prompt.id);
    return;
  }

  ergebnis.gelaufenePruefungen.push(prompt.id);

  const einzelaufgabe = buendelGroesseAusKatalog <= 1 || sammlung.elemente.length === 0;
  if (einzelaufgabe) {
    await stelleAufgabe(optionen, prompt, kriterium, sammlung.seitenwerte, alsListe, ergebnis);
    return;
  }

  // Vorfilterung: Was ohne Modell zu entscheiden ist, wird ohne Modell
  // entschieden (prompts/stufe2.md, Umsetzungshinweise).
  const { vorentschieden, anModell } = teileAuf(prompt.id, sammlung.elemente);

  for (const { element, urteil } of vorentschieden) {
    ergaenze(ergebnis, kriterium, urteil.urteil, urteil.begruendung, prompt.id, beschreibeElement(prompt.id, element));
  }

  // Zwischenspeicher (L-28).
  const offen: Element[] = [];
  for (const element of anModell) {
    const hash = inhaltsHash(prompt.id, optionen.adapter.modell, element);
    const bekannt = optionen.speicher.lies(hash);
    if (bekannt) {
      ergaenze(ergebnis, kriterium, bekannt.urteil, bekannt.begruendung, prompt.id, beschreibeElement(prompt.id, element));
    } else {
      offen.push(element);
    }
  }

  const groesse = Math.max(1, Math.min(buendelGroesseAusKatalog, prompt.buendelGroesse));
  for (let anfang = 0; anfang < offen.length; anfang += groesse) {
    if (optionen.abbruch?.aborted) return;
    const buendel = offen.slice(anfang, anfang + groesse);
    await stelleAufgabe(optionen, prompt, kriterium, sammlung.seitenwerte, buendel, ergebnis, true);
  }
}

/** Ein Modellaufruf für ein Bündel. */
async function stelleAufgabe(
  optionen: Stufe2Optionen & { speicher: Zwischenspeicher },
  prompt: Prompt,
  kriterium: string,
  seitenwerte: Record<string, unknown>,
  elemente: readonly Element[],
  ergebnis: Stufe2Ergebnis,
  merken = false,
): Promise<void> {
  // Innerhalb des Bündels neu durchnummerieren: Das Modell bekommt 1..n und
  // kann sich nicht auf einen Index beziehen, der nicht vorliegt.
  const nummeriert = elemente.map((element, nummer) => ({ ...element, i: nummer + 1 }));

  const aufgabe = setzeEin(prompt.vorlage, {
    ...seitenwerte,
    elemente: nummeriert,
    [prompt.id === 'fokusreihenfolge' ? 'stopps' : prompt.id === 'lesereihenfolge' ? 'bloecke' : 'elemente']: nummeriert,
  });

  const antwort = await optionen.adapter.bewerte(optionen.prompts.systemAnweisung, aufgabe, nummeriert.length);
  ergebnis.modellaufrufe += 1;
  if (antwort.messung) ergebnis.messungen.push(antwort.messung);

  if (antwort.fehlschlag) {
    ergaenze(
      ergebnis,
      kriterium,
      'unsicher',
      `Die Bewertung durch das Sprachmodell ist ausgefallen: ${antwort.fehlschlag} ` +
        'Die betroffenen Stellen sind von Hand zu prüfen.',
      prompt.id,
    );
    return;
  }

  for (const element of nummeriert) {
    const urteil = antwort.urteile.get(element.i);

    if (!urteil) {
      // Das Modell hat dieses Element ausgelassen. Kein Urteil ist kein "ok".
      ergaenze(ergebnis, kriterium, 'unsicher', 'Das Sprachmodell hat zu dieser Stelle kein Urteil abgegeben.', prompt.id, beschreibeElement(prompt.id, element));
      continue;
    }

    ergaenze(ergebnis, kriterium, urteil.urteil, urteil.begruendung, prompt.id, beschreibeElement(prompt.id, element));

    if (merken) {
      const original = elemente[element.i - 1];
      if (original) {
        optionen.speicher.schreib(
          inhaltsHash(prompt.id, optionen.adapter.modell, original),
          prompt.id,
          urteil.urteil,
          urteil.begruendung,
        );
      }
    }
  }
}

/** Trägt ein Urteil in das Ergebnis ein. */
function ergaenze(
  ergebnis: Stufe2Ergebnis,
  kriterium: string,
  urteil: Urteil,
  begruendung: string | null,
  pruefungsId: string,
  stelle?: string,
): void {
  const bisher = ergebnis.urteileJeKriterium.get(kriterium) ?? [];
  bisher.push(urteil);
  ergebnis.urteileJeKriterium.set(kriterium, bisher);

  // Ein "ok" braucht keinen Hinweis: Es hält das Kriterium nicht offen.
  if (urteil === 'ok') return;

  const vorspann = urteil === 'problem' ? 'Das Sprachmodell sieht hier ein Problem' : 'Das Sprachmodell ist unsicher';

  ergebnis.hinweise.push({
    kriterium,
    herkunft: `llm/${pruefungsId}`,
    text:
      `${vorspann}${stelle ? ` bei ${stelle}` : ''}: ${begruendung ?? 'ohne Begründung'} ` +
      '(Hinweis zur Nachprüfung, keine Feststellung.)',
  });
}

/**
 * Kurze Bezeichnung der Fundstelle für den Hinweistext.
 *
 * Die Reihenfolge der Felder ist absichtlich: Erst das, was ein Mensch auf der
 * Seite sieht. Ist nichts davon da — ein Feld ohne jede Beschriftung etwa —,
 * hilft die Angabe von Typ und Platzhalter beim Wiederfinden. „Element 3" wäre
 * für den, der die Stelle suchen soll, wertlos.
 */
function beschreibeElement(pruefungsId: string, element: Element): string {
  const kandidaten = ['text', 'label', 'beschriftung', 'titel', 'meldung', 'funktion'];
  for (const feld of kandidaten) {
    const wert = element[feld];
    if (typeof wert === 'string' && wert.trim()) return `"${wert.trim().slice(0, 60)}"`;
  }

  const platzhalter = typeof element['placeholder'] === 'string' ? element['placeholder'].trim() : '';
  const typ = typeof element['typ'] === 'string' ? element['typ'].trim() : '';
  if (platzhalter) return `dem Feld mit dem Platzhalter "${platzhalter.slice(0, 40)}"`;
  if (typ) return `einem Feld ohne Beschriftung (${typ})`;

  return `Element ${element.i} der Prüfung ${pruefungsId}`;
}

/** Holt eine Liste aus den Seitenwerten, falls die Vorlage keine `elemente` nutzt. */
function listeAusSeitenwerten(seitenwerte: Record<string, unknown>, name: string): Element[] {
  const wert = seitenwerte[name];
  return Array.isArray(wert) ? (wert as Element[]) : [];
}
