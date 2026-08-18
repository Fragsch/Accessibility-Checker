/**
 * Eingabe des Prüfauftrags: Adressen und Prüfstandard.
 *
 * Ein Formular mit `submit`, kein Knopf mit Klickbehandlung — damit die
 * Eingabetaste im Adressfeld tut, was jeder erwartet.
 */

import { useState } from 'react';

import type { Standard } from '../typen';
import { Sprachmodell } from './Sprachmodell';

interface Eigenschaften {
  beschaeftigt: boolean;
  beiStart: (urls: string[], standard: Standard, stufe2: boolean) => void;
}

export function Pruefauftrag({ beschaeftigt, beiStart }: Eigenschaften): React.ReactElement {
  const [adressen, setzeAdressen] = useState('');
  const [standard, setzeStandard] = useState<Standard>('2.1');
  const [stufe2, setzeStufe2] = useState(false);
  const [fehler, setzeFehler] = useState<string | null>(null);

  function abschicken(ereignis: React.FormEvent): void {
    ereignis.preventDefault();

    const urls = adressen
      .split('\n')
      .map((zeile) => zeile.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      setzeFehler('Bitte geben Sie mindestens eine Adresse an.');
      return;
    }

    setzeFehler(null);
    beiStart(urls, standard, stufe2);
  }

  return (
    <form onSubmit={abschicken} noValidate>
      <div className="feldgruppe">
        <label htmlFor="adressen">Zu prüfende Adressen</label>
        <textarea
          id="adressen"
          value={adressen}
          onChange={(e) => setzeAdressen(e.target.value)}
          aria-describedby="adressen-hilfe"
          {...(fehler ? { 'aria-invalid': true, 'aria-errormessage': 'adressen-fehler' } : {})}
          placeholder="beispiel.de"
          autoComplete="url"
          spellCheck={false}
        />
        <p className="hilfetext" id="adressen-hilfe">
          Eine Adresse je Zeile. Fehlt <code>https://</code>, wird es ergänzt.
        </p>
        {/*
          role="alert" ist hier keine Zierde: ohne einen Weg, die Meldung
          anzusagen, bleibt aria-errormessage wirkungslos — wer nicht auf den
          Bildschirm sieht, erfaehrt vom Fehler sonst nichts.
        */}
        {fehler && (
          <p className="meldung meldung--fehler" id="adressen-fehler" role="alert">
            {fehler}
          </p>
        )}
      </div>

      <fieldset className="feldgruppe">
        <legend>Prüfstandard</legend>
        <div className="auswahl">
          <label>
            <input
              type="radio"
              name="standard"
              value="2.1"
              checked={standard === '2.1'}
              onChange={() => setzeStandard('2.1')}
            />
            WCAG 2.1, Level AA (50 Kriterien)
          </label>
          <label>
            <input
              type="radio"
              name="standard"
              value="2.2"
              checked={standard === '2.2'}
              onChange={() => setzeStandard('2.2')}
            />
            WCAG 2.2, Level AA (55 Kriterien)
          </label>
        </div>
      </fieldset>

      <Sprachmodell aktiv={stufe2} standard={standard} beiAenderung={setzeStufe2} />

      <div className="knopfreihe">
        <button type="submit" disabled={beschaeftigt}>
          {beschaeftigt ? 'Prüfung läuft …' : 'Prüfung starten'}
        </button>
      </div>
    </form>
  );
}
