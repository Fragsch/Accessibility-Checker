#!/usr/bin/env node
/**
 * Abnahme auf einem Betriebssystem (PRD 8.1, NF-13, Phase 8).
 *
 *   npm run abnahme            prüft diesen Rechner und schreibt das Protokoll
 *   npm run abnahme -- --zeigen   nur die bisher gesammelten Protokolle zeigen
 *
 * Das Werkzeug soll unter Windows, macOS und Linux laufen. Behauptet ist das
 * schnell; belegt ist es erst, wenn es auf allen dreien einmal durchgelaufen
 * ist. Dieser Lauf prüft die Stellen, an denen Plattformunterschiede
 * tatsächlich durchschlagen — und schreibt das Ergebnis nach
 * `test/abnahme/<plattform>-<architektur>.json`.
 *
 * Diese Dateien werden versioniert. Sie sind der Beleg: Wer wissen will, ob
 * das Werkzeug unter Windows je gelaufen ist, sieht nach, ob dort eine Datei
 * liegt und was in ihr steht. Eine Zusage im Fließtext beweist nichts.
 *
 * Geprüft wird in dieser Reihenfolge — von der Voraussetzung zum Erzeugnis:
 *
 *   1. Laufzeit und Speicherorte     — läuft Node, sind die Pfade beschreibbar?
 *   2. Daten                          — Katalog, Prompts, Abdeckungsmatrix
 *   3. Datenbank                      — better-sqlite3 samt Schema
 *   4. Browser                        — Playwright und Chromium
 *   5. Engines                        — jede einzelne an einer echten Seite
 *   6. Bericht                        — HTML und PDF
 *   7. Sprachmodell                   — Ollama, ausdrücklich als „darf fehlen"
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Katalog } from '../src/katalog/laden.js';
import { ladeAbdeckung } from '../src/katalog/abdeckung.js';
import { oeffneDatenbank } from '../src/db/index.js';
import { Protokoll } from '../src/protokoll.js';
import { datenVerzeichnis, projektWurzel } from '../src/plattform/pfade.js';
import { erkenneHardware, schlageModellVor } from '../src/plattform/hardware.js';
import { OllamaAdapter, OLLAMA_ADRESSE } from '../src/stufe2/adapter/ollama.js';
import { ladePrompts } from '../src/stufe2/prompts.js';
import { fuehreScanAus } from '../src/scan/runner.js';
import { baueBerichtsdaten } from '../src/bericht/daten.js';
import { alsHtml } from '../src/bericht/html.js';
import { alsPdf } from '../src/bericht/pdf.js';

type Ausgang = 'ok' | 'fehlt' | 'fehler';

interface Probe {
  name: string;
  ausgang: Ausgang;
  /** Was gemessen oder gefunden wurde — kurz, für die Tabelle. */
  befund: string;
  /**
   * Darf diese Probe fehlschlagen, ohne die Abnahme zu kippen?
   *
   * Genau eine tut das: das Sprachmodell. Stufe 2 ist optional (Regel 7) —
   * ein Rechner ohne Ollama ist ein vollständig brauchbarer Rechner.
   */
  optional?: boolean;
}

interface Abnahmeprotokoll {
  plattform: NodeJS.Platform;
  architektur: string;
  betriebssystem: string;
  node: string;
  gepruefLtAm: string;
  werkzeug: string;
  proben: Probe[];
  bestanden: boolean;
}

async function hauptlauf(): Promise<void> {
  const wurzel = projektWurzel();
  const ordner = path.join(wurzel, 'test/abnahme');
  fs.mkdirSync(ordner, { recursive: true });

  if (process.argv.includes('--zeigen')) {
    zeigeGesammelte(ordner);
    return;
  }

  console.log(`Abnahme auf ${os.platform()} ${os.arch()} — ${os.release()}\n`);

  const proben: Probe[] = [];
  for (const pruefung of PRUEFUNGEN) {
    process.stdout.write(`  ${pruefung.name.padEnd(46)}`);
    const probe = await fuehreAus(pruefung);
    proben.push(probe);
    console.log(`${zeichen(probe)} ${probe.befund}`);
  }

  const bestanden = proben.every((p) => p.ausgang === 'ok' || p.optional === true);

  const protokoll: Abnahmeprotokoll = {
    plattform: os.platform(),
    architektur: os.arch(),
    betriebssystem: `${os.type()} ${os.release()}`,
    node: process.version,
    gepruefLtAm: new Date().toISOString().slice(0, 10),
    werkzeug: werkzeugfassung(),
    proben,
    bestanden,
  };

  const ziel = path.join(ordner, `${os.platform()}-${os.arch()}.json`);
  fs.writeFileSync(ziel, `${JSON.stringify(protokoll, null, 2)}\n`, 'utf8');

  console.log(`\nProtokoll geschrieben: ${path.relative(wurzel, ziel)}`);
  console.log(
    bestanden
      ? `\nAbnahme auf ${os.platform()} bestanden.`
      : `\nAbnahme auf ${os.platform()} NICHT bestanden — siehe die Zeilen mit ✗.`,
  );

  zeigeGesammelte(ordner);
  if (!bestanden) process.exitCode = 1;
}

