/**
 * Rückfrage vor einer Handlung, die sich nicht rückgängig machen lässt.
 *
 * Als natives `dialog` mit `showModal()`, nicht als nachgebauter Kasten. Das
 * Element bringt mit, was ein Modal ausmacht und was von Hand jedes Mal falsch
 * gebaut wird: Der Fokus bleibt darin (2.4.3), alles dahinter wird `inert` und
 * damit für Zeiger, Tastatur und Sprachausgabe unerreichbar, Escape schließt
 * (2.1.2), und beim Schließen kehrt der Fokus dorthin zurück, wo er hergekommen
 * ist. Regel 6 verbietet fremde Komponenten, nicht die des Browsers.
 *
 * Warum überhaupt ein Dialog und nicht die Rückfrage in der Zeile, die vorher
 * dort stand: Die Zeile musste dafür drei Bedienelemente zusätzlich aufnehmen
 * und wurde zweizeilig, und wer mit einer Sprachausgabe arbeitet, bekam von der
 * neu erschienenen Frage nichts mit — sie stand irgendwo in der Tabelle. Der
 * Dialog holt den Fokus zu sich und liest sich selbst vor.
 *
 * Der Fokus geht auf „Abbrechen", nicht auf die Bestätigung: Wer den Dialog mit
 * der Tastatur wegdrückt, soll dabei nichts löschen. Aus demselben Grund bricht
 * auch ein Klick auf den verdunkelten Hintergrund ab — jeder Weg heraus, den
 * man nicht bewusst gewählt hat, führt in die harmlose Richtung.
 */

import { useEffect, useId, useRef } from 'react';

interface Eigenschaften {
  /** Steuert `showModal()` und `close()`. Der Dialog bleibt im Baum. */
  offen: boolean;
  /** Die Frage. Steht als Überschrift und ist zugleich der Name des Dialogs. */
  titel: string;
  /** Worum es geht — der Name der Prüfung, hervorgehoben. */
  betreff: string;
  /** Was geschieht, wenn bestätigt wird. Ein Satz, keine Beschwichtigung. */
  folge: string;
  /** Beschriftung der Bestätigung. Nennt die Handlung, nicht „OK". */
  bestaetigenText: string;
  beiBestaetigen: () => void;
  beiAbbrechen: () => void;
}

export function Bestaetigung({
  offen,
  titel,
  betreff,
  folge,
  bestaetigenText,
  beiBestaetigen,
  beiAbbrechen,
}: Eigenschaften): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const abbrechen = useRef<HTMLButtonElement>(null);

  /*
    Eigene Kennungen je Dialog, nicht feste.

    Zwei Ansichten setzen diesen Baustein ein. Stünden beide zugleich im Baum,
    trügen Überschrift und Text zweimal dieselbe `id` — und `aria-labelledby`
    griffe auf die erste, also womöglich auf den falschen Dialog. Ein Fehler,
    der nur einer Sprachausgabe auffällt und dem Auge nie.
  */
  const kennung = useId();
  const titelId = `${kennung}-titel`;
  const textId = `${kennung}-text`;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (offen && !element.open) {
      element.showModal();
      /*
        Der Fokus wird gesetzt, nicht dem Browser überlassen.

        `showModal()` nimmt sonst das erste bedienbare Element im Dialog, und
        das ist die Bestätigung — bei einer zerstörenden Handlung genau die
        falsche. `autoFocus` hilft hier nicht: React trägt es nicht als Attribut
        ein, sondern ruft beim Einhängen `focus()` auf, und eingehängt ist der
        Dialog schon, bevor er geöffnet wird.
      */
      abbrechen.current?.focus();
    }
    if (!offen && element.open) element.close();
  }, [offen]);

  return (
    <dialog
      className="dialog"
      ref={dialog}
      aria-labelledby={titelId}
      aria-describedby={textId}
      /*
        Escape. Der Browser schließt selbst und meldet es hier; ohne diese
        Zeile bliebe der Zustand oben auf „offen" stehen, und der Dialog ließe
        sich nicht wieder öffnen.
      */
      onCancel={beiAbbrechen}
      /*
        Ein Klick auf den verdunkelten Hintergrund bricht ab.

        Erkannt wird er daran, dass das Ziel des Klicks der `dialog` selbst ist
        — der Inhalt liegt in einem eigenen Element darin. Das hält nur,
        solange der `dialog` kein eigenes Polster trägt; siehe `_dialog.scss`.
      */
      onClick={(e) => {
        if (e.target === dialog.current) beiAbbrechen();
      }}
    >
      <div className="dialog__inhalt">
        <h2 id={titelId}>{titel}</h2>
        <p id={textId}>
          <span className="dialog__betreff">{`„${betreff}“`}</span> {folge}
        </p>
        <div className="knopfreihe dialog__knoepfe">
          {/*
            Abbrechen steht links und zuerst, die Bestätigung rechts und
            zuletzt — im Markup wie auf dem Bildschirm. Die Reihenfolge wird
            nirgends per CSS gedreht: Sichtbare und vorgelesene Folge müssen
            dieselbe sein (1.3.2, 2.4.3), und bei einer zerstörenden Handlung
            ist der harmlose Weg zugleich der, den die Tastatur zuerst findet.
          */}
          <button type="button" className="zweitrangig" ref={abbrechen} onClick={beiAbbrechen}>
            Abbrechen
          </button>
          <button type="button" className="gefaehrlich" onClick={beiBestaetigen}>
            {bestaetigenText}
          </button>
        </div>
      </div>
    </dialog>
  );
}
