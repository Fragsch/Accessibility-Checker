/**
 * Die Navigation in der Kopfzeile.
 *
 * Drei Wege, die von überall erreichbar sein sollen: eine neue Prüfung
 * beginnen, in die bisherigen Prüfungen sehen, nachlesen, was das Werkzeug
 * findet. Sie stehen in der Kopfzeile und nirgends sonst — dieselbe Schaltfläche
 * zweimal auf einer Seite ist für eine Sprachausgabe eine Dopplung ohne
 * Mehrwert.
 *
 * Auf schmalen Fenstern passen sie nicht nebeneinander und ziehen in ein
 * Aufklappmenü. Beide Zustände teilen sich **eine** Liste im Markup; welcher
 * gilt, entscheidet allein das Stylesheet. Zwei getrennte Fassungen — eine für
 * schmal, eine für breit — stünden beide im Baum, und eine Sprachausgabe läse
 * jeden Punkt doppelt.
 *
 * Das Menü ist eine Aufklappschaltfläche nach dem üblichen Muster: `button` mit
 * `aria-expanded`, das Ziel über `aria-controls` benannt. Escape schließt es und
 * gibt den Fokus zurück (2.1.2 — nichts darf den Fokus einsperren), ein Klick
 * daneben schließt es ebenfalls.
 */

import { useEffect, useId, useRef, useState } from 'react';

interface Eigenschaften {
  beiNeuePruefung: () => void;
  beiScans: () => void;
  beiAbdeckung: () => void;
  /** Während ein Scan läuft, führt „Neue Prüfung“ ins Leere — der Lauf bliebe im Hintergrund stehen. */
  laeuft: boolean;
}

export function Kopfnavigation({
  beiNeuePruefung,
  beiScans,
  beiAbdeckung,
  laeuft,
}: Eigenschaften): React.ReactElement {
  const [offen, setzeOffen] = useState(false);
  const listenId = useId();
  const schalter = useRef<HTMLButtonElement>(null);
  const huelle = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!offen) return undefined;

    function beiTaste(ereignis: KeyboardEvent): void {
      if (ereignis.key !== 'Escape') return;
      setzeOffen(false);
      schalter.current?.focus();
    }

    function beiZeiger(ereignis: PointerEvent): void {
      const ziel = ereignis.target;
      if (ziel instanceof Node && huelle.current?.contains(ziel)) return;
      setzeOffen(false);
    }

    document.addEventListener('keydown', beiTaste);
    document.addEventListener('pointerdown', beiZeiger);
    return () => {
      document.removeEventListener('keydown', beiTaste);
      document.removeEventListener('pointerdown', beiZeiger);
    };
  }, [offen]);

  /** Erst schließen, dann handeln — sonst bleibt das Menü über der neuen Ansicht stehen. */
  function fuehreAus(handlung: () => void): void {
    setzeOffen(false);
    handlung();
  }

  return (
    <nav className={`kopfnav${offen ? ' kopfnav--offen' : ''}`} aria-label="Werkzeug" ref={huelle}>
      <button
        type="button"
        className="kopfnav__schalter zweitrangig"
        aria-expanded={offen}
        aria-controls={listenId}
        onClick={() => setzeOffen((bisher) => !bisher)}
        ref={schalter}
      >
        Menü
      </button>

      <ul className="kopfnav__liste" id={listenId}>
        <li>
          <button type="button" className="zweitrangig" onClick={() => fuehreAus(beiScans)}>
            Bisherige Prüfungen
          </button>
        </li>
        <li>
          <button type="button" className="zweitrangig" onClick={() => fuehreAus(beiAbdeckung)}>
            Was dieses Werkzeug findet
          </button>
        </li>
        <li>
          <button type="button" onClick={() => fuehreAus(beiNeuePruefung)} disabled={laeuft}>
            Neue Prüfung
          </button>
        </li>
      </ul>
    </nav>
  );
}
