/**
 * Berichtsdaten nach WCAG-EM und ACR (PRD 6.6.1, X-10 bis X-22).
 *
 * Dieses Modul erzeugt **keine Darstellung.** Es baut aus einem Scanergebnis
 * die sieben Abschnitte des Berichts als Daten; HTML, PDF, EARL und der
 * Entwurf der Erklärung greifen alle auf dasselbe Modell zu.
 *
 * Der Trennstrich ist mehr als Ordnungsliebe: Drei Ausgabewege, die jeder für
 * sich aus dem Scanergebnis rechnen, laufen unweigerlich auseinander. Dann
 * steht im PDF eine andere Zahl als in der HTML-Fassung — und der Bericht ist
 * als Aussage gegenüber Dritten wertlos.
 *
 * **Zwei Regeln stehen über allem:**
 *
 * `pruefung_erforderlich` wird nie zu „Unterstützt" (X-14). Solange ein
 * Kriterium offen ist, trägt der Bericht sichtbar den Vermerk *Entwurf*.
 *
 * Der Bericht zeigt ausschließlich die Kriterien des gewählten Standards
 * (X-19). Kriterien der jeweils anderen Fassung tauchen nicht auf — auch nicht
 * als „nicht bewertet".
 */

import type {
  AcrBewertung,
  Betriebsart,
  Empfehlung,
  Kriterium,
  ProjektBewertung,
  Qualitaetshinweis,
  ScanErgebnis,
  SeitenErgebnis,
  SeitenZustand,
  Standard,
  Status,
  Stufe,
} from '../typen/index.js';
import type { Profil } from '../profil/index.js';
import { verdichte } from '../scan/statusableitung.js';
import { erkenneMuster, ranglisteSeiten } from './muster.js';
import type { Muster, SeitenRang } from './muster.js';

// --------------------------------------------------------------- Wortschatz

/**
 * Bewertungssprache des ACR, deutsch (X-11, X-18).
 *
 * Im Bericht erscheinen ausschließlich diese Begriffe. Die englischen
 * Originalbezeichnungen stehen nur hier im Kommentar, damit die Herkunft aus
 * dem VPAT-2.5-Vokabular nachvollziehbar bleibt.
 */
export const ACR_TEXT: Record<AcrBewertung, string> = {
  unterstuetzt: 'Unterstützt', // Supports
  teilweise_unterstuetzt: 'Teilweise unterstützt', // Partially Supports
  unterstuetzt_nicht: 'Unterstützt nicht', // Does Not Support
  nicht_anwendbar: 'Nicht anwendbar', // Not Applicable
  nicht_abschliessend_bewertet: 'Nicht abschließend bewertet', // eigene Ergänzung, siehe X-14
};

export const STUFE_TEXT: Record<Stufe, string> = {
  auto: 'Stufe 1 — automatisch',
  llm: 'Stufe 2 — Sprachmodell',
  manuell: 'Stufe 3 — manuell',
};

export const BETRIEBSART_TEXT: Record<Betriebsart, string> = {
  einzelseite: 'Einzelseite',
  profil: 'Prüfprofil',
  gesamt: 'Gesamtprüfung über die Domain',
};

/** Bekannte Grenzen je Prüfstufe (X-15). Aus ARCHITEKTUR 5.8 bis 5.10. */
export const GRENZEN: Record<Stufe, string> = {
  auto:
    'Automatische Prüfungen belegen Verstöße, nicht deren Abwesenheit. Was nicht beurteilt werden konnte, ' +
    'bleibt offen und wird nicht als erfüllt geführt.',
  llm:
    'Ein Urteil des Sprachmodells ist nie ein Verstoß, sondern immer ein Anlass zur Nachprüfung. ' +
    'Beurteilt wird ausschließlich Text, keine Bilder.',
  manuell: 'Das Ergebnis hängt am Urteil der prüfenden Person. Eine Antwort kann keinen belegten Verstoß aufheben.',
};

// ------------------------------------------------------------------ Modell

