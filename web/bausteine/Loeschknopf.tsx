/**
 * Der Löschknopf einer Listenzeile — allein sein Sinnbild, rot gerahmt.
 *
 * Er steht in der letzten Spalte zweier Tabellen, in denen sonst beschriftete
 * Knöpfe stehen. Ausgeschrieben brachen diese Spalten auf schmaleren Fenstern
 * um und bauten höher als der Inhalt daneben. Der Papierkorb ist eines der
 * wenigen Sinnbilder, das ohne Beschriftung verstanden wird, und er steht hier
 * an dem Ort, an dem man ihn sucht.
 *
 * Rot ist nicht der einzige Träger der Aussage (1.4.1): Die Form sagt, was
 * geschieht, die Farbe nur, wie ernst es ist.
 *
 * Der Name geht nicht verloren, er wird genauer — „Löschen: Schnellprüfung“
 * statt bloß „Löschen“. In einer Liste gleich aussehender Zeilen ist das der
 * Unterschied zwischen einem Knopf und dem richtigen Knopf (4.1.2). Kein
 * `title`: Der Browser-Tooltip lässt sich nicht mit Escape schließen, nicht mit
 * dem Zeiger erreichen und erscheint bei Berührungsbedienung gar nicht — genau
 * das verbietet 1.4.13.
 *
 * Maße und Farben stehen in `_knoepfe.scss` unter `.nur-symbol` und
 * `.gefaehrlich`.
 */

/**
 * Der Papierkorb als Pfad.
 *
 * Material Symbols (Apache 2.0) in ihrem Kasten von 960 Einheiten, unverändert
 * wie geliefert — dieselbe Herkunft wie die vier Sinnbilder in
 * `Statuszeichen.tsx`. Als Pfad und nicht als Schriftzeichen, damit keine
 * Schriftlinie mitkommt, die sich nicht mittig setzen lässt.
 */
const PAPIERKORB =
  'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z';

interface Eigenschaften {
  /** Was gelöscht würde. Steht im verborgenen Namen des Knopfes. */
  betreff: string;
  beiKlick: () => void;
}

export function Loeschknopf({ betreff, beiKlick }: Eigenschaften): React.ReactElement {
  return (
    <button type="button" className="zweitrangig gefaehrlich nur-symbol" onClick={beiKlick}>
      {/*
        `aria-hidden`, weil der Knopf seinen Namen schon nebenan trägt. Ohne das
        stünde das Bild ein zweites Mal im Zugänglichkeitsbaum.
        `focusable="false"` für den älteren Edge, der SVG sonst in die
        Tabulatorreihenfolge nimmt.
      */}
      <svg className="symbol" viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d={PAPIERKORB} />
      </svg>
      <span className="nur-fuer-screenreader">Löschen: {betreff}</span>
    </button>
  );
}
