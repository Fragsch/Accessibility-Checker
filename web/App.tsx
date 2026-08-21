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
import type {
  Auftrag,
  Fragenliste,
  Kriterium,
  Projektansicht as Projektdaten,
  Rueckziel,
  ScanZustand,
} from './typen';
import { Abdeckungsansicht } from './bausteine/Abdeckungsansicht';
import { Berichtsansicht } from './bausteine/Berichtsansicht';
import { Erklaerknopf } from './bausteine/Erklaerknopf';
import { Ergebnisansicht } from './bausteine/Ergebnisansicht';
import { Fortschritt } from './bausteine/Fortschritt';
import { Profilverwaltung } from './bausteine/Profilverwaltung';
import { Projektansicht } from './bausteine/Projektansicht';
import { Pruefauftrag } from './bausteine/Pruefauftrag';
import { Kopfnavigation } from './bausteine/Kopfnavigation';
import { Pruefliste } from './bausteine/Pruefliste';
import { Scanliste } from './bausteine/Scanliste';

type Ansicht = 'auftrag' | 'profile' | 'scans' | 'abdeckung' | 'laeuft' | 'ergebnis';
type Sicht = 'befunde' | 'projekt' | 'pruefliste' | 'bericht';

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

  /**
   * Die Abdeckungsmatrix ansehen (PRD 10).
   *
   * Der Katalog wird dabei nachgeholt, falls noch keiner geladen ist — sonst
   * stuenden in der Matrix nur Kennungen und keine Titel. Schlaegt das fehl,
   * ist das kein Grund, die Ansicht zu verweigern: Die Messwerte stehen dann
   * eben ohne Titel da.
   */
  async function zeigeAbdeckung(): Promise<void> {
    if (kriterien.length === 0) {
      setzeKriterien(await ladeKatalog(zustand?.standard ?? '2.1').catch(() => []));
    }
    setzeAnsicht('abdeckung');
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

  /*
    Der Entwurfsvermerk (Regel 4) gehoert zum ganzen Ergebnis und nicht zu
    einer seiner Sichten — deshalb steht er hier und nicht in der
    Ergebnisansicht. Er sitzt im Kasten der Ansichtswahl: Wer die Sicht
    wechselt, liest ihn dort erneut.

    Nicht in der Berichtssicht: Der Bericht traegt seinen eigenen, genaueren
    Vermerk mit der Zahl der offenen Kriterien. Zweimal dasselbe untereinander
    liest niemand.
  */
  const entwurfshinweis =
    zustand?.entwurf && sicht !== 'bericht' ? (
      <div className="meldung meldung--entwurf" role="status">
        <h3>Dieses Ergebnis ist ein Entwurf</h3>
        <p>
          Solange Kriterien den Status „Prüfung erforderlich“ tragen, ist die Prüfung nicht abgeschlossen. Offene
          Kriterien werden nie als konform ausgegeben.
        </p>
      </div>
    ) : null;

  /*
    Wohin ein „Zurueck" aus einer Nebenansicht fuehrt.

    An das offene Ergebnis, solange eines vorliegt — sonst an den Auftrag. Die
    Kopfzeile traegt mit „Neue Pruefung" bereits einen Weg zum leeren Formular,
    und der raeumt dabei das Ergebnis weg (`vonVorn`). Ein zweiter Knopf, der
    dasselbe Ziel verspricht, aber etwas anderes tut, waere die schlechtere Art
    der Dopplung: nicht ueberfluessig, sondern irrefuehrend.

    Einmal abgeleitet und an alle Nebenansichten gereicht, damit sich die beiden
    nicht auseinanderentwickeln — genau das war der Fall, als die Scanliste noch
    pauschal an den Auftrag zurueckfuehrte und die Abdeckungsansicht nicht.
  */
  const rueckziel: Rueckziel = zustand?.ergebnis ? 'ergebnis' : 'auftrag';
  const zurueck = (): void => setzeAnsicht(rueckziel);

  const sichten: { wert: Sicht; text: string }[] = [
    { wert: 'befunde', text: 'Befunde je Seite' },
    ...(projekt ? [{ wert: 'projekt' as Sicht, text: 'Projektebene' }] : []),
    ...(fragen && fragen.fortschritt.gesamt > 0
      ? [{ wert: 'pruefliste' as Sicht, text: `Manuelle Prüfliste (${fragen.fortschritt.offen} offen)` }]
      : []),
    // Ein laufender Scan liefert keinen Bericht: Ein Zwischenstand saehe aus
    // wie ein Ergebnis, und ein noch nicht geprueftes Kriterium wie ein
    // erfuelltes.
    ...(zustand?.ergebnis && !zustand.laeuft ? [{ wert: 'bericht' as Sicht, text: 'Bericht' }] : []),
  ];

  return (
    <>
      <a className="sprunglink" href="#inhalt">
        Zum Inhalt springen
      </a>

      {/*
        Die Kopfzeile bleibt beim Scrollen stehen und traegt die drei Wege, die
        von ueberall erreichbar sein muessen. Sie steht ausserhalb von `.seite`,
        weil sie die volle Fensterbreite einnimmt — die Spalte darin bringt ihr
        Inhalt selbst mit.
      */}
      <header className="kopfzeile">
        <div className="kopfzeile__inhalt">
          <h1 className="marke">Accessibility-Checker</h1>
          <Kopfnavigation
            beiNeuePruefung={vonVorn}
            beiScans={() => setzeAnsicht('scans')}
            beiAbdeckung={() => void zeigeAbdeckung()}
            laeuft={zustand?.laeuft ?? false}
          />
        </div>
      </header>

      <div className="seite">
        <main id="inhalt">
          {fehler && (
            <div className="meldung meldung--fehler" role="alert">
              <h2>Das hat nicht geklappt</h2>
              <p>{fehler}</p>
            </div>
          )}

          {ansicht === 'auftrag' && (
            <>
              {/*
                Der Satz stand erst in der Kopfzeile, dann als Einleitung ueber
                dem Auftrag. Beides las ihn jedem vor, der das Werkzeug taeglich
                benutzt — und der weiss laengst, wonach geprueft wird und dass
                nichts abfliesst. Er steht deshalb hinter dem Zeichen: einmal
                nachzulesen fuer den, der ihn braucht, und aus dem Weg fuer den,
                der ihn kennt. Aus dem Weg heisst nicht versteckt — die
                Schaltflaeche steht in der Ueberschriftszeile und ist mit
                Tastatur, Zeiger und Finger gleichermassen zu erreichen.

                Der Knopf steht neben der Ueberschrift, nicht in ihr: Sein Name
                zaehlte sonst zum Namen der Ueberschrift, und eine Sprachausgabe
                laese „Was soll geprueft werden? Was dieses Werkzeug prueft".
              */}
              <div className="ueberschriftszeile">
                <h2 tabIndex={-1} ref={ueberschrift}>
                  Was soll geprüft werden?
                </h2>
                <Erklaerknopf beschriftung="Wonach geprüft wird und wo die Daten bleiben">
                  <strong>Geprüft wird nach WCAG, Konformitätsstufe AA.</strong> Die Fassung — 2.1 oder 2.2 —
                  stellen Sie weiter unten ein; 2.2 bringt neun zusätzliche Erfolgskriterien mit und lässt eines
                  entfallen.
                  <br />
                  <br />
                  Alles läuft auf diesem Rechner. Die geprüften Seiten werden lokal geladen, und weder ihre
                  Adressen noch ihre Inhalte oder die Ergebnisse verlassen ihn. Das gilt auch für die
                  Sprachmodell-Stufe: Sie spricht mit einem lokal installierten Modell, nicht mit einem Dienst im
                  Netz.
                </Erklaerknopf>
              </div>
              <Pruefauftrag
                beschaeftigt={false}
                beiStart={(auftrag) => void beginne(auftrag)}
                beiProfilverwaltung={() => setzeAnsicht('profile')}
              />
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
              <Scanliste
                beiOeffnen={(scanId) => void oeffneScan(scanId)}
                beiZurueck={zurueck}
                ziel={rueckziel}
              />
            </>
          )}

          {ansicht === 'abdeckung' && (
            <>
              <h2 tabIndex={-1} ref={ueberschrift}>
                Was dieses Werkzeug findet
              </h2>
              <Abdeckungsansicht kriterien={kriterien} beiZurueck={zurueck} ziel={rueckziel} />
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
              {sichten.length > 1 ? (
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
                  {entwurfshinweis}
                </fieldset>
              ) : (
                // Ohne Ansichtswahl gibt es keinen Kasten, in dem der Hinweis
                // stehen koennte — dann steht er fuer sich.
                entwurfshinweis
              )}

              {sicht === 'bericht' && zustand?.ergebnis ? (
                <Berichtsansicht scanId={zustand.scanId} ergebnis={zustand.ergebnis} />
              ) : sicht === 'pruefliste' && fragen && zustand ? (
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
                  angeforderteSeite={angeforderteSeite}
                />
              ) : (
                <p>Kein Ergebnis vorhanden.</p>
              )}

            </>
          )}
        </main>

      </div>

      {/*
        Die Fusszeile steht ausserhalb der Spalte, damit ihre Flaeche ueber die
        volle Fensterbreite laeuft. Das Jahr kommt aus der Uhr des Rechners —
        ein eingetragenes veraltet, und niemand bemerkt es.
      */}
      <footer className="fusszeile">
        <div className="fusszeile__inhalt">
          <p className="fusszeile__hinweis">
            Das Werkzeug ersetzt keine zertifizierte Prüfung. Solange Kriterien den Status „Prüfung erforderlich“
            tragen, ist das Ergebnis ein Entwurf.
          </p>
          <p className="fusszeile__urheber">© {new Date().getFullYear()} Frank Gschwandtner</p>
        </div>
      </footer>
    </>
  );
}
