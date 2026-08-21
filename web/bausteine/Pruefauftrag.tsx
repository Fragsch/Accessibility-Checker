/**
 * Eingabe des Prüfauftrags: Betriebsart, Adressen, Prüfstandard (K-01, K-02).
 *
 * Drei Betriebsarten, drei Eingabeformen — aber ein Formular. Die Alternative
 * wären drei Masken, zwischen denen man sich vorab entscheiden müsste, ohne zu
 * sehen, was die andere verlangt.
 *
 * Ein `submit`, kein Knopf mit Klickbehandlung: damit die Eingabetaste im
 * Adressfeld tut, was jeder erwartet.
 */

import { useEffect, useState } from 'react';

import { ladeProfile } from '../api';
import type { Auftrag, Betriebsart, Profil, Standard } from '../typen';
import { Sprachmodell } from './Sprachmodell';

interface Eigenschaften {
  beschaeftigt: boolean;
  beiStart: (auftrag: Auftrag) => void;
  /** Wechsel in die Profilverwaltung (K-03). */
  beiProfilverwaltung: () => void;
}

/**
 * Eine Fehlermeldung samt dem Feld, das sie meint.
 *
 * Vorher trug das Formular nur den Meldungstext, und `aria-invalid` sass
 * unbesehen am Adressfeld. Seit es mehr als ein Pflichtfeld gibt, waere das
 * falsch: Wer den Namen vergisst, bekaeme das Adressfeld als fehlerhaft
 * angesagt und suchte dort nach einem Fehler, den es nicht gibt (3.3.1).
 */
interface Feldfehler {
  text: string;
  feld: 'name' | 'adressen' | 'profil' | 'startadresse' | 'anmeldung';
}

