/**
 * Die gemessene Abdeckung des Werkzeugs (PRD 10, Phase 8).
 *
 * Diese Ansicht ist die Selbstauskunft des Werkzeugs: **Wo bin ich
 * nachweislich zuverlässig, und wo nicht?** Sie steht nicht bei einem
 * einzelnen Ergebnis, sondern für sich — sie gilt für jedes Ergebnis
 * gleichermaßen.
 *
 * Die Zahlen sind gemessen, nicht geschätzt. Erzeugt werden sie von
 * `npm run verifikation`; liegt keine Messung vor, sagt die Ansicht genau das.
 * Eine Behauptung ohne Messung wäre schlechter als eine Leerstelle — sie sähe
 * aus wie eine Zusage.
 */

import { useEffect, useState } from 'react';

import { ApiFehler, ladeAbdeckung } from '../api';
import type { Abdeckungsmatrix, Einstufung, Kriterium } from '../typen';

interface Eigenschaften {
  /** Der geladene Katalog liefert die Titel. Fehlt er, stehen nur die Kennungen. */
  kriterien: Kriterium[];
  beiZurueck: () => void;
}

const EINSTUFUNG_TEXT: Record<Einstufung, string> = {
  belegt: 'Verstöße werden belegt erkannt',
  teilweise: 'teils belegt, teils zur Prüfung vorgelegt',
  nur_hinweis: 'wird immer zur Prüfung vorgelegt',
  luecke: 'gemessene Lücke — ein Verstoß blieb unbemerkt',
  ungeprueft: 'nicht gemessen',
};

/** Reihenfolge der Gruppen in der Anzeige: erst die Lücken, zuletzt das Sichere. */
const REIHENFOLGE: Einstufung[] = ['luecke', 'ungeprueft', 'nur_hinweis', 'teilweise', 'belegt'];

const GRUPPENTITEL: Record<Einstufung, string> = {
  luecke: 'Gemessene Lücken',
  ungeprueft: 'Nicht gemessen',
  nur_hinweis: 'Wird immer zur Prüfung vorgelegt',
  teilweise: 'Teilweise belegt',
  belegt: 'Verstöße werden belegt erkannt',
};

const GRUPPENTEXT: Record<Einstufung, string> = {
  luecke:
    'Hier hat das Werkzeug einen eingebauten Verstoß übersehen und das Kriterium als erfüllt geführt. Das ist ' +
    'der einzige Wert in dieser Übersicht, der ein Versagen beschreibt — ein Ergebnis zu diesen Kriterien ist ' +
    'nicht belastbar.',
  ungeprueft:
    'Zu diesen Kriterien gibt es keinen Testfall. Meist liegt das daran, dass sich die Frage am Inhalt ' +
    'entscheidet und nicht am Markup — eine Referenzseite könnte dort nichts belegen. Was das Werkzeug hier ' +
    'meldet, ist ungemessen.',
  nur_hinweis:
    'Diese Kriterien werden nie automatisch als Verstoß belegt. Das Werkzeug legt sie stattdessen dem ' +
    'Sprachmodell oder der prüfenden Person vor. Sie bleiben offen, bis jemand sie beantwortet — das ist so ' +
    'gewollt und kein Mangel.',
  teilweise:
    'Ein Teil der eingebauten Verstöße wurde belegt, der Rest zur Prüfung vorgelegt. Ein „erfüllt" zu diesen ' +
    'Kriterien trägt weniger weit als bei den belegten.',
  belegt:
    'Jeder eingebaute Verstoß wurde als belegter Verstoß gemeldet. Auch hier gilt: Belegt wird das Vorliegen ' +
    'eines Mangels, nie dessen Abwesenheit.',
};