export interface Deckblatt {
  /** Name des geprüften Angebots. Aus dem Profil, sonst aus der Adresse. */
  angebot: string;
  startadresse: string;
  standard: Standard;
  /** Ausgeschrieben: „WCAG 2.1, Level AA" (X-20). */
  standardText: string;
  /** Zeitpunkt der Prüfung — die geprüfte Fassung ist die von diesem Tag. */
  gepruefteFassung: string;
  erstelltAm: string;
  pruefendePerson: string | null;
  werkzeug: string;
  /** Solange ein Kriterium offen ist (X-14). */
  entwurf: boolean;
  /** Zahl der offenen Kriterien — gehört in den Entwurfsvermerk. */
  offeneKriterien: number;
  kriterienGesamt: number;
}

export interface Geltungsbereich {
  standardText: string;
  betriebsart: Betriebsart;
  betriebsartText: string;
  browser: string;
  viewports: string[];
  /** Was den Aussagewert einschränkt — nie leer, es gibt immer Grenzen. */
  einschraenkungen: string[];
}

export interface Stichprobenseite {
  url: string;
  bezeichnung: string | null;
  titel: string | null;
  /** Zweckvermerk aus dem Prüfprofil (X-16, K-05). */
  zweck: string | null;
  zustand: SeitenZustand;
  fehler: string | null;
  verstoesse: number;
  offen: number;
}

export interface Stichprobe {
  seiten: Stichprobenseite[];
  /** Warum genau diese Seiten — nach WCAG-EM Schritt 3. */
  begruendung: string;
  gepruefteSeiten: number;
  gescheiterteSeiten: number;
}

export interface Kennzahlen {
  erfuellt: number;
  nichtErfuellt: number;
  pruefungErforderlich: number;
  nichtAnwendbar: number;
  gesamt: number;
}

/** Eine der wirksamsten Maßnahmen (PRD 6.6.1 Abschnitt 4). */
export interface Massnahme {
  titel: string;
  kriterium: string;
  kriteriumTitel: string;
  betroffeneSeiten: number;
  baustein: string | null;
  empfehlung: string;
}

export interface Zusammenfassung {
  kennzahlen: Kennzahlen;
  gesamtbild: string;
  massnahmen: Massnahme[];
  rangliste: SeitenRang[];
}

export interface Konformitaetszeile {
  kriterium: Kriterium;
  status: Status;
  acr: AcrBewertung;
  acrText: string;
  /** Schriftliche Anmerkung zu **jedem** Kriterium (X-12). */
  anmerkung: string;
  betroffeneSeiten: string[];
  anwendbareSeiten: number;
}

/** Ein Mangel, verdichtet über alle Seiten, auf denen er gleich auftritt. */
export interface Belegstelle {
  beschreibung: string;
  selektor: string | null;
  htmlAusschnitt: string | null;
  schwere: string;
  seiten: string[];
  baustein: string | null;
}

export interface Detailbefund {
  kriterium: Kriterium;
  acrText: string;
  belege: Belegstelle[];
  empfehlung: Empfehlung;
}

export interface Methodikzeile {
  kriterium: string;
  titel: string;
  /** Welche Stufen der Katalog für dieses Kriterium vorsieht. */
  stufen: Stufe[];
  /** Woher die Bewertung tatsächlich stammt (E-05). */
  herkunft: string[];
  grenzen: string[];
}

export type VermerkArt = 'entwurf' | 'geschuetzt' | 'stufe2' | 'abbruch' | 'seitenfehler' | 'qualitaet';

/** Ein Vermerk, der im Bericht sichtbar stehen muss. */
export interface Vermerk {
  art: VermerkArt;
  ueberschrift: string;
  text: string;
  /** Betroffene Kriterien, sofern die Angabe zum Vermerk gehört (X-22). */
  kriterien?: string[];
}

export interface Berichtsdaten {
  deckblatt: Deckblatt;
  geltungsbereich: Geltungsbereich;
  stichprobe: Stichprobe;
  zusammenfassung: Zusammenfassung;
  konformitaet: Konformitaetszeile[];
  detailbefunde: Detailbefund[];
  methodik: Methodikzeile[];
  /** Mängel ohne Kriterium im gewählten Standard (X-21). */
  qualitaetshinweise: { hinweis: Qualitaetshinweis; seiten: string[] }[];
  vermerke: Vermerk[];
}

