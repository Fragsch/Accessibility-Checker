/**
 * Die geführte manuelle Prüfliste (PRD 6.4).
 *
 * Was diese Ansicht leisten muss, damit sie benutzt wird: **eine Frage nach
 * der anderen, mit dem Kontext daneben.** Eine Liste von vierzig Fragen ohne
 * Kontext ist keine Prüfliste, sondern eine Ausrede, es sein zu lassen.
 *
 * Beantwortete Fragen verschwinden nicht — sie rutschen nach unten und lassen
 * sich zurücknehmen. Wer sich vertan hat, soll das ohne Umweg richtigstellen
 * können.
 */

import { useState } from 'react';

import { ApiFehler, beantworteFrage, nimmAntwortZurueck } from '../api';
import type { Antwortwert, BeantworteteFrage, Fragenliste, GebuendelteFrage, Kriterium } from '../typen';

interface Eigenschaften {
  scanId: number;
  liste: Fragenliste;
  kriterien: Kriterium[];
  beiAenderung: () => void;
}

const ANTWORTEN: { wert: Antwortwert; beschriftung: string; erlaeuterung: string }[] = [
  { wert: 'erfuellt', beschriftung: 'erfüllt', erlaeuterung: 'Die Anforderung ist hier eingehalten.' },
  { wert: 'nicht_erfuellt', beschriftung: 'nicht erfüllt', erlaeuterung: 'Die Anforderung ist hier verletzt.' },
  { wert: 'nicht_anwendbar', beschriftung: 'nicht anwendbar', erlaeuterung: 'Auf dieser Seite gegenstandslos.' },
];

