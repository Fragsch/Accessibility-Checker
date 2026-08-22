/**
 * Prüfprofile anlegen, ändern, löschen, austauschen (K-03 bis K-07).
 *
 * Das Prüfprofil ist die Arbeitsform für den Regelbetrieb: eine kuratierte
 * Auswahl repräsentativer Seiten, einmal angelegt und danach wiederverwendet.
 * Der Zweck ist Vergleichbarkeit über die Zeit — deshalb gehört auch der
 * Prüfstandard ins Profil (K-13) und wird hier mitgepflegt.
 *
 * Die Vorschlagsfunktion (K-06) liefert eine Kandidatenliste aus einem
 * einmaligen Crawl. Übernommen wird daraus nur, was ein Mensch ankreuzt: Eine
 * bewusst gewählte Seite ist mehr wert als eine gefundene.
 */

import { useEffect, useRef, useState } from 'react';

import {
  ApiFehler,
  aendereProfil,
  holeProfilAustausch,
  importiereProfil,
  ladeProfile,
  legeProfilAn,
  loescheProfil,
  schlageSeitenVor,
} from '../api';
import type { Feldfehler, GefundeneSeite, Profil, Standard } from '../typen';
import { Bestaetigung } from './Bestaetigung';
import { Feldmeldung, fehlerbezug, zeigeFehlerfeld } from './Feldfehler';
import { Loeschknopf } from './Loeschknopf';

interface Eigenschaften {
  beiFertig: () => void;
}

interface Zeile {
  url: string;
  bezeichnung: string;
  zweck: string;
}

const LEERE_ZEILE: Zeile = { url: '', bezeichnung: '', zweck: '' };

