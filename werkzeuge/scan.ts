#!/usr/bin/env node
/**
 * Scan von der Befehlszeile aus — bis die Oberflaeche steht (Phase 2) der
 * einzige Weg, das Werkzeug zu bedienen.
 *
 *   npm run scan -- https://example.org
 *   npm run scan -- https://example.org --standard 2.2 --speichern
 *   npm run scan -- datei.html --nur-verstoesse
 *
 * Ortspfade werden zu file://-Adressen ergaenzt, damit die Referenzseiten ohne
 * Webserver geprueft werden koennen.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fuehreScanAus } from '../src/scan/runner.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { protokollDatei } from '../src/plattform/pfade.js';
import { istEntwurf } from '../src/scan/statusableitung.js';
import { oeffneDatenbank } from '../src/db/index.js';
import { speichereScan } from '../src/db/scan-speichern.js';
import type { ScanErgebnis, Standard, Status } from '../src/typen/index.js';

const STATUS_ZEICHEN: Record<Status, string> = {
  nicht_erfuellt: '✗',
  pruefung_erforderlich: '?',
  erfuellt: '✓',
  nicht_anwendbar: '–',
};

const STATUS_TEXT: Record<Status, string> = {
  nicht_erfuellt: 'nicht erfuellt',
  pruefung_erforderlich: 'Pruefung erforderlich',
  erfuellt: 'erfuellt',
  nicht_anwendbar: 'nicht anwendbar',
};

interface Argumente {
  urls: string[];
  standard: Standard;
  speichern: boolean;
  nurVerstoesse: boolean;
  ausfuehrlich: boolean;
}

function leseArgumente(argv: string[]): Argumente {
  const argumente: Argumente = {
    urls: [],
    standard: '2.1',
    speichern: false,
    nurVerstoesse: false,
    ausfuehrlich: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--standard') {
      const wert = argv[++i];
      if (wert !== '2.1' && wert !== '2.2') throw new Error(`--standard erwartet 2.1 oder 2.2, nicht "${wert}"`);
      argumente.standard = wert;
    } else if (arg === '--speichern') {
      argumente.speichern = true;
    } else if (arg === '--nur-verstoesse') {
      argumente.nurVerstoesse = true;
    } else if (arg === '--ausfuehrlich') {
      argumente.ausfuehrlich = true;
    } else if (arg && arg.startsWith('--')) {
      throw new Error(`Unbekannte Angabe: ${arg}`);
    } else if (arg) {
      argumente.urls.push(zuAdresse(arg));
    }
  }

  if (argumente.urls.length === 0) {
    throw new Error('Keine Adresse angegeben.\n\n  npm run scan -- https://example.org [--standard 2.2] [--speichern]');
  }
  return argumente;
}

function zuAdresse(eingabe: string): string {
  if (/^https?:\/\//i.test(eingabe) || eingabe.startsWith('file://')) return eingabe;
  return pathToFileURL(path.resolve(eingabe)).href;
}

async function hauptlauf(): Promise<void> {
  const argumente = leseArgumente(process.argv.slice(2));
  const protokoll = new Protokoll({ datei: protokollDatei(), konsoleAb: 'fehler' });
  const katalog = Katalog.laden();

  console.log(`Pruefstandard WCAG ${argumente.standard} — ${katalog.fuerStandard(argumente.standard).length} Kriterien\n`);

  const ergebnis = await fuehreScanAus({
    seiten: argumente.urls.map((url) => ({ url })),
    standard: argumente.standard,
    katalog,
    protokoll,
    beiFortschritt: (m) => {
      if (m.art === 'seite-begonnen') process.stdout.write(`[${m.nummer}/${m.gesamt}] ${m.url} … `);
      else if (m.art === 'fehler') console.log(`fehlgeschlagen: ${m.text}`);
      else console.log('fertig');
    },
  });

  zeigeErgebnis(ergebnis, katalog, argumente);

  if (argumente.speichern) {
    const db = oeffneDatenbank();
    const scanId = speichereScan(db, ergebnis);
    db.close();
    console.log(`\nGespeichert als Scan ${scanId}.`);
  }

  const protokollierteWarnungen = protokoll.gefiltert('warnung');
  if (protokollierteWarnungen.length > 0 && argumente.ausfuehrlich) {
    console.log(`\nProtokoll — ${protokollierteWarnungen.length} Warnung(en):`);
    for (const eintrag of protokollierteWarnungen) console.log(`  ${eintrag.bereich}: ${eintrag.text}`);
  }
}

function zeigeErgebnis(ergebnis: ScanErgebnis, katalog: Katalog, argumente: Argumente): void {
  for (const seite of ergebnis.seiten) {
    console.log(`\n${'='.repeat(78)}\n${seite.url}`);
    if (seite.titel) console.log(`Titel: ${seite.titel}`);
    if (seite.zustand === 'fehler') {
      console.log(`Nicht geprueft: ${seite.fehler}`);
      continue;
    }

    const zaehlung = zaehleStatus(seite.bewertungen.map((b) => b.status));
    console.log(
      `${zaehlung.nicht_erfuellt} nicht erfuellt · ${zaehlung.pruefung_erforderlich} Pruefung erforderlich · ` +
        `${zaehlung.erfuellt} erfuellt · ${zaehlung.nicht_anwendbar} nicht anwendbar`,
    );

    const anzuzeigen = argumente.nurVerstoesse
      ? seite.bewertungen.filter((b) => b.status === 'nicht_erfuellt')
      : seite.bewertungen.filter((b) => b.status !== 'nicht_anwendbar');

    for (const bewertung of anzuzeigen) {
      const kriterium = katalog.findeKriterium(bewertung.kriterium);
      console.log(
        `\n  ${STATUS_ZEICHEN[bewertung.status]} ${bewertung.kriterium} ${kriterium?.titel ?? ''}` +
          `  [${STATUS_TEXT[bewertung.status]}, ${bewertung.herkunft}]`,
      );

      for (const befund of bewertung.befunde) {
        console.log(`      · ${befund.schwere}: ${befund.beschreibung}`);
        if (befund.selektor) console.log(`        ${befund.selektor}`);
      }
      if (argumente.ausfuehrlich) {
        for (const hinweis of bewertung.hinweise) console.log(`      ! ${hinweis.text}`);
        for (const frage of bewertung.offeneFragen) console.log(`      ? ${frage.frage}`);
      } else if (bewertung.hinweise.length + bewertung.offeneFragen.length > 0) {
        const anzahl = bewertung.hinweise.length + bewertung.offeneFragen.length;
        console.log(`      (${anzahl} offene${anzahl === 1 ? 'r Punkt' : ' Punkte'} — mit --ausfuehrlich anzeigen)`);
      }
    }
  }

  console.log(`\n${'='.repeat(78)}\nProjektebene ueber ${ergebnis.seiten.length} Seite(n):`);
  const gesamt = zaehleStatus(ergebnis.projektebene.map((p) => p.status));
  for (const status of ['nicht_erfuellt', 'pruefung_erforderlich', 'erfuellt', 'nicht_anwendbar'] as Status[]) {
    console.log(`  ${STATUS_ZEICHEN[status]} ${String(gesamt[status]).padStart(3)}  ${STATUS_TEXT[status]}`);
  }

  if (istEntwurf(ergebnis.projektebene)) {
    console.log('\nDas Ergebnis ist ein Entwurf: offene Kriterien sind nicht bewertet und');
    console.log('duerfen nicht als konform ausgegeben werden.');
  }
}

function zaehleStatus(status: readonly Status[]): Record<Status, number> {
  const zaehlung: Record<Status, number> = {
    erfuellt: 0,
    nicht_erfuellt: 0,
    pruefung_erforderlich: 0,
    nicht_anwendbar: 0,
  };
  for (const s of status) zaehlung[s] += 1;
  return zaehlung;
}

hauptlauf().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
