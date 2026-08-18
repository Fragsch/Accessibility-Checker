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
import { fuehreAxeAus } from '../src/stufe1/axe.js';
import { normalisiereAxe } from '../src/stufe1/normalisierung.js';
import { projektWurzel } from '../src/plattform/pfade.js';
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
    vorbereiten: async () => undefined,
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

      // Auch die nicht anwendbaren einblenden, damit jede Zeile im DOM steht.
      await seite.getByLabel(/^nicht anwendbar/).check();

      for (const aufklappen of await seite.locator('details.kriterium').all()) {
        await aufklappen.evaluate((element) => element.setAttribute('open', ''));
      }
    },
  },
];

async function hauptlauf(): Promise<void> {
  const katalog = Katalog.laden();
  const protokoll = new Protokoll({ datei: null, konsoleAb: 'fehler' });
  const zuordnung = katalog.regelZuordnung('axe', STANDARD);
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

        const axeErgebnis = await fuehreAxeAus(geladen.seite, {
          standard: STANDARD,
          zusatzRegeln: [...zuordnung.keys()],
        });
        const normalisiert = normalisiereAxe(axeErgebnis.verstoesse, axeErgebnis.unentschieden, {
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
