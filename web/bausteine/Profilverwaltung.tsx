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

import { useEffect, useState } from 'react';

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
import type { GefundeneSeite, Profil, Standard } from '../typen';

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
  const [fehler, setzeFehler] = useState<string | null>(null);

  // Vorschlagsfunktion (K-06)
  const [startadresse, setzeStartadresse] = useState('');
  const [sucht, setzeSucht] = useState(false);
  const [kandidaten, setzeKandidaten] = useState<GefundeneSeite[]>([]);
  const [uebernommen, setzeUebernommen] = useState<Set<string>>(new Set());

  useEffect(() => {
    void aktualisiere();
  }, []);

  async function aktualisiere(): Promise<void> {
    try {
      setzeProfile(await ladeProfile());
    } catch (e) {
      setzeFehler(alsText(e));
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
      setzeFehler('Ein Profil braucht einen Namen.');
      return;
    }
    if (seiten.length === 0) {
      setzeFehler('Ein Profil braucht mindestens eine Seite.');
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
      setzeFehler(alsText(e));
    }
  }

  async function entferne(profil: Profil): Promise<void> {
    try {
      await loescheProfil(profil.id);
      setzeMeldung(`Profil „${profil.name}“ gelöscht.`);
      await aktualisiere();
    } catch (e) {
      setzeFehler(alsText(e));
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
      setzeFehler(alsText(e));
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
      setzeFehler(e instanceof SyntaxError ? 'Die Datei enthält kein lesbares JSON.' : alsText(e));
    } finally {
      ereignis.target.value = '';
    }
  }

  /** Kandidatenliste aus einem einmaligen Crawl holen (K-06). */
  async function schlageVor(): Promise<void> {
    if (!startadresse.trim()) {
      setzeFehler('Bitte geben Sie an, wo der Crawl beginnen soll.');
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
      setzeFehler(alsText(e));
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
                          <button type="button" className="zweitrangig" onClick={() => void entferne(profil)}>
                            Löschen<span className="nur-fuer-screenreader">: {profil.name}</span>
                          </button>
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
              placeholder="Schnellprüfung"
            />
            <p className="hilfetext">
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
                    placeholder="beispiel.de/kontakt"
                    spellCheck={false}
                  />

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
                      Zeile {nummer + 1} entfernen
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
              aria-describedby="vorschlag-hilfe"
            />
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