// ------------------------------------------------------------- Die Proben

interface Pruefung {
  name: string;
  optional?: boolean;
  lauf: () => Promise<string> | string;
}

const PRUEFUNGEN: Pruefung[] = [
  {
    name: '1  Node-Laufzeit',
    lauf: () => {
      const [gross] = process.versions.node.split('.');
      if (Number(gross) < 22) throw new Error(`Node ${process.versions.node} ist zu alt, gebraucht wird 22 oder neuer`);
      return `Node ${process.versions.node}, ${os.arch()}`;
    },
  },
  {
    name: '1  Speicherorte beschreibbar',
    lauf: () => {
      // Nicht nur auf Vorhandensein pruefen: Unter Windows scheitert das
      // Schreiben gern erst am Rechteproblem, nicht am fehlenden Ordner.
      const ordner = datenVerzeichnis();
      fs.mkdirSync(ordner, { recursive: true });
      const probe = path.join(ordner, '.abnahme-schreibprobe');
      fs.writeFileSync(probe, 'probe', 'utf8');
      fs.rmSync(probe);
      return path.relative(projektWurzel(), ordner) || ordner;
    },
  },
  {
    name: '2  Prüfkatalog lesbar und gültig',
    lauf: () => {
      const katalog = Katalog.laden();
      return `${katalog.fuerStandard('2.1').length} Kriterien unter 2.1, ${katalog.fuerStandard('2.2').length} unter 2.2`;
    },
  },
  {
    name: '2  Prompts der Stufe 2 lesbar',
    lauf: () => `${ladePrompts().nachId.size} Prompts`,
  },
  {
    name: '2  Abdeckungsmatrix vorhanden',
    optional: true,
    lauf: () => {
      const matrix = ladeAbdeckung();
      if (!matrix) throw new Error('nicht gemessen — "npm run verifikation" erzeugt sie');
      return `gemessen am ${matrix.gemessenAm}, ${matrix.kennzahlen.mitTestfall} Kriterien mit Testfall`;
    },
  },
  {
    name: '3  Datenbank (better-sqlite3) samt Schema',
    lauf: () => {
      // Im Arbeitsspeicher: Die Abnahme darf die Betriebsdatenbank nicht
      // anfassen. Geprueft wird, ob sich die native Bibliothek auf dieser
      // Plattform ueberhaupt laden laesst — das ist die eigentliche Frage.
      const db = oeffneDatenbank({ pfad: ':memory:' });
      const tabellen = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      db.close();
      return `${tabellen.length} Tabellen angelegt`;
    },
  },
  {
    name: '4  Chromium startet und lädt eine Seite',
    lauf: async () => {
      const { Browser } = await import('../src/scan/browser.js');
      const browser = await Browser.starten({ protokoll: stilles() });
      try {
        const geladen = await browser.ladeSeite(referenzseite('sauber.html'));
        const titel = await geladen.seite.title();
        await geladen.schliessen();
        return `Seite geladen: „${titel}"`;
      } finally {
        await browser.schliessen();
      }
    },
  },
  {
    name: '5  Alle sechs Engines an einer echten Seite',
    lauf: async () => {
      /*
        Der vollstaendige Scan statt einzelner Engineaufrufe: Genau hier
        schlagen Plattformunterschiede durch, die in der Einzelpruefung nicht
        auffallen — tesseract.js laedt WebAssembly nach, die Pixelanalyse
        schreibt Bilddateien, und die Schriftmasse fallen je Betriebssystem
        anders aus.
      */
      const ergebnis = await fuehreScanAus({
        seiten: [{ url: referenzseite('mangelhaft.html') }],
        standard: '2.2',
        protokoll: stilles(),
        mehrereViewports: true,
      });

      const seite = ergebnis.seiten[0];
      if (!seite || seite.zustand !== 'fertig') throw new Error(seite?.fehler ?? 'Der Scan ist nicht fertig geworden');

      const verstoesse = seite.bewertungen.filter((b) => b.status === 'nicht_erfuellt').length;
      if (verstoesse < 15) {
        throw new Error(`nur ${verstoesse} Verstoesse gefunden — auf dieser Seite sind es sonst deutlich mehr`);
      }
      return `${verstoesse} Verstoesse auf mangelhaft.html, ${seite.bewertungen.length} Kriterien bewertet`;
    },
  },
  {
    name: '6  Bericht als HTML und PDF',
    lauf: async () => {
      const ergebnis = await fuehreScanAus({
        seiten: [{ url: referenzseite('sauber.html') }],
        standard: '2.2',
        protokoll: stilles(),
      });

      const daten = baueBerichtsdaten({ ergebnis, kriterien: Katalog.laden().fuerStandard('2.2') });
      const html = alsHtml(daten, { alleAufgeklappt: true });
      const pdf = await alsPdf(daten, { html });

      if (!html.includes('Konformitätstabelle')) throw new Error('Der HTML-Bericht ist unvollstaendig');
      if (pdf.length < 10_000) throw new Error(`Das PDF ist mit ${pdf.length} Byte verdaechtig klein`);

      return `HTML ${Math.round(html.length / 1024)} kB, PDF ${Math.round(pdf.length / 1024)} kB`;
    },
  },
  {
    name: '7  Hardware-Erkennung',
    lauf: () => {
      const hardware = erkenneHardware();
      const vorschlag = schlageModellVor(hardware);
      return `${hardware.beschleunigung}, ${hardware.speicherGb} GB → ${vorschlag.modell}`;
    },
  },
  {
    name: '7  Ollama erreichbar (darf fehlen)',
    optional: true,
    lauf: async () => {
      const adapter = new OllamaAdapter({ modell: 'unbekannt', adresse: OLLAMA_ADRESSE, protokoll: stilles() });
      const zustand = await adapter.zustand();
      await adapter.freigeben();
      if (!zustand.erreichbar) throw new Error(zustand.grund ?? 'nicht erreichbar');
      return `${zustand.version ?? 'unbekannte Fassung'}, ${zustand.modelle.length} Modell(e)`;
    },
  },
];

