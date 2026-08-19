/**
 * Bericht erzeugen und ausgeben (X-02 bis X-06).
 *
 * Die Ansicht zeigt zuerst, **was im Bericht stehen wird** — Kennzahlen und
 * Vermerke —, und erst danach die Ausgabewege. Diese Reihenfolge ist Absicht:
 * Ein Bericht ist eine Aussage gegenüber Dritten. Wer ihn herunterlädt, soll
 * vorher gesehen haben, dass er als Entwurf gekennzeichnet ist und warum.
 *
 * Die Formate sind Verweise, keine Knöpfe mit Ladebalken. Der Browser lädt
 * damit selbst herunter, und das PDF wird erst erzeugt, wenn es jemand
 * anfordert — es dauert einige Sekunden.
 */

import { useEffect, useState } from 'react';

import { ApiFehler, berichtAdresse, ladeBerichtsdaten } from '../api';
import type { Berichtsdaten, Berichtsumfang, ScanErgebnis } from '../typen';

interface Eigenschaften {
  scanId: number;
  ergebnis: ScanErgebnis;
}

const FORMATE: { format: 'html' | 'pdf' | 'earl' | 'erklaerung'; titel: string; erlaeuterung: string }[] = [
  {
    format: 'html',
    titel: 'Bericht als HTML',
    erlaeuterung:
      'Eine eigenständige Datei ohne Verweise nach außen. Die Belege sind aus der Konformitätstabelle heraus ' +
      'aufklappbar.',
  },
  {
    format: 'pdf',
    titel: 'Bericht als PDF',
    erlaeuterung: 'Derselbe Bericht, linear gesetzt und mit Seitenzahlen. Die Erzeugung dauert einige Sekunden.',
  },
  {
    format: 'earl',
    titel: 'Rohdaten als EARL',
    erlaeuterung:
      'JSON im EARL-Vokabular des W3C — für Werkzeuge, die Ergebnisse zusammenführen oder über die Zeit ' +
      'vergleichen.',
  },
  {
    format: 'erklaerung',
    titel: 'Erklärung zur Barrierefreiheit (Entwurf)',
    erlaeuterung:
      'Vorlage nach § 12b BGG. Was das Werkzeug nicht wissen kann, steht in eckigen Klammern und ist von Hand ' +
      'zu ergänzen.',
  },
];

