#!/usr/bin/env node
/**
 * Modellvergleich (PRD 10.1, Phase 8).
 *
 *   npm run modellvergleich                          alle lokal vorhandenen Modelle
 *   npm run modellvergleich -- --modelle=a,b         nur diese
 *   npm run modellvergleich -- --pruefung=linkzweck  nur eine Prüfung
 *
 * Ob ein lokales Modell in der benötigten Größenordnung ausreichend zuverlässig
 * urteilt, ist eine **empirische Frage.** Dieses Werkzeug beantwortet sie: Es
 * legt jedem Modell denselben Testsatz mit bekanntem Sollurteil vor und misst
 * je Prüfung aus `prompts/stufe2.md` vier Größen:
 *
 *   **Trefferquote**    — wie viele der eingebauten Verstöße als `problem` erkannt werden
 *   **Fehlalarmquote**  — wie oft ein einwandfreier Fall als `problem` gemeldet wird
 *   **Anteil unsicher** — wie viel manuelle Nacharbeit anfällt
 *   **Laufzeit**        — was der Lauf kostet
 *
 * Der Anteil `unsicher` ist ausdrücklich **kein Mangel**, sondern eine
 * Kenngröße (L-23). Ein Modell, das im Zweifel `unsicher` sagt, ist besser als
 * eines, das rät. Die einzige wirklich schlechte Zahl ist das **falsche `ok`**:
 * ein Verstoß, den das Modell durchwinkt. Er wird deshalb gesondert ausgewiesen.
 *
 * Zeigt sich, dass ein Modell für einzelne Prüfungen nicht genügt, sind diese
 * Prüfungen abschaltbar und gehen vollständig in Stufe 3 über — der Katalog
 * entscheidet darüber, nicht der Code.
 *
 * **Ohne Ollama läuft hier nichts, und das ist kein Fehler.** Das Werkzeug
 * sagt dann, was fehlt, und beendet sich. Stufe 2 ist optional (Regel 7).
 */

import fs from 'node:fs';
import path from 'node:path';

import { OllamaAdapter, OLLAMA_ADRESSE } from '../src/stufe2/adapter/ollama.js';
import type { ModellAdapter, Urteil } from '../src/stufe2/adapter/typ.js';
import { ladePrompts, setzeEin } from '../src/stufe2/prompts.js';
import type { Prompt, Prompts } from '../src/stufe2/prompts.js';
import { Protokoll } from '../src/protokoll.js';
import { projektWurzel } from '../src/plattform/pfade.js';

// ------------------------------------------------------------------ Satz

type Art = 'buendel' | 'folge' | 'seite';

interface Fall {
  soll?: 'ok' | 'problem';
  warum: string;
  werte?: Record<string, unknown>;
  seitenwerte?: Record<string, unknown>;
  elemente?: { soll: 'ok' | 'problem'; werte: Record<string, unknown> }[];
}

interface SatzPruefung {
  kriterium: string;
  art: Art;
  faelle: Fall[];
}

interface Satz {
  pruefungen: Record<string, SatzPruefung>;
}

// -------------------------------------------------------------- Messwerte

/** Ein einzelnes Urteil gegen seinen Sollwert. */
interface Vergleichsfall {
  pruefung: string;
  warum: string;
  soll: 'ok' | 'problem';
  ist: Urteil;
}

interface PruefungsErgebnis {
  pruefung: string;
  kriterium: string;
  faelle: number;
  /** Sollwert `problem`, Urteil `problem`. */
  treffer: number;
  /** Sollwert `problem`, Urteil `ok`. Der gefährliche Fall. */
  falschesOk: number;
  /** Sollwert `ok`, Urteil `problem`. */
  fehlalarme: number;
  /** Sollwert `ok`, Urteil `ok`. */
  richtigOk: number;
  unsicher: number;
  verstossFaelle: number;
  saubereFaelle: number;
  trefferquote: number;
  fehlalarmquote: number;
  anteilUnsicher: number;
  aufrufe: number;
  dauerMs: number;
  /** Erzeugte Ausgabetoken je Sekunde, gemittelt. */
  ausgabeTempo: number;
}