async function fuehreAus(pruefung: Pruefung): Promise<Probe> {
  try {
    const befund = await pruefung.lauf();
    return { name: pruefung.name, ausgang: 'ok', befund, ...(pruefung.optional ? { optional: true } : {}) };
  } catch (e) {
    const text = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    return {
      name: pruefung.name,
      ausgang: pruefung.optional ? 'fehlt' : 'fehler',
      befund: text,
      ...(pruefung.optional ? { optional: true } : {}),
    };
  }
}

// ------------------------------------------------------ Gesammelte Protokolle

/**
 * Was auf den drei Betriebssystemen bisher belegt ist.
 *
 * Diese Übersicht ist der eigentliche Zweck des Werkzeugs. Sie macht sichtbar,
 * was noch aussteht — und verhindert, dass „läuft auf drei Betriebssystemen"
 * zu einer Behauptung wird, die nur auf einem geprüft wurde.
 */
function zeigeGesammelte(ordner: string): void {
  const erwartet: { plattform: string; name: string }[] = [
    { plattform: 'win32', name: 'Windows' },
    { plattform: 'darwin', name: 'macOS' },
    { plattform: 'linux', name: 'Linux' },
  ];

  const gefunden = fs
    .readdirSync(ordner)
    .filter((datei) => datei.endsWith('.json'))
    .map((datei) => JSON.parse(fs.readFileSync(path.join(ordner, datei), 'utf8')) as Abnahmeprotokoll);

  console.log(`\n${'='.repeat(74)}\nAbnahme nach Betriebssystem (NF-13)\n`);

  for (const { plattform, name } of erwartet) {
    const laeufe = gefunden.filter((p) => p.plattform === plattform);
    if (laeufe.length === 0) {
      console.log(`  ${name.padEnd(10)} — steht aus. Dieser Lauf hat dort nie stattgefunden.`);
      continue;
    }
    for (const lauf of laeufe) {
      const offen = lauf.proben.filter((p) => p.ausgang === 'fehler').length;
      console.log(
        `  ${name.padEnd(10)} ${lauf.architektur.padEnd(6)} ${lauf.bestanden ? 'bestanden' : `${offen} Probe(n) offen`}` +
          `  — ${lauf.gepruefLtAm}, ${lauf.node}, ${lauf.werkzeug}`,
      );
    }
  }

  const fehlende = erwartet.filter(({ plattform }) => !gefunden.some((p) => p.plattform === plattform));
  if (fehlende.length > 0) {
    console.log(
      `\n  Solange ${fehlende.map((f) => f.name).join(' und ')} aussteht, ist die Zusage „laeuft unter`,
    );
    console.log('  Windows, macOS und Linux" fuer diese Fassung nicht belegt. Der Lauf dauert');
    console.log('  wenige Minuten: npm run abnahme');
  }
}

// ------------------------------------------------------------- Werkzeuge

function referenzseite(datei: string): string {
  return pathToFileURL(path.join(projektWurzel(), 'test', 'referenzseiten', datei)).href;
}

function stilles(): Protokoll {
  return new Protokoll({ datei: null, konsoleAb: null });
}

function zeichen(probe: Probe): string {
  if (probe.ausgang === 'ok') return '✓';
  return probe.optional ? '·' : '✗';
}

function werkzeugfassung(): string {
  try {
    const paket = JSON.parse(fs.readFileSync(path.join(projektWurzel(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return `Fassung ${paket.version ?? 'unbekannt'}`;
  } catch {
    return 'Fassung unbekannt';
  }
}

hauptlauf().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
