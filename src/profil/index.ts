/**
 * Prüfprofile (PRD 6.1, K-03 bis K-07, K-13).
 *
 * Das Prüfprofil ist die Arbeitsform für den Regelbetrieb: eine kuratierte
 * Auswahl repräsentativer Seiten — Startseite, Kontaktformular,
 * Suchergebnisliste, Anmeldung, Warenkorb. Einmal angelegt, benannt und danach
 * wiederverwendet.
 *
 * Der Zweck ist **Vergleichbarkeit über die Zeit.** Deshalb gehört auch der
 * Prüfstandard ins Profil (K-13): Ein Wiederholungslauf, der plötzlich gegen
 * WCAG 2.2 misst, ist mit dem Vorlauf nicht vergleichbar, und die Verbesserung
 * oder Verschlechterung wäre nicht mehr auf die Seite zurückzuführen.
 */

import type { Database } from 'better-sqlite3';

import type { Standard } from '../typen/index.js';
import { pruefeAdresse } from '../scan/adressen.js';

export interface Viewport {
  breite: number;
  hoehe: number;
}

export interface ProfilSeite {
  id?: number;
  url: string;
  /** Wofür diese Seite steht (K-04). */
  bezeichnung: string;
  /** Warum sie im Profil ist — „Kontaktformular", „Suchergebnis" (K-04). */
  zweck: string | null;
  reihenfolge: number;
}

export interface Profil {
  id: number;
  name: string;
  standard: Standard;
  viewports: Viewport[];
  angelegtAm: string;
  seiten: ProfilSeite[];
}

export interface ProfilEingabe {
  name: string;
  standard?: Standard | undefined;
  viewports?: Viewport[] | undefined;
  seiten: { url: string; bezeichnung: string; zweck?: string | null | undefined }[];
}

export class ProfilFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'ProfilFehler';
  }
}

/** Vorgabe-Viewports nach A-04, falls das Profil nichts anderes sagt. */
export const VIEWPORTS_VORGABE: Viewport[] = [
  { breite: 1280, hoehe: 900 },
  { breite: 768, hoehe: 1024 },
  { breite: 320, hoehe: 640 },
];

interface ProfilZeile {
  id: number;
  name: string;
  standard: string;
  viewports: string;
  angelegt_am: string;
}

interface SeitenZeile {
  id: number;
  profil_id: number;
  url: string;
  bezeichnung: string;
  zweck: string | null;
  reihenfolge: number;
}

export function listeProfile(db: Database): Profil[] {
  const zeilen = db.prepare(`SELECT * FROM profil ORDER BY name`).all() as ProfilZeile[];
  return zeilen.map((zeile) => ausZeile(db, zeile));
}

export function findeProfil(db: Database, id: number): Profil | null {
  const zeile = db.prepare(`SELECT * FROM profil WHERE id = ?`).get(id) as ProfilZeile | undefined;
  return zeile ? ausZeile(db, zeile) : null;
}

/** Legt ein Profil an. Die Seiten werden dabei geprüft und normalisiert. */
export function legeProfilAn(db: Database, eingabe: ProfilEingabe): Profil {
  const seiten = pruefeSeiten(eingabe.seiten);
  const name = eingabe.name.trim();
  if (!name) throw new ProfilFehler('Ein Profil braucht einen Namen.');

  const anlegen = db.transaction((): number => {
    const zeile = db
      .prepare(`INSERT INTO profil (name, standard, viewports, angelegt_am) VALUES (?, ?, ?, ?)`)
      .run(
        name,
        eingabe.standard ?? '2.1',
        JSON.stringify(eingabe.viewports ?? VIEWPORTS_VORGABE),
        new Date().toISOString(),
      );

    const profilId = Number(zeile.lastInsertRowid);
    schreibSeiten(db, profilId, seiten);
    return profilId;
  });

  const id = anlegen();
  const angelegt = findeProfil(db, id);
  if (!angelegt) throw new ProfilFehler('Das Profil konnte nicht angelegt werden.');
  return angelegt;
}

/** Ändert ein Profil. Die Seitenliste wird vollständig ersetzt. */
export function aendereProfil(db: Database, id: number, eingabe: ProfilEingabe): Profil | null {
  if (!findeProfil(db, id)) return null;

  const seiten = pruefeSeiten(eingabe.seiten);
  const name = eingabe.name.trim();
  if (!name) throw new ProfilFehler('Ein Profil braucht einen Namen.');

  const aendern = db.transaction(() => {
    db.prepare(`UPDATE profil SET name = ?, standard = ?, viewports = ? WHERE id = ?`).run(
      name,
      eingabe.standard ?? '2.1',
      JSON.stringify(eingabe.viewports ?? VIEWPORTS_VORGABE),
      id,
    );
    db.prepare(`DELETE FROM profil_seite WHERE profil_id = ?`).run(id);
    schreibSeiten(db, id, seiten);
  });

  aendern();
  return findeProfil(db, id);
}

