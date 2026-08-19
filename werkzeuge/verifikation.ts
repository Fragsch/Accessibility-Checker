#!/usr/bin/env node
/**
 * Verifikation gegen die Referenzseiten (PRD 10, Phase 8).
 *
 *   npm run verifikation              misst und schreibt katalog/abdeckung.json
 *   npm run verifikation -- --nur-messen   misst, ohne die Matrix zu schreiben
 *   npm run verifikation -- --seite=X      nur diese Referenzseite
 *
 * Der Lauf beantwortet zwei Fragen, die auseinandergehalten werden müssen:
 *
 *   **Findet das Werkzeug, was es finden soll?**  Gemessen je Kriterium als
 *   belegt erkannt, als offen gemeldet oder übersehen.
 *
 *   **Meldet es, was gar nicht da ist?**  Gemessen an den sauberen Fassungen
 *   derselben Seiten. Jeder Befund dort ist ein Fehlalarm-Verdacht.
 *
 * Die Unterscheidung zwischen „übersehen" und „als offen gemeldet" ist der
 * Kern: Ein Kriterium, das offen bleibt, kostet manuelle Arbeit. Eines, das
 * fälschlich als erfüllt gilt, kostet die Gültigkeit des ganzen Berichts.
 * Nur das Zweite ist ein Fehler des Werkzeugs.
 *
 * Ergebnis ist `katalog/abdeckung.json` — die Abdeckungsmatrix, die das PRD
 * verlangt und die die Anwendung anzeigt. Sie ist der Grund, warum dieser Lauf
 * nicht nur ein Test ist: Ohne sie behauptet das Werkzeug seine Genauigkeit,
 * statt sie zu belegen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { fuehreScanAus } from '../src/scan/runner.js';
import { Katalog } from '../src/katalog/laden.js';
import { leiteEinstufungAb, standardAbdeckungsPfad } from '../src/katalog/abdeckung.js';
import type { Abdeckungsmatrix, KriteriumAbdeckung } from '../src/katalog/abdeckung.js';
import { Protokoll } from '../src/protokoll.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import { stufenDesKriteriums } from '../src/bericht/daten.js';
import type { Kriterium, SeitenErgebnis, Standard, Status } from '../src/typen/index.js';

interface SollVerstoss {
  kriterium: string;
  stufe: string;
  stelle: string;
  was: string;
  nurStandard?: string;
}

interface SollSeite {
  zweck?: string;
  erwarteteVerstoesse: SollVerstoss[];
  erwarteteNichtAnwendbar?: string[];
  hinweis?: string;
}

/** Ein Angebot aus mehreren Seiten, das als ein Scan geprüft wird. */
interface SollGruppe {
  zweck?: string;
  seiten: string[];
  erwarteteVerstoesse: SollVerstoss[];
}

interface Soll {
  standard: Standard;
  seiten: Record<string, SollSeite>;
  gruppen?: Record<string, SollGruppe>;
  zielwerte?: { erkennungsquote_auto?: number; fehlalarmquote?: number };
}

/** Was an einer einzelnen Seite gemessen wurde. */
interface Seitenmessung {
  datei: string;
  zweck: string;
  sollKriterien: string[];
  /**
   * Davon die Kriterien mit mindestens einem Sollverstoss der Stufe `auto`.
   *
   * Bezugsgroesse der Zielwerte aus `soll.json`: Verstoesse der Stufen `llm`
   * und `manuell` haengen am Urteil des Modells beziehungsweise des Menschen
   * und gehoeren nicht in eine Aussage ueber die Automatik.
   */
  sollKriterienAuto: string[];
  erkannt: string[];
  offen: string[];
  uebersehen: string[];
  fehlalarme: string[];
}

