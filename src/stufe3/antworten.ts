/**
 * Persistente Speicherung der manuellen Antworten (M-03, M-04).
 *
 * Antworten liegen je **Adresse und Fragekennung**, nicht je Scan. Das ist der
 * Kern von M-04: Wer eine Frage einmal beantwortet hat, soll sie beim nächsten
 * Scan derselben Seite nicht erneut vorgelegt bekommen.
 *
 * Die Fragekennung enthält den Kontext (siehe `fragen.ts`). Ändert sich der
 * Inhalt der betroffenen Stellen, entsteht eine neue Kennung — die alte
 * Antwort greift dann nicht mehr. Genau so ist es richtig: Eine Antwort auf
 * einen Text, den es nicht mehr gibt, wäre wertlos und gefährlich.
 */

import type { Database } from 'better-sqlite3';

import type { Antwortwert, ManuelleAntwort } from '../typen/index.js';

interface AntwortZeile {
  url: string;
  kriterium: string;
  frage_hash: string;
  antwort: string;
  notiz: string | null;
  beantwortet_am: string;
}

/**
 * Speichert eine Antwort.
 * Eine erneute Antwort auf dieselbe Frage ersetzt die vorherige — der Mensch
 * darf seine Meinung ändern, ohne dass sich Widersprüche ansammeln.
 */
export function speichereAntwort(db: Database, antwort: ManuelleAntwort): void {
  db.prepare(
    `INSERT INTO manuelle_antwort (url, kriterium, frage_hash, antwort, notiz, beantwortet_am)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(url, kriterium, frage_hash) DO UPDATE SET
       antwort = excluded.antwort,
       notiz = excluded.notiz,
       beantwortet_am = excluded.beantwortet_am`,
  ).run(antwort.url, antwort.kriterium, antwort.frageHash, antwort.antwort, antwort.notiz, antwort.beantwortetAm);
}

/** Alle Antworten zu einer Adresse, nach Fragekennung. */
export function lesAntworten(db: Database, url: string): Map<string, ManuelleAntwort> {
  const zeilen = db.prepare(`SELECT * FROM manuelle_antwort WHERE url = ?`).all(url) as AntwortZeile[];
  return new Map(zeilen.map((z) => [z.frage_hash, ausZeile(z)]));
}

/**
 * Antworten zu mehreren Adressen auf einmal.
 * Bei einem Prüfprofil mit 25 Seiten spart das 25 Abfragen.
 */
export function lesAntwortenFuer(db: Database, urls: readonly string[]): Map<string, Map<string, ManuelleAntwort>> {
  const ergebnis = new Map<string, Map<string, ManuelleAntwort>>();
  if (urls.length === 0) return ergebnis;

  const platzhalter = urls.map(() => '?').join(', ');
  const zeilen = db
    .prepare(`SELECT * FROM manuelle_antwort WHERE url IN (${platzhalter})`)
    .all(...urls) as AntwortZeile[];

  for (const zeile of zeilen) {
    const proSeite = ergebnis.get(zeile.url) ?? new Map<string, ManuelleAntwort>();
    proSeite.set(zeile.frage_hash, ausZeile(zeile));
    ergebnis.set(zeile.url, proSeite);
  }
  return ergebnis;
}

/** Löscht eine Antwort — etwa wenn sie versehentlich gegeben wurde. */
export function loescheAntwort(db: Database, url: string, frageHash: string): boolean {
  const ergebnis = db.prepare(`DELETE FROM manuelle_antwort WHERE url = ? AND frage_hash = ?`).run(url, frageHash);
  return ergebnis.changes > 0;
}

/** Wie viele Fragen zu einer Adresse bereits beantwortet sind. */
export function zaehleAntworten(db: Database, url: string): number {
  const zeile = db.prepare(`SELECT COUNT(*) AS n FROM manuelle_antwort WHERE url = ?`).get(url) as { n: number };
  return zeile.n;
}

function ausZeile(zeile: AntwortZeile): ManuelleAntwort {
  return {
    url: zeile.url,
    kriterium: zeile.kriterium,
    frageHash: zeile.frage_hash,
    antwort: zeile.antwort as Antwortwert,
    notiz: zeile.notiz,
    beantwortetAm: zeile.beantwortet_am,
  };
}
