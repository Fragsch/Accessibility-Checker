/**
 * Laden, Validieren und Filtern des Pruefkatalogs.
 *
 * Der Katalog ist Daten (Regel 1). Dieses Modul liest ihn ein, prueft ihn gegen
 * das Laufzeitschema und stellt Abfragen bereit — es kennt kein einziges
 * Erfolgskriterium namentlich.
 *
 * Bezug: ARCHITEKTUR.md 9 Schritt 1, katalog/README.md
 */

import fs from 'node:fs';
import path from 'node:path';

import { KATALOG_DATEIEN, katalogDateiSchema } from './schema.js';
import { katalogVerzeichnis } from '../plattform/pfade.js';
import type { Engine, Kriterium, Standard } from '../typen/index.js';

/** Standardpfad des Katalogverzeichnisses. */
export function standardKatalogPfad(): string {
  return katalogVerzeichnis();
}

export class KatalogFehler extends Error {
  readonly datei: string;

  constructor(message: string, datei: string) {
    super(message);
    this.name = 'KatalogFehler';
    this.datei = datei;
  }
}

export class Katalog {
  readonly kriterien: readonly Kriterium[];

  constructor(kriterien: readonly Kriterium[]) {
    this.kriterien = kriterien;
  }

  /**
   * Liest alle Katalogdateien und validiert sie gegen das Laufzeitschema.
   * Ein Schemaverstoss ist ein harter Fehler — mit einem kaputten Katalog darf
   * nicht geprueft werden.
   */
  static laden(verzeichnis: string = standardKatalogPfad()): Katalog {
    const alle: Kriterium[] = [];
    const gesehen = new Set<string>();

    for (const name of KATALOG_DATEIEN) {
      const pfad = path.join(verzeichnis, `${name}.json`);

      let roh: unknown;
      try {
        roh = JSON.parse(fs.readFileSync(pfad, 'utf8'));
      } catch (e) {
        throw new KatalogFehler(`${name}.json nicht lesbar oder kein gueltiges JSON: ${(e as Error).message}`, pfad);
      }

      const ergebnis = katalogDateiSchema.safeParse(roh);
      if (!ergebnis.success) {
        const stellen = ergebnis.error.issues
          .slice(0, 10)
          .map((i) => `  ${i.path.join('.') || '(Wurzel)'}: ${i.message}`)
          .join('\n');
        throw new KatalogFehler(`${name}.json entspricht nicht dem Schema:\n${stellen}`, pfad);
      }

      for (const kriterium of ergebnis.data.kriterien) {
        if (kriterium.prinzip !== ergebnis.data.prinzip) {
          throw new KatalogFehler(
            `${name}.json/${kriterium.id}: prinzip "${kriterium.prinzip}" weicht vom Prinzip der Datei ab`,
            pfad,
          );
        }
        if (gesehen.has(kriterium.id)) {
          throw new KatalogFehler(`Kriterium ${kriterium.id} ist mehrfach vorhanden`, pfad);
        }
        gesehen.add(kriterium.id);
        alle.push(kriterium as Kriterium);
      }
    }

    return new Katalog(alle);
  }

  /**
   * Kriterien des gewaehlten Standards.
   *
   * 2.1 → eingefuehrtMit ∈ {2.0, 2.1}
   * 2.2 → alles ausser entfallenAb === '2.2'
   */
  fuerStandard(standard: Standard): Kriterium[] {
    if (standard === '2.1') {
      return this.kriterien.filter((k) => k.standard.eingefuehrtMit !== '2.2');
    }
    return this.kriterien.filter((k) => k.standard.entfallenAb !== '2.2');
  }

  findeKriterium(id: string): Kriterium | undefined {
    return this.kriterien.find((k) => k.id === id);
  }

  /**
   * Regeln, die im gewaehlten Standard kein Kriterium mehr haben (X-21).
   *
   * Betroffen ist genau ein Fall: 4.1.1 entfaellt mit WCAG 2.2, und mit ihm
   * verlieren die Regeln zur HTML-Gueltigkeit ihre Zuordnung. Erhoben werden
   * sie trotzdem — als allgemeiner Qualitaetshinweis ausserhalb der
   * Konformitaetstabelle, ohne Einfluss auf die Bewertung.
   *
   * Unter 2.1 ist die Menge leer; dort aendert sich am Ablauf nichts.
   */
  qualitaetsRegeln(standard: Standard, engine: Engine = 'html'): Map<string, Engine> {
    const geltend = new Set(this.fuerStandard(standard).map((k) => k.id));
    const regeln = new Map<string, Engine>();

    for (const kriterium of this.kriterien) {
      if (geltend.has(kriterium.id)) continue;
      for (const pruefung of kriterium.pruefungen) {
        if (pruefung.typ !== 'auto' || pruefung.engine !== engine) continue;
        for (const regelId of pruefung.regelIds) regeln.set(regelId, pruefung.engine);
      }
    }

    // Was in einem geltenden Kriterium ohnehin vorkommt, ist kein
    // Qualitaetshinweis, sondern regulaerer Befund.
    for (const regelId of this.alleRegelZuordnungen(standard).keys()) regeln.delete(regelId);

    return regeln;
  }

  /**
   * Zuordnung Regel-ID → Kriterien fuer eine Engine (ARCHITEKTUR 5.1).
   * Eine Regel kann mehreren Kriterien zugeordnet sein; ein Befund erzeugt dann
   * einen Eintrag je Kriterium.
   */
  regelZuordnung(engine: Engine, standard: Standard): Map<string, string[]> {
    const zuordnung = new Map<string, string[]>();
    for (const kriterium of this.fuerStandard(standard)) {
      for (const pruefung of kriterium.pruefungen) {
        if (pruefung.typ !== 'auto' || pruefung.engine !== engine) continue;
        for (const regelId of pruefung.regelIds) {
          const vorhanden = zuordnung.get(regelId);
          if (vorhanden) vorhanden.push(kriterium.id);
          else zuordnung.set(regelId, [kriterium.id]);
        }
      }
    }
    return zuordnung;
  }

  /** Alle Regel-IDs einer Engine im gewaehlten Standard. */
  regelIds(engine: Engine, standard: Standard): string[] {
    return [...this.regelZuordnung(engine, standard).keys()];
  }

  /**
   * Zuordnung Regel → Kriterien ueber alle Engines hinweg.
   *
   * Regel-IDs sind je Engine vergeben, ueberschneiden sich aber nicht — der
   * Katalog-Pruefer wacht darueber. Deshalb genuegt eine gemeinsame Tabelle,
   * und die Normalisierung braucht die Engine nicht zu kennen.
   */
  alleRegelZuordnungen(standard: Standard): Map<string, string[]> {
    const gesamt = new Map<string, string[]>();
    for (const kriterium of this.fuerStandard(standard)) {
      for (const pruefung of kriterium.pruefungen) {
        if (pruefung.typ !== 'auto') continue;
        for (const regelId of pruefung.regelIds) {
          const vorhanden = gesamt.get(regelId);
          if (vorhanden) {
            if (!vorhanden.includes(kriterium.id)) vorhanden.push(kriterium.id);
          } else {
            gesamt.set(regelId, [kriterium.id]);
          }
        }
      }
    }
    return gesamt;
  }
}