export interface BerichtsOptionen {
  ergebnis: ScanErgebnis;
  /** Kriterien des gewählten Standards — die Auswahl ist bereits erfolgt (X-19). */
  kriterien: readonly Kriterium[];
  /** Profil des Scans, falls vorhanden. Liefert Namen und Zweckvermerke (X-16). */
  profil?: Profil | null;
  pruefendePerson?: string | null;
  /** Nur diese Seite berichten (X-05). Fehlt sie, gilt der Projektbericht. */
  nurSeite?: string;
  /** Erzeugungszeitpunkt; einsetzbar, damit Tests reproduzierbar bleiben. */
  erstelltAm?: string;
}

// ------------------------------------------------------------------ Aufbau

/**
 * Baut die Berichtsdaten.
 *
 * Bei `nurSeite` wird das Ergebnis vorher auf diese eine Seite eingeengt und
 * die Projektebene **neu verdichtet** (X-05). Die gespeicherte Verdichtung
 * einfach zu übernehmen wäre falsch: Sie bezieht sich auf alle Seiten, und ein
 * Seitenbericht behauptete dann Mängel, die auf dieser Seite gar nicht
 * vorliegen.
 */
export function baueBerichtsdaten(optionen: BerichtsOptionen): Berichtsdaten {
  const kriterien = [...optionen.kriterien];
  const ergebnis = engeEin(optionen.ergebnis, optionen.nurSeite);
  const erstelltAm = optionen.erstelltAm ?? new Date().toISOString();

  const nachId = new Map(kriterien.map((k) => [k.id, k]));

  /*
    Neu verdichtet statt uebernommen (X-19).

    Die Verdichtung im Scanergebnis stammt aus dem Lauf. Fuer den Bericht
    zaehlt aber der Katalog: Unter WCAG 2.2 muessen genau 55 Zeilen erscheinen,
    auch wenn zu einem Kriterium keine Bewertung vorliegt — dann eben als
    „nicht abschliessend bewertet". Ein stillschweigend fehlendes Kriterium
    waere im Bericht nicht zu bemerken, und niemand koennte den Unterschied
    zwischen „geprueft und in Ordnung" und „gar nicht dabei" sehen.
  */
  const projektebene = verdichte(ergebnis.seiten, kriterien);
  const muster = erkenneMuster(ergebnis);
  const rangliste = ranglisteSeiten(ergebnis);

  const kennzahlen = zaehle(projektebene);
  const offene = projektebene.filter((p) => p.status === 'pruefung_erforderlich').map((p) => p.kriterium);

  const konformitaet = projektebene.map((zeile) =>
    baueKonformitaetszeile(zeile, nachId.get(zeile.kriterium) as Kriterium, ergebnis),
  );

  return {
    deckblatt: baueDeckblatt(ergebnis, optionen, erstelltAm, offene.length, kriterien.length),
    geltungsbereich: baueGeltungsbereich(ergebnis, optionen.profil ?? null),
    stichprobe: baueStichprobe(ergebnis, optionen.profil ?? null, rangliste),
    zusammenfassung: {
      kennzahlen,
      gesamtbild: beschreibeGesamtbild(kennzahlen, ergebnis.seiten.length),
      massnahmen: waehleMassnahmen(muster, nachId),
      rangliste,
    },
    konformitaet,
    detailbefunde: baueDetailbefunde(projektebene, nachId, muster),
    methodik: baueMethodik(kriterien, ergebnis),
    qualitaetshinweise: sammleQualitaetshinweise(ergebnis),
    vermerke: baueVermerke(ergebnis, offene, kriterien),
  };
}

/**
 * Engt das Ergebnis auf eine Seite ein (X-05).
 *
 * Die Verdichtung entsteht danach ohnehin neu — sie bezoege sich sonst auf
 * alle Seiten, und ein Seitenbericht behauptete Maengel, die auf dieser Seite
 * gar nicht vorliegen.
 */
function engeEin(ergebnis: ScanErgebnis, nurSeite?: string): ScanErgebnis {
  if (!nurSeite) return ergebnis;
  return { ...ergebnis, seiten: ergebnis.seiten.filter((s) => s.url === nurSeite) };
}