export function Profilverwaltung({ beiFertig }: Eigenschaften): React.ReactElement {
  const [profile, setzeProfile] = useState<Profil[]>([]);
  const [bearbeitet, setzeBearbeitet] = useState<number | 'neu' | null>(null);
  const [name, setzeName] = useState('');
  const [standard, setzeStandard] = useState<Standard>('2.1');
  const [zeilen, setzeZeilen] = useState<Zeile[]>([{ ...LEERE_ZEILE }]);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [fehler, setzeFehler] = useState<Feldfehler | null>(null);

  /*
    Das Profil, zu dem gerade nachgefragt wird — das ganze Profil, nicht nur
    seine Nummer: Der Dialog nennt seinen Namen, und den muesste er sich sonst
    aus der Liste zurueckholen, waehrend diese gerade neu geladen wird.
  */
  const [nachfrage, setzeNachfrage] = useState<Profil | null>(null);

  /*
    Der Fokus nach dem Loeschen.

    Sonst uebernimmt das der Dialog: Er gibt den Fokus beim Schliessen dorthin
    zurueck, wo er hergekommen ist. Nach einem Loeschen ist das der Knopf einer
    Zeile, die es nicht mehr gibt — der Fokus faellt auf den Seitenanfang, und
    wer mit der Tastatur arbeitet, steht ohne Vorwarnung wieder ganz oben.

    Er geht deshalb auf die Meldung. Sie ist die Antwort auf die Handlung und
    nennt das geloeschte Profil beim Namen.
  */
  const meldungsfeld = useRef<HTMLParagraphElement>(null);
  const fokusAufMeldung = useRef(false);

  // Vorschlagsfunktion (K-06)
  const [startadresse, setzeStartadresse] = useState('');
  const [sucht, setzeSucht] = useState(false);
  const [kandidaten, setzeKandidaten] = useState<GefundeneSeite[]>([]);
  const [uebernommen, setzeUebernommen] = useState<Set<string>>(new Set());

  useEffect(() => {
    void aktualisiere();
  }, []);

  /*
    Der Fokus wandert auf das Feld, das den Fehler traegt.

    In einem Effekt und nicht gleich beim Abschicken: Erst danach steht
    `aria-invalid` am Feld und die Meldung darunter im Markup.

    Das war der eigentliche Mangel dieser Ansicht. Das Formular ist lang, der
    Knopf „Profil speichern" steht ganz unten, und die Meldung erschien ganz
    oben — ausserhalb des Bildes. Wer ohne Eingabe speicherte, sah gar nichts
    geschehen und hielt den Knopf fuer kaputt.
  */
  useEffect(() => {
    if (fehler?.feld) zeigeFehlerfeld(fehler.feld);
  }, [fehler]);

  /*
    Ein behobener Fehler verschwindet, sobald er behoben ist.

    Sonst steht die Meldung noch unter dem Feld, waehrend daneben schon der
    Name getippt ist — sie widerspricht dem, was zu sehen ist, und wer sie
    liest, sucht einen Fehler, den es nicht mehr gibt.

    Geprueft wird die Bedingung, die den Fehler erzeugt hat, und nicht bloss,
    ob im Feld etwas steht: „Ein Profil braucht mindestens eine Seite" gilt so
    lange, wie keine der Zeilen eine Adresse traegt — auch wenn die erste,
    an der die Meldung haengt, leer bleibt.

    Nur entfernt wird hier, nie hinzugefuegt. Wer beim Tippen nach dem dritten
    Zeichen erfaehrt, seine Eingabe sei ungueltig, bekommt eine Bewertung fuer
    etwas, das er noch gar nicht abgeschickt hat.
  */
  useEffect(() => {
    if (!fehler?.feld) return;

    const behoben =
      (fehler.feld === 'profil-name' && name.trim() !== '') ||
      (fehler.feld === 'url-0' && zeilen.some((zeile) => zeile.url.trim() !== '')) ||
      (fehler.feld === 'vorschlag-start' && startadresse.trim() !== '');

    if (behoben) setzeFehler(null);
  }, [fehler, name, zeilen, startadresse]);

  useEffect(() => {
    if (!fokusAufMeldung.current || meldung === null) return;
    fokusAufMeldung.current = false;
    meldungsfeld.current?.focus();
  }, [meldung]);

  async function aktualisiere(): Promise<void> {
    try {
      setzeProfile(await ladeProfile());
    } catch (e) {
      setzeFehler({ text: alsText(e) });
    }
  }

  function beginneNeu(): void {
    setzeBearbeitet('neu');
    setzeName('');
    setzeStandard('2.1');
    setzeZeilen([{ ...LEERE_ZEILE }]);
    setzeKandidaten([]);
    setzeUebernommen(new Set());
    setzeFehler(null);
  }

  function beginneAendern(profil: Profil): void {
    setzeBearbeitet(profil.id);
    setzeName(profil.name);
    setzeStandard(profil.standard);
    setzeZeilen(
      profil.seiten.map((seite) => ({
        url: seite.url,
        bezeichnung: seite.bezeichnung,
        zweck: seite.zweck ?? '',
      })),
    );
    setzeKandidaten([]);
    setzeUebernommen(new Set());
    setzeFehler(null);
  }

  async function speichere(ereignis: React.FormEvent): Promise<void> {
    ereignis.preventDefault();

    const seiten = zeilen
      .filter((zeile) => zeile.url.trim())
      .map((zeile) => ({
        url: zeile.url.trim(),
        bezeichnung: zeile.bezeichnung.trim(),
        zweck: zeile.zweck.trim() || null,
      }));

    if (!name.trim()) {
      // „Bitte geben Sie …" und nicht „Ein Profil braucht …": Das eine sagt,
      // was zu tun ist, das andere stellt eine Tatsache fest (3.3.3).
      setzeFehler({ feld: 'profil-name', text: 'Bitte geben Sie dem Profil einen Namen.' });
      return;
    }
    if (seiten.length === 0) {
      // Gemeint ist die erste Adresszeile: Dort faengt an, was fehlt.
      setzeFehler({
        feld: 'url-0',
        text: 'Ein Profil braucht mindestens eine Seite. Bitte tragen Sie hier eine Adresse ein, etwa beispiel.de/kontakt.',
      });
      return;
    }

    try {
      const eingabe = { name: name.trim(), standard, seiten };
      const gespeichert =
        bearbeitet === 'neu' ? await legeProfilAn(eingabe) : await aendereProfil(bearbeitet as number, eingabe);

      setzeFehler(null);
      setzeMeldung(`Profil „${gespeichert.name}“ gespeichert (${gespeichert.seiten.length} Seiten).`);
      setzeBearbeitet(null);
      await aktualisiere();
    } catch (e) {
      setzeFehler({ text: alsText(e) });
    }
  }

  async function entferne(profil: Profil): Promise<void> {
    try {
      await loescheProfil(profil.id);
      // Erst den Dialog zu, dann die Meldung: Solange er offen ist, ist alles
      // dahinter `inert`, und der Fokus koennte gar nicht auf die Meldung.
      setzeNachfrage(null);
      fokusAufMeldung.current = true;
      setzeMeldung(`Profil „${profil.name}“ gelöscht.`);
      await aktualisiere();
    } catch (e) {
      // Auch im Fehlerfall schliesst der Dialog: Die Fehlermeldung steht in
      // der Ansicht dahinter, und die bleibt `inert`, solange er offen ist.
      setzeNachfrage(null);
      setzeFehler({ text: alsText(e) });
    }
  }

  /** Profil als JSON sichern, damit es im Projekt versioniert werden kann (K-07). */
  async function exportiere(profil: Profil): Promise<void> {
    try {
      const austausch = await holeProfilAustausch(profil.id);
      const datei = new Blob([JSON.stringify(austausch, null, 2)], { type: 'application/json' });
      const adresse = URL.createObjectURL(datei);
      const verweis = document.createElement('a');
      verweis.href = adresse;
      verweis.download = `pruefprofil-${profil.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
      verweis.click();
      URL.revokeObjectURL(adresse);
    } catch (e) {
      setzeFehler({ text: alsText(e) });
    }
  }

  async function importiere(ereignis: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const datei = ereignis.target.files?.[0];
    if (!datei) return;

    try {
      const eingelesen = JSON.parse(await datei.text()) as unknown;
      const profil = await importiereProfil(eingelesen);
      setzeMeldung(`Profil „${profil.name}“ übernommen.`);
      setzeFehler(null);
      await aktualisiere();
    } catch (e) {
      setzeFehler({ text: e instanceof SyntaxError ? 'Die Datei enthält kein lesbares JSON.' : alsText(e) });
    } finally {
      ereignis.target.value = '';
    }
  }

  /** Kandidatenliste aus einem einmaligen Crawl holen (K-06). */
  async function schlageVor(): Promise<void> {
    if (!startadresse.trim()) {
      setzeFehler({ feld: 'vorschlag-start', text: 'Bitte geben Sie an, wo der Crawl beginnen soll.' });
      return;
    }

    setzeSucht(true);
    setzeFehler(null);
    try {
      const ergebnis = await schlageSeitenVor({
        start: startadresse.trim(),
        hoechsttiefe: 2,
        hoechstzahl: 40,
        verzoegerungMs: 500,
        robotsBeachten: true,
      });
      setzeKandidaten(ergebnis.seiten);
      setzeMeldung(
        `${ergebnis.seiten.length} Seiten gefunden` +
          (ergebnis.durchRobotsAusgeschlossen.length > 0
            ? `, ${ergebnis.durchRobotsAusgeschlossen.length} durch robots.txt ausgelassen`
            : '') +
          '. Kreuzen Sie an, was ins Profil soll.',
      );
    } catch (e) {
      setzeFehler({ text: alsText(e) });
    } finally {
      setzeSucht(false);
    }
  }

  function schalteKandidat(seite: GefundeneSeite): void {
    const naechste = new Set(uebernommen);
    if (naechste.has(seite.url)) {
      naechste.delete(seite.url);
      setzeZeilen((bisher) => bisher.filter((zeile) => zeile.url !== seite.url));
    } else {
      naechste.add(seite.url);
      setzeZeilen((bisher) => [
        ...bisher.filter((zeile) => zeile.url.trim()),
        { url: seite.url, bezeichnung: seite.vermuteterZweck ?? seite.titel, zweck: seite.vermuteterZweck ?? '' },
      ]);
    }
    setzeUebernommen(naechste);
  }

  return (
    <section aria-label="Prüfprofile">
      {/*
        `tabIndex={-1}`: Nach dem Löschen ist der Knopf fort, an den der Dialog
        den Fokus zurückgäbe. Er kommt stattdessen hierher — angesprungen wird
        die Meldung nur aus dem Programm, in der Tabulatorreihenfolge steht sie
        nicht.
      */}
      {meldung && (
        <p className="meldung" role="status" tabIndex={-1} ref={meldungsfeld}>
          {meldung}
        </p>
      )}
      {/*
        Oben steht nur noch, was zu keinem Feld gehoert — eine Datei ohne
        lesbares JSON, eine Schnittstelle, die nicht antwortet. Dorthin kann
        der Fokus nicht springen, weil es keine Stelle im Formular gibt, an der
        etwas zu berichtigen waere. Alles Uebrige steht an seinem Feld.
      */}
      {fehler && !fehler.feld && (
        <p className="meldung meldung--fehler" role="alert">
          {fehler.text}
        </p>
      )}

      {bearbeitet === null ? (
        <>
          <h3>Gespeicherte Profile</h3>

          {profile.length === 0 ? (
            <p>Noch kein Profil angelegt.</p>
          ) : (
            <div className="tabellenrahmen" tabIndex={0} role="region" aria-label="Gespeicherte Prüfprofile">
              <table className="tabelle">
                <caption className="nur-fuer-screenreader">Gespeicherte Prüfprofile</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Seiten</th>
                    <th scope="col">Standard</th>
                    <th scope="col">Angelegt</th>
                    <th scope="col">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.map((profil) => (
                    <tr key={profil.id}>
                      <th scope="row">{profil.name}</th>
                      <td>{profil.seiten.length}</td>
                      <td>WCAG {profil.standard}</td>
                      <td>{new Date(profil.angelegtAm).toLocaleDateString('de-DE')}</td>
                      <td>
                        <div className="knopfreihe knopfreihe--eng">
                          <button type="button" className="zweitrangig" onClick={() => beginneAendern(profil)}>
                            Ändern<span className="nur-fuer-screenreader">: {profil.name}</span>
                          </button>
                          <button type="button" className="zweitrangig" onClick={() => void exportiere(profil)}>
                            Exportieren<span className="nur-fuer-screenreader">: {profil.name}</span>
                          </button>
                          {/*
                            Nur als Sinnbild, und erst nach einer Rueckfrage.

                            Bisher stand hier ein drittes beschriftetes Wort —
                            die Zelle wurde damit die breiteste der Tabelle —
                            und ein Druck darauf loeschte das Profil sofort.
                            Ein Profil ist Handarbeit: eine kuratierte Auswahl
                            von Seiten, die jemand einzeln zusammengetragen hat
                            (K-03). Es ohne Rueckfrage zu verlieren, war der
                            groessere der beiden Mangel.
                          */}
                          <Loeschknopf betreff={profil.name} beiKlick={() => setzeNachfrage(profil)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="feldgruppe">
            <label htmlFor="profil-import">Profil aus Datei übernehmen</label>
            <input id="profil-import" type="file" accept="application/json,.json" onChange={(e) => void importiere(e)} />
            <p className="hilfetext">
              Erwartet wird eine Datei, die dieses Werkzeug exportiert hat. Adressen bleiben dabei vollständig erhalten.
            </p>
          </div>

          <div className="knopfreihe">
            <button type="button" onClick={beginneNeu}>
              Neues Profil anlegen
            </button>
            <button type="button" className="zweitrangig" onClick={beiFertig}>
              Zurück zum Prüfauftrag
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void speichere(e)} noValidate>
          <h3>{bearbeitet === 'neu' ? 'Neues Profil' : 'Profil ändern'}</h3>

          <div className="feldgruppe">
            <label htmlFor="profil-name">Name des Profils</label>
            <input
              id="profil-name"
              type="text"
              value={name}
              onChange={(e) => setzeName(e.target.value)}
              required
              {...fehlerbezug(fehler, 'profil-name', 'profil-name-hilfe')}
              placeholder="Schnellprüfung"
            />
            <Feldmeldung fehler={fehler} feld="profil-name" />
            <p className="hilfetext" id="profil-name-hilfe">
              Etwa „Schnellprüfung“ mit 5 Seiten oder „Vollabnahme“ mit 25. Mehrere Profile je Projekt sind vorgesehen.
            </p>
          </div>

          <fieldset className="feldgruppe">
            <legend>Prüfstandard des Profils</legend>
            <div className="auswahl">
              <label>
                <input
                  type="radio"
                  name="profil-standard"
                  checked={standard === '2.1'}
                  onChange={() => setzeStandard('2.1')}
                />
                WCAG 2.1, Level AA
              </label>
              <label>
                <input
                  type="radio"
                  name="profil-standard"
                  checked={standard === '2.2'}
                  onChange={() => setzeStandard('2.2')}
                />
                WCAG 2.2, Level AA
              </label>
            </div>
            <p className="hilfetext">
              Der Standard bleibt im Profil gespeichert. Ein Wiederholungslauf gegen eine andere Fassung wäre mit dem
              Vorlauf nicht vergleichbar.
            </p>
          </fieldset>

          <h4>Seiten des Profils</h4>
          <ol className="profilzeilen">
            {zeilen.map((zeile, nummer) => (
              <li key={nummer}>
                <div className="feldgruppe">
                  <label htmlFor={`url-${nummer}`}>Adresse {nummer + 1}</label>
                  <input
                    id={`url-${nummer}`}
                    type="text"
                    value={zeile.url}
                    onChange={(e) => aendereZeile(setzeZeilen, nummer, { url: e.target.value })}
                    {...fehlerbezug(fehler, `url-${nummer}`)}
                    placeholder="beispiel.de/kontakt"
                    spellCheck={false}
                  />
                  <Feldmeldung fehler={fehler} feld={`url-${nummer}`} />

                  <label htmlFor={`bezeichnung-${nummer}`}>Bezeichnung</label>
                  <input
                    id={`bezeichnung-${nummer}`}
                    type="text"
                    value={zeile.bezeichnung}
                    onChange={(e) => aendereZeile(setzeZeilen, nummer, { bezeichnung: e.target.value })}
                    placeholder="Kontaktformular"
                  />

                  <label htmlFor={`zweck-${nummer}`}>Zweckvermerk (optional)</label>
                  <input
                    id={`zweck-${nummer}`}
                    type="text"
                    value={zeile.zweck}
                    onChange={(e) => aendereZeile(setzeZeilen, nummer, { zweck: e.target.value })}
                    placeholder="Formular mit Pflichtfeldern"
                  />

                  <div className="knopfreihe knopfreihe--eng">
                    <button
                      type="button"
                      className="zweitrangig"
                      onClick={() => setzeZeilen((bisher) => bisher.filter((_, i) => i !== nummer))}
                      disabled={zeilen.length === 1}
                    >
                      {/*
                        „Seite", nicht „Zeile": Die Karte darueber traegt die
                        Adresse einer Seite des Profils, und der Knopf darunter
                        heisst „Seite hinzufuegen". Die Nummer bleibt — sie
                        unterscheidet die sonst gleich lautenden Knoepfe fuer
                        eine Sprachausgabe (4.1.2) und benennt dieselbe Zahl
                        wie die Beschriftung „Adresse N" im Feld darueber.
                      */}
                      Seite {nummer + 1} entfernen
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="knopfreihe">
            <button type="button" className="zweitrangig" onClick={() => setzeZeilen((b) => [...b, { ...LEERE_ZEILE }])}>
              Seite hinzufügen
            </button>
          </div>

          <fieldset className="feldgruppe">
            <legend>Seiten vorschlagen lassen</legend>
            <label htmlFor="vorschlag-start">Startadresse für die Suche</label>
            <input
              id="vorschlag-start"
              type="text"
              value={startadresse}
              onChange={(e) => setzeStartadresse(e.target.value)}
              placeholder="beispiel.de"
              spellCheck={false}
              {...fehlerbezug(fehler, 'vorschlag-start', 'vorschlag-hilfe')}
            />
            <Feldmeldung fehler={fehler} feld="vorschlag-start" />
            <p className="hilfetext" id="vorschlag-hilfe">
              Ein einmaliger Crawl sammelt Kandidaten. Was davon ins Profil kommt, entscheiden Sie.
            </p>
            <div className="knopfreihe">
              <button type="button" className="zweitrangig" onClick={() => void schlageVor()} disabled={sucht}>
                {sucht ? 'Seiten werden gesucht …' : 'Seiten suchen'}
              </button>
            </div>

            {kandidaten.length > 0 && (
              <ul className="kandidaten">
                {kandidaten.map((seite) => (
                  <li key={seite.url}>
                    <label className="ankreuzfeld">
                      <input
                        type="checkbox"
                        checked={uebernommen.has(seite.url)}
                        onChange={() => schalteKandidat(seite)}
                      />
                      <span>
                        {seite.titel || seite.url}
                        {seite.vermuteterZweck && <span className="hilfetext"> — vermutlich: {seite.vermuteterZweck}</span>}
                        <span className="hilfetext"> {seite.url}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <div className="knopfreihe">
            <button type="submit">Profil speichern</button>
            <button type="button" className="zweitrangig" onClick={() => setzeBearbeitet(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {/*
        Ein Dialog für die ganze Ansicht, nicht einer je Zeile: Offen ist immer
        höchstens einer, und mehrere im Baum wären mehrfach dieselbe
        Überschrift.

        Er steht außerhalb der Verzweigung zwischen Liste und Formular. Beim
        Wechsel dorthin würde er sonst mitsamt seinem Zustand ausgehängt — und
        ein `dialog`, der aus dem Baum verschwindet statt sich zu schließen,
        nimmt den Fokus mit ins Nichts.

        Was die Folge nennt, ist nachgesehen und nicht vermutet: `scan.profil_id`
        steht im Schema auf `ON DELETE SET NULL`. Die Prüfungen bleiben also,
        nur ihr Bezug geht verloren — und mit ihm bei namenlosen Läufen die
        Bezeichnung in der Liste, die sich aus dem Profilnamen speiste.
      */}
      <Bestaetigung
        offen={nachfrage !== null}
        titel="Profil löschen?"
        betreff={nachfrage?.name ?? ''}
        folge={
          nachfrage
            ? `wird mit ${nachfrage.seiten.length === 1 ? 'seiner einen Seite' : `seinen ${nachfrage.seiten.length} Seiten`} gelöscht. Bereits gelaufene Prüfungen bleiben erhalten, verlieren aber den Bezug zu diesem Profil. Das lässt sich nicht rückgängig machen.`
            : ''
        }
        bestaetigenText="Ja, löschen"
        beiBestaetigen={() => {
          if (nachfrage) void entferne(nachfrage);
        }}
        beiAbbrechen={() => setzeNachfrage(null)}
      />
    </section>
  );
}

function aendereZeile(
  setzeZeilen: React.Dispatch<React.SetStateAction<Zeile[]>>,
  nummer: number,
  aenderung: Partial<Zeile>,
): void {
  setzeZeilen((bisher) => bisher.map((zeile, i) => (i === nummer ? { ...zeile, ...aenderung } : zeile)));
}

function alsText(e: unknown): string {
  return e instanceof ApiFehler ? e.message : String(e);
}
