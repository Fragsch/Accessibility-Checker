/**
 * Ablaufsteuerung eines Scans (ARCHITEKTUR 9 Schritte 4 bis 8).
 *
 * Je Seite: laden → Anwendbarkeit bestimmen → Stufe 1 ausfuehren → Befunde
 * zuordnen → Status ableiten. Danach Verdichtung auf Projektebene.
 *
 * Zwei Grundsaetze bestimmen den Aufbau:
 *   - Eine Seite, die nicht geladen werden kann, bricht den Scan nicht ab
 *     (ARCHITEKTUR 5.6).
 *   - Was nicht geprueft wurde, bekommt `pruefung_erforderlich`, nie `erfuellt`.
 *     Das gilt ausdruecklich auch fuer die Engines und Stufen, die es vor
 *     Phase 3 und 4 noch nicht gibt (CLAUDE.md, "Wichtig beim Einstieg").
 */

import type {
  Befund,
  Betriebsart,
  Bewertung,
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
import { fuehreAxeAus } from '../stufe1/axe.js';
import { normalisiereAxe } from '../stufe1/normalisierung.js';
import { baueBewertung, verdichte } from './statusableitung.js';

/** Engines, die in Phase 1 und 2 tatsaechlich laufen. */
const VORHANDENE_ENGINES = new Set(['axe']);

export const WERKZEUG_VERSION = '0.1.0';

export interface SeitenAuftrag {
  url: string;
  bezeichnung?: string;
}

export interface ScanAuftrag {
  seiten: SeitenAuftrag[];
  standard?: Standard;
  betriebsart?: Betriebsart;
  viewport?: Viewport;
  /** Stufe 2 ist vor Phase 4 nicht vorhanden und bleibt abschaltbar (Regel 7). */
  stufe2Aktiv?: boolean;
  katalog?: Katalog;
  browser?: Browser;
  protokoll?: Protokoll;
  /** Fortschrittsmeldung je Seite — Grundlage der spaeteren Ereignisse (SSE). */
  beiFortschritt?: (meldung: FortschrittMeldung) => void;
}

export interface FortschrittMeldung {
  art: 'seite-begonnen' | 'seite-fertig' | 'fehler';
  url: string;
  nummer: number;
  gesamt: number;
  text?: string;
}

/**
 * Fuehrt einen vollstaendigen Scan aus.
 * Der Browser wird gestartet, wenn keiner uebergeben wurde — und dann auch
 * wieder geschlossen.
 */
export async function fuehreScanAus(auftrag: ScanAuftrag): Promise<ScanErgebnis> {
  const protokoll = auftrag.protokoll ?? stillesProtokoll;
  const standard = auftrag.standard ?? '2.1';
  const betriebsart = auftrag.betriebsart ?? (auftrag.seiten.length > 1 ? 'profil' : 'einzelseite');
  const katalog = auftrag.katalog ?? Katalog.laden();
  const kriterien = katalog.fuerStandard(standard);
  const zuordnung = katalog.regelZuordnung('axe', standard);

  const eigenerBrowser = auftrag.browser === undefined;
  const browser = auftrag.browser ?? (await Browser.starten({ protokoll }));

  const gestartetAm = new Date().toISOString();
  const seitenErgebnisse: SeitenErgebnis[] = [];

  try {
    let nummer = 0;
    for (const seitenAuftrag of auftrag.seiten) {
      nummer += 1;
      auftrag.beiFortschritt?.({
        art: 'seite-begonnen',
        url: seitenAuftrag.url,
        nummer,
        gesamt: auftrag.seiten.length,
      });

      const ergebnis = await pruefeSeite({
        browser,
        seitenAuftrag,
        kriterien,
        zuordnung,
        standard,
        betriebsart,
        protokoll,
        ...(auftrag.viewport ? { viewport: auftrag.viewport } : {}),
        stufe2Aktiv: auftrag.stufe2Aktiv ?? false,
      });

      seitenErgebnisse.push(ergebnis);
      auftrag.beiFortschritt?.({
        art: ergebnis.zustand === 'fehler' ? 'fehler' : 'seite-fertig',
        url: seitenAuftrag.url,
        nummer,
        gesamt: auftrag.seiten.length,
        ...(ergebnis.fehler ? { text: ergebnis.fehler } : {}),
      });
    }
  } finally {
    if (eigenerBrowser) await browser.schliessen();
  }

  return {
    scanId: null,
    betriebsart,
    standard,
    gestartetAm,
    beendetAm: new Date().toISOString(),
    stufe2Aktiv: auftrag.stufe2Aktiv ?? false,
    werkzeugVersion: WERKZEUG_VERSION,
    seiten: seitenErgebnisse,
    projektebene: verdichte(seitenErgebnisse, kriterien),
  };
}

interface SeitenPruefungOptionen {
  browser: Browser;
  seitenAuftrag: SeitenAuftrag;
  kriterien: readonly Kriterium[];
  zuordnung: Map<string, string[]>;
  standard: Standard;
  betriebsart: Betriebsart;
  protokoll: Protokoll;
  viewport?: Viewport;
  stufe2Aktiv: boolean;
}

async function pruefeSeite(optionen: SeitenPruefungOptionen): Promise<SeitenErgebnis> {
  const { browser, seitenAuftrag, kriterien, protokoll } = optionen;

  let geladen;
  try {
    geladen = await browser.ladeSeite(seitenAuftrag.url, {
      viewport: optionen.viewport ?? VIEWPORT_SCHREIBTISCH,
    });
  } catch (e) {
    const grund = e instanceof SeitenLadeFehler ? e.message : String(e);
    protokoll.fehler('scan', `Seite uebersprungen: ${seitenAuftrag.url}`, { grund });
    return {
      url: seitenAuftrag.url,
      bezeichnung: seitenAuftrag.bezeichnung ?? null,
      titel: null,
      zustand: 'fehler',
      fehler: grund,
      bewertungen: [],
    };
  }

  try {
    const anwendbarkeit = await ermittleAnwendbarkeit(geladen.seite, kriterien, {
      betriebsart: optionen.betriebsart,
      protokoll,
    });

    const geprueft = new Set(kriterien.map((k) => k.id));

    let befundeNachKriterium = new Map<string, Befund[]>();
    let hinweiseNachKriterium = new Map<string, Hinweis[]>();
    let ausgefuehrteRegeln = new Set<string>();
    let axeGelaufen = false;
    let axeFehler: string | null = null;

    try {
      const axeErgebnis = await fuehreAxeAus(geladen.seite, {
        standard: optionen.standard,
        zusatzRegeln: [...optionen.zuordnung.keys()],
      });

      ausgefuehrteRegeln = new Set([
        ...axeErgebnis.verstoesse.map((v) => v.id),
        ...axeErgebnis.unentschieden.map((v) => v.id),
        ...axeErgebnis.bestandenRegelIds,
        ...axeErgebnis.nichtAnwendbarRegelIds,
      ]);
      axeGelaufen = true;

      const normalisiert = normalisiereAxe(axeErgebnis.verstoesse, axeErgebnis.unentschieden, {
        zuordnung: optionen.zuordnung,
        geprueftesKriterium: (id) => geprueft.has(id),
        protokoll,
      });

      befundeNachKriterium = gruppiere(normalisiert.befunde, (b) => b.kriterium);
      hinweiseNachKriterium = gruppiere(normalisiert.hinweise, (h) => h.kriterium);
    } catch (e) {
      // Stuerzt die Engine ab, ist das kein bestandener Test (ARCHITEKTUR 5.6).
      axeFehler = e instanceof Error ? e.message.split('\n')[0] ?? e.message : String(e);
      protokoll.fehler('scan', `axe-core fehlgeschlagen auf ${geladen.url}`, { ursache: axeFehler });
    }

    const bewertungen: Bewertung[] = kriterien.map((kriterium) =>
      bewerteKriterium({
        kriterium,
        anwendbarkeit: anwendbarkeit.get(kriterium.id) ?? { anwendbar: true, treffer: null, grund: null },
        befunde: befundeNachKriterium.get(kriterium.id) ?? [],
        hinweise: [...(hinweiseNachKriterium.get(kriterium.id) ?? [])],
        ausgefuehrteRegeln,
        axeGelaufen,
        axeFehler,
        stufe2Aktiv: optionen.stufe2Aktiv,
      }),
    );

    return {
      url: geladen.url,
      bezeichnung: seitenAuftrag.bezeichnung ?? null,
      titel: geladen.titel || null,
      zustand: 'fertig',
      fehler: null,
      bewertungen,
    };
  } finally {
    await geladen.schliessen();
  }
}

interface KriteriumOptionen {
  kriterium: Kriterium;
  anwendbarkeit: AnwendbarkeitErgebnis;
  befunde: Befund[];
  hinweise: Hinweis[];
  ausgefuehrteRegeln: Set<string>;
  axeGelaufen: boolean;
  axeFehler: string | null;
  stufe2Aktiv: boolean;
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
      if (!VORHANDENE_ENGINES.has(pruefung.engine)) {
        hinweise.push({
          kriterium: kriterium.id,
          herkunft: `auto/${pruefung.engine}`,
          text: `Die Pruefung ueber "${pruefung.engine}" ist noch nicht vorhanden (Ausbaustufe). Dieser Teil des Kriteriums wurde nicht geprueft.`,
        });
        continue;
      }

      if (optionen.axeFehler) {
        hinweise.push({
          kriterium: kriterium.id,
          herkunft: 'auto/axe',
          text: `axe-core konnte auf dieser Seite nicht ausgefuehrt werden (${optionen.axeFehler}). Das Kriterium wurde nicht automatisch geprueft.`,
        });
        continue;
      }

      const gelaufen = pruefung.regelIds.filter((id) => optionen.ausgefuehrteRegeln.has(id));
      const ausgefallen = pruefung.regelIds.filter((id) => !optionen.ausgefuehrteRegeln.has(id));

      if (gelaufen.length > 0) {
        autoPruefungGelaufen = true;
        herkuenfte.add('auto/axe');
      }
      if (ausgefallen.length > 0) {
        hinweise.push({
          kriterium: kriterium.id,
          herkunft: 'auto/axe',
          text: `Diese axe-Regeln wurden nicht ausgefuehrt: ${ausgefallen.join(', ')}. Der davon abgedeckte Teil des Kriteriums ist ungeprueft.`,
        });
      }
      continue;
    }

    if (pruefung.typ === 'llm') {
      // Regel 7: Ohne Stufe 2 wandert die Pruefung in die manuelle Liste.
      hinweise.push({
        kriterium: kriterium.id,
        herkunft: `llm/${pruefung.pruefungsId}`,
        text: optionen.stufe2Aktiv
          ? `Die Bewertung "${pruefung.pruefungsId}" der Sprachmodell-Stufe steht noch aus.`
          : `Die Sprachmodell-Stufe ist nicht aktiv. Die Bewertung "${pruefung.pruefungsId}" ist von Hand vorzunehmen.`,
      });
      herkuenfte.add('manuell');
      continue;
    }

    offeneFragen.push({
      kriterium: kriterium.id,
      frage: pruefung.frage,
      kontextSelektor: pruefung.kontextSelektor ?? null,
      betroffeneElemente: null,
    });
    herkuenfte.add('manuell');
  }

  return baueBewertung({
    kriterium,
    anwendbar: true,
    befunde: optionen.befunde,
    hinweise,
    offeneFragen,
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
