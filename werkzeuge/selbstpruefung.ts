#!/usr/bin/env node
/**
 * Prueft die eigene Oberflaeche mit dem eigenen Werkzeug (NF-01, ARCHITEKTUR 7).
 *
 *   npm run build && npm run pruefe:selbst
 *
 * Der Reiz und die Schwierigkeit liegen darin, dass eine Einzelseitenanwendung
 * drei Ansichten hat, die nacheinander im selben Dokument erscheinen. Eine
 * Pruefung der Startadresse sieht nur das Formular — und damit den geringsten
 * Teil des Markups. Deshalb wird hier bedient, nicht bloss geladen: Auftrag
 * ausfuellen, Pruefung starten, Ergebnis aufklappen, und in jedem dieser
 * Zustaende messen.
 *
 * Beendet sich mit Code 1, sobald in einer Ansicht ein Verstoss belegt ist.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Browser } from '../src/scan/browser.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { ENGINES } from '../src/stufe1/index.js';
import { fuegeZusammen } from '../src/stufe1/engine.js';
import type { EngineErgebnis, EngineKontext } from '../src/stufe1/engine.js';
import { normalisiere } from '../src/stufe1/normalisierung.js';
import { VIEWPORT_SCHREIBTISCH } from '../src/scan/browser.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import { oeffneDatenbank, selbstpruefungDatenbankPfad, verwirfDatenbank } from '../src/db/index.js';
import { baueServer } from '../src/server/index.js';
import type { Befund, Standard } from '../src/typen/index.js';
import type { Page } from 'playwright';

const PORT = Number(process.env['PORT_SELBSTPRUEFUNG'] ?? 3199);
const STANDARD: Standard = '2.1';

interface Ansicht {
  name: string;
  vorbereiten: (seite: Page) => Promise<void>;
}

/** Die zu pruefende Seite: die eigene Oberflaeche in ihren drei Zustaenden. */
const ANSICHTEN: Ansicht[] = [
  {
    name: 'Auftrag — Formular',
    /*
      Mit aufgeklappter Erklaerung: Die Blase steht nur im Baum, solange sie
      offen ist. Zugeklappt gaebe es hier nichts zu messen — und ein Stueck
      Markup, das die eigene Pruefung nie zu sehen bekommt, ist ungeprueft,
      gleich wie oft der Lauf gruen ausgeht.
    */
    vorbereiten: async (seite) => {
      await seite.getByRole('button', { name: 'Wonach geprüft wird und wo die Daten bleiben' }).click();
      await seite.getByRole('note').waitFor();
    },
  },
  {
    name: 'Auftrag — mit Fehlermeldung',
    /*
      Der Name wird vorher ausgefuellt, damit die Meldung die des Adressfeldes
      ist und nicht die des Namensfeldes davor. Gemessen werden soll ein
      Formular, das schon eine Pflichtangabe hinter sich hat und an der
      naechsten haengt — dort steht die Fehlermeldung neben ausgefuellten
      Feldern, und genau dieser Zustand ist der schwierigere.
    */
    vorbereiten: async (seite) => {
      await seite.getByLabel('Name der Prüfung').fill('Selbstprüfung');
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();
      await seite.getByText('Bitte geben Sie mindestens eine Adresse an.').waitFor();
    },
  },
  {
    name: 'Ergebnis — alle Kriterien aufgeklappt',
    vorbereiten: async (seite) => {
      const beispiel = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'mangelhaft.html')).href;

      await seite.getByLabel('Name der Prüfung').fill('Selbstprüfung');
      await seite.getByLabel('Zu prüfende Adressen').fill(beispiel);
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();

      await seite.getByRole('heading', { name: /^Ergebnis/ }).waitFor({ timeout: 120_000 });

      /*
        Auch die nicht anwendbaren einblenden, damit jede Zeile im DOM steht.

        Ueber die Rolle und nicht ueber die Beschriftung allein: „Nicht
        anwendbar" heissen auch die Statuspunkte an den Zeilen — sie tragen den
        Status als `aria-label`. Sobald die Zeilen eingeblendet sind, passt der
        Name auf ein Kaestchen und auf jeden Punkt darunter, und die Suche
        bliebe mehrdeutig. Der Ausdruck ohne Anker, weil hinter der
        Beschriftung noch die Anzahl steht.
      */
      await seite.getByRole('checkbox', { name: /Nicht anwendbar/ }).check();

      await klappeAllesAuf(seite);
    },
  },
  {
    name: 'Manuelle Prüfliste',
    vorbereiten: async (seite) => {
      const beispiel = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'mangelhaft.html')).href;

      await seite.getByLabel('Name der Prüfung').fill('Selbstprüfung');
      await seite.getByLabel('Zu prüfende Adressen').fill(beispiel);
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();
      await seite.getByRole('heading', { name: /^Ergebnis/ }).waitFor({ timeout: 120_000 });

      await seite.getByLabel(/^Manuelle Prüfliste/).check();
      await seite.getByRole('heading', { name: 'Manuelle Prüfliste' }).waitFor();

      // Eine Frage beantworten, damit auch der beantwortete Zweig im DOM steht.
      await seite.getByRole('button', { name: 'erfüllt', exact: true }).first().click();
      await seite.getByRole('heading', { name: /^Beantwortet/ }).waitFor({ timeout: 20_000 });

      await klappeAllesAuf(seite);
    },
  },
  {
    /*
      Die Eingabemaske. Dort steht das meiste Markup der Profilverwaltung.
      Liste und Maske sind Alternativen im selben Platz — was die eine zeigt,
      verdeckt die andere. Sie brauchen deshalb je einen eigenen Eintrag.
    */
    name: 'Prüfprofile — Eingabemaske',
    vorbereiten: async (seite) => {
      await oeffneProfilverwaltung(seite);
      await seite.getByRole('button', { name: 'Neues Profil anlegen' }).click();
      await seite.getByRole('heading', { name: 'Neues Profil' }).waitFor();
      await seite.getByRole('button', { name: 'Seite hinzufügen' }).click();
    },
  },
  {
    /*
      Die Liste der gespeicherten Profile — mit einer Zeile darin.

      Ohne Profil steht dort nur „Noch kein Profil angelegt", und die Tabelle
      samt ihrer Knopfspalte wurde nie gemessen. Der Lauf legt sich deshalb
      selbst eines an; die Datenbank der Selbstpruefung ist ohnehin ein
      Wegwerfstueck.
    */
    name: 'Prüfprofile — gespeicherte Profile',
    vorbereiten: async (seite) => {
      await legeProfilAn(seite, 'Selbstprüfung');
    },
  },
  {
    /*
      Der Dialog ist ein eigener Zustand und braucht einen eigenen Eintrag:
      Geschlossen steht er zwar im Baum, aber weder sichtbar noch erreichbar.

      Er legt sich sein eigenes Profil an, statt sich auf das der Ansicht
      davor zu verlassen — ein Testfall, der von der Reihenfolge seiner
      Nachbarn abhaengt, bricht beim ersten Umsortieren.

      Geloescht wird nichts. Gemessen wird die offene Rueckfrage.
    */
    name: 'Prüfprofile — Rückfrage vor dem Löschen',
    vorbereiten: async (seite) => {
      await legeProfilAn(seite, 'Zum Löschen');

      await seite.getByRole('button', { name: 'Löschen: Zum Löschen' }).click();
      await seite.getByRole('dialog').waitFor();
      await seite.getByRole('heading', { name: 'Profil löschen?' }).waitFor();
    },
  },
  {
    name: 'Bisherige Prüfungen',
    vorbereiten: async (seite) => {
      await seite.getByRole('button', { name: 'Bisherige Prüfungen' }).click();
      await seite.getByRole('heading', { name: 'Bisherige Prüfungen', level: 2 }).waitFor();
    },
  },
  {
    /*
      Der Dialog ist ein eigener Zustand und braucht deshalb einen eigenen
      Eintrag: Geschlossen steht er zwar im Baum, aber weder sichtbar noch
      erreichbar — die Ansicht darueber saehe ihn nie.

      Geloescht wird dabei nichts. Gemessen wird die offene Rueckfrage; sie
      wird nicht bestaetigt.
    */
    name: 'Bisherige Prüfungen — Rückfrage vor dem Löschen',
    vorbereiten: async (seite) => {
      await seite.getByRole('button', { name: 'Bisherige Prüfungen' }).click();
      await seite.getByRole('heading', { name: 'Bisherige Prüfungen', level: 2 }).waitFor();

      await seite.getByRole('button', { name: /^Löschen:/ }).first().click();
      await seite.getByRole('dialog').waitFor();
      await seite.getByRole('heading', { name: 'Prüfung löschen?' }).waitFor();
    },
  },
  {
    name: 'Projektebene über zwei Seiten',
    vorbereiten: async (seite) => {
      const mangelhaft = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'mangelhaft.html')).href;
      const sauber = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'sauber.html')).href;

      await seite.getByLabel('Name der Prüfung').fill('Selbstprüfung');
      await seite.getByLabel('Zu prüfende Adressen').fill(`${mangelhaft}\n${sauber}`);
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();
      await seite.getByRole('heading', { name: /^Ergebnis/ }).waitFor({ timeout: 180_000 });

      await seite.getByLabel('Projektebene').check();
      await seite.getByRole('heading', { name: 'Projektebene' }).waitFor();

      await klappeAllesAuf(seite);
    },
  },
  {
    name: 'Bericht — Vorschau und Ausgabewege',
    vorbereiten: async (seite) => {
      await seite.getByLabel('Name der Prüfung').fill('Selbstprüfung');
      await seite.getByLabel('Zu prüfende Adressen').fill(referenzseite('mangelhaft.html'));
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();
      await seite.getByRole('heading', { name: /^Ergebnis/ }).waitFor({ timeout: 120_000 });

      await seite.getByLabel('Bericht', { exact: true }).check();
      await seite.getByRole('heading', { name: 'Bericht', level: 3 }).waitFor();
      await seite.getByRole('heading', { name: 'Ausgabe' }).waitFor();
    },
  },
  /*
    Der erzeugte Bericht selbst.

    Er ist ein Erzeugnis dieses Werkzeugs und muss dieselben Anforderungen
    erfuellen wie die Oberflaeche (NF-01) — ein Bericht ueber Barrierefreiheit,
    den ein Teil seiner Leser nicht lesen kann, widerlegt sich selbst. Geprueft
    wird die HTML-Fassung; das PDF entsteht aus demselben Baum.
  */
  {
    name: 'Erzeugter Bericht (HTML)',
    vorbereiten: async (seite) => {
      const scanId = await erzeugeBericht(seite);
      await seite.goto(`http://127.0.0.1:${PORT}/api/scan/${scanId}/bericht?format=html`);
      await seite.getByRole('heading', { level: 2, name: /Konformitätstabelle/ }).waitFor();
    },
  },
  {
    name: 'Entwurf der Erklärung zur Barrierefreiheit',
    vorbereiten: async (seite) => {
      const scanId = await erzeugeBericht(seite);
      await seite.goto(`http://127.0.0.1:${PORT}/api/scan/${scanId}/bericht?format=erklaerung`);
      await seite.getByRole('heading', { level: 1, name: 'Erklärung zur Barrierefreiheit' }).waitFor();
    },
  },
  {
    name: 'Abdeckungsmatrix — was dieses Werkzeug findet',
    vorbereiten: async (seite) => {
      await seite.getByRole('button', { name: 'Was dieses Werkzeug findet' }).click();
      await seite.getByRole('heading', { name: 'Was dieses Werkzeug findet', level: 2 }).waitFor();
      // Auf die Messwerte warten: Ohne sie stuenden nur zwei Absaetze da, und
      // die Tabellen — das eigentlich zu Pruefende — waeren nie im DOM.
      await seite.getByRole('heading', { level: 3, name: 'Woran gemessen wurde' }).waitFor({ timeout: 20_000 });
    },
  },
];