export function Pruefliste({ scanId, liste, kriterien, beiAenderung }: Eigenschaften): React.ReactElement {
  const [fehler, setzeFehler] = useState<string | null>(null);
  const nachId = new Map(kriterien.map((k) => [k.id, k]));

  async function antworte(frage: GebuendelteFrage, wert: Antwortwert, notiz: string): Promise<void> {
    setzeFehler(null);
    try {
      // Auf allen Seiten beantworten, auf denen die Frage offen ist (M-07).
      for (const url of frage.seiten) {
        await beantworteFrage(scanId, {
          url,
          kriterium: frage.frage.kriterium,
          frageHash: frage.frage.id,
          antwort: wert,
          notiz: notiz.trim() || null,
        });
      }
      beiAenderung();
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  async function nimmZurueck(url: string, frageHash: string): Promise<void> {
    setzeFehler(null);
    try {
      await nimmAntwortZurueck(scanId, url, frageHash);
      beiAenderung();
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  const { offen, beantwortet, fortschritt } = liste;

  return (
    <section aria-label="Geführte Prüfliste">
      <h2>Manuelle Prüfliste</h2>

      <p aria-live="polite">
        {fortschritt.beantwortet} von {fortschritt.gesamt} Fragen beantwortet
        {fortschritt.offen > 0 ? `, ${fortschritt.offen} offen` : ' — nichts mehr offen'}.
      </p>

      {fehler && (
        <div className="meldung meldung--fehler" role="alert">
          <p>{fehler}</p>
        </div>
      )}

      {offen.length === 0 && beantwortet.length === 0 && (
        <p>Zu diesem Scan gibt es keine manuellen Fragen.</p>
      )}

      {offen.length > 0 && (
        <>
          <h3>Offen ({offen.length})</h3>

          {/*
            Die Bedeutung der drei Antworten steht sichtbar hier — einmal, nicht
            als title-Attribut an jedem Knopf. Ein Browser-Tooltip laesst sich
            nicht mit Escape schliessen, nicht mit dem Zeiger erreichen und
            erscheint bei Beruehrungsbedienung gar nicht (1.4.13). Die eigene
            Selbstpruefung hat das prompt gemeldet.
          */}
          <dl className="antwortlegende">
            {ANTWORTEN.map((a) => (
              <div key={a.wert}>
                <dt>{a.beschriftung}</dt>
                <dd>{a.erlaeuterung}</dd>
              </div>
            ))}
          </dl>
          <ul className="fragenliste">
            {offen.map((eintrag) => (
              <Frage
                key={eintrag.frage.id}
                eintrag={eintrag}
                kriterium={nachId.get(eintrag.frage.kriterium)}
                beiAntwort={(wert, notiz) => void antworte(eintrag, wert, notiz)}
              />
            ))}
          </ul>
        </>
      )}

      {beantwortet.length > 0 && (
        <>
          <h3>Beantwortet ({beantwortet.length})</h3>
          <ul className="fragenliste">
            {beantwortet.map((eintrag) => (
              <BeantworteteZeile
                key={`${eintrag.url}-${eintrag.frage.id}`}
                eintrag={eintrag}
                kriterium={nachId.get(eintrag.frage.kriterium)}
                beiRuecknahme={() => void nimmZurueck(eintrag.url, eintrag.frage.id)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface FrageEigenschaften {
  eintrag: GebuendelteFrage;
  kriterium: Kriterium | undefined;
  beiAntwort: (wert: Antwortwert, notiz: string) => void;
}

function Frage({ eintrag, kriterium, beiAntwort }: FrageEigenschaften): React.ReactElement {
  const [notiz, setzeNotiz] = useState('');
  const { frage, seiten } = eintrag;
  const notizId = `notiz-${frage.id}`;

  return (
    <li className="frage">
      <h4>
        <span className="kriterium__kennung">{frage.kriterium}</span> {kriterium?.titel ?? ''}
      </h4>

      <p className="frage__text">{frage.frage}</p>

      {frage.begruendung && (
        <p className="hinweis">
          <strong>Das Sprachmodell meint:</strong> {frage.begruendung}{' '}
          <span className="hilfetext">(Meinung, keine Feststellung — Sie entscheiden.)</span>
        </p>
      )}

      {/* M-01 und M-05: der Kontext gehört zur Frage, nicht in eine eigene Suche. */}
      {frage.kontextSelektor && (
        <p className="hilfetext">
          Betroffene Stellen: <code>{frage.kontextSelektor}</code>
          {frage.betroffeneElemente !== null && ` (${frage.betroffeneElemente} Element(e))`}
        </p>
      )}

      {frage.kontext && frage.kontext.length > 0 && (
        <details className="aufklappbar">
          <summary>Kontext ansehen ({frage.kontext.length} Probe(n))</summary>
          <ul className="probenliste">
            {frage.kontext.map((probe, nummer) => (
              <li key={`${frage.id}-${nummer}`}>
                <code>{probe}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="hilfetext">
        {seiten.length === 1 ? (
          <a href={seiten[0]} target="_blank" rel="noreferrer">
            Seite öffnen
          </a>
        ) : (
          `Gilt für ${seiten.length} Seiten — eine Antwort beantwortet sie alle.`
        )}
      </p>

      <div className="feldgruppe">
        <label htmlFor={notizId}>Notiz (freiwillig)</label>
        <input
          type="text"
          id={notizId}
          value={notiz}
          onChange={(e) => setzeNotiz(e.target.value)}
          placeholder="Was Sie festgestellt haben"
        />
      </div>

      <div className="knopfreihe">
        {ANTWORTEN.map((antwort) => (
          // Alle drei Antworten gleich gewichtet: Ein Prüfwerkzeug darf keine
          // nahelegen. Eine hervorgehobene Schaltfläche wäre ein Vorschlag,
          // und der hätte hier nichts zu suchen.
          <button
            key={antwort.wert}
            type="button"
            className="zweitrangig"
            onClick={() => beiAntwort(antwort.wert, notiz)}
          >
            {antwort.beschriftung}
          </button>
        ))}
      </div>
    </li>
  );
}

function BeantworteteZeile({
  eintrag,
  kriterium,
  beiRuecknahme,
}: {
  eintrag: BeantworteteFrage & { url: string };
  kriterium: Kriterium | undefined;
  beiRuecknahme: () => void;
}): React.ReactElement {
  const beschriftung = ANTWORTEN.find((a) => a.wert === eintrag.antwort)?.beschriftung ?? eintrag.antwort;

  return (
    <li className="frage frage--beantwortet">
      <h4>
        <span className="kriterium__kennung">{eintrag.frage.kriterium}</span> {kriterium?.titel ?? ''}
      </h4>
      <p className="frage__text">{eintrag.frage.frage}</p>
      <p>
        <span className={`status status--${eintrag.antwort}`}>Beantwortet mit: {beschriftung}</span>
      </p>
      {eintrag.notiz && <p className="hilfetext">Notiz: {eintrag.notiz}</p>}
      <div className="knopfreihe">
        <button type="button" className="zweitrangig" onClick={beiRuecknahme}>
          Antwort zurücknehmen
        </button>
      </div>
    </li>
  );
}
