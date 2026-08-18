/**
 * Ablaufsteuerung eines Scans (ARCHITEKTUR 9 Schritte 4 bis 8).
 *
 * Je Seite: laden → Anwendbarkeit bestimmen → Engines der Stufe 1 ausfuehren →
 * Befunde zuordnen → Status ableiten. Danach die Vergleiche ueber mehrere
 * Seiten und die Verdichtung auf Projektebene.
 *
 * Zwei Grundsaetze bestimmen den Aufbau:
 *   - Eine Seite, die nicht geladen werden kann, bricht den Scan nicht ab
 *     (ARCHITEKTUR 5.6).
 *   - Was nicht geprueft wurde, bekommt `pruefung_erforderlich`, nie
 *     `erfuellt`. Das gilt fuer fehlende Engines ebenso wie fuer einzelne
 *     Regeln, die nicht gelaufen sind.
 */

import type {
  BeantworteteFrage,
  Befund,
  Betriebsart,
  Bewertung,
  Engine as EngineName,
  Hinweis,
  Kriterium,
  OffeneFrage,
  ScanErgebnis,
  SeitenErgebnis,
  Standard,
} from '../typen/index.js';
import { Katalog } from '../katalog/laden.js';
import { Protokoll, stillesProtokoll } from '../protokoll.js';
import { Browser, SeitenLadeFehler, VIEWPORT_SCHREIBTISCH } from './browser.js';
import type { Viewport } from './browser.js';
import { ermittleAnwendbarkeit } from './anwendbarkeit.js';
import type { AnwendbarkeitErgebnis } from './anwendbarkeit.js';
import { findeEngine, vorhandeneEngines } from '../stufe1/index.js';
import type { EngineKontext, RohBefund, RohHinweis } from '../stufe1/engine.js';
import { fuegeZusammen } from '../stufe1/engine.js';
import { BEWEGUNGSHOERER_SPITZEL } from '../stufe1/eigen/dom.js';
import { lesMerkmale, vergleicheSeiten } from '../stufe1/eigen/mehrseitig.js';
import type { SeitenMerkmale } from '../stufe1/eigen/mehrseitig.js';
import { normalisiere } from '../stufe1/normalisierung.js';
import { baueBewertung, verdichte } from './statusableitung.js';
import type { LlmUrteil } from './statusableitung.js';
import { fuehreStufe2Aus } from '../stufe2/pruefungen.js';
import type { Stufe2Ergebnis } from '../stufe2/pruefungen.js';
import { ladePrompts } from '../stufe2/prompts.js';
import type { Prompts } from '../stufe2/prompts.js';
import type { ModellAdapter } from '../stufe2/adapter/typ.js';
import type { Zwischenspeicher } from '../stufe2/cache.js';
import { baueKatalogFragen } from '../stufe3/fragen.js';
import type { ManuelleAntwort } from '../typen/index.js';

export const WERKZEUG_VERSION = '0.1.0';

/** Viewports nach A-04. Der breiteste ist der Hauptdurchgang. */
export const VIEWPORTS: Viewport[] = [
  { breite: 1280, hoehe: 900 },
  { breite: 768, hoehe: 1024 },
  { breite: 320, hoehe: 640 },
];

export interface SeitenAuftrag {
  url: string;
  bezeichnung?: string;
}

export interface ScanAuftrag {
  seiten: SeitenAuftrag[];
  standard?: Standard;
  betriebsart?: Betriebsart;
  viewport?: Viewport;
  /**
   * Zusaetzlich in schmalen Viewports pruefen (A-04). Kostet Zeit und ist
   * deshalb abschaltbar — die Grundpruefung bleibt davon unberuehrt.
   */
  mehrereViewports?: boolean;
  /**
   * Sprachmodell-Stufe zuschalten (L-46).
   *
   * Ohne Adapter bleibt sie aus — auch wenn dieser Schalter steht. Das ist
   * kein Fehler: Ein nicht erreichbares Ollama ist eine abgeschaltete Stufe 2,
   * kein Abbruch (L-26).
   */
  stufe2Aktiv?: boolean;
  /** Modell-Adapter der Stufe 2. Fehlt er, bleibt die Stufe aus. */
  stufe2Adapter?: ModellAdapter;
  /** Zwischenspeicher fuer bereits bewertete Textbausteine (L-28). */
  stufe2Speicher?: Zwischenspeicher;
  /**
   * Bereits gegebene manuelle Antworten, nach Adresse und Fragekennung
   * (M-04). Passende Antworten werden uebernommen, statt die Frage erneut
   * zu stellen.
   */
  fruehereAntworten?: Map<string, Map<string, ManuelleAntwort>>;
  katalog?: Katalog;
  browser?: Browser;
  protokoll?: Protokoll;
  /** Abbruch durch den Nutzer (K-11). Wirkt zwischen zwei Seiten. */
  abbruch?: AbortSignal;
  /** Fortschrittsmeldung je Seite — Grundlage der Ereignisse (SSE, ARCHITEKTUR 6). */
  beiFortschritt?: (meldung: FortschrittMeldung) => void;
}