export function Pruefauftrag({ beschaeftigt, beiStart, beiProfilverwaltung }: Eigenschaften): React.ReactElement {
  const [betriebsart, setzeBetriebsart] = useState<Betriebsart>('einzelseite');
  const [name, setzeName] = useState('');
  const [adressen, setzeAdressen] = useState('');
  const [standard, setzeStandard] = useState<Standard>('2.1');
  const [stufe2, setzeStufe2] = useState(false);
  const [profile, setzeProfile] = useState<Profil[]>([]);
  const [profilId, setzeProfilId] = useState<number | null>(null);
  const [fehler, setzeFehler] = useState<Feldfehler | null>(null);

  // Gesamtprüfung (K-08, K-09)
  const [startadresse, setzeStartadresse] = useState('');
  const [hoechsttiefe, setzeHoechsttiefe] = useState(2);
  const [hoechstzahl, setzeHoechstzahl] = useState(30);
  const [einschluss, setzeEinschluss] = useState('');
  const [ausschluss, setzeAusschluss] = useState('');
  const [verzoegerung, setzeVerzoegerung] = useState(500);
  const [robots, setzeRobots] = useState(true);

  // Anmeldung (S-01)
  const [mitAnmeldung, setzeMitAnmeldung] = useState(false);
  const [anmeldeadresse, setzeAnmeldeadresse] = useState('');

  useEffect(() => {
    void ladeProfile()
      .then(setzeProfile)
      .catch(() => setzeProfile([]));
  }, []);

  // Der Standard gehoert zum Profil (K-13). Wer eines waehlt, soll sehen,
  // gegen welche Fassung gemessen wird — und sie nicht versehentlich aendern.
  const gewaehltesProfil = profile.find((p) => p.id === profilId) ?? null;

  function abschicken(ereignis: React.FormEvent): void {
    ereignis.preventDefault();

    const anmeldung = mitAnmeldung ? anmeldeadresse.trim() : '';
    if (mitAnmeldung && !anmeldung) {
      setzeFehler({ feld: 'anmeldung', text: 'Bitte geben Sie die Adresse an, auf der Sie sich anmelden.' });
      return;
    }

    /*
      Der Name ist Pflicht, sobald der Auftrag aus freier Eingabe entsteht.
      Beim Pruefprofil nicht: Dort traegt der Profilname die Kennzeichnung, und
      ein zweiter Name daneben sagte dasselbe noch einmal.
    */
    const benennung = name.trim();
    if (betriebsart !== 'profil' && !benennung) {
      setzeFehler({ feld: 'name', text: 'Bitte geben Sie der Prüfung einen Namen.' });
      return;
    }

    const gemeinsam = {
      standard,
      stufe2,
      ...(benennung ? { name: benennung } : {}),
      ...(mitAnmeldung ? { anmeldung: { url: anmeldung } } : {}),
    };

    if (betriebsart === 'gesamt') {
      const start = startadresse.trim();
      if (!start) {
        setzeFehler({ feld: 'startadresse', text: 'Bitte geben Sie die Adresse an, bei der der Crawl beginnen soll.' });
        return;
      }

      setzeFehler(null);
      beiStart({
        ...gemeinsam,
        betriebsart: 'gesamt',
        crawl: {
          start,
          hoechsttiefe,
          hoechstzahl,
          verzoegerungMs: verzoegerung,
          robotsBeachten: robots,
          ...(zerlege(einschluss).length > 0 ? { einschluss: zerlege(einschluss) } : {}),
          ...(zerlege(ausschluss).length > 0 ? { ausschluss: zerlege(ausschluss) } : {}),
        },
      });
      return;
    }

    if (betriebsart === 'profil') {
      if (profilId === null) {
        setzeFehler({ feld: 'profil', text: 'Bitte wählen Sie ein Prüfprofil aus.' });
        return;
      }
      setzeFehler(null);
      beiStart({ ...gemeinsam, betriebsart: 'profil', profilId });
      return;
    }

    const urls = adressen
      .split('\n')
      .map((zeile) => zeile.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      setzeFehler({ feld: 'adressen', text: 'Bitte geben Sie mindestens eine Adresse an.' });
      return;
    }

    setzeFehler(null);
    beiStart({ ...gemeinsam, betriebsart: urls.length > 1 ? 'profil' : 'einzelseite', urls });
  }

  return (
    <form onSubmit={abschicken} noValidate>
      {/*
        Die Betriebsart und ihre Eingaben stehen in einer Karte: Was hier
        einzutragen ist, haengt an der Wahl darueber und wechselt mit ihr. Zwei
        Karten machten daraus zwei Themen.
      */}
      <div className="feldgruppen">
        <fieldset className="feldgruppe">
          <legend>Was soll geprüft werden?</legend>
          <div className="auswahl">
            <label>
              <input
                type="radio"
                name="betriebsart"
                checked={betriebsart === 'einzelseite'}
                onChange={() => setzeBetriebsart('einzelseite')}
              />
              Einzelne Adressen
            </label>
            <label>
              <input
                type="radio"
                name="betriebsart"
                checked={betriebsart === 'profil'}
                onChange={() => setzeBetriebsart('profil')}
              />
              Gespeichertes Prüfprofil
            </label>
            <label>
              <input
                type="radio"
                name="betriebsart"
                checked={betriebsart === 'gesamt'}
                onChange={() => setzeBetriebsart('gesamt')}
              />
              Gesamtprüfung über die Domain
            </label>
          </div>
        </fieldset>

        {/*
          Der Name der Pruefung.

          Er steht vor den Adressen, nicht dahinter: Wer eine Pruefung anlegt,
          weiss in diesem Augenblick noch, wozu sie dient — spaeter in der
          Liste weiss es niemand mehr. Beim Pruefprofil entfaellt das Feld,
          weil der Profilname diese Aufgabe schon erfuellt.

          `required` steht im Markup und nicht nur in der Pruefung beim
          Abschicken: Eine Sprachausgabe sagt die Pflicht damit beim Betreten
          des Feldes an und nicht erst, nachdem das Formular abgewiesen wurde
          (3.3.2). Die Sternchen-Schreibweise bleibt weg — sie traegt fuer
          sich genommen keine Bedeutung, und der Hinweis darunter sagt es in
          Worten.
        */}
        {betriebsart !== 'profil' && (
          <div className="feldgruppe">
            <label htmlFor="pruefungsname">Name der Prüfung</label>
            <input
              id="pruefungsname"
              type="text"
              value={name}
              onChange={(e) => setzeName(e.target.value)}
              required
              aria-describedby="pruefungsname-hilfe"
              {...(fehler?.feld === 'name' ? { 'aria-invalid': true, 'aria-errormessage': 'auftrag-fehler' } : {})}
              placeholder="Relaunch Startseite, Stand August"
              maxLength={200}
            />
            <p className="hilfetext" id="pruefungsname-hilfe">
              Pflichtangabe. Unter diesem Namen steht die Prüfung später in der Liste der bisherigen Prüfungen — ohne
              ihn sind zwei Läufe über dieselbe Seite dort nicht zu unterscheiden.
            </p>
          </div>
        )}

        {betriebsart === 'einzelseite' && (
          <div className="feldgruppe">
            <label htmlFor="adressen">Zu prüfende Adressen</label>
            <textarea
              id="adressen"
              value={adressen}
              onChange={(e) => setzeAdressen(e.target.value)}
              aria-describedby="adressen-hilfe"
              {...(fehler?.feld === 'adressen' ? { 'aria-invalid': true, 'aria-errormessage': 'auftrag-fehler' } : {})}
              placeholder="beispiel.de"
              autoComplete="url"
              spellCheck={false}
            />
            <p className="hilfetext" id="adressen-hilfe">
              Eine Adresse je Zeile. Fehlt <code>https://</code>, wird es ergänzt.
            </p>
          </div>
        )}

        {betriebsart === 'profil' && (
          <div className="feldgruppe">
            <label htmlFor="profil">Prüfprofil</label>
            <select
              id="profil"
              value={profilId ?? ''}
              onChange={(e) => setzeProfilId(e.target.value ? Number(e.target.value) : null)}
              aria-describedby="profil-hilfe"
            >
              <option value="">Bitte wählen</option>
              {profile.map((profil) => (
                <option key={profil.id} value={profil.id}>
                  {profil.name} ({profil.seiten.length} Seiten, WCAG {profil.standard})
                </option>
              ))}
            </select>
            <p className="hilfetext" id="profil-hilfe">
              {gewaehltesProfil
                ? `Geprüft wird gegen WCAG ${gewaehltesProfil.standard} — so, wie im Profil hinterlegt. Das hält Wiederholungsläufe vergleichbar.`
                : 'Ein Profil ist eine benannte Liste repräsentativer Seiten. Der Prüfstandard gehört dazu.'}
            </p>
            {profile.length === 0 && <p className="hilfetext">Es ist noch kein Profil angelegt.</p>}
            <div className="knopfreihe">
              <button type="button" className="zweitrangig" onClick={beiProfilverwaltung}>
                Profile verwalten
              </button>
            </div>
          </div>
        )}

        {betriebsart === 'gesamt' && (
          <fieldset className="feldgruppe">
            <legend>Crawl-Grenzen</legend>

            <label htmlFor="startadresse">Startadresse</label>
            <input
              id="startadresse"
              type="text"
              value={startadresse}
              onChange={(e) => setzeStartadresse(e.target.value)}
              required
              {...(fehler?.feld === 'startadresse'
                ? { 'aria-invalid': true, 'aria-errormessage': 'auftrag-fehler' }
                : {})}
              placeholder="beispiel.de"
              autoComplete="url"
              spellCheck={false}
            />

            <label htmlFor="hoechsttiefe">Maximale Tiefe</label>
            <input
              id="hoechsttiefe"
              type="number"
              min={0}
              max={6}
              value={hoechsttiefe}
              onChange={(e) => setzeHoechsttiefe(Number(e.target.value))}
            />

            <label htmlFor="hoechstzahl">Maximale Seitenzahl</label>
            <input
              id="hoechstzahl"
              type="number"
              min={1}
              max={200}
              value={hoechstzahl}
              onChange={(e) => setzeHoechstzahl(Number(e.target.value))}
            />

            <label htmlFor="einschluss">Nur diese Pfade (optional)</label>
            <input
              id="einschluss"
              type="text"
              value={einschluss}
              onChange={(e) => setzeEinschluss(e.target.value)}
              placeholder="/produkte/*, /hilfe/*"
              spellCheck={false}
              aria-describedby="muster-hilfe"
            />

            <label htmlFor="ausschluss">Diese Pfade auslassen (optional)</label>
            <input
              id="ausschluss"
              type="text"
              value={ausschluss}
              onChange={(e) => setzeAusschluss(e.target.value)}
              placeholder="/archiv/*"
              spellCheck={false}
              aria-describedby="muster-hilfe"
            />
            <p className="hilfetext" id="muster-hilfe">
              Mehrere Muster mit Komma trennen. <code>*</code> steht für beliebig viele Zeichen.
            </p>

            <label htmlFor="verzoegerung">Wartezeit zwischen zwei Aufrufen (Millisekunden)</label>
            <input
              id="verzoegerung"
              type="number"
              min={0}
              max={10000}
              step={100}
              value={verzoegerung}
              onChange={(e) => setzeVerzoegerung(Number(e.target.value))}
              aria-describedby="verzoegerung-hilfe"
            />
            <p className="hilfetext" id="verzoegerung-hilfe">
              Ein Crawl ohne Pause ist aus Sicht des Zielservers von einem Angriff kaum zu unterscheiden.
            </p>

            {/*
              Der Text steht in einem `span`: In der Pille ist jedes Kind ein
              eigenes Flex-Element. Ohne die Huelle wuerden `code` und das Wort
              dahinter zu zwei Elementen mit der Luecke der Pille dazwischen —
              aus „robots.txt beachten" wuerde ein zerrissener Satz.
            */}
            <div className="auswahl">
              <label>
                <input type="checkbox" checked={robots} onChange={(e) => setzeRobots(e.target.checked)} />
                <span>
                  <code>robots.txt</code> beachten
                </span>
              </label>
            </div>
          </fieldset>
        )}
      </div>

      {/*
        Anmeldung als Uebergabe an den Menschen (S-01 bis S-03). Der Hinweis
        steht vor der Eingabe, nicht dahinter: Wer hier ein Kennwort erwartet,
        soll sofort lesen, dass keines verlangt wird.
      */}
      <fieldset className="feldgruppe">
        <legend>Geschützter Bereich</legend>
        <div className="auswahl">
          <label>
            <input
              type="checkbox"
              checked={mitAnmeldung}
              onChange={(e) => setzeMitAnmeldung(e.target.checked)}
              aria-describedby="anmeldung-hilfe"
            />
            Vor der Prüfung anmelden
          </label>
        </div>
        <p className="hilfetext" id="anmeldung-hilfe">
          Das Werkzeug öffnet ein sichtbares Browserfenster und wartet. Sie melden sich selbst an. Zugangsdaten werden
          weder erfasst noch gespeichert.
        </p>

        {mitAnmeldung && (
          <>
            <label htmlFor="anmeldeadresse">Adresse der Anmeldeseite</label>
            <input
              id="anmeldeadresse"
              type="text"
              value={anmeldeadresse}
              onChange={(e) => setzeAnmeldeadresse(e.target.value)}
              required
              {...(fehler?.feld === 'anmeldung'
                ? { 'aria-invalid': true, 'aria-errormessage': 'auftrag-fehler' }
                : {})}
              placeholder="beispiel.de/anmelden"
              autoComplete="url"
              spellCheck={false}
            />
          </>
        )}
      </fieldset>

      {betriebsart !== 'profil' && (
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
      )}

      <Sprachmodell aktiv={stufe2} standard={gewaehltesProfil?.standard ?? standard} beiAenderung={setzeStufe2} />

      {/*
        role="alert" ist hier keine Zierde: ohne einen Weg, die Meldung
        anzusagen, bleibt aria-errormessage wirkungslos — wer nicht auf den
        Bildschirm sieht, erfaehrt vom Fehler sonst nichts.
      */}
      {fehler && (
        <p className="meldung meldung--fehler" id="auftrag-fehler" role="alert">
          {fehler.text}
        </p>
      )}

      <div className="knopfreihe">
        <button type="submit" disabled={beschaeftigt}>
          {beschaeftigt ? 'Prüfung läuft …' : 'Prüfung starten'}
        </button>
      </div>
    </form>
  );
}

/** Zerlegt eine Musterliste aus einem Eingabefeld. */
function zerlege(eingabe: string): string[] {
  return eingabe
    .split(',')
    .map((teil) => teil.trim())
    .filter(Boolean);
}