async function hauptlauf(): Promise<void> {
  const wurzel = projektWurzel();
  const schreiben = !process.argv.includes('--nur-messen');
  const nurSeite = process.argv.find((a) => a.startsWith('--seite='))?.slice('--seite='.length);

  const soll = JSON.parse(
    fs.readFileSync(path.join(wurzel, 'test/referenzseiten/soll.json'), 'utf8'),
  ) as Soll;

  const katalog = Katalog.laden();
  const kriterien = katalog.fuerStandard(soll.standard);
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });

  const messungen: Seitenmessung[] = [];

  for (const [datei, erwartet] of Object.entries(soll.seiten)) {
    if (nurSeite && datei !== nurSeite) continue;

    const ergebnis = await fuehreScanAus({
      seiten: [{ url: pathToFileURL(path.join(wurzel, 'test/referenzseiten', datei)).href }],
      standard: soll.standard,
      katalog,
      protokoll,
      mehrereViewports: true,
    });

    const seite = ergebnis.seiten[0];
    if (!seite || seite.zustand !== 'fertig') {
      console.error(`${datei}: konnte nicht geprueft werden${seite?.fehler ? ` — ${seite.fehler}` : ''}`);
      process.exitCode = 1;
      continue;
    }

    const messung = messeSeite(datei, seite, erwartet, soll.standard);
    messungen.push(messung);
    zeigeSeite(messung, soll.standard);
  }

  /*
    Die Gruppen laufen als ein Scan ueber mehrere Seiten. Anders sind 2.4.5,
    3.2.3 und 3.2.6 nicht messbar: Sie entstehen erst aus dem Vergleich der
    Seiten untereinander, und an einer Einzelseite sind sie zu Recht nicht
    anwendbar. Ohne diesen Teil stuenden sie in der Matrix als „ungemessen" —
    obwohl das Werkzeug sie durchaus prueft.
  */
  for (const [name, gruppe] of Object.entries(soll.gruppen ?? {})) {
    if (nurSeite && name !== nurSeite) continue;

    const ergebnis = await fuehreScanAus({
      seiten: gruppe.seiten.map((datei) => ({
        url: pathToFileURL(path.join(wurzel, 'test/referenzseiten', datei)).href,
      })),
      standard: soll.standard,
      betriebsart: 'profil',
      katalog,
      protokoll,
      mehrereViewports: true,
    });

    const fertige = ergebnis.seiten.filter((s) => s.zustand === 'fertig');
    if (fertige.length !== gruppe.seiten.length) {
      console.error(`${name}: nur ${fertige.length} von ${gruppe.seiten.length} Seiten geprueft`);
      process.exitCode = 1;
      continue;
    }

    // Gemessen wird die Projektebene, nicht eine einzelne Seite: Ein Verstoss
    // auf der dritten Seite ist ein Verstoss des Angebots. Genauso zaehlt ein
    // Fehlalarm auf jeder der drei Seiten.
    const messung = messe(
      name,
      new Map<string, Status>(ergebnis.projektebene.map((b) => [b.kriterium, b.status])),
      { zweck: gruppe.zweck ?? '', erwarteteVerstoesse: gruppe.erwarteteVerstoesse },
      soll.standard,
    );
    messungen.push(messung);
    zeigeSeite(messung, soll.standard);
  }

  const matrix = baueMatrix(messungen, kriterien, soll.standard);
  zeigeMatrix(matrix, kriterien);

  if (schreiben && !nurSeite) {
    const ziel = standardAbdeckungsPfad();
    fs.writeFileSync(ziel, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
    console.log(`\nAbdeckungsmatrix geschrieben: ${path.relative(wurzel, ziel)}`);
  } else if (nurSeite) {
    console.log('\nEinzelne Seite gemessen — die Matrix bliebe unvollstaendig und wurde nicht geschrieben.');
  }

  if (matrix.kennzahlen.uebersehen > 0 || matrix.kennzahlen.fehlalarme > 0) process.exitCode = 1;
}

// --------------------------------------------------------- Messen je Seite

function messeSeite(
  datei: string,
  seite: SeitenErgebnis,
  erwartet: SollSeite,
  standard: Standard,
): Seitenmessung {
  return messe(
    datei,
    new Map<string, Status>(seite.bewertungen.map((b) => [b.kriterium, b.status])),
    erwartet,
    standard,
  );
}

function messe(
  datei: string,
  status: Map<string, Status>,
  erwartet: SollSeite,
  standard: Standard,
): Seitenmessung {
  const sollKriterien = [
    ...new Set(
      erwartet.erwarteteVerstoesse
        .filter((v) => !v.nurStandard || v.nurStandard === standard)
        .map((v) => v.kriterium),
    ),
  ].sort();

  return {
    datei,
    zweck: erwartet.zweck ?? '',
    sollKriterien,
    sollKriterienAuto: [
      ...new Set(
        erwartet.erwarteteVerstoesse
          .filter((v) => v.stufe === 'auto' && (!v.nurStandard || v.nurStandard === standard))
          .map((v) => v.kriterium),
      ),
    ].sort(),
    erkannt: sollKriterien.filter((k) => status.get(k) === 'nicht_erfuellt'),
    offen: sollKriterien.filter((k) => status.get(k) === 'pruefung_erforderlich'),
    uebersehen: sollKriterien.filter(
      (k) => status.get(k) === 'erfuellt' || status.get(k) === 'nicht_anwendbar',
    ),
    fehlalarme: [...status]
      .filter(([kriterium, s]) => s === 'nicht_erfuellt' && !sollKriterien.includes(kriterium))
      .map(([kriterium]) => kriterium)
      .sort(),
  };
}

