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

import { useEffect, useState } from 'react';

import { ApiFehler, ladeScans, loescheScan } from '../api';
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

export function Scanliste({ beiOeffnen, beiZurueck, ziel }: Eigenschaften): React.ReactElement {
  const [scans, setzeScans] = useState<ScanUebersicht[]>([]);
  const [nachfrage, setzeNachfrage] = useState<number | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);

  useEffect(() => {
    void aktualisiere();
  }, []);

  async function aktualisiere(): Promise<void> {
    try {
      setzeScans(await ladeScans());
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  async function entferne(scanId: number): Promise<void> {
    try {
      await loescheScan(scanId);
      setzeNachfrage(null);
      setzeMeldung(`Scan ${scanId} wurde mit allen Belegen gelöscht.`);
      await aktualisiere();
    } catch (e) {
      setzeFehler(e instanceof ApiFehler ? e.message : String(e));
    }
  }

  return (
    <section aria-label="Bisherige Prüfungen">
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

      <h3>Bisherige Prüfungen</h3>

      {scans.length === 0 ? (
        <p>Es liegt noch kein Scan vor.</p>
      ) : (
        <div className="tabellenrahmen" tabIndex={0} role="region" aria-label="Gespeicherte Scans">
          <table className="tabelle">
            <caption className="nur-fuer-screenreader">Gespeicherte Scans</caption>
            <thead>
              <tr>
                <th scope="col">Nummer</th>
                <th scope="col">Begonnen</th>
                <th scope="col">Umfang</th>
                <th scope="col">Seiten</th>
                <th scope="col">Standard</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr key={scan.scanId}>
                  <th scope="row">{scan.scanId}</th>
                  <td>{new Date(scan.gestartetAm).toLocaleString('de-DE')}</td>
                  <td>
                    {BETRIEBSART_TEXT[scan.betriebsart]}
                    {scan.profilName ? ` — ${scan.profilName}` : ''}
                    {scan.geschuetzt && <span className="vermerk"> geschützter Bereich</span>}
                  </td>
                  <td>{scan.seiten}</td>
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
                          Öffnen<span className="nur-fuer-screenreader">: Scan {scan.scanId}</span>
                        </button>
                        <button type="button" className="zweitrangig" onClick={() => setzeNachfrage(scan.scanId)}>
                          Löschen<span className="nur-fuer-screenreader">: Scan {scan.scanId}</span>
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

      <div className="knopfreihe">
        <button type="button" className="zweitrangig" onClick={beiZurueck}>
          {RUECKZIEL_TEXT[ziel]}
        </button>
      </div>
    </section>
  );
}