function baueDeckblatt(
  ergebnis: ScanErgebnis,
  optionen: BerichtsOptionen,
  erstelltAm: string,
  offeneKriterien: number,
  kriterienGesamt: number,
): Deckblatt {
  const startadresse = optionen.nurSeite ?? ergebnis.seiten[0]?.url ?? '(keine Adresse)';

  return {
    angebot: optionen.profil?.name ?? benenneAngebot(startadresse),
    startadresse,
    standard: ergebnis.standard,
    standardText: standardText(ergebnis.standard),
    gepruefteFassung: ergebnis.gestartetAm,
    erstelltAm,
    pruefendePerson: optionen.pruefendePerson ?? null,
    werkzeug: `Accessibility-Checker ${ergebnis.werkzeugVersion}`,
    entwurf: offeneKriterien > 0,
    offeneKriterien,
    kriterienGesamt,
  };
}

export function standardText(standard: Standard): string {
  return `WCAG ${standard}, Level AA`;
}

/** Aus der Adresse einen brauchbaren Namen machen, wenn kein Profil da ist. */
function benenneAngebot(adresse: string): string {
  try {
    const url = new URL(adresse);
    return url.protocol === 'file:' ? (url.pathname.split('/').pop() ?? adresse) : url.hostname;
  } catch {
    return adresse;
  }
}

function baueGeltungsbereich(ergebnis: ScanErgebnis, profil: Profil | null): Geltungsbereich {
  const viewports = (profil?.viewports ?? [{ breite: 1280, hoehe: 900 }]).map((v) => `${v.breite} × ${v.hoehe} Pixel`);

  const einschraenkungen: string[] = [
    'Geprüft wurde der Auslieferungszustand zum genannten Zeitpunkt. Spätere Änderungen sind nicht erfasst.',
    'Automatische Prüfungen belegen Verstöße; sie belegen nicht deren Abwesenheit.',
  ];

  if (!ergebnis.stufe2Aktiv) {
    einschraenkungen.push('Die Sprachmodell-Stufe war abgeschaltet. Die betroffenen Kriterien sind manuell zu prüfen.');
  }
  if (ergebnis.geschuetzt) {
    einschraenkungen.push('Teile der Prüfung fanden in einem angemeldeten Bereich statt.');
  }
  if (ergebnis.seiten.some((s) => s.zustand === 'fehler')) {
    einschraenkungen.push('Einzelne Seiten konnten nicht geladen werden und sind nicht bewertet.');
  }

  return {
    standardText: standardText(ergebnis.standard),
    betriebsart: ergebnis.betriebsart,
    betriebsartText: BETRIEBSART_TEXT[ergebnis.betriebsart],
    browser: 'Chromium, gesteuert über Playwright',
    viewports,
    einschraenkungen,
  };
}

/**
 * Stichprobe nach WCAG-EM (X-16).
 *
 * Der Zweckvermerk stammt aus dem Prüfprofil und wird über die Adresse
 * zugeordnet — nicht über die Reihenfolge: Bei einer Weiterleitung trägt das
 * Ergebnis die Zieladresse, und die Reihenfolge stimmt dann nicht mehr.
 */
function baueStichprobe(ergebnis: ScanErgebnis, profil: Profil | null, rangliste: SeitenRang[]): Stichprobe {
  const zwecke = new Map((profil?.seiten ?? []).map((s) => [s.url, s.zweck]));
  const raenge = new Map(rangliste.map((r) => [r.url, r]));

  const seiten: Stichprobenseite[] = ergebnis.seiten.map((seite) => ({
    url: seite.url,
    bezeichnung: seite.bezeichnung,
    titel: seite.titel,
    zweck: zwecke.get(seite.url) ?? null,
    zustand: seite.zustand,
    fehler: seite.fehler,
    verstoesse: raenge.get(seite.url)?.verstoesse ?? 0,
    offen: raenge.get(seite.url)?.offen ?? 0,
  }));

  return {
    seiten,
    begruendung: begruendeAuswahl(ergebnis.betriebsart, profil),
    gepruefteSeiten: seiten.filter((s) => s.zustand === 'fertig').length,
    gescheiterteSeiten: seiten.filter((s) => s.zustand === 'fehler').length,
  };
}

