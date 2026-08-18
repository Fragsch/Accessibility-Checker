/**
 * Laden der Prompts aus `prompts/stufe2.md`.
 *
 * Die Prompts sind Daten, kein Code — genau wie der Prüfkatalog. Sie stehen in
 * einer Datei, die ein Mensch lesen und ändern kann, ohne TypeScript
 * anzufassen. Phase 8 schärft sie anhand gemessener Fehlalarmquoten nach; das
 * darf keine Codeänderung erfordern.
 *
 * Die Datei ist zugleich Dokumentation. Deshalb wird sie hier geparst und
 * nicht in ein Maschinenformat übersetzt: Zwei Fassungen desselben Textes
 * laufen unweigerlich auseinander.
 */

import fs from 'node:fs';
import path from 'node:path';

import { projektWurzel } from '../plattform/pfade.js';

export interface Prompt {
  /** Kennung, über die der Katalog die Prüfung anspricht. */
  id: string;
  /** Erfolgskriterium, zu dem die Prüfung gehört. */
  kriterium: string;
  /** Vorlage mit Platzhaltern nach Mustache-Art. */
  vorlage: string;
  buendelGroesse: number;
  sammelSelektor: string | null;
  /** Nur bei Prüfprofil oder Gesamtprüfung auswertbar. */
  nurMehrseitig: boolean;
  /** Nur unter WCAG 2.2 einschlägig. */
  nurStandard: '2.2' | null;
}

export interface Prompts {
  /** Gilt für jeden Aufruf, unverändert. */
  systemAnweisung: string;
  nachId: Map<string, Prompt>;
}

export function standardPromptPfad(): string {
  return path.join(projektWurzel(), 'prompts', 'stufe2.md');
}

export class PromptFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'PromptFehler';
  }
}

/** Liest und zerlegt die Prompt-Datei. */
export function ladePrompts(datei: string = standardPromptPfad()): Prompts {
  let inhalt: string;
  try {
    inhalt = fs.readFileSync(datei, 'utf8');
  } catch (e) {
    throw new PromptFehler(`prompts/stufe2.md nicht lesbar: ${(e as Error).message}`);
  }

  const systemAnweisung = lesSystemAnweisung(inhalt);
  const nachId = new Map<string, Prompt>();

  // Überschriften der Form:  ## 1. `linkzweck` — Erfolgskriterium 2.4.4
  const kopfMuster = /^## \d+\. `([a-z0-9-]+)` — Erfolgskriterium (\d+\.\d+\.\d+)(.*)$/gm;

  for (const kopf of inhalt.matchAll(kopfMuster)) {
    const id = kopf[1];
    const kriterium = kopf[2];
    if (!id || !kriterium) continue;

    const abschnitt = inhalt.slice(kopf.index + kopf[0].length);
    const vorlage = erstesCodeBlock(abschnitt);
    if (!vorlage) throw new PromptFehler(`Prompt "${id}" hat keinen Vorlagenblock`);

    const angaben = /\*\*Bündelgröße:\*\*\s*(\d+)([^\n]*)/.exec(abschnitt);
    if (!angaben?.[1]) throw new PromptFehler(`Prompt "${id}" nennt keine Bündelgröße`);

    const zusatz = angaben[2] ?? '';
    const selektor = /\*\*Sammelselektor:\*\*\s*`([^`]+)`/.exec(zusatz);

    nachId.set(id, {
      id,
      kriterium,
      vorlage,
      buendelGroesse: Number(angaben[1]),
      sammelSelektor: selektor?.[1] ?? null,
      nurMehrseitig: /nur mehrseitig/i.test(zusatz),
      nurStandard: /nur WCAG 2\.2/i.test(`${kopf[3] ?? ''}${zusatz}`) ? '2.2' : null,
    });
  }

  if (nachId.size === 0) throw new PromptFehler('In prompts/stufe2.md wurde kein einziger Prompt gefunden');

  return { systemAnweisung, nachId };
}

function lesSystemAnweisung(inhalt: string): string {
  const kopf = inhalt.indexOf('## Gemeinsame Systemanweisung');
  if (kopf === -1) throw new PromptFehler('Die gemeinsame Systemanweisung fehlt in prompts/stufe2.md');

  const anweisung = erstesCodeBlock(inhalt.slice(kopf));
  if (!anweisung) throw new PromptFehler('Die gemeinsame Systemanweisung hat keinen Textblock');
  return anweisung;
}

/** Inhalt des ersten eingezäunten Codeblocks eines Abschnitts. */
function erstesCodeBlock(abschnitt: string): string | null {
  const treffer = /```[a-z]*\n([\s\S]*?)```/.exec(abschnitt);
  return treffer?.[1]?.trimEnd() ?? null;
}

// --------------------------------------------------------------- Einsetzen

/** Werte, die in eine Vorlage eingesetzt werden. */
export type Werte = Record<string, unknown>;

/**
 * Setzt Werte in eine Vorlage ein.
 *
 * Bewusst winzig gehalten und nicht über eine Bibliothek gelöst: Gebraucht
 * werden genau zwei Dinge — Platzhalter und wiederholte Abschnitte. Alles
 * andere wäre eine Angriffsfläche für Text, der aus fremden Seiten stammt.
 *
 *   {{name}}                     Wert einsetzen
 *   {{#liste}} … {{/liste}}      Block je Eintrag wiederholen
 *
 * Innerhalb eines Blocks gelten die Felder des Eintrags; was dort fehlt, wird
 * im umgebenden Bereich gesucht.
 */
export function setzeEin(vorlage: string, werte: Werte): string {
  return abschnitte(vorlage, [werte]);
}

function abschnitte(vorlage: string, umgebung: Werte[]): string {
  const blockMuster = /\{\{#([a-zA-Z0-9_]+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/;

  let text = vorlage;
  let treffer = blockMuster.exec(text);
  while (treffer) {
    const [ganz, name, koerper] = treffer;
    const wert = suche(name ?? '', umgebung);
    const eintraege = Array.isArray(wert) ? (wert as Werte[]) : [];

    const ersetzt = eintraege.map((eintrag) => abschnitte(koerper ?? '', [eintrag, ...umgebung])).join('');
    text = text.slice(0, treffer.index) + ersetzt + text.slice(treffer.index + ganz.length);
    treffer = blockMuster.exec(text);
  }

  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, name: string) => {
    const wert = suche(name, umgebung);
    if (wert === undefined || wert === null) return '';
    return String(wert);
  });
}

function suche(name: string, umgebung: readonly Werte[]): unknown {
  for (const ebene of umgebung) {
    if (Object.prototype.hasOwnProperty.call(ebene, name)) return ebene[name];
  }
  return undefined;
}