export interface FortschrittMeldung {
  art: 'seite-begonnen' | 'seite-fertig' | 'fehler';
  url: string;
  nummer: number;
  gesamt: number;
  text?: string;
  ergebnis?: SeitenErgebnis;
}

/** Fuehrt einen vollstaendigen Scan aus. */
export async function fuehreScanAus(auftrag: ScanAuftrag): Promise<ScanErgebnis> {
  const protokoll = auftrag.protokoll ?? stillesProtokoll;
  const standard = auftrag.standard ?? '2.1';
  const betriebsart = auftrag.betriebsart ?? (auftrag.seiten.length > 1 ? 'profil' : 'einzelseite');
  const katalog = auftrag.katalog ?? Katalog.laden();
  const kriterien = katalog.fuerStandard(standard);

  // Die Sprachmodell-Stufe laeuft nur, wenn sie eingeschaltet *und* ein
  // Adapter vorhanden ist. Fehlt einer von beiden, wandern die betroffenen
  // Pruefungen in die manuelle Liste (L-26, L-48).
  const stufe2Aktiv = (auftrag.stufe2Aktiv ?? false) && auftrag.stufe2Adapter !== undefined;
  let prompts: Prompts | null = null;
  if (stufe2Aktiv) {
    try {
      prompts = ladePrompts();
    } catch (e) {
      protokoll.fehler('stufe2', `Prompts nicht ladbar: ${(e as Error).message}`);
    }
  }

  const eigenerBrowser = auftrag.browser === undefined;
  const browser = auftrag.browser ?? (await Browser.starten({ protokoll }));

  const gestartetAm = new Date().toISOString();
  const seitenErgebnisse: SeitenErgebnis[] = [];
  const merkmale: SeitenMerkmale[] = [];

  try {
    let nummer = 0;
    for (const seitenAuftrag of auftrag.seiten) {
      if (auftrag.abbruch?.aborted) {
        protokoll.info('scan', `Abgebrochen nach ${nummer} von ${auftrag.seiten.length} Seiten`);
        break;
      }

      nummer += 1;
      auftrag.beiFortschritt?.({
        art: 'seite-begonnen',
        url: seitenAuftrag.url,
        nummer,
        gesamt: auftrag.seiten.length,
      });

      const { ergebnis, merkmale: seitenMerkmale } = await pruefeSeite({
        browser,
        seitenAuftrag,
        kriterien,
        katalog,
        standard,
        betriebsart,
        protokoll,
        ...(auftrag.viewport ? { viewport: auftrag.viewport } : {}),
        mehrereViewports: auftrag.mehrereViewports ?? false,
        stufe2Aktiv,
        ...(auftrag.fruehereAntworten ? { fruehereAntworten: auftrag.fruehereAntworten } : {}),
        ...(stufe2Aktiv && prompts && auftrag.stufe2Adapter
          ? {
              stufe2: {
                adapter: auftrag.stufe2Adapter,
                prompts,
                ...(auftrag.stufe2Speicher ? { speicher: auftrag.stufe2Speicher } : {}),
                ...(auftrag.abbruch ? { abbruch: auftrag.abbruch } : {}),
              },
            }
          : {}),
      });

      seitenErgebnisse.push(ergebnis);
      if (seitenMerkmale) merkmale.push(seitenMerkmale);

      auftrag.beiFortschritt?.({
        art: ergebnis.zustand === 'fehler' ? 'fehler' : 'seite-fertig',
        url: seitenAuftrag.url,
        nummer,
        gesamt: auftrag.seiten.length,
        ergebnis,
        ...(ergebnis.fehler ? { text: ergebnis.fehler } : {}),
      });
    }
  } finally {
    if (eigenerBrowser) await browser.schliessen();
    // Modell freigeben, damit es nicht dauerhaft Speicher belegt
    // (ANLEITUNG-OLLAMA.md, Fallstrick 2).
    if (stufe2Aktiv) await auftrag.stufe2Adapter?.freigeben();
  }

  if (betriebsart !== 'einzelseite') {
    ergaenzeMehrseitiges(seitenErgebnisse, merkmale, katalog, standard, kriterien);
  }

  return {
    scanId: null,
    betriebsart,
    standard,
    gestartetAm,
    beendetAm: new Date().toISOString(),
    stufe2Aktiv,
    werkzeugVersion: WERKZEUG_VERSION,
    seiten: seitenErgebnisse,
    projektebene: verdichte(seitenErgebnisse, kriterien),
  };
}

