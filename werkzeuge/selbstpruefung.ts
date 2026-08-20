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
import { oeffneDatenbank } from '../src/db/index.js';
import { loescheAntwortenZu } from '../src/stufe3/antworten.js';
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
    vorbereiten: async (seite) => {
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();
      await seite.getByText('Bitte geben Sie mindestens eine Adresse an.').waitFor();
    },
  },
  {
    name: 'Ergebnis — alle Kriterien aufgeklappt',
    vorbereiten: async (seite) => {
      const beispiel = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'mangelhaft.html')).href;

      await seite.getByLabel('Zu prüfende Adressen').fill(beispiel);
      await seite.getByRole('button', { name: 'Prüfung starten' }).click();

      await seite.getByRole('heading', { name: /^Ergebnis/ }).waitFor({ timeout: 120_000 });

      /*
        Auch die nicht anwendbaren einblenden, damit jede Zeile im DOM steht.

        Ohne Anker am Zeilenanfang: Die Beschriftung traegt vorweg den
        Statuspunkt, und dessen Zeichen steht im Textinhalt — auch wenn es
        `aria-hidden` ist und eine Sprachausgabe es ueberspringt. Playwright
        vergleicht hier den Textinhalt, nicht den barrierefreien Namen.
      */
      await seite.getByLabel(/Nicht anwendbar/).check();

      await klappeAllesAuf(seite);
    },
  },
  {
    name: 'Manuelle Prüfliste',
    vorbereiten: async (seite) => {
      const beispiel = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'mangelhaft.html')).href;

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
    name: 'Prüfprofile — Liste und Formular',
    vorbereiten: async (seite) => {
      await seite.getByLabel('Gespeichertes Prüfprofil').check();
      await seite.getByRole('button', { name: 'Profile verwalten' }).click();
      await seite.getByRole('heading', { name: 'Gespeicherte Profile' }).waitFor();

      // Auch die Eingabemaske messen: Dort steht das meiste Markup.
      await seite.getByRole('button', { name: 'Neues Profil anlegen' }).click();
      await seite.getByRole('heading', { name: 'Neues Profil' }).waitFor();
      await seite.getByRole('button', { name: 'Seite hinzufügen' }).click();
    },
  },
  {
    name: 'Bisherige Prüfungen',
    vorbereiten: async (seite) => {
      await seite.getByRole('button', { name: 'Bisherige Prüfungen' }).click();
      await seite.getByRole('heading', { name: 'Bisherige Prüfungen', level: 3 }).waitFor();
    },
  },
  {
    name: 'Projektebene über zwei Seiten',
    vorbereiten: async (seite) => {
      const mangelhaft = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'mangelhaft.html')).href;
      const sauber = pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', 'sauber.html')).href;

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

/** Fuehrt einen Scan durch die Oberflaeche und liefert dessen Kennung. */
async function erzeugeBericht(seite: Page): Promise<number> {
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

    Manuelle Antworten liegen je Adresse und Frage, nicht je Scan (M-04) — ein
    neuer Scan derselben Seite erbt sie also. Jeder Lauf beantwortete bisher
    eine weitere Frage der Referenzseite, und nach der neunzehnten war keine
    mehr offen: Die Pruefliste zeigte nur noch beantwortete Fragen, der Lauf
    fand seinen Knopf nicht und brach ab. Ein Pruefwerkzeug, das nach genuegend
    eigenen Laeufen an sich selbst scheitert, misst die falsche Sache.
  */
  const db = oeffneDatenbank();
  const verworfen = loescheAntwortenZu(db, referenzseite('mangelhaft.html'));
  db.close();
  if (verworfen > 0) {
    console.log(`Frueher gegebene Antworten zur Referenzseite verworfen: ${verworfen}\n`);
  }
  const zuordnung = katalog.alleRegelZuordnungen(STANDARD);
  const geprueft = new Set(katalog.fuerStandard(STANDARD).map((k) => k.id));

  const server = baueServer({ katalog, protokoll });
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
    await server.close();
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
