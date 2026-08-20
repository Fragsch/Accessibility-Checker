-- Fassung 3 — Abbild der geprueften Seite.
--
-- Ein Bildschirmfoto je Seite, aufgenommen unmittelbar bevor die Engines
-- laufen. Es beantwortet eine Frage, die keine Zahl beantworten kann: Wurde
-- ueberhaupt das geprueft, was geprueft werden sollte?
--
-- Der Anlass war ein Cookie-Hinweis. Er legte sich ueber die Seite, die Engines
-- massen ihn statt des Inhalts darunter, und das Ergebnis sah vollstaendig aus
-- und war unbrauchbar — ohne dass irgendetwas daran auffaellig gewesen waere.
-- Dieselbe Lage entsteht bei einer Weiterleitung auf eine Fehlerseite, einer
-- Altersabfrage oder einer Anmeldemaske.
--
-- An `scan_seite`, nicht an `befund`: Das Bild gehoert zur Seite als ganzer und
-- zu keinem einzelnen Mangel. Die Spalte `befund.screenshot` bleibt davon
-- unberuehrt — sie zeigt eine Fundstelle, dieses Bild zeigt die Lage.
--
-- Als BLOB in derselben Datenbank und nicht als Datei daneben: Loeschen muss
-- alles mitnehmen (S-24). `scan_seite` haengt per ON DELETE CASCADE am Scan;
-- damit verschwindet das Bild mit ihm, ohne dass irgendwo eine verwaiste Datei
-- zurueckbleibt. Bilder aus geschuetzten Bereichen enthalten regelmaessig
-- personenbezogene Daten (PRD 6.1.2) — eine Zusage, die nur haelt, wenn es
-- genau einen Ort gibt, an dem sie liegen.

ALTER TABLE scan_seite ADD COLUMN abbild BLOB;
ALTER TABLE scan_seite ADD COLUMN abbild_breite INTEGER;
ALTER TABLE scan_seite ADD COLUMN abbild_hoehe INTEGER;