/**
 * Traegt die Ergebnisse der seitenuebergreifenden Vergleiche nach.
 *
 * Diese Kriterien lassen sich an einer Seite nicht beurteilen; ihr Befund
 * entsteht erst aus dem Vergleich. Er wird auf allen Seiten vermerkt, weil er
 * fuer alle gilt.
 */
function ergaenzeMehrseitiges(
  seiten: SeitenErgebnis[],
  merkmale: readonly SeitenMerkmale[],
  katalog: Katalog,
  standard: Standard,
  kriterien: readonly Kriterium[],
): void {
  const geprueft = new Set(kriterien.map((k) => k.id));
  const vergleich = vergleicheSeiten(merkmale, katalog.regelZuordnung('eigen', standard), (id) => geprueft.has(id));
  if (vergleich.befunde.length === 0) return;

  for (const seite of seiten) {
    if (seite.zustand !== 'fertig') continue;

    for (const befund of vergleich.befunde) {
      const bewertung = seite.bewertungen.find((b) => b.kriterium === befund.kriterium);
      if (!bewertung) continue;

      bewertung.befunde.push(befund);
      bewertung.status = 'nicht_erfuellt';
      if (!bewertung.herkunft.includes('auto/eigen')) {
        bewertung.herkunft = bewertung.herkunft === 'ungeprueft' ? 'auto/eigen' : `${bewertung.herkunft} + auto/eigen`;
      }
    }
  }
}

interface SeitenPruefungOptionen {
  browser: Browser;
  seitenAuftrag: SeitenAuftrag;
  kriterien: readonly Kriterium[];
  katalog: Katalog;
  standard: Standard;
  betriebsart: Betriebsart;
  protokoll: Protokoll;
  viewport?: Viewport;
  mehrereViewports: boolean;
  stufe2Aktiv: boolean;
  fruehereAntworten?: Map<string, Map<string, ManuelleAntwort>>;
  stufe2?: {
    adapter: ModellAdapter;
    prompts: Prompts;
    speicher?: Zwischenspeicher;
    abbruch?: AbortSignal;
  };
}

interface SeitenPruefungErgebnis {
  ergebnis: SeitenErgebnis;
  merkmale: SeitenMerkmale | null;
}