function referenzseite(datei: string): string {
  return pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', datei)).href;
}

/** Vom Pruefauftrag in die Profilverwaltung, bis deren Liste steht. */
async function oeffneProfilverwaltung(seite: Page): Promise<void> {
  await seite.getByLabel('Gespeichertes Prüfprofil').check();
  await seite.getByRole('button', { name: 'Profile verwalten' }).click();
  await seite.getByRole('heading', { name: 'Gespeicherte Profile' }).waitFor();
}

/**
 * Legt ein Profil ueber die Oberflaeche an und laesst die Liste stehen.
 *
 * Ueber die Oberflaeche und nicht ueber die Schnittstelle: Was hier gemessen
 * wird, soll auf demselben Weg entstanden sein, den ein Mensch nimmt.
 */
async function legeProfilAn(seite: Page, name: string): Promise<void> {
  await oeffneProfilverwaltung(seite);

  await seite.getByRole('button', { name: 'Neues Profil anlegen' }).click();
  await seite.getByRole('heading', { name: 'Neues Profil' }).waitFor();
  await seite.getByLabel('Name des Profils').fill(name);
  await seite.getByLabel('Adresse 1').fill(referenzseite('sauber.html'));
  await seite.getByLabel('Bezeichnung').fill('Referenzseite');
  await seite.getByRole('button', { name: 'Profil speichern' }).click();

  await seite.getByRole('heading', { name: 'Gespeicherte Profile' }).waitFor();
  await seite.getByRole('button', { name: `Löschen: ${name}` }).waitFor();
}

