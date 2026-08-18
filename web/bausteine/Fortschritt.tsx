/**
 * Fortschritt eines laufenden Scans.
 *
 * Der Textstand steht in einem `aria-live`-Bereich (ARCHITEKTUR 7). "polite",
 * nicht "assertive": Der Fortschritt ist wichtig, aber er darf niemandem ins
 * Wort fallen, der gerade etwas anderes liest.
 */

import type { ScanZustand } from '../typen';

interface Eigenschaften {
  zustand: ScanZustand;
  gepruefteSeiten: string[];
  beiAbbruch: () => void;
}

export function Fortschritt({ zustand, gepruefteSeiten, beiAbbruch }: Eigenschaften): React.ReactElement {
  const stand = `${zustand.seitenFertig} von ${zustand.seitenGesamt} Seiten geprüft`;

  return (
    <section className="fortschritt" aria-label="Fortschritt der Prüfung">
      <h2>Prüfung läuft</h2>

      <progress value={zustand.seitenFertig} max={zustand.seitenGesamt}>
        {stand}
      </progress>

      <p aria-live="polite">
        {stand}
        {zustand.aktuelleUrl ? `. Gerade wird geprüft: ${zustand.aktuelleUrl}` : ''}
      </p>

      <p className="hilfetext">
        Eine Seite dauert je nach Umfang einige Sekunden. Ergebnisse erscheinen, sobald sie vorliegen.
      </p>

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