async function pruefeSeite(optionen: SeitenPruefungOptionen): Promise<SeitenPruefungErgebnis> {
  const { browser, seitenAuftrag, kriterien, katalog, protokoll } = optionen;
  const hauptViewport = optionen.viewport ?? VIEWPORT_SCHREIBTISCH;

  let geladen;
  try {
    geladen = await browser.ladeSeite(seitenAuftrag.url, {
      viewport: hauptViewport,
      spitzel: BEWEGUNGSHOERER_SPITZEL,
    });
  } catch (e) {
    const grund = e instanceof SeitenLadeFehler ? e.message : String(e);
    protokoll.fehler('scan', `Seite uebersprungen: ${seitenAuftrag.url}`, { grund });
    return {
      ergebnis: {
        url: seitenAuftrag.url,
        bezeichnung: seitenAuftrag.bezeichnung ?? null,
        titel: null,
        zustand: 'fehler',
        fehler: grund,
        bewertungen: [],
      },
      merkmale: null,
    };
  }

  try {
    const anwendbarkeit = await ermittleAnwendbarkeit(geladen.seite, kriterien, {
      betriebsart: optionen.betriebsart,
      protokoll,
    });
    const merkmale = await lesMerkmale(geladen.seite);
    const geprueft = new Set(kriterien.map((k) => k.id));

    // Welche Engines sind ueberhaupt gefragt, und mit welchen Regeln?
    const gefragteEngines = sammleEngines(kriterien);
    const vorhanden = vorhandeneEngines();

    const kontext: EngineKontext = {
      seite: geladen.seite,
      browser,
      url: geladen.url,
      standard: optionen.standard,
      viewport: hauptViewport,
      quelltext: geladen.quelltext,
      protokoll,
    };

    const rohBefunde: RohBefund[] = [];
    const rohHinweise: RohHinweis[] = [];
    const ausgefuehrteRegeln = new Set<string>();
    const gescheiterteEngines = new Map<EngineName, string>();

    for (const [engineName, regeln] of gefragteEngines) {
      if (!vorhanden.has(engineName)) continue;
      const engine = findeEngine(engineName);
      if (!engine) continue;

      try {
        const ergebnis = await engine.ausfuehren(kontext, [...regeln]);
        rohBefunde.push(...ergebnis.befunde);
        rohHinweise.push(...ergebnis.hinweise);
        for (const regel of ergebnis.ausgefuehrteRegeln) ausgefuehrteRegeln.add(regel);
      } catch (e) {
        // Eine abgestuerzte Engine ist kein bestandener Test (ARCHITEKTUR 5.6).
        const ursache = e instanceof Error ? e.message.split('\n')[0] ?? e.message : String(e);
        gescheiterteEngines.set(engineName, ursache);
        protokoll.fehler('scan', `Engine "${engineName}" fehlgeschlagen auf ${geladen.url}`, { ursache });
      }
    }

    // Zusaetzliche Viewports (A-04): dieselben Engines, schmalere Fenster.
    if (optionen.mehrereViewports) {
      const weitere = await pruefeWeitereViewports(kontext, gefragteEngines, vorhanden, hauptViewport, protokoll);
      rohBefunde.push(...weitere.befunde);
      rohHinweise.push(...weitere.hinweise);
      for (const regel of weitere.ausgefuehrteRegeln) ausgefuehrteRegeln.add(regel);
    }

    const normalisiert = normalisiere(rohBefunde, rohHinweise, {
      zuordnung: katalog.alleRegelZuordnungen(optionen.standard),
      geprueftesKriterium: (id) => geprueft.has(id),
      protokoll,
    });

    /*
      Stufe 2 läuft nach Stufe 1 und nicht davor.

      Zum einen liefert Stufe 1 die Vorarbeit — den Tab-Durchlauf etwa, dessen
      Reihenfolge der Prompt `fokusreihenfolge` inhaltlich beurteilt. Zum
      anderen sind die Ergebnisse der Stufe 1 damit fertig, bevor der langsame
      Teil beginnt; die Oberfläche kann sie sofort zeigen und die Urteile des
      Modells nachreichen (L-49, NF-10).
    */
    let stufe2: Stufe2Ergebnis | null = null;
    if (optionen.stufe2) {
      stufe2 = await fuehreStufe2Aus({
        adapter: optionen.stufe2.adapter,
        prompts: optionen.stufe2.prompts,
        kriterien,
        standard: optionen.standard,
        sammelKontext: { seite: geladen.seite, protokoll },
        protokoll,
        mehrseitig: optionen.betriebsart !== 'einzelseite',
        ...(optionen.stufe2.speicher ? { speicher: optionen.stufe2.speicher } : {}),
        ...(optionen.stufe2.abbruch ? { abbruch: optionen.stufe2.abbruch } : {}),
      });

      protokoll.info('stufe2', `${stufe2.modellaufrufe} Modellaufrufe, ${stufe2.zwischenspeicherTreffer} aus dem Zwischenspeicher`, {
        url: geladen.url,
      });
    }

    const befundeNachKriterium = gruppiere(normalisiert.befunde, (b) => b.kriterium);
    const hinweiseNachKriterium = gruppiere([...normalisiert.hinweise, ...(stufe2?.hinweise ?? [])], (h) => h.kriterium);

    /*
      Fragen der Stufe 3 vorbereiten (M-01).

      Das geschieht hier und nicht erst bei der Bewertung, weil dafuer die
      Seite noch offen sein muss: Zu jeder Frage gehoert der Kontext, und der
      steht im DOM. Eine Frage ohne Kontext ist fuer den, der sie beantworten
      soll, kaum brauchbar.
    */
    const fragenNachKriterium = new Map<string, OffeneFrage[]>();
    for (const kriterium of kriterien) {
      if (!(anwendbarkeit.get(kriterium.id)?.anwendbar ?? true)) continue;
      if (!kriterium.pruefungen.some((p) => p.typ === 'manuell')) continue;

      const fragen = await baueKatalogFragen(kriterium, { seite: geladen.seite, protokoll });
      if (fragen.length > 0) fragenNachKriterium.set(kriterium.id, fragen);
    }

    for (const frage of stufe2?.offeneFragen ?? []) {
      const bisher = fragenNachKriterium.get(frage.kriterium) ?? [];
      bisher.push(frage);
      fragenNachKriterium.set(frage.kriterium, bisher);
    }

    // Frueher gegebene Antworten zu dieser Adresse (M-04).
    const antworten = optionen.fruehereAntworten?.get(geladen.url) ?? new Map<string, ManuelleAntwort>();

    const bewertungen: Bewertung[] = kriterien.map((kriterium) =>
      bewerteKriterium({
        kriterium,
        anwendbarkeit: anwendbarkeit.get(kriterium.id) ?? { anwendbar: true, treffer: null, grund: null },
        befunde: befundeNachKriterium.get(kriterium.id) ?? [],
        hinweise: [...(hinweiseNachKriterium.get(kriterium.id) ?? [])],
        ausgefuehrteRegeln,
        vorhandeneEngines: vorhanden,
        gescheiterteEngines,
        stufe2Aktiv: optionen.stufe2Aktiv,
        fragen: fragenNachKriterium.get(kriterium.id) ?? [],
        antworten,
        ...(stufe2 ? { stufe2 } : {}),
      }),
    );

    return {
      ergebnis: {
        url: geladen.url,
        bezeichnung: seitenAuftrag.bezeichnung ?? null,
        titel: geladen.titel || null,
        zustand: 'fertig',
        fehler: null,
        bewertungen,
      },
      merkmale,
    };
  } finally {
    await geladen.schliessen();
  }
}

