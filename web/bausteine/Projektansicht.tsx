/**
 * Verdichtete Sicht über alle geprüften Seiten (E-20 bis E-26).
 *
 * Bei Prüfprofil und Gesamtprüfung gilt beides zugleich: Jede Seite behält
 * ihre eigenständige Bewertung, zusätzlich entsteht diese Projektebene. Der
 * Wechsel zwischen beiden Sichten bleibt jederzeit möglich (E-23).
 *
 * Die Musterkennung ist der eigentliche Gewinn: Ein fehlerhafter Sprunglink im
 * Kopfbereich erscheint auf 25 Seiten. Ohne Zusammenfassung liest sich das als
 * 25 Probleme — tatsächlich ist es eine Zeile Code.
 */

import { useMemo } from 'react';

import type { Kriterium, Projektansicht as Ansicht, Status } from '../typen';
import { BAUSTEIN_TEXT, STATUS_TEXT, STATUS_ZEICHEN } from '../typen';

interface Eigenschaften {
  ansicht: Ansicht;
  kriterien: Kriterium[];
  /** Sprung in die Einzelseiten-Ansicht (E-22, E-23). */
  beiSeitensprung: (url: string) => void;
}

export function Projektansicht({ ansicht, kriterien, beiSeitensprung }: Eigenschaften): React.ReactElement {
  const nachKriterium = useMemo(() => new Map(kriterien.map((k) => [k.id, k])), [kriterien]);
  const seitenGesamt = ansicht.seiten.filter((s) => s.zustand === 'fertig').length;

  const auffaellige = ansicht.projektebene.filter(
    (bewertung) => bewertung.status === 'nicht_erfuellt' || bewertung.status === 'pruefung_erforderlich',
  );

  return (
    <>
      <h3>Projektebene</h3>
      <p className="hilfetext">
        Verdichtet über {seitenGesamt} geprüfte {seitenGesamt === 1 ? 'Seite' : 'Seiten'}. Ein Kriterium gilt hier als
        nicht erfüllt, sobald es auf mindestens einer Seite nicht erfüllt ist.
      </p>

      {auffaellige.length === 0 ? (
        <p>Auf Projektebene ist nichts offen und nichts belegt verletzt.</p>
      ) : (
        <div className="tabellenrahmen" tabIndex={0} role="region" aria-label="Kriterien mit Verstößen oder offenen Punkten">
          <table className="tabelle">
            <caption className="nur-fuer-screenreader">Kriterien mit Verstößen oder offenen Punkten</caption>
            <thead>
              <tr>
                <th scope="col">Kriterium</th>
                <th scope="col">Status</th>
                <th scope="col">Betroffene Seiten</th>
              </tr>
            </thead>
            <tbody>
              {auffaellige.map((bewertung) => (
                <tr key={bewertung.kriterium}>
                  <th scope="row">
                    {bewertung.kriterium} {nachKriterium.get(bewertung.kriterium)?.titel ?? ''}
                  </th>
                  <td className={`status--${bewertung.status}`}>
                    <span className="status__zeichen" aria-hidden="true">
                      {STATUS_ZEICHEN[bewertung.status as Status]}
                    </span>
                    {STATUS_TEXT[bewertung.status as Status]}
                  </td>
                  <td>
                    {bewertung.betroffeneSeiten.length} von {bewertung.anwendbareSeiten}
                    {bewertung.betroffeneSeiten.length > 0 && (
                      <ul className="seitenliste">
                        {bewertung.betroffeneSeiten.map((url) => (
                          <li key={url}>
                            <button type="button" className="alsverweis" onClick={() => beiSeitensprung(url)}>
                              {url}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Wiederkehrende Befunde</h3>
      {ansicht.muster.length === 0 ? (
        <p>Kein Befund tritt mehrfach auf.</p>
      ) : (
        <>
          <p className="hilfetext">
            Gleichartige Befunde stehen hier als ein Eintrag mit Seitenliste — nicht als je ein Befund pro Seite. Was
            auf vielen Seiten an derselben Stelle auftritt, ist meist ein Vorlagenfehler und einmal zu beheben.
          </p>
          <ul className="musterliste">
            {ansicht.muster
              .filter((muster) => muster.seiten.length > 1)
              .map((muster) => (
                <li key={muster.hash}>
                  <h4>
                    {muster.befund.kriterium} — {muster.befund.beschreibung}
                  </h4>
                  <p className="hilfetext">
                    Auf {muster.seiten.length} Seiten. Herkunft: {muster.befund.engine}/{muster.befund.regelId}.
                    {muster.baustein ? ` Vermutlich im Baustein: ${BAUSTEIN_TEXT[muster.baustein]}.` : ''}
                  </p>
                  {muster.befund.selektor && (
                    <p>
                      <code>{muster.befund.selektor}</code>
                    </p>
                  )}
                  <details className="aufklappbar">
                    <summary>Betroffene Seiten ({muster.seiten.length})</summary>
                    <ul className="seitenliste">
                      {muster.seiten.map((url) => (
                        <li key={url}>
                          <button type="button" className="alsverweis" onClick={() => beiSeitensprung(url)}>
                            {url}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
          </ul>
          {ansicht.muster.every((muster) => muster.seiten.length <= 1) && (
            <p>Kein Befund tritt auf mehr als einer Seite auf.</p>
          )}
        </>
      )}

      <h3>Seiten nach Fehlerlast</h3>
      {ansicht.rangliste.length === 0 ? (
        <p>Keine Seite konnte bewertet werden.</p>
      ) : (
        <div className="tabellenrahmen" tabIndex={0} role="region" aria-label="Seiten nach Anzahl und Schwere der Verstöße">
          <table className="tabelle">
            <caption className="nur-fuer-screenreader">Seiten nach Anzahl und Schwere der Verstöße</caption>
            <thead>
              <tr>
                <th scope="col">Seite</th>
                <th scope="col">Verstöße</th>
                <th scope="col">Gewicht</th>
                <th scope="col">Offen</th>
              </tr>
            </thead>
            <tbody>
              {ansicht.rangliste.map((rang) => (
                <tr key={rang.url}>
                  <th scope="row">
                    <button type="button" className="alsverweis" onClick={() => beiSeitensprung(rang.url)}>
                      {rang.bezeichnung ?? rang.url}
                    </button>
                  </th>
                  <td>{rang.verstoesse}</td>
                  <td>{rang.gewicht}</td>
                  <td>{rang.offen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hilfetext">
        Das Gewicht summiert die Schwere aller Befunde. Zehn geringe Mängel sind nicht dasselbe wie zwei kritische —
        wer die Liste von oben abarbeitet, kommt am schnellsten voran.
      </p>
    </>
  );
}
