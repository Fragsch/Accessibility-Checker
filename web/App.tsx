/**
 * Die Anwendung: Auftrag → Fortschritt → Ergebnis.
 *
 * Bewusst ohne Router und ohne Zustandsbibliothek. Es gibt genau drei
 * Zustaende, und die Oberflaeche muss WCAG 2.1 AA halten (NF-01) — je weniger
 * Fremdverhalten im Spiel ist, desto sicherer laesst sich das zusagen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiFehler, brichScanAb, hoereAufScan, ladeKatalog, ladeScan, starteScan } from './api';
import type { Kriterium, ScanZustand, Standard } from './typen';
import { Ergebnisansicht } from './bausteine/Ergebnisansicht';
import { Fortschritt } from './bausteine/Fortschritt';
import { Pruefauftrag } from './bausteine/Pruefauftrag';

type Ansicht = 'auftrag' | 'laeuft' | 'ergebnis';

export function App(): React.ReactElement {
  const [ansicht, setzeAnsicht] = useState<Ansicht>('auftrag');
  const [zustand, setzeZustand] = useState<ScanZustand | null>(null);
  const [kriterien, setzeKriterien] = useState<Kriterium[]>([]);
  const [gepruefteSeiten, setzeGepruefteSeiten] = useState<string[]>([]);
  const [fehler, setzeFehler] = useState<string | null>(null);

  const ueberschrift = useRef<HTMLHeadingElement>(null);
  const abmelden = useRef<(() => void) | null>(null);

  // Nach einem Ansichtswechsel den Fokus an den Anfang des neuen Inhalts
  // setzen. Ohne das bliebe er auf einem Knopf, den es nicht mehr gibt.
  useEffect(() => {
    if (ansicht !== 'auftrag') ueberschrift.current?.focus();
  }, [ansicht]);

  useEffect(() => () => abmelden.current?.(), []);

  const holeStand = useCallback(async (scanId: number) => {
    try {
      const stand = await ladeScan(scanId);
      setzeZustand(stand);
      if (!stand.laeuft) setzeAnsicht('ergebnis');
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
      setzeAnsicht('ergebnis');
    }
  }, []);

  async function beginne(urls: string[], standard: Standard, stufe2: boolean): Promise<void> {
    setzeFehler(null);
    setzeGepruefteSeiten([]);

    try {
      const geladeneKriterien = await ladeKatalog(standard);
      setzeKriterien(geladeneKriterien);

      const scanId = await starteScan(urls, standard, stufe2);
      setzeAnsicht('laeuft');
      setzeZustand({
        scanId,
        zustand: 'laeuft',
        standard,
        seitenGesamt: urls.length,
        seitenFertig: 0,
        aktuelleUrl: null,
        fehler: null,
        laeuft: true,
        ergebnis: null,
        entwurf: true,
      });

      abmelden.current?.();
      abmelden.current = hoereAufScan(scanId, (ereignis) => {
        if (ereignis.art === 'seite-begonnen') {
          setzeZustand((bisher) => (bisher ? { ...bisher, aktuelleUrl: String(ereignis.daten['url']) } : bisher));
        } else if (ereignis.art === 'seite-fertig' || ereignis.art === 'fehler') {
          const url = ereignis.daten['url'];
          if (typeof url === 'string') setzeGepruefteSeiten((bisher) => [...bisher, url]);
          setzeZustand((bisher) =>
            bisher ? { ...bisher, aktuelleUrl: null, seitenFertig: Number(ereignis.daten['nummer'] ?? bisher.seitenFertig) } : bisher,
          );
        } else if (ereignis.art === 'fertig') {
          abmelden.current?.();
          abmelden.current = null;
          void holeStand(scanId);
        }
      });
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
      setzeAnsicht('auftrag');
    }
  }

  async function abbrechen(): Promise<void> {
    if (!zustand) return;
    try {
      await brichScanAb(zustand.scanId);
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
    await holeStand(zustand.scanId);
  }

  function vonVorn(): void {
    abmelden.current?.();
    abmelden.current = null;
    setzeZustand(null);
    setzeFehler(null);
    setzeAnsicht('auftrag');
  }

  return (
    <>
      <a className="sprunglink" href="#inhalt">
        Zum Inhalt springen
      </a>

      <div className="seite">
        <header className="kopfzeile">
          <h1>Barrierefreiheit prüfen</h1>
          <p>Nach WCAG 2.1 und 2.2, Level AA. Läuft vollständig auf diesem Rechner.</p>
        </header>

        <main id="inhalt">
          {fehler && (
            <div className="meldung meldung--fehler" role="alert">
              <h2>Das hat nicht geklappt</h2>
              <p>{fehler}</p>
            </div>
          )}

          {ansicht === 'auftrag' && (
            <>
              <h2 tabIndex={-1} ref={ueberschrift}>
                Was soll geprüft werden?
              </h2>
              <Pruefauftrag
                beschaeftigt={false}
                beiStart={(urls, standard, stufe2) => void beginne(urls, standard, stufe2)}
              />
            </>
          )}

          {ansicht === 'laeuft' && zustand && (
            <>
              <h2 tabIndex={-1} ref={ueberschrift} className="nur-fuer-screenreader">
                Prüfung läuft
              </h2>
              <Fortschritt
                zustand={zustand}
                gepruefteSeiten={gepruefteSeiten}
                beiAbbruch={() => void abbrechen()}
              />
            </>
          )}

          {ansicht === 'ergebnis' && (
            <>
              <h2 tabIndex={-1} ref={ueberschrift}>
                Ergebnis
                {zustand?.zustand === 'abgebrochen' && ' (abgebrochen)'}
              </h2>

              {zustand?.zustand === 'abgebrochen' && (
                <div className="meldung" role="status">
                  <p>
                    Die Prüfung wurde abgebrochen. Angezeigt wird, was bis dahin geprüft wurde — die übrigen Seiten
                    fehlen.
                  </p>
                </div>
              )}

              {zustand?.ergebnis ? (
                <Ergebnisansicht
                  ergebnis={zustand.ergebnis}
                  kriterien={kriterien}
                  entwurf={zustand.entwurf}
                />
              ) : (
                <p>Kein Ergebnis vorhanden.</p>
              )}

              <div className="knopfreihe">
                <button type="button" onClick={vonVorn}>
                  Neue Prüfung
                </button>
              </div>
            </>
          )}
        </main>

        <footer className="fusszeile">
          <p>
            Das Werkzeug ersetzt keine zertifizierte Prüfung. Solange Kriterien den Status „Prüfung erforderlich“
            tragen, ist das Ergebnis ein Entwurf.
          </p>
        </footer>
      </div>
    </>
  );
}
