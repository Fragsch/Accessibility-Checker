/**
 * Bisherige Scans: ansehen und löschen (S-24).
 *
 * Löschen ist hier kein Aufräumen, sondern eine Zusage: Belege aus geschützten
 * Bereichen enthalten regelmäßig personenbezogene Daten (PRD 6.1.2). Wer sie
 * loswerden will, muss das ohne Umweg über die Datenbank können — und samt
 * aller Screenshots und HTML-Ausschnitte.
 *
 * Deshalb steht bei jedem Scan aus einem geschützten Bereich ein Vermerk
 * (S-22): Man soll sehen, wo solche Belege liegen, bevor man einen Bericht
 * weitergibt.
 */

import { useEffect, useRef, useState } from 'react';

import { ApiFehler, abbildAdresse, ladeScans, loescheScan } from '../api';
import type { Rueckziel, ScanUebersicht } from '../typen';
import { BETRIEBSART_TEXT, RUECKZIEL_TEXT } from '../typen';

interface Eigenschaften {
  beiOeffnen: (scanId: number) => void;
  /**
   * Zurueck dorthin, wo man herkam — nicht pauschal an den Auftrag.
   *
   * Wer ein Ergebnis offen hat und nur nachsehen wollte, was sonst noch
   * gespeichert ist, will danach wieder an sein Ergebnis. Ein „Zurueck", das
   * ihn stattdessen auf dem leeren Formular absetzt, sieht aus, als waere das
   * Ergebnis fort.
   */
  beiZurueck: () => void;
  /** Wohin `beiZurueck` fuehrt. Steuert allein die Beschriftung. */
  ziel: Rueckziel;
}

/**
 * Woran eine Pruefung in der Liste zu erkennen ist.
 *
 * Der Name ist seit Fassung 4 der Datenbank Pflicht — aber nur in der
 * Oberflaeche und nur fuer neue Laeufe. Aeltere Pruefungen haben keinen, und
 * Laeufe aus der Befehlszeile oder der Selbstpruefung bekommen keinen. Fuer
 * die gibt es zwei Rueckfaelle in dieser Reihenfolge: der Name des Profils,
 * aus dem der Lauf stammt, und zuletzt die Nummer.
 *
 * Erfunden wird dabei nichts. „Pruefung 42" sagt offen, dass hier nur eine
 * Nummer steht — ein aus Adresse und Datum zusammengesetzter Name saehe aus
 * wie eine Angabe, die jemand gemacht hat.
 */
function bezeichne(scan: ScanUebersicht): string {
  return scan.name ?? scan.profilName ?? `Prüfung ${scan.scanId}`;
}

/** Wie viele Zeilen ein Abruf holt — der erste wie jeder weitere. */
const ABSCHNITT = 50;