// --------------------------------------------------------- Matrix erzeugen

function baueMatrix(
  messungen: readonly Seitenmessung[],
  kriterien: readonly Kriterium[],
  standard: Standard,
): Abdeckungsmatrix {
  const zeilen: Record<string, KriteriumAbdeckung> = {};

  /*
    Die Zeilen entstehen aus dem Katalog, nicht aus den Messungen. Sonst
    fehlten genau die Kriterien, zu denen es keinen Testfall gibt — und das
    sind die, über die eine Abdeckungsmatrix am dringendsten Auskunft geben
    muss. Ein leerer Platz in der Tabelle ist die ehrlichste Zahl, die es zu
    einem ungemessenen Kriterium gibt.
  */
  for (const kriterium of kriterien) {
    const zahlen = {
      testfaelle: 0,
      belegtErkannt: 0,
      alsOffenGemeldet: 0,
      uebersehen: 0,
      fehlalarme: 0,
    };

    for (const messung of messungen) {
      if (messung.sollKriterien.includes(kriterium.id)) zahlen.testfaelle += 1;
      if (messung.erkannt.includes(kriterium.id)) zahlen.belegtErkannt += 1;
      if (messung.offen.includes(kriterium.id)) zahlen.alsOffenGemeldet += 1;
      if (messung.uebersehen.includes(kriterium.id)) zahlen.uebersehen += 1;
      zahlen.fehlalarme += messung.fehlalarme.filter((k) => k === kriterium.id).length;
    }

    zeilen[kriterium.id] = {
      stufen: stufenDesKriteriums(kriterium),
      ...zahlen,
      einstufung: leiteEinstufungAb(zahlen),
    };
  }

  const werte = Object.values(zeilen);
  const testfaelle = werte.reduce((s, z) => s + z.testfaelle, 0);
  const belegtErkannt = werte.reduce((s, z) => s + z.belegtErkannt, 0);

  // Die Automatik gesondert: Nur sie ist Gegenstand der Zielwerte.
  let testfaelleAuto = 0;
  let erkanntAuto = 0;
  for (const messung of messungen) {
    for (const kriterium of messung.sollKriterienAuto) {
      testfaelleAuto += 1;
      if (messung.erkannt.includes(kriterium)) erkanntAuto += 1;
    }
  }

  return {
    beschreibung:
      'Gemessene Abdeckung je Erfolgskriterium (PRD 10). Erzeugt von werkzeuge/verifikation.ts — ' +
      'nicht von Hand pflegen, sondern neu messen.',
    gemessenAm: new Date().toISOString().slice(0, 10),
    standard,
    werkzeug: werkzeugfassung(),
    referenzseiten: messungen.map((m) => ({
      datei: m.datei,
      zweck: m.zweck,
      sollverstoesse: m.sollKriterien.length,
      gepruefteKriterien: kriterien.length,
    })),
    kennzahlen: {
      kriterienGesamt: kriterien.length,
      mitTestfall: werte.filter((z) => z.testfaelle > 0).length,
      ohneTestfall: werte.filter((z) => z.testfaelle === 0).length,
      testfaelle,
      belegtErkannt,
      alsOffenGemeldet: werte.reduce((s, z) => s + z.alsOffenGemeldet, 0),
      uebersehen: werte.reduce((s, z) => s + z.uebersehen, 0),
      fehlalarme: werte.reduce((s, z) => s + z.fehlalarme, 0),
      erkennungsquote: testfaelle === 0 ? 0 : Math.round((belegtErkannt / testfaelle) * 1000) / 1000,
      erkennungsquoteAuto: testfaelleAuto === 0 ? 0 : Math.round((erkanntAuto / testfaelleAuto) * 1000) / 1000,
      testfaelleAuto,
      fehlalarmquote:
        messungen.length === 0
          ? 0
          : Math.round((werte.reduce((s, z) => s + z.fehlalarme, 0) / messungen.length) * 1000) / 1000,
    },
    kriterien: zeilen,
  };
}

