#!/usr/bin/env node
/**
 * Verifikation gegen die Referenzseiten (PRD 10, Phase 8).
 *
 *   npm run verifikation
 *
 * Vergleicht die Befunde mit `test/referenzseiten/soll.json` und weist je
 * Kriterium aus: erkannt, als offen gemeldet, uebersehen, Fehlalarm.
 *
 * Die Unterscheidung zwischen „uebersehen" und „als offen gemeldet" ist der
 * Kern: Ein Kriterium, das offen bleibt, kostet manuelle Arbeit. Eines, das
 * faelschlich als erfuellt gilt, kostet die Gueltigkeit des ganzen Berichts.
 * Nur das Zweite ist ein Fehler des Werkzeugs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fuehreScanAus } from '../src/scan/runner.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import type { SeitenErgebnis, Standard } from '../src/typen/index.js';

interface SollVerstoss {
  kriterium: string;
  stufe: string;
  stelle: string;
  was: string;
  nurStandard?: string;
}

interface SollSeite {
  erwarteteVerstoesse: SollVerstoss[];
  erwarteteNichtAnwendbar?: string[];
}

async function hauptlauf(): Promise<void> {
  const wurzel = projektWurzel();
  const soll = JSON.parse(fs.readFileSync(path.join(wurzel, 'test/referenzseiten/soll.json'), 'utf8')) as {
    standard: Standard;
    seiten: Record<string, SollSeite>;
  };

  const katalog = Katalog.laden();
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });

  let uebersehenGesamt = 0;
  let fehlalarmGesamt = 0;

  for (const [datei, erwartet] of Object.entries(soll.seiten)) {
    const ergebnis = await fuehreScanAus({
      seiten: [{ url: pathToFileURL(path.join(wurzel, 'test/referenzseiten', datei)).href }],
      standard: soll.standard,
      katalog,
      protokoll,
      mehrereViewports: true,
    });

    const seite = ergebnis.seiten[0];
    if (!seite || seite.zustand !== 'fertig') {
      console.error(`${datei}: konnte nicht geprueft werden`);
      process.exitCode = 1;
      continue;
    }

    berichte(datei, seite, erwartet, soll.standard, (uebersehen, fehlalarm) => {
      uebersehenGesamt += uebersehen;
      fehlalarmGesamt += fehlalarm;
    });
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Uebersehen (faelschlich erfuellt oder nicht anwendbar): ${uebersehenGesamt}`);
  console.log(`Fehlalarme (Befund ohne Sollwert):                      ${fehlalarmGesamt}`);
  if (uebersehenGesamt > 0) {
    console.log('\nJedes uebersehene Kriterium ist ein stiller Fehlschlag: Es sieht aus wie');
    console.log('ein bestandener Test. Das ist der gefaehrlichste Zustand des Werkzeugs.');
  }
}

function berichte(
  datei: string,
  seite: SeitenErgebnis,
  erwartet: SollSeite,
  standard: Standard,
  zaehle: (uebersehen: number, fehlalarm: number) => void,
): void {
  const status = new Map(seite.bewertungen.map((b) => [b.kriterium, b.status]));

  const sollKriterien = [
    ...new Set(
      erwartet.erwarteteVerstoesse
        .filter((v) => !v.nurStandard || v.nurStandard === standard)
        .map((v) => v.kriterium),
    ),
  ].sort();

  const erkannt = sollKriterien.filter((k) => status.get(k) === 'nicht_erfuellt');
  const offen = sollKriterien.filter((k) => status.get(k) === 'pruefung_erforderlich');
  const uebersehen = sollKriterien.filter(
    (k) => status.get(k) === 'erfuellt' || status.get(k) === 'nicht_anwendbar',
  );
  const fehlalarm = seite.bewertungen
    .filter((b) => b.status === 'nicht_erfuellt' && !sollKriterien.includes(b.kriterium))
    .map((b) => b.kriterium);

  console.log(`\n${'='.repeat(70)}\n${datei} — WCAG ${standard}`);
  if (sollKriterien.length > 0) {
    const quote = ((erkannt.length / sollKriterien.length) * 100).toFixed(0);
    console.log(`  Sollverstoesse: ${sollKriterien.length}`);
    console.log(`  ✓ belegt erkannt      ${String(erkannt.length).padStart(2)} (${quote} %)  ${erkannt.join(' ')}`);
    console.log(`  ? als offen gemeldet  ${String(offen.length).padStart(2)}       ${offen.join(' ')}`);
    console.log(`  ✗ UEBERSEHEN          ${String(uebersehen.length).padStart(2)}       ${uebersehen.join(' ') || '—'}`);
  }
  console.log(`  ! Fehlalarm-Verdacht  ${String(fehlalarm.length).padStart(2)}       ${fehlalarm.join(' ') || '—'}`);

  zaehle(uebersehen.length, fehlalarm.length);
}

hauptlauf().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