/**
 * Wiederholt die Pruefung in den schmaleren Viewports.
 *
 * Gemeldet werden nur Befunde, die im Hauptdurchgang nicht schon auftraten —
 * sonst stuende jeder Mangel dreimal im Ergebnis. Die Entdoppelung uebernimmt
 * die Normalisierung; hier wird lediglich die Breite vermerkt, damit im Befund
 * steht, wo er auftrat.
 */
async function pruefeWeitereViewports(
  kontext: EngineKontext,
  gefragteEngines: Map<EngineName, Set<string>>,
  vorhanden: Set<EngineName>,
  hauptViewport: Viewport,
  protokoll: Protokoll,
): Promise<{ befunde: RohBefund[]; hinweise: RohHinweis[]; ausgefuehrteRegeln: string[] }> {
  const ergebnisse = [];

  for (const viewport of VIEWPORTS) {
    if (viewport.breite === hauptViewport.breite) continue;

    try {
      await kontext.seite.setViewportSize({ width: viewport.breite, height: viewport.hoehe });
      await kontext.seite.waitForTimeout(400);

      for (const [engineName, regeln] of gefragteEngines) {
        if (!vorhanden.has(engineName)) continue;
        // Im schmalen Fenster zaehlen nur die Engines, deren Urteil von der
        // Darstellung abhaengt. Markupgueltigkeit und Sprache aendern sich nicht.
        if (engineName !== 'axe' && engineName !== 'pixel' && engineName !== 'eigen') continue;

        const engine = findeEngine(engineName);
        if (!engine) continue;

        const nurDarstellung = engineName === 'eigen' ? [...regeln].filter(istDarstellungsabhaengig) : [...regeln];
        if (nurDarstellung.length === 0) continue;

        ergebnisse.push(await engine.ausfuehren({ ...kontext, viewport }, nurDarstellung));
      }
    } catch (e) {
      protokoll.warnung('scan', `Pruefung bei ${viewport.breite} Pixeln fehlgeschlagen: ${(e as Error).message}`);
    }
  }

  await kontext.seite
    .setViewportSize({ width: hauptViewport.breite, height: hauptViewport.hoehe })
    .catch(() => undefined);

  const zusammen = fuegeZusammen(ergebnisse);
  return { befunde: zusammen.befunde, hinweise: zusammen.hinweise, ausgefuehrteRegeln: zusammen.ausgefuehrteRegeln };
}

