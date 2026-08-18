/**
 * Datenbankzugriff.
 *
 * `better-sqlite3` arbeitet synchron. Das ist hier ein Vorteil: der Scan laeuft
 * ohnehin sequenziell, und ohne Zusagenketten bleibt der Ablauf lesbar.
 *
 * Bezug: ARCHITEKTUR.md 4.2 und 9 Schritt 3
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import DatenbankTreiber from 'better-sqlite3';
import type { Database } from 'better-sqlite3';

import { datenVerzeichnis } from '../plattform/pfade.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));

/** Fassung, die das Grundschema `schema.sql` herstellt. */
const GRUNDFASSUNG = 1;

export interface DatenbankOptionen {
  /** Dateipfad. `:memory:` fuer eine fluechtige Datenbank in Tests. */
  pfad?: string;
}

/** Vorgabepfad der Betriebsdatenbank — `daten/` ist nicht versioniert. */
export function standardDatenbankPfad(): string {
  return path.join(datenVerzeichnis(), 'pruefungen.db');
}

/**
 * Oeffnet die Datenbank und bringt sie auf den aktuellen Schemastand.
 * Eine neue Datei erhaelt das Grundschema, eine vorhandene die fehlenden
 * Migrationen — in aufsteigender Reihenfolge, in je einer Transaktion.
 */
export function oeffneDatenbank(optionen: DatenbankOptionen = {}): Database {
  const pfad = optionen.pfad ?? standardDatenbankPfad();

  if (pfad !== ':memory:') fs.mkdirSync(path.dirname(pfad), { recursive: true });

  const db = new DatenbankTreiber(pfad);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  wendeSchemaAn(db);
  return db;
}

function wendeSchemaAn(db: Database): void {
  const fassung = Number((db.pragma('user_version', { simple: true }) as number | bigint) ?? 0);

  if (fassung === 0) {
    const grundschema = fs.readFileSync(path.join(HIER, 'schema.sql'), 'utf8');
    db.exec(grundschema);
    db.pragma(`user_version = ${GRUNDFASSUNG}`);
  }

  for (const { nummer, sql } of lesMigrationen()) {
    const stand = Number((db.pragma('user_version', { simple: true }) as number | bigint) ?? 0);
    if (nummer <= stand) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${nummer}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${nummer} fehlgeschlagen: ${(e as Error).message}`);
    }
  }
}

interface Migration {
  nummer: number;
  sql: string;
}

function lesMigrationen(): Migration[] {
  const verzeichnis = path.join(HIER, 'migrationen');
  if (!fs.existsSync(verzeichnis)) return [];

  return fs
    .readdirSync(verzeichnis)
    .filter((datei) => datei.endsWith('.sql'))
    .map((datei) => {
      const treffer = /^(\d+)/.exec(datei);
      if (!treffer?.[1]) throw new Error(`Migration ohne fuehrende Nummer: ${datei}`);
      return { nummer: Number(treffer[1]), sql: fs.readFileSync(path.join(verzeichnis, datei), 'utf8') };
    })
    .sort((a, b) => a.nummer - b.nummer);
}
