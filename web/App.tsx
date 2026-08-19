/**
 * Die Anwendung: Auftrag → Fortschritt → Ergebnis.
 *
 * Bewusst ohne Router und ohne Zustandsbibliothek. Es gibt eine Handvoll
 * Zustaende, und die Oberflaeche muss WCAG 2.1 AA halten (NF-01) — je weniger
 * Fremdverhalten im Spiel ist, desto sicherer laesst sich das zusagen.
 *
 * Seit Phase 6 kommen drei Nebenwege dazu: die Profilverwaltung, die Liste der
 * bisherigen Scans und — bei mehreren Seiten — die Projektebene. Sie sind
 * Nebenwege und keine eigenen Anwendungen: derselbe Kopf, derselbe Fokuspfad.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiFehler,
  brichScanAb,
  hoereAufScan,
  ladeFragen,
  ladeKatalog,
  ladeProjekt,
  ladeScan,
  meldeAnmeldungFertig,
  starteScan,
} from './api';
import type { Auftrag, Fragenliste, Kriterium, Projektansicht as Projektdaten, ScanZustand } from './typen';
import { Ergebnisansicht } from './bausteine/Ergebnisansicht';
import { Fortschritt } from './bausteine/Fortschritt';
import { Profilverwaltung } from './bausteine/Profilverwaltung';
import { Projektansicht } from './bausteine/Projektansicht';
import { Pruefauftrag } from './bausteine/Pruefauftrag';
import { Pruefliste } from './bausteine/Pruefliste';
import { Scanliste } from './bausteine/Scanliste';

type Ansicht = 'auftrag' | 'profile' | 'scans' | 'laeuft' | 'ergebnis';
type Sicht = 'befunde' | 'projekt' | 'pruefliste';

export function App(): React.ReactElement {
  const [ansicht, setzeAnsicht] = useState<Ansicht>('auftrag');
  const [zustand, setzeZustand] = useState<ScanZustand | null>(null);
  const [kriterien, setzeKriterien] = useState<Kriterium[]>([]);
  const [gepruefteSeiten, setzeGepruefteSeiten] = useState<string[]>([]);
  const [crawlmeldungen, setzeCrawlmeldungen] = useState<string[]>([]);
  const [sitzungsverlust, setzeSitzungsverlust] = useState<string | null>(null);
  const [fragen, setzeFragen] = useState<Fragenliste | null>(null);
  const [projekt, setzeProjekt] = useState<Projektdaten | null>(null);
  const [angeforderteSeite, setzeAngeforderteSeite] = useState<string | null>(null);
  const [sicht, setzeSicht] = useState<Sicht>('befunde');
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
      if (!stand.laeuft) {
        setzeAnsicht('ergebnis');
        setzeFragen(await ladeFragen(scanId).catch(() => null));
        setzeProjekt((stand.ergebnis?.seiten.length ?? 0) > 1 ? await ladeProjekt(scanId).catch(() => null) : null);
      }
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
      setzeAnsicht('ergebnis');
    }
  }, []);

  async function beginne(auftrag: Auftrag): Promise<void> {
    setzeFehler(null);
    setzeGepruefteSeiten([]);
    setzeCrawlmeldungen([]);
    setzeSitzungsverlust(null);
    setzeProjekt(null);

    try {
      const geladeneKriterien = await ladeKatalog(auftrag.standard);
      setzeKriterien(geladeneKriterien);

      const scanId = await starteScan(auftrag);
      setzeAnsicht('laeuft');
      setzeZustand({
        scanId,
        zustand: 'laeuft',
        standard: auftrag.standard,
        seitenGesamt: auftrag.urls?.length ?? 0,
        seitenFertig: 0,
        aktuelleUrl: null,
        fehler: null,
        laeuft: true,
        ergebnis: null,
        entwurf: true,
        anmeldung: auftrag.anmeldung ? { url: auftrag.anmeldung.url, zustand: 'wartet' } : null,
      });

      /*
        Beim Profil bestimmt der Server den Standard aus dem Profil (K-13).
        Der Katalog oben kann daher der falsche sein — deshalb wird er nach
        dem Start noch einmal anhand des tatsaechlichen Standards geholt.
      */
      const stand = await ladeScan(scanId).catch(() => null);
      if (stand && stand.standard !== auftrag.standard) {
        setzeKriterien(await ladeKatalog(stand.standard));
        setzeZustand((bisher) => (bisher ? { ...bisher, standard: stand.standard } : bisher));
      }

      abmelden.current?.();
      abmelden.current = hoereAufScan(scanId, (ereignis) => {
        if (ereignis.art === 'anmeldung-noetig') {
          const url = String(ereignis.daten['url'] ?? '');
          setzeZustand((bisher) => (bisher ? { ...bisher, anmeldung: { url, zustand: 'wartet' } } : bisher));
        } else if (ereignis.art === 'sitzung-verloren') {
          setzeSitzungsverlust(String(ereignis.daten['text'] ?? 'Die Sitzung ist abgelaufen.'));
        } else if (ereignis.art === 'seite-begonnen') {
          setzeZustand((bisher) =>
            bisher ? { ...bisher, anmeldung: null, aktuelleUrl: String(ereignis.daten['url']) } : bisher,
          );
        } else if (ereignis.art === 'fortschritt' && ereignis.daten['phase'] === 'crawl') {
          const text = String(ereignis.daten['url'] ?? ereignis.daten['text'] ?? '');
          if (text) setzeCrawlmeldungen((bisher) => (bisher.includes(text) ? bisher : [...bisher, text]));
        } else if (ereignis.art === 'seite-fertig' || ereignis.art === 'fehler') {
          const url = ereignis.daten['url'];
          if (typeof url === 'string') setzeGepruefteSeiten((bisher) => [...bisher, url]);
          setzeZustand((bisher) =>
            bisher
              ? {
                  ...bisher,
                  aktuelleUrl: null,
                  seitenFertig: Number(ereignis.daten['nummer'] ?? bisher.seitenFertig),
                  seitenGesamt: Number(ereignis.daten['gesamt'] ?? bisher.seitenGesamt),
                }
              : bisher,
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

  /** Bestätigung nach der Anmeldung — erst danach beginnt die Prüfung (S-02). */
  async function anmeldungFertig(): Promise<void> {
    if (!zustand) return;
    try {
      await meldeAnmeldungFertig(zustand.scanId);
      setzeZustand((bisher) => (bisher ? { ...bisher, anmeldung: null } : bisher));
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
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

  /** Einen gespeicherten Scan wieder öffnen. */
  async function oeffneScan(scanId: number): Promise<void> {
    setzeFehler(null);
    try {
      const stand = await ladeScan(scanId);
      setzeKriterien(await ladeKatalog(stand.standard));
      setzeZustand(stand);
      setzeFragen(await ladeFragen(scanId).catch(() => null));
      setzeProjekt((stand.ergebnis?.seiten.length ?? 0) > 1 ? await ladeProjekt(scanId).catch(() => null) : null);
      setzeSicht('befunde');
      setzeAnsicht('ergebnis');
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  function vonVorn(): void {
    abmelden.current?.();
    abmelden.current = null;
    setzeZustand(null);
    setzeFragen(null);
    setzeProjekt(null);
    setzeAngeforderteSeite(null);
    setzeCrawlmeldungen([]);
    setzeSitzungsverlust(null);
    setzeSicht('befunde');
    setzeFehler(null);
    setzeAnsicht('auftrag');
  }

  function springeZuSeite(url: string): void {
    setzeAngeforderteSeite(url);
    setzeSicht('befunde');
  }

  const sichten: { wert: Sicht; text: string }[] = [
    { wert: 'befunde', text: 'Befunde je Seite' },
    ...(projekt ? [{ wert: 'projekt' as Sicht, text: 'Projektebene' }] : []),
    ...(fragen && fragen.fortschritt.gesamt > 0
      ? [{ wert: 'pruefliste' as Sicht, text: `Manuelle Prüfliste (${fragen.fortschritt.offen} offen)` }]
      : []),
  ];

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
                beiStart={(auftrag) => void beginne(auftrag)}
                beiProfilverwaltung={() => setzeAnsicht('profile')}
              />
              <div className="knopfreihe">
                <button type="button" className="zweitrangig" onClick={() => setzeAnsicht('scans')}>
                  Bisherige Prüfungen
                </button>
              </div>
            </>
          )}

          {ansicht === 'profile' && (
            <>
              <h2 tabIndex={-1} ref={ueberschrift}>
                Prüfprofile
              </h2>
              <Profilverwaltung beiFertig={() => setzeAnsicht('auftrag')} />
            </>
          )}

          {ansicht === 'scans' && (
            <>
              <h2 tabIndex={-1} ref={ueberschrift}>
                Bisherige Prüfungen
              </h2>
              <Scanliste beiOeffnen={(scanId) => void oeffneScan(scanId)} beiFertig={() => setzeAnsicht('auftrag')} />
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
                crawlmeldungen={crawlmeldungen}
                sitzungsverlust={sitzungsverlust}
                beiAbbruch={() => void abbrechen()}
                beiAnmeldungFertig={() => void anmeldungFertig()}
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

              {sitzungsverlust && (
                <div className="meldung meldung--fehler" role="status">
                  <p>{sitzungsverlust}</p>
                </div>
              )}

              {/*
                Belege aus geschuetzten Bereichen werden unveraendert
                gespeichert (S-20). Das ist so gewollt — aber es muss dort
                stehen, wo jemand ueberlegt, den Bericht weiterzugeben (S-23).
              */}
              {zustand?.geschuetzt && (
                <div className="meldung" role="status">
                  <p>
                    Dieser Scan enthält Seiten aus einem geschützten Bereich. Screenshots und HTML-Ausschnitte geben
                    deren Inhalte unverändert wieder — vor einer Weitergabe des Berichts bitte prüfen.
                  </p>
                </div>
              )}

              {/*
                Sichten auf dasselbe Ergebnis: was gefunden wurde, wie es sich
                ueber alle Seiten verdichtet, und was noch zu tun ist. Als
                Radiogruppe, nicht als Reiterleiste — semantisches HTML vor
                ARIA, und mit der Tastatur bedienbar, ohne dass jemand ein
                Tastenverhalten nachbauen muss.
              */}
              {sichten.length > 1 && (
                <fieldset className="feldgruppe">
                  <legend>Ansicht</legend>
                  <div className="auswahl">
                    {sichten.map((eintrag) => (
                      <label key={eintrag.wert}>
                        <input
                          type="radio"
                          name="sicht"
                          checked={sicht === eintrag.wert}
                          onChange={() => setzeSicht(eintrag.wert)}
                        />
                        {eintrag.text}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {sicht === 'pruefliste' && fragen && zustand ? (
                <Pruefliste
                  scanId={zustand.scanId}
                  liste={fragen}
                  kriterien={kriterien}
                  beiAenderung={() => void holeStand(zustand.scanId)}
                />
              ) : sicht === 'projekt' && projekt ? (
                <Projektansicht ansicht={projekt} kriterien={kriterien} beiSeitensprung={springeZuSeite} />
              ) : zustand?.ergebnis ? (
                <Ergebnisansicht
                  ergebnis={zustand.ergebnis}
                  kriterien={kriterien}
                  entwurf={zustand.entwurf}
                  angeforderteSeite={angeforderteSeite}
                />
              ) : (
                <p>Kein Ergebnis vorhanden.</p>
              )}

              <div className="knopfreihe">
                <button type="button" onClick={vonVorn}>
                  Neue Prüfung
                </button>
                <button type="button" className="zweitrangig" onClick={() => setzeAnsicht('scans')}>
                  Bisherige Prüfungen
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
