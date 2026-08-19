/**
 * Ablage und Abruf von Scanergebnissen.
 *
 * Ein Scan laeuft minutenlang. Deshalb entsteht die Zeile in `scan` schon beim
 * Start und nicht erst am Ende: die Oberflaeche braucht sofort eine Kennung,
 * und eine abgebrochene Pruefung soll das behalten, was bis dahin geprueft war.
 *
 * Je Seite wird in einer Transaktion geschrieben. Ein halb gespeichertes
 * Seitenergebnis waere schlimmer als gar keines.
 */

import type { Database } from 'better-sqlite3';

import type {
  Befund,
  Betriebsart,
  Bewertung,
  Engine,
  Hinweis,
  Kriterium,
  OffeneFrage,
  Qualitaetshinweis,
  ScanErgebnis,
  Schwere,
  SeitenErgebnis,
  SeitenZustand,
  Standard,
  Status,
} from '../typen/index.js';
import { verdichte } from '../scan/statusableitung.js';

export interface ScanAnlage {
  betriebsart: Betriebsart;
  standard: Standard;
  stufe2Aktiv: boolean;
  werkzeugVersion: string;
  gestartetAm: string;
  seiten: { url: string; bezeichnung?: string | undefined }[];
  /** Profil, aus dem der Auftrag stammt (K-03). `null` bei freier Eingabe. */
  profilId?: number | null | undefined;
  /** Modell der Sprachmodell-Stufe, sofern eingeschaltet (L-29). */
  stufe2Modell?: string | null | undefined;
  /**
   * Der Scan lief in einer angemeldeten Sitzung (S-22).
   *
   * Die Kennzeichnung entscheidet spaeter darueber, ob vor dem Export gewarnt
   * wird: Belege aus geschuetzten Bereichen koennen personenbezogene Daten
   * enthalten (S-23).
   */
  geschuetzt?: boolean | undefined;
}

/** Legt Scan und Seitenzeilen an. Alle Seiten starten im Zustand `offen`. */
export function legeScanAn(db: Database, anlage: ScanAnlage): number {
  const anlegen = db.transaction((a: ScanAnlage): number => {
    const scan = db
      .prepare(
        `INSERT INTO scan (profil_id, betriebsart, standard, gestartet_am, beendet_am,
                           stufe2_aktiv, stufe2_modell, geschuetzt, werkzeug_version)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        a.profilId ?? null,
        a.betriebsart,
        a.standard,
        a.gestartetAm,
        a.stufe2Aktiv ? 1 : 0,
        a.stufe2Modell ?? null,
        a.geschuetzt ? 1 : 0,
        a.werkzeugVersion,
      );

    const scanId = Number(scan.lastInsertRowid);
    const seiteEinfuegen = db.prepare(
      `INSERT INTO scan_seite (scan_id, url, bezeichnung, titel, status) VALUES (?, ?, ?, NULL, 'offen')`,
    );
    for (const seite of a.seiten) seiteEinfuegen.run(scanId, seite.url, seite.bezeichnung ?? null);
    return scanId;
  });

  return anlegen(anlage);
}

/**
 * Traegt Seiten nach, die erst waehrend des Laufs bekannt werden (K-08).
 *
 * Bei der Gesamtpruefung steht die Seitenliste beim Start noch nicht fest —
 * sie entsteht erst im Crawl. Die Scan-Zeile muss aber sofort existieren,
 * damit die Oberflaeche eine Kennung und einen Ereignisstrom hat.
 */
export function ergaenzeSeiten(
  db: Database,
  scanId: number,
  seiten: readonly { url: string; bezeichnung?: string | undefined }[],
): void {
  const schreiben = db.transaction(() => {
    const einfuegen = db.prepare(
      `INSERT INTO scan_seite (scan_id, url, bezeichnung, titel, status) VALUES (?, ?, ?, NULL, 'offen')`,
    );
    for (const seite of seiten) einfuegen.run(scanId, seite.url, seite.bezeichnung ?? null);
  });
  schreiben();
}

/** Kennzeichnet einen Scan als aus einem geschuetzten Bereich stammend (S-22). */
export function markiereGeschuetzt(db: Database, scanId: number): void {
  db.prepare(`UPDATE scan SET geschuetzt = 1 WHERE id = ?`).run(scanId);
}

/**
 * Schreibt das Ergebnis einer Seite fort.
 *
 * Die Zuordnung erfolgt ueber die Reihenfolge, nicht ueber die Adresse: eine
 * Weiterleitung aendert die Adresse zwischen Auftrag und Ergebnis.
 */
export function speichereSeitenErgebnis(
  db: Database,
  scanId: number,
  reihenfolge: number,
  ergebnis: SeitenErgebnis,
): void {
  const schreiben = db.transaction(() => {
    const seiten = db
      .prepare(`SELECT id FROM scan_seite WHERE scan_id = ? ORDER BY id`)
      .all(scanId) as { id: number }[];
    const seitenId = seiten[reihenfolge]?.id;
    if (seitenId === undefined) throw new Error(`Scan ${scanId} hat keine Seite mit der Nummer ${reihenfolge + 1}`);

    db.prepare(`UPDATE scan_seite SET url = ?, titel = ?, status = ? WHERE id = ?`).run(
      ergebnis.url,
      ergebnis.titel,
      ergebnis.zustand,
      seitenId,
    );

    const bewertungEinfuegen = db.prepare(
      `INSERT INTO bewertung (scan_seite_id, kriterium, status, herkunft) VALUES (?, ?, ?, ?)`,
    );
    const befundEinfuegen = db.prepare(
      `INSERT INTO befund (bewertung_id, selektor, html_ausschnitt, screenshot, beschreibung, schwere, muster_hash)
       VALUES (?, ?, ?, NULL, ?, ?, NULL)`,
    );
    const hinweisEinfuegen = db.prepare(`INSERT INTO hinweis (bewertung_id, text, herkunft) VALUES (?, ?, ?)`);

    for (const bewertung of ergebnis.bewertungen) {
      const zeile = bewertungEinfuegen.run(seitenId, bewertung.kriterium, bewertung.status, bewertung.herkunft);
      const bewertungsId = Number(zeile.lastInsertRowid);

      for (const befund of bewertung.befunde) {
        befundEinfuegen.run(bewertungsId, befund.selektor, befund.htmlAusschnitt, befund.beschreibung, befund.schwere);
      }
      for (const hinweis of bewertung.hinweise) {
        hinweisEinfuegen.run(bewertungsId, hinweis.text, hinweis.herkunft);
      }
    }

    // Haengt an der Seite, nicht an einer Bewertung (X-21): Zu diesen Maengeln
    // gibt es im gewaehlten Standard kein Kriterium.
    const qualitaetEinfuegen = db.prepare(
      `INSERT INTO qualitaetshinweis (scan_seite_id, regel_id, engine, selektor, beschreibung, schwere)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const hinweis of ergebnis.qualitaetshinweise ?? []) {
      qualitaetEinfuegen.run(
        seitenId,
        hinweis.regelId,
        hinweis.engine,
        hinweis.selektor,
        hinweis.beschreibung,
        hinweis.schwere,
      );
    }
  });

  schreiben();
}

