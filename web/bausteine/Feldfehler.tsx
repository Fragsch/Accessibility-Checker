/**
 * Fehlermeldungen, die an dem Feld stehen, das sie meinen (3.3.1).
 *
 * Vorher trugen die Formulare ihre Meldung an einer Stelle — im Prüfauftrag
 * unten vor dem Absendeknopf, in der Profilverwaltung ganz oben. Beides ist zu
 * wenig, und zwar aus zwei verschiedenen Gründen.
 *
 * **Für das Auge:** Wer in einem langen Formular unten auf „speichern“ drückt
 * und die Meldung erscheint oben außerhalb des Bildes, sieht nichts geschehen.
 * Der Knopf wirkt kaputt. Gefunden wird die Meldung dann durch Zufall beim
 * Hochscrollen — das ist keine Fehlermeldung, das ist ein Suchspiel.
 *
 * **Für die Sprachausgabe:** 3.3.1 verlangt, dass „das fehlerhafte Element
 * benannt“ wird, nicht nur, dass ein Fehlertext irgendwo steht. Ein freier Satz
 * ohne Bezug beschreibt den Fehler, benennt aber nicht das Feld. Deshalb hier
 * beides: `aria-invalid` am Feld und die Meldung über `aria-describedby` daran
 * gebunden.
 *
 * **Warum `aria-describedby` und nicht `aria-errormessage`.** Letzteres ist das
 * genauere Attribut und stand hier auch — es wird aber nur von einem Teil der
 * Sprachausgaben ausgewertet. Wo es nicht ausgewertet wird, hört man „ungültige
 * Eingabe“ und erfährt nicht, was falsch ist. `aria-describedby` liest jede.
 * Ein Attribut, das nur die halbe Hälfte erreicht, ist an dieser Stelle
 * schlechter als das ältere, das alle erreichen.
 *
 * **Kein `role="alert"` mehr.** Es stand da, weil ohne Ansage niemand vom
 * Fehler erfuhr. Diesen Weg gibt es jetzt: Der Fokus wandert auf das Feld, und
 * damit liest die Sprachausgabe Name, Zustand und Meldung in einem Zug.
 * Bliebe `role="alert"` daneben stehen, käme derselbe Satz einen Augenblick
 * vorher ein zweites Mal.
 */

import type { Feldfehler } from '../typen';

/**
 * Bringt das fehlerhafte Feld unter den Fokus und vor Augen.
 *
 * Der Fokus, nicht bloß das Scrollen: Scrollen hilft nur dem Auge. Der Fokus
 * hilft allen — die Sprachausgabe liest das Feld samt Meldung vor, die Tastatur
 * steht sofort dort, wo etwas einzugeben ist, und das Bild zieht ohnehin mit.
 *
 * `preventScroll` und danach `scrollIntoView`: Ohne das scrollte der Browser
 * das Feld gerade eben an den Rand des Bildes, und die Beschriftung darüber
 * bliebe außerhalb. `block: 'center'` stellt Feld, Beschriftung und Meldung
 * zusammen ins Bild.
 */
export function zeigeFehlerfeld(feldId: string): void {
  const feld = document.getElementById(feldId);
  if (!feld) return;

  feld.focus({ preventScroll: true });
  feld.scrollIntoView({
    block: 'center',
    // Ein weicher Lauf ist angenehmer, aber nicht für jeden — wer Bewegung
    // abbestellt hat, bekommt den Sprung (2.3.3).
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

/**
 * Die Attribute, die ein Feld trägt, solange der Fehler ihm gilt.
 *
 * `hilfeId` bleibt dabei erhalten: Der Hilfetext erklärt weiterhin, was in das
 * Feld gehört, und beides zusammen ergibt erst die vollständige Auskunft.
 */
export function fehlerbezug(
  fehler: Feldfehler | null,
  feldId: string,
  hilfeId?: string,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  /*
    Die Meldung steht vor dem Hilfetext, nicht dahinter.

    Vorgelesen wird die Reihenfolge, in der die Kennungen hier stehen. „Was
    ist falsch" gehoert dabei vor „was gehoert hier hinein": Wer das Feld
    gerade abgewiesen bekommen hat, wartet nicht erst einen Satz Erklaerung
    ab, um zu erfahren, warum.

    Die eigene Pruefung hat auf der umgekehrten Reihenfolge bestanden: Sie
    liest die erste Beschreibung eines ungueltigen Feldes als dessen
    Fehlermeldung — und fand den Hilfetext, der von einem Fehler nichts weiss.
  */
  const beschreibung = fehler?.feld === feldId ? [meldungsId(feldId), hilfeId] : [hilfeId];
  const zusammen = beschreibung.filter(Boolean).join(' ');

  return {
    ...(fehler?.feld === feldId ? { 'aria-invalid': true as const } : {}),
    ...(zusammen ? { 'aria-describedby': zusammen } : {}),
  };
}

function meldungsId(feldId: string): string {
  return `fehler-${feldId}`;
}

interface Eigenschaften {
  fehler: Feldfehler | null;
  /** Kennung des Feldes, unter dem diese Meldung steht. */
  feld: string;
}

/** Die Meldung selbst — sie steht nur da, wenn der Fehler dieses Feld meint. */
export function Feldmeldung({ fehler, feld }: Eigenschaften): React.ReactElement | null {
  if (fehler?.feld !== feld) return null;

  return (
    <p className="feldfehler" id={meldungsId(feld)}>
      {fehler.text}
    </p>
  );
}