function begruendeAuswahl(betriebsart: Betriebsart, profil: Profil | null): string {
  switch (betriebsart) {
    case 'einzelseite':
      return (
        'Geprüft wurde eine einzelne Seite. Aussagen über das Angebot als Ganzes lassen sich daraus nicht ableiten — ' +
        'dafür braucht es eine Stichprobe nach WCAG-EM.'
      );
    case 'profil':
      return profil
        ? `Die Seiten stammen aus dem Prüfprofil „${profil.name}". Sie wurden bewusst ausgewählt, um die ` +
            'wesentlichen Seitentypen und Abläufe des Angebots abzudecken (WCAG-EM Schritt 3).'
        : 'Die Seiten wurden von Hand zusammengestellt und decken die wesentlichen Seitentypen des Angebots ab.';
    case 'gesamt':
      return (
        'Die Seiten stammen aus einem Crawl über die Domain innerhalb der eingestellten Grenzen. ' +
        'Eine vollständige Erfassung ist damit nicht zugesichert: Seiten hinter Formularen, Suchergebnisse und ' +
        'nicht verlinkte Bereiche bleiben unberücksichtigt.'
      );
  }
}

function zaehle(projektebene: readonly ProjektBewertung[]): Kennzahlen {
  return {
    erfuellt: projektebene.filter((p) => p.status === 'erfuellt').length,
    nichtErfuellt: projektebene.filter((p) => p.status === 'nicht_erfuellt').length,
    pruefungErforderlich: projektebene.filter((p) => p.status === 'pruefung_erforderlich').length,
    nichtAnwendbar: projektebene.filter((p) => p.status === 'nicht_anwendbar').length,
    gesamt: projektebene.length,
  };
}

function beschreibeGesamtbild(kennzahlen: Kennzahlen, seiten: number): string {
  const seitenText = seiten === 1 ? 'einer Seite' : `${seiten} Seiten`;

  if (kennzahlen.nichtErfuellt === 0 && kennzahlen.pruefungErforderlich === 0) {
    return (
      `Auf ${seitenText} wurde kein Verstoß belegt, und es ist kein Kriterium offen. ` +
      'Das ist das bestmögliche Ergebnis dieses Werkzeugs — es ersetzt keine zertifizierte Prüfung.'
    );
  }

  const teile: string[] = [`Geprüft wurden ${kennzahlen.gesamt} Erfolgskriterien auf ${seitenText}.`];

  if (kennzahlen.nichtErfuellt > 0) {
    teile.push(
      `${kennzahlen.nichtErfuellt} ${kennzahlen.nichtErfuellt === 1 ? 'Kriterium ist' : 'Kriterien sind'} ` +
        'belegt nicht erfüllt.',
    );
  } else {
    teile.push('Kein Kriterium ist belegt verletzt.');
  }

  if (kennzahlen.pruefungErforderlich > 0) {
    teile.push(
      `${kennzahlen.pruefungErforderlich} ${kennzahlen.pruefungErforderlich === 1 ? 'Kriterium ist' : 'Kriterien sind'} ` +
        'noch nicht abschließend bewertet und gelten nicht als erfüllt.',
    );
  }

  return teile.join(' ');
}

/**
 * Die drei wirksamsten Maßnahmen (PRD 6.6.1 Abschnitt 4).
 *
 * Maßgeblich ist die Verbreitung: Ein Mangel, der auf zwanzig Seiten gleich
 * auftritt, ist meist eine Zeile in einer Vorlage. Ihn zuerst zu nennen ist
 * der Unterschied zwischen einer Fehlerliste und einer Aufgabenliste.
 */
