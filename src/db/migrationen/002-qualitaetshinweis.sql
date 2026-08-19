-- Fassung 2 — Qualitaetshinweise (X-21).
--
-- Ein Mangel, der im gewaehlten Standard kein Erfolgskriterium mehr hat.
-- Betroffen ist bislang genau ein Fall: 4.1.1 entfaellt mit WCAG 2.2, und die
-- Regeln zur HTML-Gueltigkeit verlieren damit ihre Zuordnung.
--
-- Eigene Tabelle statt einer Spalte an `befund`: Ein Qualitaetshinweis haengt
-- an der Seite, nicht an einer Bewertung — er gehoert zu keinem Kriterium.
-- Genau das ist seine Eigenschaft, und ein Fremdschluessel auf `bewertung`
-- wuerde sie verwischen.

CREATE TABLE qualitaetshinweis (
  id            INTEGER PRIMARY KEY,
  scan_seite_id INTEGER NOT NULL REFERENCES scan_seite(id) ON DELETE CASCADE,
  regel_id      TEXT NOT NULL,
  engine        TEXT NOT NULL,
  selektor      TEXT,
  beschreibung  TEXT NOT NULL,
  schwere       TEXT NOT NULL
);

CREATE INDEX idx_qualitaetshinweis_seite ON qualitaetshinweis(scan_seite_id);