/**
 * Regeln, deren Urteil von der Fensterbreite abhaengt.
 *
 * `textabstand-test` gehoert ausdruecklich dazu: Ein Kasten mit fester Hoehe
 * faellt bei 1280 Pixeln nicht auf, weil der Text auf eine Zeile passt. Erst
 * wenn er im schmalen Fenster umbricht, wird er abgeschnitten.
 */
function istDarstellungsabhaengig(regel: string): boolean {
  return [
    'zielgroesse-24',
    'dom-reihenfolge-vs-visuell',
    'fokus-verdeckt',
    'tooltip-hoverbar',
    'textabstand-test',
  ].includes(regel);
}

/** Welche Engine soll welche Regeln ausfuehren? Steht ausschliesslich im Katalog. */
function sammleEngines(kriterien: readonly Kriterium[]): Map<EngineName, Set<string>> {
  const gefragt = new Map<EngineName, Set<string>>();
  for (const kriterium of kriterien) {
    for (const pruefung of kriterium.pruefungen) {
      if (pruefung.typ !== 'auto') continue;
      const vorhanden = gefragt.get(pruefung.engine) ?? new Set<string>();
      for (const regel of pruefung.regelIds) vorhanden.add(regel);
      gefragt.set(pruefung.engine, vorhanden);
    }
  }
  return gefragt;
}

interface KriteriumOptionen {
  kriterium: Kriterium;
  anwendbarkeit: AnwendbarkeitErgebnis;
  befunde: Befund[];
  hinweise: Hinweis[];
  ausgefuehrteRegeln: Set<string>;
  vorhandeneEngines: Set<EngineName>;
  gescheiterteEngines: Map<EngineName, string>;
  stufe2Aktiv: boolean;
  /** Vorbereitete Fragen dieses Kriteriums (M-01, M-06). */
  fragen: OffeneFrage[];
  /** Frueher gegebene Antworten zu dieser Adresse (M-04). */
  antworten: Map<string, ManuelleAntwort>;
  stufe2?: Stufe2Ergebnis;
}

/**
 * Bewertet ein Kriterium auf einer Seite.
 *
 * Hier entscheidet sich, ob das Werkzeug ehrlich ist: Jede Pruefung, die im
 * Katalog steht, aber nicht gelaufen ist, muss einen Hinweis erzeugen. Sonst
 * sieht ein ungeprueftes Kriterium aus wie ein bestandenes.
 */
