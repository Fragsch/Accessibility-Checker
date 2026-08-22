/**
 * Anzeige eines Status als Punkt mit Zeichen, mit Erklärung beim Darüberfahren.
 *
 * In einer langen Liste steht der Status an jeder Zeile. Ausgeschrieben und in
 * seiner Farbe wird daraus ein unruhiges Band aus Wörtern, das vom eigentlichen
 * Inhalt — der Kriterienbezeichnung — ablenkt. Der Punkt sagt dasselbe und
 * bleibt ruhig.
 *
 * Im Punkt steht das Sinnbild des Status — Haken, Kreuz, Fragezeichen oder
 * Strich. Ohne es trüge für Sehende die Farbe die Aussage allein, und das ist
 * genau, was 1.4.1 nicht zulässt. Wer sich bei einem Zeichen nicht sicher ist,
 * fährt darüber und liest den Status im Klartext.
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

/**
 * Die vier Sinnbilder als Pfad, nicht als Schriftzeichen.
 *
 * Ein Schriftzeichen im Kreis war das Naheliegende und hat sich nicht mittig
 * bekommen lassen: Ausgerichtet wird dabei der Zeilenkasten, und der richtet
 * sich nach den Metriken der Schrift — bei „?" nach der festen Schrift, bei
 * Haken, Kreuz und Strich nach einer Rueckfallschrift mit anderen Metriken.
 * Wo genau die Tinte darin liegt, weiss das Layout nicht. Ein Pfad hat keine
 * Schriftlinie; sein Kasten ist seine Tinte, und der laesst sich auf den
 * Millimeter mittig setzen.
 *
 * Die Pfade sind Material Symbols (Apache 2.0) in ihrem Kasten von 960
 * Einheiten, wie sie geliefert werden. Nachgemessen wurde, wo die Tinte darin
 * sitzt: Haken, Kreuz und Strich stehen mittig, das Fragezeichen sitzt 20
 * Einheiten zu tief — es ist als Schriftzeichen gedacht und auf der
 * Schriftlinie ausgerichtet, nicht im Kasten. Sein Kasten ist deshalb um diese
 * 20 Einheiten verschoben. Der Wert ist gemessen, nicht geschaetzt; wer einen
 * Pfad austauscht, misst neu.
 */
const SINNBILDER: Record<Status, { kasten: string; pfad: string }> = {
  erfuellt: {
    kasten: '0 -960 960 960',
    pfad: 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z',
  },
  nicht_erfuellt: {
    kasten: '0 -960 960 960',
    pfad: 'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z',
  },
  pruefung_erforderlich: {
    kasten: '0 -940 960 960',
    pfad:
      'M424-320q0-81 14.5-116.5T500-514q41-36 62.5-62.5T584-637q0-41-27.5-68T480-732q-51 0-77.5 31T365-638l-103-44q21-64 77-111t141-47q105 0 161.5 58.5T698-641q0 50-21.5 85.5T609-475q-49 47-59.5 71.5T539-320H424Zm56 240q-33 0-56.5-23.5T400-160q0-33 23.5-56.5T480-240q33 0 56.5 23.5T560-160q0 33-23.5 56.5T480-80Z',
  },
  nicht_anwendbar: {
    kasten: '0 -960 960 960',
    pfad: 'M240-440v-80h480v80H240Z',
  },
};

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
      <span className="statuspunkt__punkt" role="img" aria-label={STATUS_TEXT[status]}>
        {/*
          `fill="currentColor"`: Die Farbe kommt aus `.status--…` und steht
          nirgends zweimal. Es ist die kraeftige Statusfarbe — 6:1 auf ihrer
          Toenung und damit auch als Grafik weit ueber der Schwelle von 1.4.11.

          `aria-hidden` und `focusable="false"`: Den Namen traegt der Punkt
          selbst ueber `aria-label` — „Nicht erfuellt" ist gesprochen die
          vollstaendigere Aussage als ein vorgelesenes Kreuz. `focusable`
          gehoert dazu, weil aeltere Browser SVG sonst in die
          Tabulatorreihenfolge nehmen (2.4.3).
        */}
        <svg
          className="statuspunkt__sinnbild"
          viewBox={SINNBILDER[status].kasten}
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d={SINNBILDER[status].pfad} />
        </svg>
      </span>
      <span className="statuspunkt__hinweis" role="tooltip" aria-hidden="true">
        {STATUS_TEXT[status]} — {STATUS_ERLAEUTERUNG[status]}
      </span>
    </span>
  );
}