export function Abdeckungsansicht({ kriterien, beiZurueck }: Eigenschaften): React.ReactElement {
  const [matrix, setzeMatrix] = useState<Abdeckungsmatrix | null>(null);
  const [hinweis, setzeHinweis] = useState<string | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [geladen, setzeGeladen] = useState(false);

  useEffect(() => {
    let abgemeldet = false;

    void ladeAbdeckung()
      .then((antwort) => {
        if (abgemeldet) return;
        setzeMatrix(antwort.matrix);
        setzeHinweis(antwort.hinweis ?? null);
      })
      .catch((e: unknown) => {
        if (!abgemeldet) setzeFehler(e instanceof ApiFehler ? e.message : String(e));
      })
      .finally(() => {
        if (!abgemeldet) setzeGeladen(true);
      });

    return () => {
      abgemeldet = true;
    };
  }, []);

  const titelVon = (id: string): string => kriterien.find((k) => k.id === id)?.titel ?? '';

  if (fehler) {
    return (
      <div className="meldung meldung--fehler" role="alert">
        <p>{fehler}</p>
      </div>
    );
  }

  if (!geladen) return <p>Die Messwerte werden geladen …</p>;

  if (!matrix) {
    return (
      <>
        <div className="meldung" role="status">
          <p>{hinweis ?? 'Es liegt keine Messung der Abdeckung vor.'}</p>
          <p>
            Solange nicht gemessen wurde, kann das Werkzeug über seine eigene Zuverlässigkeit nichts sagen. Die
            Messung erzeugt <code>npm run verifikation</code>; sie läuft über die Referenzseiten in{' '}
            <code>test/referenzseiten/</code> und dauert einige Minuten.
          </p>
        </div>
        <div className="knopfreihe">
          <button type="button" onClick={beiZurueck}>
            Zurück
          </button>
        </div>
      </>
    );
  }

  const k = matrix.kennzahlen;
  const eintraege = Object.entries(matrix.kriterien);

  return (
    <>
      <p>
        Diese Zahlen stammen aus einem Lauf gegen {matrix.referenzseiten.length} Referenzseiten mit bekannter
        Fehlerlage, gemessen am {datum(matrix.gemessenAm)} mit {matrix.werkzeug} unter WCAG {matrix.standard}. Sie
        sagen, wie belastbar ein Ergebnis dieses Werkzeugs je Kriterium ist.
      </p>

      <dl className="zaehlung">
        <div>
          <dt>Kriterien mit Testfall</dt>
          <dd className="zahl">
            {k.mitTestfall} von {k.kriterienGesamt}
          </dd>
        </div>
        <div>
          <dt>Verstöße belegt erkannt</dt>
          <dd className="zahl">{Math.round(k.erkennungsquote * 100)} %</dd>
        </div>
        <div>
          <dt>Davon in der Automatik</dt>
          <dd className="zahl">{Math.round(k.erkennungsquoteAuto * 100)} %</dd>
        </div>
        <div>
          <dt>Übersehen</dt>
          <dd className="zahl">{k.uebersehen}</dd>
        </div>
        <div>
          <dt>Fehlalarme</dt>
          <dd className="zahl">{k.fehlalarme}</dd>
        </div>
      </dl>

      <div className="meldung" role="note">
        <p>
          <strong>Übersehen wiegt schwerer als offen.</strong> Ein Kriterium, das offen bleibt, kostet manuelle
          Arbeit. Eines, das fälschlich als erfüllt gilt, kostet die Gültigkeit des ganzen Berichts. Nur das Zweite
          ist ein Fehler des Werkzeugs.
        </p>
      </div>

      {REIHENFOLGE.map((einstufung) => {
        const gruppe = eintraege.filter(([, zeile]) => zeile.einstufung === einstufung);
        if (gruppe.length === 0) return null;

        return (
          <section key={einstufung}>
            <h3>
              {GRUPPENTITEL[einstufung]} ({gruppe.length})
            </h3>
            <p className="hilfetext">{GRUPPENTEXT[einstufung]}</p>

            <div
              className="tabellenrahmen"
              tabIndex={0}
              role="region"
              aria-label={`${GRUPPENTITEL[einstufung]} — Kriterien im Einzelnen`}
            >
              <table className="tabelle">
                <caption className="nur-fuer-screenreader">
                  {GRUPPENTITEL[einstufung]} — Kriterien im Einzelnen
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Kriterium</th>
                    <th scope="col">Vorgesehene Stufen</th>
                    <th scope="col">Testfälle</th>
                    <th scope="col">Belegt</th>
                    <th scope="col">Offen</th>
                    <th scope="col">Übersehen</th>
                  </tr>
                </thead>
                <tbody>
                  {gruppe.map(([id, zeile]) => (
                    <tr key={id}>
                      <th scope="row">
                        {id} {titelVon(id)}
                      </th>
                      <td>{zeile.stufen.map((s) => STUFE_TEXT[s]).join(', ')}</td>
                      <td>{zeile.testfaelle}</td>
                      <td>{zeile.belegtErkannt}</td>
                      <td>{zeile.alsOffenGemeldet}</td>
                      <td>{zeile.uebersehen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <h3>Woran gemessen wurde</h3>
      <ul className="probenliste">
        {matrix.referenzseiten.map((seite) => (
          <li key={seite.datei}>
            <strong>{seite.datei}</strong>
            {seite.zweck ? ` — ${seite.zweck}` : ''}{' '}
            <span className="hilfetext">
              ({seite.sollverstoesse === 0 ? 'befundfrei erwartet' : `${seite.sollverstoesse} eingebaute Verstöße`})
            </span>
          </li>
        ))}
      </ul>

      <p className="hilfetext">
        Die Einstufung „{EINSTUFUNG_TEXT.belegt}" bezieht sich immer auf die eingebauten Verstöße dieser Seiten. Ein
        Werkzeug, das nur auf eigens gebauten Testseiten funktioniert, wäre wertlos — deshalb steht neben jeder
        mangelhaften Seite eine inhaltsgleiche saubere Fassung, an der Fehlalarme sichtbar werden.
      </p>

      <div className="knopfreihe">
        <button type="button" onClick={beiZurueck}>
          Zurück
        </button>
      </div>
    </>
  );
}

const STUFE_TEXT: Record<string, string> = {
  auto: 'automatisch',
  llm: 'Sprachmodell',
  manuell: 'manuell',
};

function datum(iso: string): string {
  const wert = new Date(iso);
  if (Number.isNaN(wert.getTime())) return iso;
  return wert.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
