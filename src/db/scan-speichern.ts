/**
 * Ablage eines Scanergebnisses in der Datenbank.
 *
 * Ein Scan wird in einer Transaktion geschrieben — ein halb gespeicherter Scan
 * waere schlimmer als gar keiner.
 */

import type { Database } from 'better-sqlite3';

import type { ScanErgebnis } from '../typen/index.js';

export function speichereScan(db: Database, ergebnis: ScanErgebnis): number {
  const scanEinfuegen = db.prepare(
    `INSERT INTO scan (profil_id, betriebsart, standard, gestartet_am, beendet_am,
                       stufe2_aktiv, stufe2_modell, geschuetzt, werkzeug_version)
     VALUES (NULL, ?, ?, ?, ?, ?, NULL, 0, ?)`,
  );
  const seiteEinfuegen = db.prepare(
    `INSERT INTO scan_seite (scan_id, url, bezeichnung, titel, status) VALUES (?, ?, ?, ?, ?)`,
  );
  const bewertungEinfuegen = db.prepare(
    `INSERT INTO bewertung (scan_seite_id, kriterium, status, herkunft) VALUES (?, ?, ?, ?)`,
  );
  const befundEinfuegen = db.prepare(
    `INSERT INTO befund (bewertung_id, selektor, html_ausschnitt, screenshot,
                         beschreibung, schwere, muster_hash)
     VALUES (?, ?, ?, NULL, ?, ?, NULL)`,
  );
  const hinweisEinfuegen = db.prepare(`INSERT INTO hinweis (bewertung_id, text, herkunft) VALUES (?, ?, ?)`);

  const schreiben = db.transaction((e: ScanErgebnis): number => {
    const scan = scanEinfuegen.run(
      e.betriebsart,
      e.standard,
      e.gestartetAm,
      e.beendetAm,
      e.stufe2Aktiv ? 1 : 0,
      e.werkzeugVersion,
    );
    const scanId = Number(scan.lastInsertRowid);

    for (const seite of e.seiten) {
      const seitenZeile = seiteEinfuegen.run(scanId, seite.url, seite.bezeichnung, seite.titel, seite.zustand);
      const seitenId = Number(seitenZeile.lastInsertRowid);

      for (const bewertung of seite.bewertungen) {
        const bewertungsZeile = bewertungEinfuegen.run(
          seitenId,
          bewertung.kriterium,
          bewertung.status,
          bewertung.herkunft,
        );
        const bewertungsId = Number(bewertungsZeile.lastInsertRowid);

        for (const befund of bewertung.befunde) {
          befundEinfuegen.run(
            bewertungsId,
            befund.selektor,
            befund.htmlAusschnitt,
            befund.beschreibung,
            befund.schwere,
          );
        }
        for (const hinweis of bewertung.hinweise) {
          hinweisEinfuegen.run(bewertungsId, hinweis.text, hinweis.herkunft);
        }
      }
    }

    return scanId;
  });

  return schreiben(ergebnis);
}