export function Scanliste({ beiOeffnen, beiZurueck, ziel }: Eigenschaften): React.ReactElement {
  const [scans, setzeScans] = useState<ScanUebersicht[]>([]);
  const [gesamt, setzeGesamt] = useState(0);
  const [suche, setzeSuche] = useState('');
  const [laedt, setzeLaedt] = useState(true);
  const [nachfrage, setzeNachfrage] = useState<number | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);

  /*
    Der Fokus nach dem Nachladen.

    Sind mit dem letzten Abschnitt alle Zeilen geladen, verschwindet der Knopf
    „Ältere anzeigen" — und mit ihm das Element, auf dem der Fokus gerade
    stand. Er fiele auf den Seitenanfang zurueck, und wer mit der Tastatur
    arbeitet, stuende ohne Vorwarnung wieder ganz oben. Deshalb wandert er in
    diesem Fall auf die Zeile, die sagt, wie viele Pruefungen nun zu sehen
    sind: Sie ist die Antwort auf den Knopfdruck.
  */
  const zaehlzeile = useRef<HTMLParagraphElement>(null);
  const fokusAufZaehlzeile = useRef(false);
  const suchfeld = useRef<HTMLInputElement>(null);

  /**
   * Leert die Suche und gibt den Fokus zurueck ins Feld.
   *
   * Der Fokus muss zurueck, weil der Knopf mit dem letzten Zeichen
   * verschwindet: Bliebe er, wo er war, faende er ein Element vor, das es
   * nicht mehr gibt, und faellt auf den Seitenanfang. Und wer die Suche
   * loescht, will ohnehin eine neue eingeben.
   */
  function leereSuche(): void {
    setzeSuche('');
    suchfeld.current?.focus();
  }

  /*
    Die Suche laeuft auf dem Server, nicht auf den geladenen Zeilen: Gesucht
    werden soll in allen Pruefungen, gerade in denen, die noch nicht geladen
    sind. Genau dafuer gibt es die Suche.

    Die Verzoegerung von 300 ms haelt die Zahl der Abrufe klein, ohne dass das
    Tippen stockt. `suche` selbst bleibt unverzoegert im Feld — sonst spraenge
    der Text beim Schreiben.
  */
  useEffect(() => {
    setzeLaedt(true);
    const zeitgeber = setTimeout(() => {
      void hole(0, false);
    }, 300);
    return () => clearTimeout(zeitgeber);
  }, [suche]);

  useEffect(() => {
    if (!fokusAufZaehlzeile.current) return;
    fokusAufZaehlzeile.current = false;
    zaehlzeile.current?.focus();
  }, [scans.length]);

  /**
   * Holt einen Abschnitt.
   *
   * `anhaengen` unterscheidet die beiden Faelle: Beim Nachladen kommen die
   * Zeilen hinten dazu, bei einer neuen Suche ersetzen sie die bisherigen.
   */
  async function hole(versatz: number, anhaengen: boolean): Promise<void> {
    try {
      const antwort = await ladeScans({ suche, anzahl: ABSCHNITT, versatz });
      setzeGesamt(antwort.gesamt);
      setzeScans((bisher) => (anhaengen ? [...bisher, ...antwort.scans] : antwort.scans));
      setzeFehler(null);
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    } finally {
      setzeLaedt(false);
    }
  }

  async function ladeAeltere(): Promise<void> {
    // Nur wenn dieser Abschnitt der letzte ist, wandert der Fokus weiter —
    // sonst bleibt er, wo er ist, und der Knopf laesst sich erneut druecken.
    fokusAufZaehlzeile.current = scans.length + ABSCHNITT >= gesamt;
    await hole(scans.length, true);
  }

  /**
   * Laedt den sichtbaren Ausschnitt neu.
   *
   * Nach dem Loeschen wird nicht auf den ersten Abschnitt zurueckgesprungen:
   * Wer sich durch dreihundert Laeufe nach unten geladen hat, um dort einen
   * zu loeschen, will nicht wieder oben anfangen.
   */
  async function aktualisiere(): Promise<void> {
    const bisher = Math.max(scans.length, ABSCHNITT);
    try {
      const antwort = await ladeScans({ suche, anzahl: bisher, versatz: 0 });
      setzeGesamt(antwort.gesamt);
      setzeScans(antwort.scans);
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  async function entferne(scanId: number): Promise<void> {
    try {
      const geloescht = scans.find((s) => s.scanId === scanId);
      await loescheScan(scanId);
      setzeNachfrage(null);
      setzeMeldung(`„${geloescht ? bezeichne(geloescht) : `Prüfung ${scanId}`}“ wurde mit allen Belegen gelöscht.`);
      await aktualisiere();
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  /*
    Kein eigener Titel und kein `aria-label`: Die Ansicht traegt ihre
    Ueberschrift „Bisherige Pruefungen" schon in `App.tsx`, und der Fokus
    springt nach dem Wechsel dorthin. Ein zweiter Titel gleichen Wortlauts
    stuende doppelt auf dem Bildschirm, und ein gleichnamiger Bereich meldete
    sich einer Sprachausgabe ein drittes Mal — dreimal derselbe Text, ohne dass
    es drei Dinge gaebe.
  */
  return (
    <section>
      {meldung && (
        <p className="meldung" role="status">
          {meldung}
        </p>
      )}
      {fehler && (
        <p className="meldung meldung--fehler" role="alert">
          {fehler}
        </p>
      )}

      {/*
        Das Suchfeld steht auch dann da, wenn gerade nichts gefunden wurde:
        Verschwaende es mit dem letzten Treffer, koennte man den Begriff nicht
        mehr aendern und saesse in einer leeren Liste fest.

        `type="search"`, damit der Browser sein Loeschkreuz und die eigene
        Vorgeschichte anbietet. Kein Suchknopf daneben — gesucht wird beim
        Tippen, und ein Knopf, der nichts ausloest, was nicht ohnehin
        geschieht, verspricht eine Handlung, die es nicht gibt.
      */}
      <div className="feldgruppe">
        <label htmlFor="scan-suche">Prüfung suchen</label>
        <div className="suchfeld">
          <input
            id="scan-suche"
            type="search"
            ref={suchfeld}
            value={suche}
            onChange={(e) => setzeSuche(e.target.value)}
            aria-describedby="scan-suche-hilfe"
            placeholder="Name der Prüfung"
          />
          {/*
            Der Loeschknopf steht nur da, wenn es etwas zu loeschen gibt.
            Ein Knopf ueber einem leeren Feld verspricht eine Handlung, die
            nichts bewirkt.

            Eigener Knopf statt des eingebauten Kreuzes von `type="search"`:
            Das laesst sich mit der Tastatur nicht erreichen. Dieser hier hat
            einen Namen, steht in der Tabulatorreihenfolge und traegt den
            Fokusrahmen der Oberflaeche.
          */}
          {suche !== '' && (
            <button type="button" className="suchfeld__loeschen" onClick={leereSuche}>
              <span className="nur-fuer-screenreader">Suche löschen</span>
            </button>
          )}
        </div>
        {/*
          Der Hilfetext nennt nur, wonach die Liste auch sichtbar geordnet ist.
          Er sprach frueher von der Nummer — die steht seit der Umstellung auf
          Namen in keiner Spalte mehr, und ein Hinweis auf ein Merkmal, das
          nirgends abzulesen ist, schickt zum Raten. Gesucht wird ueber das,
          was in der Spalte „Name" steht; bei namenlosen Laeufen ist das
          „Pruefung 362", und genau so eingegeben findet es die Zeile.
        */}
        <p className="hilfetext" id="scan-suche-hilfe">
          Gesucht wird über den Namen, wie er in der Spalte „Name“ steht — über alle gespeicherten Prüfungen, auch über
          die, die unten noch nicht geladen sind. Die Escape-Taste leert das Feld.
        </p>
      </div>

      {scans.length === 0 ? (
        <p>{laedt ? 'Wird gesucht …' : suche.trim() ? `Keine Prüfung passt zu „${suche.trim()}“.` : 'Es liegt noch kein Scan vor.'}</p>
      ) : (
        <div className="tabellenrahmen" tabIndex={0} role="region" aria-label="Gespeicherte Scans">
          <table className="tabelle">
            <caption className="nur-fuer-screenreader">Gespeicherte Scans</caption>
            <thead>
              <tr>
                {/*
                  Die Vorschau traegt keine Ueberschrift, die etwas verspricht,
                  was sie fuer eine Sprachausgabe nicht halten kann. Sie heisst,
                  was sie ist; was auf ihr zu sehen ist, steht daneben in der
                  Spalte "Umfang" als Adresse.
                */}
                <th scope="col">Vorschau</th>
                {/*
                  Der Name ist der Zeilenkopf, nicht mehr die Nummer: Er ist
                  das, woran ein Mensch die Zeile wiedererkennt, und genau das
                  soll eine Sprachausgabe zu jeder Zelle mit ansagen. Eine
                  laufende Nummer sagt niemandem etwas.

                  Dass er erst an zweiter Stelle steht, aendert daran nichts:
                  `scope="row"` bestimmt die Rolle, nicht die Position. Das
                  Bild gehoert nach vorn, weil das Auge zuerst dort landet —
                  eine Sprachausgabe folgt weiterhin dem Namen.
                */}
                <th scope="col">Name</th>
                <th scope="col">Begonnen</th>
                <th scope="col">Umfang</th>
                <th scope="col">Standard</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.scanId}>
                  <td>
                    {scan.hatAbbild ? (
                      <img
                        className="vorschaubild"
                        src={abbildAdresse(scan.scanId, 0)}
                        alt={`Bildschirmfoto der ersten Seite aus Prüfung „${bezeichne(scan)}“`}
                        loading="lazy"
                      />
                    ) : (
                      <span className="hilfetext">kein Bild</span>
                    )}
                  </td>
                  <th scope="row">{bezeichne(scan)}</th>
                  {/*
                    Datum und Uhrzeit stehen untereinander: Nebeneinander ist
                    die Angabe die laengste der Zeile und zwingt die Spalte
                    breiter, als sie sein muesste. Beides in einem `time`, damit
                    der Zeitpunkt maschinenlesbar bleibt — der Umbruch ist
                    Gestaltung und darf ihn nicht zerlegen.
                  */}
                  <td>
                    <time dateTime={scan.gestartetAm}>
                      {new Date(scan.gestartetAm).toLocaleDateString('de-DE')}
                      <span className="zeitangabe">
                        {new Date(scan.gestartetAm).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </time>
                  </td>
                  <td>
                    {BETRIEBSART_TEXT[scan.betriebsart]}
                    {scan.profilName ? ` — ${scan.profilName}` : ''}
                    {scan.geschuetzt && <span className="vermerk"> geschützter Bereich</span>}
                  </td>
                  <td>WCAG {scan.standard}</td>
                  <td>
                    {nachfrage === scan.scanId ? (
                      <div className="knopfreihe knopfreihe--eng">
                        <span id={`nachfrage-${scan.scanId}`}>Wirklich löschen?</span>
                        <button
                          type="button"
                          onClick={() => void entferne(scan.scanId)}
                          aria-describedby={`nachfrage-${scan.scanId}`}
                        >
                          Ja, löschen
                        </button>
                        <button type="button" className="zweitrangig" onClick={() => setzeNachfrage(null)}>
                          Abbrechen
                        </button>
                      </div>
                    ) : (
                      <div className="knopfreihe knopfreihe--eng">
                        <button type="button" className="zweitrangig" onClick={() => beiOeffnen(scan.scanId)}>
                          Öffnen<span className="nur-fuer-screenreader">: {bezeichne(scan)}</span>
                        </button>
                        <button type="button" className="zweitrangig" onClick={() => setzeNachfrage(scan.scanId)}>
                          Löschen<span className="nur-fuer-screenreader">: {bezeichne(scan)}</span>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Wie viel zu sehen ist und wie viel es gibt.

        `role="status"` sagt die Zahl nach dem Nachladen und nach jeder Suche
        an, ohne den Fokus zu stehlen — sonst bliebe das Ergebnis einer Suche
        fuer eine Sprachausgabe unbemerkt, weil sich nur eine Tabelle weiter
        unten geaendert hat.

        `tabIndex={-1}`: Die Zeile ist das Ziel des Fokus, wenn mit dem
        letzten Abschnitt der Knopf darunter verschwindet. Sie ist nicht in
        der Tabulatorreihenfolge — angesprungen wird sie nur aus dem Programm.
      */}
      {gesamt > 0 && (
        <p className="hilfetext zaehlzeile" role="status" tabIndex={-1} ref={zaehlzeile}>
          {scans.length === gesamt
            ? `Alle ${gesamt} ${gesamt === 1 ? 'Prüfung' : 'Prüfungen'}${suche.trim() ? ' zu dieser Suche' : ''} werden angezeigt.`
            : `${scans.length} von ${gesamt} Prüfungen werden angezeigt.`}
        </p>
      )}

      <div className="knopfreihe">
        {scans.length < gesamt && (
          <button type="button" className="zweitrangig" onClick={() => void ladeAeltere()}>
            Ältere anzeigen
          </button>
        )}
        <button type="button" className="zweitrangig" onClick={beiZurueck}>
          {RUECKZIEL_TEXT[ziel]}
        </button>
      </div>
    </section>
  );
}