function waehleMassnahmen(muster: readonly Muster[], nachId: Map<string, Kriterium>): Massnahme[] {
  const massnahmen: Massnahme[] = [];

  for (const eintrag of muster) {
    const kriterium = nachId.get(eintrag.befund.kriterium);
    if (!kriterium) continue;
    if (massnahmen.some((m) => m.kriterium === kriterium.id)) continue;

    massnahmen.push({
      titel: eintrag.befund.beschreibung,
      kriterium: kriterium.id,
      kriteriumTitel: kriterium.titel,
      betroffeneSeiten: eintrag.seiten.length,
      baustein: eintrag.baustein,
      empfehlung: kriterium.empfehlung.text,
    });

    if (massnahmen.length === 3) break;
  }

  return massnahmen;
}

function baueKonformitaetszeile(
  zeile: ProjektBewertung,
  kriterium: Kriterium,
  ergebnis: ScanErgebnis,
): Konformitaetszeile {
  return {
    kriterium,
    status: zeile.status,
    acr: zeile.acr,
    acrText: ACR_TEXT[zeile.acr],
    anmerkung: baueAnmerkung(zeile, kriterium, ergebnis),
    betroffeneSeiten: zeile.betroffeneSeiten,
    anwendbareSeiten: zeile.anwendbareSeiten,
  };
}

/**
 * Schriftliche Anmerkung zu jedem Kriterium (X-12).
 *
 * VPAT 2.5 verlangt sie ausdrücklich auch bei „Unterstützt" — und das aus
 * gutem Grund: Ein Häkchen ohne Angabe, *wie* geprüft wurde, ist keine
 * Aussage, sondern eine Behauptung.
 */
export function baueAnmerkung(zeile: ProjektBewertung, kriterium: Kriterium, ergebnis: ScanErgebnis): string {
  const gepruefteSeiten = ergebnis.seiten.filter((s) => s.zustand === 'fertig');
  const seitenwort = (anzahl: number): string => (anzahl === 1 ? '1 geprüfte Seite' : `${anzahl} geprüfte Seiten`);

  const befunde = zaehleBefunde(gepruefteSeiten, kriterium.id);
  const stufen = stufenDesKriteriums(kriterium)
    .map((s) => STUFE_TEXT[s])
    .join(', ');

  switch (zeile.acr) {
    case 'unterstuetzt':
      return `Auf ${seitenwort(zeile.anwendbareSeiten)} geprüft, ohne Beanstandung. Prüfweg: ${stufen}.`;

    case 'teilweise_unterstuetzt':
      return (
        `Auf ${zeile.betroffeneSeiten.length} von ${zeile.anwendbareSeiten} anwendbaren Seiten nicht erfüllt, ` +
        `${befunde} ${befunde === 1 ? 'Beleg' : 'Belege'}. Die übrigen Seiten sind unauffällig. ` +
        'Die Belege stehen in Abschnitt 6.'
      );

    case 'unterstuetzt_nicht':
      return (
        `Auf allen ${zeile.anwendbareSeiten} anwendbaren Seiten nicht erfüllt, ` +
        `${befunde} ${befunde === 1 ? 'Beleg' : 'Belege'}. Die Belege stehen in Abschnitt 6.`
      );

    case 'nicht_anwendbar':
      return kriterium.anwendbarWenn
        ? `Auf keiner geprüften Seite anwendbar: Es kamen keine Inhalte vor, auf die das Kriterium zutrifft ` +
            `(geprüft über „${kriterium.anwendbarWenn}").`
        : 'Auf keiner geprüften Seite anwendbar.';

    case 'nicht_abschliessend_bewertet': {
      const offeneFragen = zaehleOffeneFragen(gepruefteSeiten, kriterium.id);
      const grund =
        offeneFragen > 0
          ? `${offeneFragen} ${offeneFragen === 1 ? 'Frage ist' : 'Fragen sind'} noch von Hand zu klären.`
          : 'Es liegt ein Hinweis vor, dass die Prüfung nicht abgeschlossen werden konnte.';

      return (
        `${grund} Prüfweg: ${stufen}. ` +
        'Das Kriterium gilt ausdrücklich nicht als erfüllt; solange es offen ist, ist dieser Bericht ein Entwurf.'
      );
    }
  }
}

function zaehleBefunde(seiten: readonly SeitenErgebnis[], kriterium: string): number {
  return seiten.reduce(
    (summe, seite) => summe + (seite.bewertungen.find((b) => b.kriterium === kriterium)?.befunde.length ?? 0),
    0,
  );
}

