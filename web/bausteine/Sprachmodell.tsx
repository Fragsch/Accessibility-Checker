/**
 * Zuschalten der Sprachmodell-Stufe (L-46, L-47, L-45).
 *
 * Der Schalter steht bewusst aus. Stufe 2 kostet auf schwacher Hardware
 * Minuten je Seite; das darf niemandem widerfahren, ohne dass er es
 * angeordnet hat.
 *
 * Genauso wichtig ist die Gegenrichtung: Wer sie ausschaltet, muss erfahren,
 * **was dadurch entfällt** (L-47). Eine stillschweigende Verschlechterung der
 * Aussagekraft wäre das Gegenteil dessen, wofür dieses Werkzeug da ist.
 */

import { useEffect, useState } from 'react';

import { ApiFehler, ladeStufe2Zustand } from '../api';
import type { Standard, Stufe2Zustand } from '../typen';

interface Eigenschaften {
  aktiv: boolean;
  /** Welche Kriterien ohne Stufe 2 offen bleiben, haengt am Standard. */
  standard: Standard;
  beiAenderung: (aktiv: boolean) => void;
}

export function Sprachmodell({ aktiv, standard, beiAenderung }: Eigenschaften): React.ReactElement {
  const [zustand, setzeZustand] = useState<Stufe2Zustand | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laedt, setzeLaedt] = useState(true);

  useEffect(() => {
    let abgemeldet = false;

    ladeStufe2Zustand(standard)
      .then((geladen) => {
        if (!abgemeldet) setzeZustand(geladen);
      })
      .catch((e: unknown) => {
        if (!abgemeldet) setzeFehler(e instanceof ApiFehler ? e.message : String(e));
      })
      .finally(() => {
        if (!abgemeldet) setzeLaedt(false);
      });

    return () => {
      abgemeldet = true;
    };
  }, [standard]);

  const einsatzbereit = zustand?.einsatzbereit ?? false;

  return (
    <fieldset className="feldgruppe">
      <legend>Sprachmodell-Stufe</legend>

      <div className="auswahl">
        <label>
          <input
            type="checkbox"
            checked={aktiv && einsatzbereit}
            disabled={!einsatzbereit}
            onChange={(e) => beiAenderung(e.target.checked)}
          />
          Inhaltliche Bewertung durch ein lokales Sprachmodell zuschalten
        </label>
      </div>

      {laedt && <p className="hilfetext">Zustand wird ermittelt …</p>}

      {fehler && (
        <p className="meldung meldung--fehler" role="status">
          {fehler}
        </p>
      )}

      {zustand && !laedt && <Zustandsanzeige zustand={zustand} aktiv={aktiv && einsatzbereit} />}
    </fieldset>
  );
}

function Zustandsanzeige({ zustand, aktiv }: { zustand: Stufe2Zustand; aktiv: boolean }): React.ReactElement {
  if (!zustand.einsatzbereit) {
    return (
      <div className="meldung">
        <h3>Noch nicht eingerichtet</h3>
        <p>
          {zustand.ollama.erreichbar
            ? `Ollama läuft, aber das Modell ${zustand.vorschlag.modell} ist nicht geladen.`
            : (zustand.ollama.grund ?? 'Ollama ist nicht erreichbar.')}
        </p>

        <p className="hilfetext">
          Erkannt: {zustand.hardware.speicherGb} GB Arbeitsspeicher, {beschleunigungText(zustand.hardware.beschleunigung)}.
          Vorgeschlagen wird <strong>{zustand.vorschlag.modell}</strong> ({zustand.vorschlag.groesseGb} GB) —{' '}
          {zustand.vorschlag.begruendung}
        </p>

        {zustand.schritte.length > 0 && (
          <>
            <h4>Was zu tun ist</h4>
            <ol>
              {zustand.schritte.map((schritt) => (
                <li key={schritt.text}>
                  {schritt.text}
                  {schritt.befehl && <pre>{schritt.befehl}</pre>}
                </li>
              ))}
            </ol>
          </>
        )}

        <OhneStufe2 kriterien={zustand.entfaelltOhneStufe2} />
      </div>
    );
  }

  return (
    <>
      <p className="hilfetext">
        Bereit: {zustand.vorschlag.modell} über Ollama {zustand.ollama.version ?? ''}, {zustand.hardware.speicherGb} GB
        Arbeitsspeicher. Erwartet werden {zustand.vorschlag.erwartetesTempo}.
      </p>

      {/*
        role="status": Die Warnung erscheint erst, wenn der Zustand abgerufen
        ist — also nach dem Laden der Seite. Ohne Live-Bereich bekaeme sie
        niemand mit, der nicht hinsieht. Die eigene Selbstpruefung hat genau
        das gemeldet.
      */}
      {zustand.vorschlag.warnung && (
        <p className="meldung meldung--entwurf" role="status">
          {zustand.vorschlag.warnung}
        </p>
      )}

      {aktiv ? (
        <p className="hilfetext">
          Die Prüfung dauert damit deutlich länger — rechnen Sie mit Minuten je Seite statt Sekunden. Die Ergebnisse der
          automatischen Stufe erscheinen vorab.
        </p>
      ) : (
        <OhneStufe2 kriterien={zustand.entfaelltOhneStufe2} />
      )}
    </>
  );
}

/** L-47: Was ohne Stufe 2 nicht automatisch bewertet wird. */
function OhneStufe2({ kriterien }: { kriterien: string[] }): React.ReactElement | null {
  if (kriterien.length === 0) return null;

  return (
    <details>
      <summary>Was ohne Sprachmodell offen bleibt ({kriterien.length} Kriterien)</summary>
      <p>
        Diese Kriterien werden nicht automatisch inhaltlich bewertet. Sie verschwinden nicht — sie tragen den Status
        „Prüfung erforderlich“ und gehören in die manuelle Liste:
      </p>
      <p>
        <code>{kriterien.join(', ')}</code>
      </p>
    </details>
  );
}

function beschleunigungText(art: string): string {
  switch (art) {
    case 'apple-silicon':
      return 'Apple Silicon mit gemeinsamem Speicher';
    case 'grafikkarte':
      return 'mit Grafikkarte';
    default:
      return 'ohne Grafikbeschleunigung';
  }
}