function werkzeugfassung(): string {
  try {
    const paket = JSON.parse(fs.readFileSync(path.join(projektWurzel(), 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
    };
    return `${paket.name ?? 'accessibility-checker'} ${paket.version ?? ''}`.trim();
  } catch {
    return 'accessibility-checker';
  }
}

// ------------------------------------------------------------- Ausgabe

function zeigeSeite(m: Seitenmessung, standard: Standard): void {
  console.log(`\n${'='.repeat(74)}\n${m.datei} — WCAG ${standard}`);
  if (m.zweck) console.log(`  ${m.zweck}`);

  if (m.sollKriterien.length > 0) {
    const quote = ((m.erkannt.length / m.sollKriterien.length) * 100).toFixed(0);
    console.log(`  Sollverstoesse: ${m.sollKriterien.length}`);
    console.log(`  ✓ belegt erkannt      ${zahl(m.erkannt.length)} (${quote} %)  ${m.erkannt.join(' ')}`);
    console.log(`  ? als offen gemeldet  ${zahl(m.offen.length)}       ${m.offen.join(' ') || '—'}`);
    console.log(`  ✗ UEBERSEHEN          ${zahl(m.uebersehen.length)}       ${m.uebersehen.join(' ') || '—'}`);
  }
  console.log(`  ! Fehlalarm-Verdacht  ${zahl(m.fehlalarme.length)}       ${m.fehlalarme.join(' ') || '—'}`);
}

function zahl(n: number): string {
  return String(n).padStart(2);
}

function zeigeMatrix(matrix: Abdeckungsmatrix, kriterien: readonly Kriterium[]): void {
  console.log(`\n${'='.repeat(74)}\nAbdeckungsmatrix — WCAG ${matrix.standard}, ${matrix.kennzahlen.kriterienGesamt} Kriterien\n`);

  const zeichen: Record<string, string> = {
    belegt: '✓',
    teilweise: '~',
    nur_hinweis: '?',
    luecke: '✗',
    ungeprueft: '·',
  };

  console.log('  Kriterium  Stufen        Tests  erk  off  ueb  fa   Einstufung');
  console.log(`  ${'-'.repeat(70)}`);

  for (const kriterium of kriterien) {
    const zeile = matrix.kriterien[kriterium.id];
    if (!zeile) continue;
    // Ungemessene Kriterien ohne Automatikanteil sind kein Befund, sondern
    // Bauart — sie stehen in der Datei, aber nicht in dieser Uebersicht.
    if (zeile.einstufung === 'ungeprueft' && !zeile.stufen.includes('auto')) continue;

    console.log(
      `  ${kriterium.id.padEnd(10)} ${zeile.stufen.join('+').padEnd(13)} ` +
        `${zahl(zeile.testfaelle)}   ${zahl(zeile.belegtErkannt)}  ${zahl(zeile.alsOffenGemeldet)}  ` +
        `${zahl(zeile.uebersehen)}  ${zahl(zeile.fehlalarme)}   ${zeichen[zeile.einstufung]} ${zeile.einstufung}`,
    );
  }

  const ohneAutomatik = kriterien.filter((k) => {
    const z = matrix.kriterien[k.id];
    return z?.einstufung === 'ungeprueft' && !z.stufen.includes('auto');
  });

  if (ohneAutomatik.length > 0) {
    console.log(
      `\n  Ohne Testfall und ohne Automatikanteil (${ohneAutomatik.length}): ` +
        `${ohneAutomatik.map((k) => k.id).join(' ')}`,
    );
    console.log('  Diese Kriterien gehen vollstaendig an die Stufen 2 und 3. Eine Referenzseite');
    console.log('  koennte dort nichts belegen — die Frage entscheidet sich am Inhalt, nicht am Markup.');
  }

  const k = matrix.kennzahlen;
  console.log(`\n${'='.repeat(74)}`);
  console.log(`Kriterien mit Testfall:                                ${k.mitTestfall} von ${k.kriterienGesamt}`);
  console.log(`Testfaelle gesamt:                                     ${k.testfaelle}`);
  console.log(`Davon belegt erkannt:                                  ${k.belegtErkannt} (${(k.erkennungsquote * 100).toFixed(0)} %)`);
  console.log(`Davon als offen gemeldet:                              ${k.alsOffenGemeldet}`);
  console.log(`Uebersehen (faelschlich erfuellt oder nicht anwendbar): ${k.uebersehen}`);
  console.log(`Fehlalarme (Befund ohne Sollwert):                      ${k.fehlalarme}`);
  console.log('');
  console.log(`Testfaelle der Stufe 1:                                ${k.testfaelleAuto}`);
  console.log(`Davon belegt erkannt:                                  ${(k.erkennungsquoteAuto * 100).toFixed(0)} %`);

  if (k.uebersehen > 0) {
    console.log('\nJedes uebersehene Kriterium ist ein stiller Fehlschlag: Es sieht aus wie');
    console.log('ein bestandener Test. Das ist der gefaehrlichste Zustand des Werkzeugs.');
  }
}

hauptlauf().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
