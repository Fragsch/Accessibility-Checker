/**
 * Ergebnis eines Scans: Uebersicht, Filter, Kriterienliste.
 *
 * Die Reihenfolge ist bewusst: erst die Zahlen, dann das Dringende. Wer die
 * Seite oeffnet, soll ohne Suchen sehen, was belegt schiefliegt — und daneben,
 * wie viel noch offen ist.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Kriterium, ScanErgebnis, SeitenErgebnis, Status } from '../typen';
import { PRINZIP_TEXT, STATUS_ERLAEUTERUNG, STATUS_REIHENFOLGE, STATUS_TEXT } from '../typen';
import { Kriteriumszeile } from './Kriteriumszeile';

interface Eigenschaften {
  ergebnis: ScanErgebnis;
  kriterien: Kriterium[];
  /** Seite, zu der aus der Projektebene gesprungen wurde (E-22, E-23). */
  angeforderteSeite?: string | null;
}

export function Ergebnisansicht({
  ergebnis,
  kriterien,
  angeforderteSeite = null,
}: Eigenschaften): React.ReactElement {
  const [seitenNummer, setzeSeitenNummer] = useState(0);
  const [gezeigteStatus, setzeGezeigteStatus] = useState<Status[]>([
    'nicht_erfuellt',
    'pruefung_erforderlich',
    'erfuellt',
  ]);

  const gepruefteSeiten = ergebnis.seiten.filter((s) => s.zustand === 'fertig');
  const seite: SeitenErgebnis | undefined = gepruefteSeiten[seitenNummer];

  // Sprung aus der Projektebene: dort steht, auf welchen Seiten ein Kriterium
  // verletzt ist — von dort muss man ohne Suchen zur Seite kommen (E-22).
  useEffect(() => {
    if (!angeforderteSeite) return;
    const nummer = gepruefteSeiten.findIndex((s) => s.url === angeforderteSeite);
    if (nummer >= 0) setzeSeitenNummer(nummer);
  }, [angeforderteSeite, gepruefteSeiten]);

  const zaehlung = useMemo(() => zaehle(seite), [seite]);

  const nachKriterium = useMemo(() => new Map(kriterien.map((k) => [k.id, k])), [kriterien]);

  if (!seite) {
    return (
      <div className="meldung meldung--fehler">
        <h2>Keine Seite konnte geprüft werden</h2>
        <p>
          {ergebnis.seiten.map((s) => s.fehler).find(Boolean) ??
            'Die angegebenen Adressen ließen sich nicht laden. Bitte prüfen Sie die Schreibweise.'}
        </p>
      </div>
    );
  }

  const sichtbar = seite.bewertungen.filter((b) => gezeigteStatus.includes(b.status));

  function schalteStatus(status: Status): void {
    setzeGezeigteStatus((bisher) =>
      bisher.includes(status) ? bisher.filter((s) => s !== status) : [...bisher, status],
    );
  }

  return (
    <>
      {ergebnis.seiten.length > 1 && (
        <fieldset className="feldgruppe">
          <legend>Geprüfte Seite</legend>
          <div className="auswahl">
            {ergebnis.seiten.map((s, nummer) => (
              <label key={s.url}>
                <input
                  type="radio"
                  name="seite"
                  value={nummer}
                  checked={gepruefteSeiten[seitenNummer]?.url === s.url}
                  disabled={s.zustand !== 'fertig'}
                  onChange={() => setzeSeitenNummer(gepruefteSeiten.findIndex((g) => g.url === s.url))}
                />
                {s.bezeichnung ?? s.url}
                {s.zustand === 'fehler' && ' (nicht ladbar)'}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <h2>
        Übersicht
        <span className="nur-fuer-screenreader"> für {seite.url}</span>
      </h2>

      {/*
        Eine Karte, zwei Angaben: worauf sich das Ergebnis bezieht und wie es
        ausfaellt. Die Adresse stand vorher als Hilfetext daneben und ging
        unter — sie ist aber die Voraussetzung dafuer, dass die Zahlen
        darunter ueberhaupt etwas bedeuten.
      */}
      <div className="uebersicht">
        <p className="uebersicht__seite">
          <span className="uebersicht__marke">Geprüfte Seite</span>
          {seite.titel && <span className="uebersicht__titel">„{seite.titel}“</span>}
          <span className="uebersicht__adresse">{seite.url}</span>
        </p>

        {/*
          Eine Definitionsliste, kein Kachelraster aus Absaetzen: Status und
          Anzahl sind Begriff und Wert. Eine grosse fette Zahl in einem Absatz
          waere ausserdem eine Ueberschrift, die keine ist (1.3.1) — das hat die
          Selbstpruefung prompt gemeldet.

          Ohne Zeichen: Auf der Kachel steht der Status ausgeschrieben, damit
          traegt der Text die Aussage und nicht die Farbe (1.4.1). Wo der Status
          knapp neben anderem steht — an einer Kriterienzeile, in der
          Projektebene — bleibt das Zeichen erhalten.
        */}
        <dl className="zaehlung">
          {STATUS_REIHENFOLGE.map((status) => (
            <div key={status} className={`zaehlung__feld status--${status}`}>
              <dt className="status">{STATUS_TEXT[status]}</dt>
              <dd className="zahl">{zaehlung[status]}</dd>
              <dd className="hilfetext">{STATUS_ERLAEUTERUNG[status]}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2>
        Kriterien <span className="hilfetext">({sichtbar.length} von {seite.bewertungen.length} angezeigt)</span>
      </h2>

      {/*
        Der Filter gehoert unter diese Ueberschrift und nicht ueber sie: Er
        steuert, welche Kriterien in der Liste darunter stehen — nichts an der
        Uebersicht.

        Die Beschriftungen tragen keinen Statuspunkt: Zwei runde Zeichen neben
        dem Ankreuzfeld machen die Zeile unruhig, und der Status steht hier
        ohnehin ausgeschrieben.
      */}
      <fieldset className="feldgruppe">
        <legend>Anzeigen</legend>
        <div className="auswahl">
          {STATUS_REIHENFOLGE.map((status) => (
            <label key={status}>
              <input
                type="checkbox"
                checked={gezeigteStatus.includes(status)}
                onChange={() => schalteStatus(status)}
              />
              {STATUS_TEXT[status]} ({zaehlung[status]})
            </label>
          ))}
        </div>
      </fieldset>

      {sichtbar.length === 0 ? (
        <p>Kein Kriterium in der gewählten Auswahl. Bitte oben andere Status hinzunehmen.</p>
      ) : (
        Object.entries(PRINZIP_TEXT).map(([prinzip, ueberschrift]) => {
          const desPrinzips = sichtbar.filter((b) => nachKriterium.get(b.kriterium)?.prinzip === prinzip);
          if (desPrinzips.length === 0) return null;

          return (
            <section className="prinzip" key={prinzip}>
              <h3>{ueberschrift}</h3>
              <ul className="kriterienliste">
                {desPrinzips.map((bewertung) => {
                  const kriterium = nachKriterium.get(bewertung.kriterium);
                  if (!kriterium) return null;
                  return <Kriteriumszeile key={bewertung.kriterium} kriterium={kriterium} bewertung={bewertung} />;
                })}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

function zaehle(seite: SeitenErgebnis | undefined): Record<Status, number> {
  const zaehlung: Record<Status, number> = {
    nicht_erfuellt: 0,
    pruefung_erforderlich: 0,
    erfuellt: 0,
    nicht_anwendbar: 0,
  };
  for (const bewertung of seite?.bewertungen ?? []) zaehlung[bewertung.status] += 1;
  return zaehlung;
}