function zaehleOffeneFragen(seiten: readonly SeitenErgebnis[], kriterium: string): number {
  const kennungen = new Set<string>();
  for (const seite of seiten) {
    for (const frage of seite.bewertungen.find((b) => b.kriterium === kriterium)?.offeneFragen ?? []) {
      kennungen.add(frage.id);
    }
  }
  return kennungen.size;
}

export function stufenDesKriteriums(kriterium: Kriterium): Stufe[] {
  const stufen: Stufe[] = [];
  for (const pruefung of kriterium.pruefungen) {
    if (!stufen.includes(pruefung.typ)) stufen.push(pruefung.typ);
  }
  return stufen;
}

/**
 * Detailbefunde je nicht erfülltem Kriterium (PRD 6.6.1 Abschnitt 6).
 *
 * Belege stehen hier **verdichtet**: derselbe Mangel an derselben Stelle auf
 * zwanzig Seiten ist ein Eintrag mit zwanzig Adressen, nicht zwanzig Einträge.
 */
function baueDetailbefunde(
  projektebene: readonly ProjektBewertung[],
  nachId: Map<string, Kriterium>,
  muster: readonly Muster[],
): Detailbefund[] {
  const befunde: Detailbefund[] = [];

  for (const zeile of projektebene) {
    if (zeile.status !== 'nicht_erfuellt') continue;
    const kriterium = nachId.get(zeile.kriterium);
    if (!kriterium) continue;

    const belege: Belegstelle[] = muster
      .filter((m) => m.befund.kriterium === kriterium.id)
      .map((m) => ({
        beschreibung: m.befund.beschreibung,
        selektor: m.befund.selektor,
        htmlAusschnitt: m.befund.htmlAusschnitt,
        schwere: m.befund.schwere,
        seiten: m.seiten,
        baustein: m.baustein,
      }));

    befunde.push({ kriterium, acrText: ACR_TEXT[zeile.acr], belege, empfehlung: kriterium.empfehlung });
  }

  return befunde;
}

/**
 * Abdeckungsmatrix (X-15).
 *
 * Zwei Angaben je Kriterium, die sich unterscheiden dürfen: was der Katalog
 * vorsieht, und woher die Bewertung tatsächlich stammt. Weicht beides
 * voneinander ab, ist etwas ausgefallen — und genau das soll sichtbar sein.
 */
function baueMethodik(kriterien: readonly Kriterium[], ergebnis: ScanErgebnis): Methodikzeile[] {
  return kriterien.map((kriterium) => {
    const stufen = stufenDesKriteriums(kriterium);
    const herkunft = new Set<string>();

    for (const seite of ergebnis.seiten) {
      const bewertung = seite.bewertungen.find((b) => b.kriterium === kriterium.id);
      if (bewertung?.herkunft) herkunft.add(bewertung.herkunft);
    }

    return {
      kriterium: kriterium.id,
      titel: kriterium.titel,
      stufen,
      herkunft: [...herkunft],
      grenzen: stufen.map((s) => GRENZEN[s]),
    };
  });
}

/** Qualitätshinweise über alle Seiten, verdichtet (X-21). */
function sammleQualitaetshinweise(ergebnis: ScanErgebnis): { hinweis: Qualitaetshinweis; seiten: string[] }[] {
  const nachSchluessel = new Map<string, { hinweis: Qualitaetshinweis; seiten: string[] }>();

  for (const seite of ergebnis.seiten) {
    for (const hinweis of seite.qualitaetshinweise ?? []) {
      const schluessel = `${hinweis.regelId}|${hinweis.selektor ?? ''}|${hinweis.beschreibung}`;
      const vorhanden = nachSchluessel.get(schluessel);
      if (vorhanden) {
        if (!vorhanden.seiten.includes(seite.url)) vorhanden.seiten.push(seite.url);
      } else {
        nachSchluessel.set(schluessel, { hinweis, seiten: [seite.url] });
      }
    }
  }

  return [...nachSchluessel.values()].sort((a, b) => b.seiten.length - a.seiten.length);
}