export function loescheProfil(db: Database, id: number): boolean {
  return db.prepare(`DELETE FROM profil WHERE id = ?`).run(id).changes > 0;
}

// ------------------------------------------------------ Import und Export

/**
 * Profil als JSON, versionierbar im Projekt (K-07).
 *
 * **URLs bleiben vollständig erhalten.** Ein Profil mit gekürzten Adressen
 * wäre wertlos: Der ganze Zweck ist, dieselben Seiten wieder anzusteuern.
 */
export interface ProfilAustausch {
  werkzeug: 'accessibility-checker';
  fassung: 1;
  name: string;
  standard: Standard;
  viewports: Viewport[];
  seiten: { url: string; bezeichnung: string; zweck: string | null }[];
}

export function alsAustausch(profil: Profil): ProfilAustausch {
  return {
    werkzeug: 'accessibility-checker',
    fassung: 1,
    name: profil.name,
    standard: profil.standard,
    viewports: profil.viewports,
    seiten: profil.seiten.map((s) => ({ url: s.url, bezeichnung: s.bezeichnung, zweck: s.zweck })),
  };
}

export function ausAustausch(roh: unknown): ProfilEingabe {
  if (typeof roh !== 'object' || roh === null) throw new ProfilFehler('Die Datei enthält kein Profil.');

  const daten = roh as Partial<ProfilAustausch>;
  if (daten.werkzeug !== 'accessibility-checker') {
    throw new ProfilFehler('Diese Datei stammt nicht aus diesem Werkzeug.');
  }
  if (daten.fassung !== 1) {
    throw new ProfilFehler(`Unbekannte Profilfassung: ${String(daten.fassung)}.`);
  }
  if (!Array.isArray(daten.seiten) || daten.seiten.length === 0) {
    throw new ProfilFehler('Das Profil enthält keine Seiten.');
  }

  return {
    name: String(daten.name ?? 'Ohne Namen'),
    standard: daten.standard === '2.2' ? '2.2' : '2.1',
    ...(Array.isArray(daten.viewports) ? { viewports: daten.viewports } : {}),
    seiten: daten.seiten.map((s) => ({
      url: String(s.url ?? ''),
      bezeichnung: String(s.bezeichnung ?? ''),
      zweck: s.zweck ?? null,
    })),
  };
}

// ---------------------------------------------------------------- Intern

function pruefeSeiten(
  eingabe: readonly { url: string; bezeichnung: string; zweck?: string | null | undefined }[],
): ProfilSeite[] {
  if (eingabe.length === 0) throw new ProfilFehler('Ein Profil braucht mindestens eine Seite.');

  const seiten: ProfilSeite[] = [];
  const gesehen = new Set<string>();

  eingabe.forEach((roh, nummer) => {
    const url = pruefeAdresse(roh.url);
    if (!url) throw new ProfilFehler(`Keine gültige Adresse: ${roh.url}`);
    if (gesehen.has(url)) return; // Doppelte stillschweigend auslassen.
    gesehen.add(url);

    seiten.push({
      url,
      // Ohne Bezeichnung waere die Liste im Bericht eine Reihe von Adressen.
      bezeichnung: roh.bezeichnung.trim() || `Seite ${nummer + 1}`,
      zweck: roh.zweck?.trim() || null,
      reihenfolge: seiten.length,
    });
  });

  if (seiten.length === 0) throw new ProfilFehler('Ein Profil braucht mindestens eine Seite.');
  return seiten;
}

function schreibSeiten(db: Database, profilId: number, seiten: readonly ProfilSeite[]): void {
  const einfuegen = db.prepare(
    `INSERT INTO profil_seite (profil_id, url, bezeichnung, zweck, reihenfolge) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const seite of seiten) {
    einfuegen.run(profilId, seite.url, seite.bezeichnung, seite.zweck, seite.reihenfolge);
  }
}

function ausZeile(db: Database, zeile: ProfilZeile): Profil {
  const seiten = db
    .prepare(`SELECT * FROM profil_seite WHERE profil_id = ? ORDER BY reihenfolge`)
    .all(zeile.id) as SeitenZeile[];

  let viewports: Viewport[];
  try {
    viewports = JSON.parse(zeile.viewports) as Viewport[];
  } catch {
    viewports = VIEWPORTS_VORGABE;
  }

  return {
    id: zeile.id,
    name: zeile.name,
    standard: zeile.standard === '2.2' ? '2.2' : '2.1',
    viewports,
    angelegtAm: zeile.angelegt_am,
    seiten: seiten.map((s) => ({
      id: s.id,
      url: s.url,
      bezeichnung: s.bezeichnung,
      zweck: s.zweck,
      reihenfolge: s.reihenfolge,
    })),
  };
}
