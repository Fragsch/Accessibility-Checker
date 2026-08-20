/**
 * Ein Info-Zeichen neben einer Überschrift, das eine Erläuterung aufklappt.
 *
 * **Kein `title` und kein Hinweis beim Darüberfahren.** Für den Statuspunkt ist
 * ein Hinweis am Zeiger richtig: Dort wiederholt er nur, was die Sprachausgabe
 * ohnehin als Namen des Punktes vorliest, und er darf deshalb für sie verborgen
 * bleiben. Hier ist es umgekehrt — der Text steht nirgends sonst. Ein Inhalt,
 * den nur sieht, wer mit einem Zeiger darüberfährt, fiele für alle anderen
 * ersatzlos aus.
 *
 * Deshalb eine Aufklappschaltfläche nach dem üblichen Muster, wie schon in der
 * Kopfnavigation: `button` mit `aria-expanded`, das Ziel über `aria-controls`
 * benannt. Sie wird angetippt, angeklickt oder mit der Tastatur bedient und
 * verhält sich in allen drei Fällen gleich. Weil der Inhalt nicht beim
 * Darüberfahren erscheint, stellt sich die Frage nach 1.4.13 gar nicht erst:
 * Er steht, bis jemand ihn schließt.
 *
 * Escape schließt und gibt den Fokus zurück (2.1.2 — nichts darf den Fokus
 * einsperren), ein Klick daneben schließt ebenfalls.
 *
 * Das Zeichen selbst ist eine Maske und trägt keinen Text. Der Name des
 * Knopfes steht deshalb als verborgene Beschriftung darin — ohne sie hätte er
 * für eine Sprachausgabe gar keinen (4.1.2).
 */

import { useEffect, useId, useRef, useState } from 'react';

interface Eigenschaften {
  /** Der zugängliche Name des Knopfes. Sagt, was zu lesen ist, nicht „Info“. */
  beschriftung: string;
  children: React.ReactNode;
}

export function Erklaerknopf({ beschriftung, children }: Eigenschaften): React.ReactElement {
  const [offen, setzeOffen] = useState(false);
  const blasenId = useId();
  const schalter = useRef<HTMLButtonElement>(null);
  const huelle = useRef<HTMLSpanElement>(null);

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

  return (
    <span className="erklaerung" ref={huelle}>
      <button
        type="button"
        className="erklaerung__schalter"
        aria-expanded={offen}
        aria-controls={blasenId}
        onClick={() => setzeOffen((bisher) => !bisher)}
        ref={schalter}
      >
        <span className="nur-fuer-screenreader">{beschriftung}</span>
      </button>

      {offen && (
        <span className="erklaerung__blase" id={blasenId} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
