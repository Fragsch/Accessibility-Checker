/**
 * Fortschritt eines laufenden Scans.
 *
 * Der Textstand steht in einem `aria-live`-Bereich (ARCHITEKTUR 7). "polite",
 * nicht "assertive": Der Fortschritt ist wichtig, aber er darf niemandem ins
 * Wort fallen, der gerade etwas anderes liest.
 *
 * Drei Lagen kann diese Ansicht zeigen: die Anmeldung, auf die gewartet wird
 * (S-01), den Crawl, der die Seiten erst zusammensucht (K-08), und die
 * eigentliche Pruefung. Nur die letzte hat einen Balken — bei den ersten
 * beiden ist unbekannt, wie viel noch kommt, und ein Balken, der raet, ist
 * schlechter als eine ehrliche Zeile Text.
 */

import type { ScanZustand } from '../typen';

interface Eigenschaften {
  zustand: ScanZustand;
  gepruefteSeiten: string[];
  /** Meldungen des Crawls, neueste zuletzt (K-08). */
  crawlmeldungen: string[];
  /** Grund eines Sitzungsverlusts (S-05); `null`, solange die Sitzung steht. */
  sitzungsverlust: string | null;
  beiAbbruch: () => void;
  /** Bestätigung, dass die Anmeldung abgeschlossen ist (S-02). */
  beiAnmeldungFertig: () => void;
}

export function Fortschritt({
  zustand,
  gepruefteSeiten,
  crawlmeldungen,
  sitzungsverlust,
  beiAbbruch,
  beiAnmeldungFertig,
}: Eigenschaften): React.ReactElement {
  const wartetAufAnmeldung = zustand.anmeldung?.zustand === 'wartet';
  const stand =
    zustand.seitenGesamt > 0
      ? `${zustand.seitenFertig} von ${zustand.seitenGesamt} Seiten geprüft`
      : 'Seiten werden gesucht';

  return (
    <section className="fortschritt" aria-label="Fortschritt der Prüfung">
      <h2>{wartetAufAnmeldung ? 'Bitte melden Sie sich an' : 'Prüfung läuft'}</h2>

      {/*
        Die Anmeldung ist eine Uebergabe, kein Ablauf im Werkzeug (S-03).
        Deshalb steht hier ausdruecklich, dass keine Zugangsdaten erfasst
        werden — wer sein Kennwort in ein fremd geoeffnetes Fenster tippt,
        soll wissen, woran er ist.
      */}
      {wartetAufAnmeldung && zustand.anmeldung && (
        <div className="meldung" role="status">
          <p>
            Ein sichtbares Browserfenster ist auf <code>{zustand.anmeldung.url}</code> geöffnet. Melden Sie sich dort
            an und bestätigen Sie anschließend hier.
          </p>
          <p className="hilfetext">
            Das Werkzeug erfasst keine Zugangsdaten. Die Sitzung bleibt im Arbeitsspeicher und wird am Ende des Scans
            verworfen.
          </p>
          <div className="knopfreihe">
            <button type="button" onClick={beiAnmeldungFertig}>
              Anmeldung abgeschlossen — Prüfung starten
            </button>
          </div>
        </div>
      )}

      {sitzungsverlust && (
        <div className="meldung meldung--fehler" role="alert">
          <h3>Die Anmeldung ist verloren gegangen</h3>
          <p>{sitzungsverlust}</p>
        </div>
      )}

      {!wartetAufAnmeldung && (
        <>
          {zustand.seitenGesamt > 0 ? (
            <progress value={zustand.seitenFertig} max={zustand.seitenGesamt}>
              {stand}
            </progress>
          ) : null}

          <p aria-live="polite">
            {stand}
            {zustand.aktuelleUrl ? `. Gerade wird geprüft: ${zustand.aktuelleUrl}` : ''}
          </p>

          <p className="hilfetext">
            Eine Seite dauert je nach Umfang einige Sekunden. Ergebnisse erscheinen, sobald sie vorliegen.
          </p>
        </>
      )}

      {crawlmeldungen.length > 0 && (
        <details className="aufklappbar">
          <summary>Gefundene Seiten ({crawlmeldungen.length})</summary>
          <ul className="seitenliste">
            {crawlmeldungen.map((meldung) => (
              <li key={meldung}>{meldung}</li>
            ))}
          </ul>
        </details>
      )}

      {gepruefteSeiten.length > 0 && (
        <ul className="seitenliste">
          {gepruefteSeiten.map((url) => (
            <li key={url}>{url}</li>
          ))}
        </ul>
      )}

      <div className="knopfreihe">
        <button type="button" className="zweitrangig" onClick={beiAbbruch}>
          Prüfung abbrechen
        </button>
      </div>
    </section>
  );
}