interface Modellergebnis {
  modell: string;
  gemessenAm: string;
  adresse: string;
  pruefungen: PruefungsErgebnis[];
  gesamt: {
    faelle: number;
    treffer: number;
    falschesOk: number;
    fehlalarme: number;
    unsicher: number;
    trefferquote: number;
    fehlalarmquote: number;
    anteilUnsicher: number;
    dauerMs: number;
  };
  /** Fälle, in denen ein Verstoß durchgewunken wurde — einzeln aufgeführt. */
  durchgewunken: Vergleichsfall[];
}

// ---------------------------------------------------------------- Hauptlauf

async function hauptlauf(): Promise<void> {
  const wurzel = projektWurzel();
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });

  const satz = JSON.parse(
    fs.readFileSync(path.join(wurzel, 'test/modellsatz/satz.json'), 'utf8'),
  ) as Satz;

  let prompts: Prompts;
  try {
    prompts = ladePrompts();
  } catch (e) {
    console.error(`Die Prompts sind nicht lesbar: ${(e as Error).message}`);
    process.exit(1);
  }

  const nurPruefung = argument('--pruefung');
  const adresse = argument('--adresse') ?? OLLAMA_ADRESSE;
  const modelle = await bestimmeModelle(adresse, protokoll);
  if (modelle.length === 0) return;

  const ergebnisse: Modellergebnis[] = [];

  for (const modell of modelle) {
    console.log(`\n${'='.repeat(74)}\nModell: ${modell}\n${'='.repeat(74)}`);

    const adapter = new OllamaAdapter({ modell, adresse, protokoll });
    try {
      ergebnisse.push(await messeModell(adapter, prompts, satz, nurPruefung));
    } finally {
      await adapter.freigeben();
    }
  }

  for (const ergebnis of ergebnisse) {
    zeigeModell(ergebnis);
    const ziel = path.join(wurzel, 'test/modellsatz', `ergebnis-${dateiname(ergebnis.modell)}.json`);
    fs.writeFileSync(ziel, `${JSON.stringify(ergebnis, null, 2)}\n`, 'utf8');
    console.log(`\nGeschrieben: ${path.relative(wurzel, ziel)}`);
  }

  if (ergebnisse.length > 1) zeigeVergleich(ergebnisse);
}

/**
 * Welche Modelle sollen verglichen werden?
 *
 * Ohne Angabe alle lokal vorhandenen. Das ist die ehrliche Voreinstellung: Ein
 * Modell, das nicht auf diesem Rechner liegt, lässt sich hier auch nicht
 * messen — und stillschweigend eines nachzuladen wäre eine Überraschung, die
 * Gigabyte kostet.
 */
async function bestimmeModelle(adresse: string, protokoll: Protokoll): Promise<string[]> {
  const gewuenscht = argument('--modelle')
    ?.split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const probe = new OllamaAdapter({ modell: gewuenscht?.[0] ?? 'unbekannt', adresse, protokoll });
  const zustand = await probe.zustand();
  await probe.freigeben();

  if (!zustand.erreichbar) {
    console.error(`Ollama ist unter ${adresse} nicht erreichbar${zustand.grund ? `: ${zustand.grund}` : '.'}`);
    console.error('');
    console.error('Der Modellvergleich braucht ein laufendes Ollama mit mindestens zwei Modellen.');
    console.error('Einrichtung: ANLEITUNG-OLLAMA.md. Stufe 2 ist optional — ohne sie bleibt das');
    console.error('Werkzeug vollstaendig nutzbar, die betroffenen Kriterien wandern in die');
    console.error('manuelle Liste. Nur dieser Vergleich laesst sich dann nicht fahren.');
    process.exitCode = 1;
    return [];
  }

  if (!gewuenscht || gewuenscht.length === 0) {
    if (zustand.modelle.length === 0) {
      console.error('Ollama laeuft, aber es ist kein Modell installiert. Etwa: ollama pull llama3.1:8b');
      process.exitCode = 1;
      return [];
    }
    console.log(`Gemessen werden alle lokal vorhandenen Modelle: ${zustand.modelle.join(', ')}`);
    return zustand.modelle;
  }

  const fehlend = gewuenscht.filter((m) => !zustand.modelle.includes(m));
  if (fehlend.length > 0) {
    console.error(`Diese Modelle liegen nicht lokal vor: ${fehlend.join(', ')}`);
    console.error(`Vorhanden sind: ${zustand.modelle.join(', ') || '(keines)'}`);
    console.error('Nachladen mit: ollama pull <modell>');
    process.exitCode = 1;
    return [];
  }

  return gewuenscht;
}