export function Berichtsansicht({ scanId, ergebnis }: Eigenschaften): React.ReactElement {
  const [daten, setzeDaten] = useState<Berichtsdaten | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [seite, setzeSeite] = useState<string>('');
  const [person, setzePerson] = useState<string>('');

  const umfang: Berichtsumfang = seite ? { art: 'seite', url: seite } : { art: 'projekt' };
  const gepruefteSeiten = ergebnis.seiten.filter((s) => s.zustand === 'fertig');

  useEffect(() => {
    let abgemeldet = false;

    ladeBerichtsdaten(scanId, seite ? { art: 'seite', url: seite } : { art: 'projekt' })
      .then((geladen) => {
        if (!abgemeldet) {
          setzeDaten(geladen);
          setzeFehler(null);
        }
      })
      .catch((e: unknown) => {
        if (!abgemeldet) setzeFehler(e instanceof ApiFehler ? e.message : String(e));
      });

    return () => {
      abgemeldet = true;
    };
  }, [scanId, seite]);

  if (fehler) {
    return (
      <div className="meldung meldung--fehler" role="alert">
        <h3>Der Bericht konnte nicht vorbereitet werden</h3>
        <p>{fehler}</p>
      </div>
    );
  }

  if (!daten) return <p>Der Bericht wird vorbereitet …</p>;

  const k = daten.zusammenfassung.kennzahlen;

  return (
    <>
      <h3>Bericht</h3>
      <p className="hilfetext">
        Nach WCAG-EM gegliedert, mit der Bewertungssprache des ACR. Alle Angaben stammen aus dieser Prüfung; der
        Bericht enthält nichts, was nicht geprüft wurde.
      </p>

      {daten.deckblatt.entwurf && (
        <div className="meldung" role="status">
          <h4>
            Entwurf — {daten.deckblatt.offeneKriterien} von {daten.deckblatt.kriterienGesamt} Kriterien sind nicht
            abschließend bewertet
          </h4>
          <p>
            Der Bericht behauptet keine Konformität, solange Kriterien den Status „Prüfung erforderlich“ tragen.
            Arbeiten Sie die manuelle Prüfliste ab; danach entsteht der Bericht ohne diesen Vermerk.
          </p>
        </div>
      )}

      <h4>Was im Bericht stehen wird</h4>
      <div className="tabellenrahmen" tabIndex={0} role="region" aria-label="Kennzahlen des Berichts">
        <table className="tabelle">
          <caption className="nur-fuer-screenreader">Erfolgskriterien nach ACR-Bewertung</caption>
          <thead>
            <tr>
              <th scope="col">Bewertung</th>
              <th scope="col">Anzahl</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Unterstützt</th>
              <td>{k.erfuellt}</td>
            </tr>
            <tr>
              <th scope="row">Unterstützt nicht oder teilweise</th>
              <td>{k.nichtErfuellt}</td>
            </tr>
            <tr>
              <th scope="row">Nicht abschließend bewertet</th>
              <td>{k.pruefungErforderlich}</td>
            </tr>
            <tr>
              <th scope="row">Nicht anwendbar</th>
              <td>{k.nichtAnwendbar}</td>
            </tr>
            <tr>
              <th scope="row">Gesamt</th>
              <td>{k.gesamt}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {daten.vermerke.length > 0 && (
        <>
          <h4>Vermerke im Bericht</h4>
          <ul className="vermerkliste">
            {daten.vermerke.map((vermerk) => (
              <li key={vermerk.art + vermerk.ueberschrift}>
                <h5>{vermerk.ueberschrift}</h5>
                <p>{vermerk.text}</p>
                {vermerk.kriterien && vermerk.kriterien.length > 0 && (
                  <p className="hilfetext">Betroffen: {vermerk.kriterien.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <fieldset className="feldgruppe">
        <legend>Umfang und Angaben</legend>

        {gepruefteSeiten.length > 1 && (
          <>
            <label htmlFor="bericht-umfang">Umfang</label>
            <select id="bericht-umfang" value={seite} onChange={(e) => setzeSeite(e.target.value)}>
              <option value="">Projektbericht über alle {gepruefteSeiten.length} Seiten</option>
              {gepruefteSeiten.map((s) => (
                <option key={s.url} value={s.url}>
                  Nur: {s.bezeichnung ?? s.titel ?? s.url}
                </option>
              ))}
            </select>
          </>
        )}

        <label htmlFor="bericht-person">Prüfende Person</label>
        <input
          id="bericht-person"
          type="text"
          value={person}
          onChange={(e) => setzePerson(e.target.value)}
          autoComplete="off"
          aria-describedby="person-hilfe"
        />
        <p className="hilfetext" id="person-hilfe">
          Erscheint auf dem Deckblatt. Bleibt das Feld leer, steht dort „nicht angegeben“.
        </p>
      </fieldset>

      <h4>Ausgabe</h4>
      <ul className="formatliste">
        {FORMATE.map((eintrag) => (
          <li key={eintrag.format}>
            <a
              href={berichtAdresse(scanId, eintrag.format, umfang, person || undefined)}
              target="_blank"
              rel="noreferrer"
            >
              {eintrag.titel}
            </a>
            <p className="hilfetext">{eintrag.erlaeuterung}</p>
          </li>
        ))}
      </ul>
      <p className="hilfetext">
        Die Dateien öffnen sich in einem neuen Tab. Sie entstehen auf diesem Rechner und werden nirgendwohin
        übertragen.
      </p>
    </>
  );
}
