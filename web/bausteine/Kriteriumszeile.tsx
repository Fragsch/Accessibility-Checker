/**
 * Ein Erfolgskriterium in der Ergebnisliste: Uebersicht aufklappbar zu Detail
 * und Handlungsempfehlung.
 *
 * Aufgeklappt wird mit `details`/`summary`. Das ist von Haus aus mit der
 * Tastatur bedienbar und wird von Screenreadern richtig angesagt — semantisches
 * HTML vor ARIA (ARCHITEKTUR 7).
 */

import type { Bewertung, Kriterium } from '../typen';
import { Statuszeichen } from './Statuszeichen';

interface Eigenschaften {
  kriterium: Kriterium;
  bewertung: Bewertung;
}

export function Kriteriumszeile({ kriterium, bewertung }: Eigenschaften): React.ReactElement {
  const offenePunkte = bewertung.hinweise.length + bewertung.offeneFragen.length;

  return (
    <li>
      <details className="kriterium">
        <summary>
          <span className="kriterium__kennung">{kriterium.id}</span>
          <span className="kriterium__titel">{kriterium.titel}</span>
          <span className="kriterium__level">Level {kriterium.level}</span>
          <Statuszeichen status={bewertung.status} />
        </summary>

        <div className="kriterium__inhalt">
          <p>{kriterium.beschreibung}</p>

          {bewertung.befunde.length > 0 && (
            <section aria-label={`Belegte Verstöße bei ${kriterium.id}`}>
              <h3>
                {bewertung.befunde.length} belegte{bewertung.befunde.length === 1 ? 'r Verstoß' : ' Verstöße'}
              </h3>
              <ul className="befundliste">
                {bewertung.befunde.map((befund, nummer) => (
                  <li className="befund" key={`${befund.selektor ?? ''}-${nummer}`}>
                    <span className="schwere">{schwereText(befund.schwere)}:</span> {befund.beschreibung}
                    {befund.selektor && (
                      <code className="befund__stelle">
                        <span className="nur-fuer-screenreader">Fundstelle: </span>
                        {befund.selektor}
                      </code>
                    )}
                    {befund.htmlAusschnitt && <pre>{befund.htmlAusschnitt}</pre>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {offenePunkte > 0 && (
            <section aria-label={`Offene Punkte bei ${kriterium.id}`}>
              <h3>
                {offenePunkte} offene{offenePunkte === 1 ? 'r Punkt' : ' Punkte'}
              </h3>
              <ul className="hinweisliste">
                {bewertung.offeneFragen.map((frage) => (
                  <li className="hinweis" key={frage.frage}>
                    {frage.frage}
                  </li>
                ))}
                {bewertung.hinweise.map((hinweis, nummer) => (
                  <li className="hinweis" key={`${hinweis.herkunft}-${nummer}`}>
                    {hinweis.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {bewertung.status !== 'nicht_anwendbar' && <Empfehlung kriterium={kriterium} />}

          <p className="hilfetext">Geprüft über: {bewertung.herkunft}</p>
        </div>
      </details>
    </li>
  );
}

function Empfehlung({ kriterium }: { kriterium: Kriterium }): React.ReactElement {
  const { empfehlung } = kriterium;

  return (
    <section className="empfehlung" aria-label={`Handlungsempfehlung zu ${kriterium.id}`}>
      <h3>Was zu tun ist</h3>
      <p>{empfehlung.text}</p>

      {empfehlung.codeBeispiel && (
        <dl className="codevergleich">
          <div>
            <dt>So nicht</dt>
            <dd>
              <pre>{empfehlung.codeBeispiel.vorher}</pre>
            </dd>
          </div>
          <div>
            <dt>Sondern so</dt>
            <dd>
              <pre>{empfehlung.codeBeispiel.nachher}</pre>
            </dd>
          </div>
        </dl>
      )}

      {empfehlung.referenzen.length > 0 && (
        <>
          <h4>Zum Nachlesen</h4>
          <ul className="referenzen">
            {empfehlung.referenzen.map((referenz) => (
              <li key={referenz.url}>
                <a href={referenz.url} target="_blank" rel="noreferrer">
                  {referenz.titel}
                  <span className="nur-fuer-screenreader"> (öffnet in neuem Tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function schwereText(schwere: string): string {
  const texte: Record<string, string> = {
    kritisch: 'Kritisch',
    ernst: 'Ernst',
    maessig: 'Mäßig',
    gering: 'Gering',
  };
  return texte[schwere] ?? schwere;
}