// -------------------------------------------------------------- Ein Modell

async function messeModell(
  adapter: ModellAdapter,
  prompts: Prompts,
  satz: Satz,
  nurPruefung: string | undefined,
): Promise<Modellergebnis> {
  const pruefungen: PruefungsErgebnis[] = [];
  const durchgewunken: Vergleichsfall[] = [];

  for (const [id, satzPruefung] of Object.entries(satz.pruefungen)) {
    if (nurPruefung && id !== nurPruefung) continue;

    const prompt = prompts.nachId.get(id);
    if (!prompt) {
      console.error(`  ${id}: kein Prompt in prompts/stufe2.md — uebersprungen`);
      continue;
    }

    process.stdout.write(`  ${id.padEnd(28)}`);
    const ergebnis = await messePruefung(adapter, prompts, prompt, satzPruefung, durchgewunken);
    pruefungen.push(ergebnis);
    console.log(
      `Treffer ${prozent(ergebnis.trefferquote)}  Fehlalarm ${prozent(ergebnis.fehlalarmquote)}  ` +
        `unsicher ${prozent(ergebnis.anteilUnsicher)}  ${(ergebnis.dauerMs / 1000).toFixed(1)} s`,
    );
  }

  const faelle = summe(pruefungen, (p) => p.faelle);
  const treffer = summe(pruefungen, (p) => p.treffer);
  const fehlalarme = summe(pruefungen, (p) => p.fehlalarme);
  const unsicher = summe(pruefungen, (p) => p.unsicher);
  const verstossFaelle = summe(pruefungen, (p) => p.verstossFaelle);
  const saubereFaelle = summe(pruefungen, (p) => p.saubereFaelle);

  return {
    modell: adapter.modell,
    gemessenAm: new Date().toISOString().slice(0, 10),
    adresse: OLLAMA_ADRESSE,
    pruefungen,
    gesamt: {
      faelle,
      treffer,
      falschesOk: summe(pruefungen, (p) => p.falschesOk),
      fehlalarme,
      unsicher,
      trefferquote: quote(treffer, verstossFaelle),
      fehlalarmquote: quote(fehlalarme, saubereFaelle),
      anteilUnsicher: quote(unsicher, faelle),
      dauerMs: summe(pruefungen, (p) => p.dauerMs),
    },
    durchgewunken,
  };
}

