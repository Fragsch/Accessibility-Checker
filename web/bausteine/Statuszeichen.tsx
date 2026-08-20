/**
 * Anzeige eines Status als Punkt, mit Erklärung beim Darüberfahren.
 *
 * In einer langen Liste steht der Status an jeder Zeile. Ausgeschrieben und in
 * seiner Farbe wird daraus ein unruhiges Band aus Wörtern, das vom eigentlichen
 * Inhalt — der Kriterienbezeichnung — ablenkt. Der Punkt sagt dasselbe und
 * bleibt ruhig.
 *
 * Damit trägt für Sehende die Farbe die Aussage allein (1.4.1). Wer sich bei
 * einer Farbe nicht sicher ist, fährt darüber und liest den Status im Klartext.
 *
 * **Kein `title`.** Der Browser-Tooltip wäre die naheliegende Lösung und ist
 * genau die, die 1.4.13 verbietet: Er lässt sich nicht mit Escape schließen,
 * nicht mit dem Zeiger erreichen — nötig, um ihn zu vergrößern oder zu
 * markieren — und bei Berührungsbedienung erscheint er gar nicht. Die eigene
 * Prüfung hat das an dieser Stelle prompt gemeldet (Regel `tooltip-escape`).
 *
 * Der eigene Hinweis erfüllt die drei Bedingungen des Kriteriums:
 *
 * - *ausblendbar*: Escape blendet ihn aus, ohne dass der Zeiger sich bewegt
 * - *mit dem Zeiger erreichbar*: er grenzt an den Punkt und nimmt Zeiger-
 *   ereignisse an — deshalb kein `pointer-events: none`
 * - *bleibend*: er steht, solange der Zeiger auf dem Punkt oder dem Hinweis ist
 *
 * Für die Sprachausgabe ist der Punkt ein Bild mit Namen (`role="img"`); sie
 * liest „Nicht erfüllt“, wie zuvor der ausgeschriebene Text. Der Hinweis selbst
 * ist für sie verborgen — er wiederholte nur, was der Name schon sagt.
 */

import type { Status } from '../typen';
import { STATUS_ERLAEUTERUNG, STATUS_TEXT } from '../typen';

/*
  Escape blendet die Hinweise aus, bis der Zeiger den Punkt verlaesst. Ein
  Zuhoerer fuer die ganze Seite statt einer je Zeile: Bei fuenfzig Kriterien
  waeren das fuenfzig Anmeldungen fuer dieselbe Taste.
*/
const AUS = 'hinweise-aus';

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (ereignis) => {
    if (ereignis.key === 'Escape') document.body.classList.add(AUS);
  });

  document.addEventListener(
    'pointerover',
    (ereignis) => {
      const ziel = ereignis.target;
      if (ziel instanceof Element && ziel.closest('.statuspunkt')) return;
      document.body.classList.remove(AUS);
    },
    { passive: true },
  );
}

export function Statuszeichen({ status }: { status: Status }): React.ReactElement {
  return (
    <span className={`statuspunkt status--${status}`}>
      <span className="statuspunkt__punkt" role="img" aria-label={STATUS_TEXT[status]} />
      <span className="statuspunkt__hinweis" role="tooltip" aria-hidden="true">
        {STATUS_TEXT[status]} — {STATUS_ERLAEUTERUNG[status]}
      </span>
    </span>
  );
}