function bewerteKriterium(optionen: KriteriumOptionen): Bewertung {
  const { kriterium } = optionen;
  const hinweise = [...optionen.hinweise];
  const offeneFragen: OffeneFrage[] = [];
  const beantwortet: BeantworteteFrage[] = [];
  const herkuenfte = new Set<string>();

  if (!optionen.anwendbarkeit.anwendbar) {
    return baueBewertung({
      kriterium,
      anwendbar: false,
      grund: optionen.anwendbarkeit.grund,
      befunde: [],
      hinweise: [],
      offeneFragen: [],
      autoPruefungGelaufen: false,
      herkunft: 'anwendbarkeit',
    });
  }

  let autoPruefungGelaufen = false;

  for (const pruefung of kriterium.pruefungen) {
    if (pruefung.typ === 'auto') {
      if (!optionen.vorhandeneEngines.has(pruefung.engine)) {
        hinweise.push({
          kriterium: kriterium.id,
          herkunft: `auto/${pruefung.engine}`,
          text: `Die Pruefung ueber "${pruefung.engine}" ist noch nicht vorhanden. Dieser Teil des Kriteriums wurde nicht geprueft.`,
        });
        continue;
      }

      const gescheitert = optionen.gescheiterteEngines.get(pruefung.engine);
      if (gescheitert) {
        hinweise.push({
          kriterium: kriterium.id,
          herkunft: `auto/${pruefung.engine}`,
          text: `Die Engine "${pruefung.engine}" konnte auf dieser Seite nicht ausgefuehrt werden (${gescheitert}). Das Kriterium wurde insoweit nicht geprueft.`,
        });
        continue;
      }

      const gelaufen = pruefung.regelIds.filter((id) => optionen.ausgefuehrteRegeln.has(id));
      const ausgefallen = pruefung.regelIds.filter((id) => !optionen.ausgefuehrteRegeln.has(id));

      if (gelaufen.length > 0) {
        autoPruefungGelaufen = true;
        herkuenfte.add(`auto/${pruefung.engine}`);
      }
      if (ausgefallen.length > 0) {
        hinweise.push({
          kriterium: kriterium.id,
          herkunft: `auto/${pruefung.engine}`,
          text: `Diese Regeln wurden nicht ausgefuehrt: ${ausgefallen.join(', ')}. Der davon abgedeckte Teil des Kriteriums ist ungeprueft.`,
        });
      }
      continue;
    }

    if (pruefung.typ === 'llm') {
      const gelaufen = optionen.stufe2?.gelaufenePruefungen.includes(pruefung.pruefungsId) ?? false;

      if (gelaufen) {
        // Die Urteile stecken bereits als Hinweise in `optionen.hinweise`;
        // hier zaehlt nur, dass die Pruefung stattgefunden hat.
        herkuenfte.add('llm');
        continue;
      }

      // Regel 7 und L-48: Ohne Stufe 2 wandert die Pruefung in die manuelle
      // Liste — sie entfaellt nicht.
      hinweise.push({
        kriterium: kriterium.id,
        herkunft: `llm/${pruefung.pruefungsId}`,
        text: optionen.stufe2Aktiv
          ? `Die Bewertung "${pruefung.pruefungsId}" der Sprachmodell-Stufe ist ausgefallen. Sie ist von Hand vorzunehmen.`
          : `Die Sprachmodell-Stufe ist nicht aktiv. Die Bewertung "${pruefung.pruefungsId}" ist von Hand vorzunehmen.`,
      });
      herkuenfte.add('manuell');
      continue;
    }

    // Die Fragen sind bereits samt Kontext vorbereitet worden; hier zaehlt
    // nur noch, dass dieses Kriterium eine manuelle Pruefung hat.
    herkuenfte.add('manuell');
  }

  /*
    Fragen aufteilen: beantwortet oder offen (M-02, M-04).

    Eine Antwort, die zu keiner aktuellen Frage passt, wird nicht angewendet.
    Das ist wichtig: Die Fragekennung enthaelt den Kontext, und wenn der sich
    geaendert hat, ist die alte Antwort ueberholt. Sie stehen zu lassen hiesse,
    ein Urteil ueber einen Text zu faellen, den es nicht mehr gibt.
  */
  for (const frage of optionen.fragen) {
    const antwort = optionen.antworten.get(frage.id);
    if (antwort) {
      beantwortet.push({
        frage,
        antwort: antwort.antwort,
        notiz: antwort.notiz,
        beantwortetAm: antwort.beantwortetAm,
      });
      herkuenfte.add('manuell');
    } else {
      offeneFragen.push(frage);
      herkuenfte.add('manuell');
    }
  }

  const llmUrteile: LlmUrteil[] = optionen.stufe2?.urteileJeKriterium.get(kriterium.id) ?? [];

  return baueBewertung({
    kriterium,
    anwendbar: true,
    befunde: optionen.befunde,
    hinweise,
    offeneFragen,
    beantworteteFragen: beantwortet,
    llmUrteile,
    autoPruefungGelaufen,
    herkunft: herkuenfte.size ? [...herkuenfte].sort().join(' + ') : 'ungeprueft',
  });
}

function gruppiere<T>(eintraege: readonly T[], schluessel: (e: T) => string): Map<string, T[]> {
  const karte = new Map<string, T[]>();
  for (const eintrag of eintraege) {
    const k = schluessel(eintrag);
    const vorhanden = karte.get(k);
    if (vorhanden) vorhanden.push(eintrag);
    else karte.set(k, [eintrag]);
  }
  return karte;
}