async function messePruefung(
  adapter: ModellAdapter,
  prompts: Prompts,
  prompt: Prompt,
  satzPruefung: SatzPruefung,
  durchgewunken: Vergleichsfall[],
): Promise<PruefungsErgebnis> {
  const vergleiche: Vergleichsfall[] = [];
  let aufrufe = 0;
  let dauerMs = 0;
  const tempi: number[] = [];

  const stelle = async (
    seitenwerte: Record<string, unknown>,
    elemente: { soll: 'ok' | 'problem'; warum: string; werte: Record<string, unknown> }[],
  ): Promise<void> => {
    const nummeriert = elemente.map((e, nummer) => ({ ...e.werte, i: nummer + 1 }));

    /*
      Genau derselbe Aufbau wie im Betrieb (`stufe2/pruefungen.ts`). Ein
      eigener, „sauberer" Prompt fuer die Messung waere wertlos: Gemessen wird,
      was die Anwendung tatsaechlich fragt — samt Listennamen, die je Pruefung
      anders heissen.
    */
    const aufgabe = setzeEin(prompt.vorlage, {
      ...seitenwerte,
      elemente: nummeriert,
      [prompt.id === 'fokusreihenfolge' ? 'stopps' : prompt.id === 'lesereihenfolge' ? 'bloecke' : 'elemente']:
        nummeriert,
    });

    const begonnen = Date.now();
    const antwort = await adapter.bewerte(prompts.systemAnweisung, aufgabe, nummeriert.length);
    dauerMs += Date.now() - begonnen;
    aufrufe += 1;
    if (antwort.messung) tempi.push(antwort.messung.ausgabeTempo);

    elemente.forEach((fall, stelle2) => {
      // Ein ausgefallener Aufruf oder ein fehlendes Urteil gilt als
      // `unsicher` — genau wie im Betrieb (L-23, L-26).
      const urteil = antwort.urteile.get(stelle2 + 1)?.urteil ?? 'unsicher';
      const vergleich: Vergleichsfall = {
        pruefung: prompt.id,
        warum: fall.warum,
        soll: fall.soll,
        ist: urteil,
      };
      vergleiche.push(vergleich);
      if (fall.soll === 'problem' && urteil === 'ok') durchgewunken.push(vergleich);
    });
  };

  if (satzPruefung.art === 'buendel') {
    const alle = satzPruefung.faelle.map((f) => ({
      soll: f.soll ?? 'ok',
      warum: f.warum,
      werte: f.werte ?? {},
    }));
    // Die Buendelgroesse des Prompts wird eingehalten; sonst maesse man einen
    // Aufruf, den es im Betrieb gar nicht gibt.
    for (let anfang = 0; anfang < alle.length; anfang += prompt.buendelGroesse) {
      await stelle({}, alle.slice(anfang, anfang + prompt.buendelGroesse));
    }
  } else if (satzPruefung.art === 'folge') {
    for (const fall of satzPruefung.faelle) {
      await stelle(
        {},
        (fall.elemente ?? []).map((e) => ({ soll: e.soll, warum: fall.warum, werte: e.werte })),
      );
    }
  } else {
    for (const fall of satzPruefung.faelle) {
      await stelle(fall.seitenwerte ?? {}, [{ soll: fall.soll ?? 'ok', warum: fall.warum, werte: {} }]);
    }
  }

  const verstossFaelle = vergleiche.filter((v) => v.soll === 'problem').length;
  const saubereFaelle = vergleiche.filter((v) => v.soll === 'ok').length;
  const treffer = vergleiche.filter((v) => v.soll === 'problem' && v.ist === 'problem').length;
  const falschesOk = vergleiche.filter((v) => v.soll === 'problem' && v.ist === 'ok').length;
  const fehlalarme = vergleiche.filter((v) => v.soll === 'ok' && v.ist === 'problem').length;
  const richtigOk = vergleiche.filter((v) => v.soll === 'ok' && v.ist === 'ok').length;
  const unsicher = vergleiche.filter((v) => v.ist === 'unsicher').length;

  return {
    pruefung: prompt.id,
    kriterium: satzPruefung.kriterium,
    faelle: vergleiche.length,
    treffer,
    falschesOk,
    fehlalarme,
    richtigOk,
    unsicher,
    verstossFaelle,
    saubereFaelle,
    trefferquote: quote(treffer, verstossFaelle),
    fehlalarmquote: quote(fehlalarme, saubereFaelle),
    anteilUnsicher: quote(unsicher, vergleiche.length),
    aufrufe,
    dauerMs,
    ausgabeTempo: tempi.length === 0 ? 0 : Math.round(tempi.reduce((s, t) => s + t, 0) / tempi.length),
  };
}

// ------------------------------------------------------------- Ausgabe