/** Fuehrt einen Scan durch die Oberflaeche und liefert dessen Kennung. */
async function erzeugeBericht(seite: Page): Promise<number> {
  await seite.getByLabel('Name der Prüfung').fill('Selbstprüfung');
      await seite.getByLabel('Zu prüfende Adressen').fill(referenzseite('mangelhaft.html'));
  await seite.getByRole('button', { name: 'Prüfung starten' }).click();
  await seite.getByRole('heading', { name: /^Ergebnis/ }).waitFor({ timeout: 120_000 });

  const scans = (await (await fetch(`http://127.0.0.1:${PORT}/api/scans`)).json()) as {
    scans: { scanId: number }[];
  };
  const neuester = scans.scans[0]?.scanId;
  if (neuester === undefined) throw new Error('Kein Scan vorhanden — der Bericht liesse sich nicht erzeugen.');
  return neuester;
}

/**
 * Klappt jedes `details` in einem Zug auf.
 *
 * Einzeln ueber Locators zu gehen scheitert, sobald sich die Liste zwischen
 * zwei Schritten neu aufbaut — etwa nachdem eine Frage beantwortet wurde.
 */
async function klappeAllesAuf(seite: Page): Promise<void> {
  await seite.evaluate(() => {
    for (const element of Array.from(document.querySelectorAll('details'))) {
      element.setAttribute('open', '');
    }
  });
  await seite.waitForTimeout(200);
}