/**
 * Vermerke, die im Bericht sichtbar stehen müssen.
 *
 * Sie sind kein Beiwerk: Jeder einzelne verhindert, dass der Bericht mehr
 * behauptet, als geprüft wurde.
 */
function baueVermerke(
  ergebnis: ScanErgebnis,
  offeneKriterien: readonly string[],
  kriterien: readonly Kriterium[],
): Vermerk[] {
  const vermerke: Vermerk[] = [];
  const kriterienGesamt = kriterien.length;

  // X-14 — der wichtigste Vermerk des ganzen Berichts.
  if (offeneKriterien.length > 0) {
    vermerke.push({
      art: 'entwurf',
      ueberschrift: `Entwurf — ${offeneKriterien.length} von ${kriterienGesamt} Kriterien nicht abschließend bewertet`,
      text:
        'Dieser Bericht behauptet keine Konformität. Solange Kriterien den Status „Prüfung erforderlich" tragen, ' +
        'ist die Bewertung unvollständig. Arbeiten Sie die geführte Prüfliste ab; danach lässt sich der Bericht ' +
        'ohne diesen Vermerk erzeugen.',
      kriterien: [...offeneKriterien],
    });
  }

  // X-17 — Belege aus geschützten Bereichen.
  if (ergebnis.geschuetzt) {
    vermerke.push({
      art: 'geschuetzt',
      ueberschrift: 'Enthält Belege aus einem geschützten Bereich',
      text:
        'Teile der Prüfung fanden in einer angemeldeten Sitzung statt. Die Belege geben die dort angezeigten ' +
        'Inhalte unverändert wieder und können personenbezogene Daten enthalten. Vor einer Weitergabe des ' +
        'Berichts ist das zu prüfen.',
    });
  }

  /*
    X-22 — abgeschaltete Sprachmodell-Stufe samt betroffener Kriterien (L-47).

    Aufgezaehlt werden die Kriterien, die der Katalog der Stufe 2 zuweist, und
    nicht etwa alle offenen: Nur bei diesen ist das Abschalten die Ursache.
  */
  if (!ergebnis.stufe2Aktiv) {
    const betroffen = kriterien.filter((k) => k.pruefungen.some((p) => p.typ === 'llm')).map((k) => k.id);

    vermerke.push({
      art: 'stufe2',
      ueberschrift: 'Die Sprachmodell-Stufe war abgeschaltet',
      text:
        'Die textbewertende Stufe lief nicht. Die betroffenen Kriterien sind dadurch nicht unbewertet geblieben — ' +
        'sie sind in die manuelle Prüfliste gewandert und dort von Hand zu klären.',
      kriterien: betroffen,
    });
  }

  const gescheitert = ergebnis.seiten.filter((s) => s.zustand === 'fehler');
  if (gescheitert.length > 0) {
    vermerke.push({
      art: 'seitenfehler',
      ueberschrift: `${gescheitert.length} ${gescheitert.length === 1 ? 'Seite' : 'Seiten'} konnten nicht geprüft werden`,
      text:
        'Diese Seiten sind in keiner Bewertung enthalten. Der Bericht sagt über sie nichts aus — weder Gutes ' +
        'noch Schlechtes.',
      kriterien: [],
    });
  }

  if (!ergebnis.beendetAm) {
    vermerke.push({
      art: 'abbruch',
      ueberschrift: 'Die Prüfung wurde nicht zu Ende geführt',
      text:
        'Der Lauf trägt keinen Endzeitpunkt. Berichtet wird, was bis zum Abbruch geprüft wurde; die übrigen ' +
        'Seiten fehlen.',
    });
  }

  if (ergebnis.seiten.some((s) => (s.qualitaetshinweise?.length ?? 0) > 0)) {
    vermerke.push({
      art: 'qualitaet',
      ueberschrift: 'Allgemeine Qualitätshinweise außerhalb der Bewertung',
      text:
        `Unter WCAG ${ergebnis.standard} gibt es für diese Mängel kein Erfolgskriterium mehr. Sie sind in ` +
        'Abschnitt 7 aufgeführt und haben keinen Einfluss auf die Konformitätstabelle.',
    });
  }

  return vermerke;
}