export function schliesseScanAb(db: Database, scanId: number, beendetAm: string): void {
  db.prepare(`UPDATE scan SET beendet_am = ? WHERE id = ?`).run(beendetAm, scanId);
}

/** Speichert ein fertiges Ergebnis in einem Zug — genutzt vom Befehlszeilenwerkzeug. */
export function speichereScan(db: Database, ergebnis: ScanErgebnis): number {
  const scanId = legeScanAn(db, {
    betriebsart: ergebnis.betriebsart,
    standard: ergebnis.standard,
    stufe2Aktiv: ergebnis.stufe2Aktiv,
    werkzeugVersion: ergebnis.werkzeugVersion,
    gestartetAm: ergebnis.gestartetAm,
    seiten: ergebnis.seiten.map((s) => ({ url: s.url, bezeichnung: s.bezeichnung ?? undefined })),
  });

  ergebnis.seiten.forEach((seite, nummer) => speichereSeitenErgebnis(db, scanId, nummer, seite));
  if (ergebnis.beendetAm) schliesseScanAb(db, scanId, ergebnis.beendetAm);
  return scanId;
}

interface ScanZeile {
  id: number;
  profil_id: number | null;
  betriebsart: string;
  standard: string;
  gestartet_am: string;
  beendet_am: string | null;
  stufe2_aktiv: number;
  geschuetzt: number;
  werkzeug_version: string;
}

/** Kurzangaben zu einem Scan, ohne die Bewertungen. */
export interface ScanUebersicht {
  scanId: number;
  betriebsart: Betriebsart;
  standard: Standard;
  gestartetAm: string;
  beendetAm: string | null;
  seiten: number;
  profilId: number | null;
  /** Name des Profils, falls der Scan aus einem stammt — sonst `null`. */
  profilName: string | null;
  /** Der Scan enthaelt Belege aus einem geschuetzten Bereich (S-22). */
  geschuetzt: boolean;
}