function zeigeModell(ergebnis: Modellergebnis): void {
  console.log(`\n${'='.repeat(74)}\n${ergebnis.modell} — je Pruefung\n`);
  console.log('  Pruefung                     Krit.   Faelle  Treffer  Fehlal.  unsich.  falsch ok  Tempo');
  console.log(`  ${'-'.repeat(88)}`);

  for (const p of ergebnis.pruefungen) {
    console.log(
      `  ${p.pruefung.padEnd(28)} ${p.kriterium.padEnd(7)} ${String(p.faelle).padStart(5)}  ` +
        `${prozent(p.trefferquote).padStart(7)}  ${prozent(p.fehlalarmquote).padStart(7)}  ` +
        `${prozent(p.anteilUnsicher).padStart(7)}  ${String(p.falschesOk).padStart(9)}  ` +
        `${String(p.ausgabeTempo).padStart(4)} T/s`,
    );
  }

  const g = ergebnis.gesamt;
  console.log(`  ${'-'.repeat(88)}`);
  console.log(
    `  ${'gesamt'.padEnd(28)} ${''.padEnd(7)} ${String(g.faelle).padStart(5)}  ` +
      `${prozent(g.trefferquote).padStart(7)}  ${prozent(g.fehlalarmquote).padStart(7)}  ` +
      `${prozent(g.anteilUnsicher).padStart(7)}  ${String(g.falschesOk).padStart(9)}  ` +
      `${(g.dauerMs / 1000).toFixed(0)} s`,
  );

  if (ergebnis.durchgewunken.length > 0) {
    console.log(`\n  Durchgewunkene Verstoesse (${ergebnis.durchgewunken.length}):`);
    console.log('  Diese Faelle hat das Modell als "ok" bewertet, obwohl ein Verstoss vorlag.');
    console.log('  Sie sind die einzige wirklich schlechte Zahl dieser Messung.\n');
    for (const fall of ergebnis.durchgewunken) {
      console.log(`    ${fall.pruefung.padEnd(28)} ${fall.warum}`);
    }
  }
}

function zeigeVergleich(ergebnisse: readonly Modellergebnis[]): void {
  console.log(`\n${'='.repeat(74)}\nVergleich\n`);
  console.log('  Modell                          Treffer  Fehlal.  unsich.  falsch ok  Laufzeit');
  console.log(`  ${'-'.repeat(74)}`);

  for (const e of ergebnisse) {
    console.log(
      `  ${e.modell.padEnd(30)}  ${prozent(e.gesamt.trefferquote).padStart(7)}  ` +
        `${prozent(e.gesamt.fehlalarmquote).padStart(7)}  ${prozent(e.gesamt.anteilUnsicher).padStart(7)}  ` +
        `${String(e.gesamt.falschesOk).padStart(9)}  ${(e.gesamt.dauerMs / 1000).toFixed(0)} s`,
    );
  }

  console.log('\n  Lesart: Ein hoher Anteil "unsicher" ist kein Mangel, sondern manuelle Nacharbeit.');
  console.log('  Ein durchgewunkener Verstoss ist ein Mangel — er sieht aus wie ein bestandener Test.');
  console.log('  Genuegt ein Modell fuer einzelne Pruefungen nicht, gehoert die betreffende Pruefung');
  console.log('  im Katalog von "llm" auf "manuell" umgestellt. Das ist eine Datenaenderung.');
}

// ------------------------------------------------------------- Werkzeuge

function argument(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

function summe<T>(werte: readonly T[], lies: (wert: T) => number): number {
  return werte.reduce((s, w) => s + lies(w), 0);
}

function quote(teil: number, ganzes: number): number {
  return ganzes === 0 ? 0 : Math.round((teil / ganzes) * 1000) / 1000;
}

function prozent(anteil: number): string {
  return `${Math.round(anteil * 100)} %`;
}

/** Modellnamen enthalten Doppelpunkte und Schrägstriche — beides taugt nicht als Dateiname. */
function dateiname(modell: string): string {
  return modell.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
}

hauptlauf().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