async function hauptlauf(): Promise<void> {
  const katalog = Katalog.laden();
  const protokoll = new Protokoll({ datei: null, konsoleAb: 'fehler' });

  /*
    Die Ausgangslage herstellen, statt sie vorauszusetzen.

    Der Lauf bedient die eigene Oberflaeche und startet dabei echte Scans. Die
    gehoeren nicht in die Betriebsdatenbank: Dort liegen die Pruefungen des
    Menschen, und ein knappes Dutzend davon ging zwischen mehreren hundert
    Zeilen „Selbstpruefung" unter. Deshalb eine eigene Datei, und deshalb eine
    frische je Lauf.

    Frisch, nicht bloss eigen — aus einem zweiten Grund: Manuelle Antworten
    liegen je Adresse und Frage, nicht je Scan (M-04), ein neuer Scan derselben
    Seite erbt sie also. Jeder Lauf beantwortete eine weitere Frage der
    Referenzseite, und nach der neunzehnten war keine mehr offen: Die
    Pruefliste zeigte nur noch beantwortete Fragen, der Lauf fand seinen Knopf
    nicht und brach ab. Ein Pruefwerkzeug, das nach genuegend eigenen Laeufen
    an sich selbst scheitert, misst die falsche Sache. Eine leere Datenbank hat
    nichts zu erben; das fruehere Aufraeumen in fremden Daten entfaellt damit.
  */
  const datenbankPfad = selbstpruefungDatenbankPfad();
  verwirfDatenbank(datenbankPfad);

  const zuordnung = katalog.alleRegelZuordnungen(STANDARD);
  const geprueft = new Set(katalog.fuerStandard(STANDARD).map((k) => k.id));

  const db = oeffneDatenbank({ pfad: datenbankPfad });
  const server = baueServer({ katalog, protokoll, db });
  const statisch = (await import('@fastify/static')).default;
  await server.register(statisch, { root: path.join(projektWurzel(), 'dist', 'web') });
  await server.listen({ port: PORT, host: '127.0.0.1' });

  const browser = await Browser.starten({ protokoll });
  let verstoesse = 0;

  try {
    for (const ansicht of ANSICHTEN) {
      const geladen = await browser.ladeSeite(`http://127.0.0.1:${PORT}/`);
      try {
        await ansicht.vorbereiten(geladen.seite);

        // Alle gebauten Engines, nicht nur axe: Die eigene Oberflaeche soll
        // sich denselben Pruefungen stellen wie jede fremde Seite.
        const kontext: EngineKontext = {
          seite: geladen.seite,
          browser,
          url: geladen.url,
          standard: STANDARD,
          viewport: VIEWPORT_SCHREIBTISCH,
          quelltext: geladen.quelltext,
          protokoll,
        };

        const ergebnisse: EngineErgebnis[] = [];
        for (const engine of ENGINES) {
          ergebnisse.push(await engine.ausfuehren(kontext, [...zuordnung.keys()]));
        }
        const roh = fuegeZusammen(ergebnisse);

        const normalisiert = normalisiere(roh.befunde, roh.hinweise, {
          zuordnung,
          geprueftesKriterium: (id) => geprueft.has(id),
          protokoll,
        });

        berichte(ansicht.name, normalisiert.befunde, katalog);
        verstoesse += normalisiert.befunde.length;
      } finally {
        await geladen.schliessen();
      }
    }
  } finally {
    await browser.schliessen();
    // Erst den Server, dann die Datenbank: Er haelt die Verbindung, die hier
    // geschlossen wird, und eine noch laufende Anfrage fiele sonst auf eine
    // geschlossene Datei.
    await server.close();
    db.close();
  }

  console.log('');
  if (verstoesse > 0) {
    console.error(`Die eigene Oberflaeche haelt WCAG ${STANDARD} AA nicht ein: ${verstoesse} Befund(e).`);
    process.exit(1);
  }
  console.log(`Die eigene Oberflaeche ist in allen ${ANSICHTEN.length} Ansichten ohne automatischen Befund.`);
  console.log('Das ist die halbe Miete: die manuell zu pruefenden Kriterien bleiben offen.');
}

function berichte(name: string, befunde: readonly Befund[], katalog: Katalog): void {
  if (befunde.length === 0) {
    console.log(`✓ ${name} — ohne Befund`);
    return;
  }

  console.log(`✗ ${name} — ${befunde.length} Befund(e)`);
  for (const befund of befunde) {
    const titel = katalog.findeKriterium(befund.kriterium)?.titel ?? '';
    console.log(`    ${befund.kriterium} ${titel}`);
    console.log(`      ${befund.beschreibung}`);
    if (befund.selektor) console.log(`      ${befund.selektor}`);
  }
}

hauptlauf().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