export function listeScans(db: Database, hoechstzahl = 50): ScanUebersicht[] {
  const zeilen = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM scan_seite WHERE scan_id = s.id) AS seiten,
              (SELECT name FROM profil WHERE id = s.profil_id) AS profil_name
       FROM scan s ORDER BY s.id DESC LIMIT ?`,
    )
    .all(hoechstzahl) as (ScanZeile & { seiten: number; profil_name: string | null })[];

  return zeilen.map((z) => ({
    scanId: z.id,
    betriebsart: z.betriebsart as Betriebsart,
    standard: z.standard as Standard,
    gestartetAm: z.gestartet_am,
    beendetAm: z.beendet_am,
    seiten: z.seiten,
    profilId: z.profil_id,
    profilName: z.profil_name,
    geschuetzt: z.geschuetzt === 1,
  }));
}

/**
 * Liest einen Scan vollstaendig zurueck.
 * Die Projektebene wird dabei neu verdichtet, statt sie zu speichern — so gilt
 * immer die Regel aus ARCHITEKTUR 5.3 und nie ein alter Zwischenstand.
 */
export function ladeScan(db: Database, scanId: number, kriterien: readonly Kriterium[]): ScanErgebnis | null {
  const scan = db.prepare(`SELECT * FROM scan WHERE id = ?`).get(scanId) as ScanZeile | undefined;
  if (!scan) return null;

  const seitenZeilen = db
    .prepare(`SELECT * FROM scan_seite WHERE scan_id = ? ORDER BY id`)
    .all(scanId) as { id: number; url: string; bezeichnung: string | null; titel: string | null; status: string }[];

  const seiten: SeitenErgebnis[] = seitenZeilen.map((zeile) => {
    const qualitaetshinweise = leseQualitaetshinweise(db, zeile.id);
    return {
      url: zeile.url,
      bezeichnung: zeile.bezeichnung,
      titel: zeile.titel,
      zustand: zeile.status as SeitenZustand,
      fehler: null,
      bewertungen: leseBewertungen(db, zeile.id),
      ...(qualitaetshinweise.length > 0 ? { qualitaetshinweise } : {}),
    };
  });

  return {
    scanId: scan.id,
    betriebsart: scan.betriebsart as Betriebsart,
    profilId: scan.profil_id,
    geschuetzt: scan.geschuetzt === 1,
    standard: scan.standard as Standard,
    gestartetAm: scan.gestartet_am,
    beendetAm: scan.beendet_am,
    stufe2Aktiv: scan.stufe2_aktiv === 1,
    werkzeugVersion: scan.werkzeug_version,
    seiten,
    projektebene: verdichte(seiten, kriterien),
  };
}

function leseQualitaetshinweise(db: Database, seitenId: number): Qualitaetshinweis[] {
  const zeilen = db
    .prepare(`SELECT * FROM qualitaetshinweis WHERE scan_seite_id = ? ORDER BY id`)
    .all(seitenId) as { regel_id: string; engine: string; selektor: string | null; beschreibung: string; schwere: string }[];

  return zeilen.map((z) => ({
    regelId: z.regel_id,
    engine: z.engine as Engine,
    selektor: z.selektor,
    beschreibung: z.beschreibung,
    schwere: z.schwere as Schwere,
  }));
}

function leseBewertungen(db: Database, seitenId: number): Bewertung[] {
  const zeilen = db
    .prepare(`SELECT * FROM bewertung WHERE scan_seite_id = ? ORDER BY id`)
    .all(seitenId) as { id: number; kriterium: string; status: string; herkunft: string }[];

  const befundZeilen = db
    .prepare(
      `SELECT b.* FROM befund b JOIN bewertung w ON w.id = b.bewertung_id WHERE w.scan_seite_id = ? ORDER BY b.id`,
    )
    .all(seitenId) as {
    bewertung_id: number;
    selektor: string | null;
    html_ausschnitt: string | null;
    beschreibung: string;
    schwere: string;
  }[];

  const hinweisZeilen = db
    .prepare(
      `SELECT h.* FROM hinweis h JOIN bewertung w ON w.id = h.bewertung_id WHERE w.scan_seite_id = ? ORDER BY h.id`,
    )
    .all(seitenId) as { bewertung_id: number; text: string; herkunft: string }[];

  return zeilen.map((zeile) => {
    const befunde: Befund[] = befundZeilen
      .filter((b) => b.bewertung_id === zeile.id)
      .map((b) => ({
        kriterium: zeile.kriterium,
        // Die Regel-ID steckt nicht im Schema aus ARCHITEKTUR 4.2; die Herkunft
        // der Bewertung nennt die Engine.
        regelId: '',
        engine: 'axe',
        selektor: b.selektor,
        htmlAusschnitt: b.html_ausschnitt,
        beschreibung: b.beschreibung,
        schwere: b.schwere as Schwere,
      }));

    const hinweise: Hinweis[] = hinweisZeilen
      .filter((h) => h.bewertung_id === zeile.id)
      .map((h) => ({ kriterium: zeile.kriterium, text: h.text, herkunft: h.herkunft }));

    // Offene Fragen der Stufe 3 werden erst ab Phase 5 gespeichert.
    const offeneFragen: OffeneFrage[] = [];

    return {
      kriterium: zeile.kriterium,
      status: zeile.status as Status,
      herkunft: zeile.herkunft,
      befunde,
      hinweise,
      offeneFragen,
    };
  });
}
