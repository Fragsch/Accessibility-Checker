/**
 * Statusableitung (ARCHITEKTUR 5.2), Verdichtung (5.3) und ACR-Abbildung (5.4).
 *
 * Die Reihenfolge in `leiteStatusAb` ist bindend. Ein automatischer Verstoss
 * schlaegt jedes andere Ergebnis.
 *
 * Der gefaehrlichste Zustand des Werkzeugs waere ein `erfuellt`, dem keine
 * Pruefung zugrunde liegt. Deshalb gilt hier durchgaengig: Wer nichts geprueft
 * hat, sagt `pruefung_erforderlich`.
 */

import type {
  AcrBewertung,
  BeantworteteFrage,
  Befund,
  Bewertung,
  Hinweis,
  Kriterium,
  OffeneFrage,
  ProjektBewertung,
  SeitenErgebnis,
  Status,
} from '../typen/index.js';

/**
 * Urteil der Stufe 2 zu einem Kriterium.
 *
 * Die Wortwahl stammt aus `prompts/stufe2.md` und ist dort verbindlich
 * festgelegt — sie im Code anders zu benennen hiesse, an zwei Stellen
 * dasselbe zu pflegen.
 */
export type LlmUrteil = 'ok' | 'problem' | 'unsicher';

export interface AbleitungEingabe {
  kriterium: Kriterium;
  anwendbar: boolean;
  /** Grund der Nichtanwendbarkeit, falls `anwendbar === false`. */
  grund?: string | null;
  befunde: readonly Befund[];
  hinweise: readonly Hinweis[];
  offeneFragen: readonly OffeneFrage[];
  /** Bereits vom Menschen beantwortete Fragen (M-02, M-03). */
  beantworteteFragen?: readonly BeantworteteFrage[];
  llmUrteile?: readonly LlmUrteil[];
  /**
   * Belegt, dass mindestens eine automatische Pruefung tatsaechlich gelaufen
   * ist. Ohne diesen Beleg gibt es kein `erfuellt`.
   */
  autoPruefungGelaufen: boolean;
  /** Woher das Ergebnis stammt, etwa `auto/axe`. */
  herkunft: string;
}

/**
 * Status eines Kriteriums auf genau einer Seite.
 *
 * 1. nicht anwendbar                                   → nicht_anwendbar
 * 2. mindestens ein automatischer Verstoss             → nicht_erfuellt
 * 3. eine manuelle Antwort "nicht erfuellt"            → nicht_erfuellt
 * 4. alle Fragen mit "nicht anwendbar" beantwortet     → nicht_anwendbar
 * 5. offene manuelle Frage, Hinweis, LLM "problem"
 *    oder "unsicher"                                   → pruefung_erforderlich
 * 6. sonst                                             → erfuellt
 *
 * Die Schritte 3 und 4 sind mit Phase 5 dazugekommen. Sie fuegen sich in die
 * bindende Reihenfolge aus ARCHITEKTUR 5.2 ein, ohne sie umzustossen: Ein
 * automatischer Verstoss schlaegt weiterhin alles. Ein Mensch kann einen
 * belegten Verstoss nicht wegantworten — er kann nur hinzufuegen, was die
 * Automatik nicht sieht.
 */
export function leiteStatusAb(eingabe: AbleitungEingabe): Status {
  if (!eingabe.anwendbar) return 'nicht_anwendbar';

  if (eingabe.befunde.length > 0) return 'nicht_erfuellt';

  const antworten = eingabe.beantworteteFragen ?? [];
  if (antworten.some((a) => a.antwort === 'nicht_erfuellt')) return 'nicht_erfuellt';

  // Gegenstandslos ist ein Kriterium erst, wenn *jede* Frage dazu so
  // beantwortet wurde — und keine mehr offen ist.
  if (
    antworten.length > 0 &&
    eingabe.offeneFragen.length === 0 &&
    antworten.every((a) => a.antwort === 'nicht_anwendbar')
  ) {
    return 'nicht_anwendbar';
  }

  if (eingabe.offeneFragen.length > 0) return 'pruefung_erforderlich';
  if (eingabe.hinweise.length > 0) return 'pruefung_erforderlich';

  const urteile = eingabe.llmUrteile ?? [];
  if (urteile.some((u) => u === 'problem' || u === 'unsicher')) return 'pruefung_erforderlich';

  // Kein Befund, keine offene Frage — aber auch keine gelaufene Pruefung.
  // Das ist kein bestandener Test, sondern ein ungeprueftes Kriterium.
  //
  // Eine menschliche Antwort zaehlt dabei als gelaufene Pruefung: Wer
  // hingesehen und "erfuellt" gesagt hat, hat geprueft.
  if (!eingabe.autoPruefungGelaufen && antworten.length === 0) return 'pruefung_erforderlich';

  return 'erfuellt';
}

/** Baut die vollstaendige Bewertung eines Kriteriums auf einer Seite. */
export function baueBewertung(eingabe: AbleitungEingabe): Bewertung {
  const status = leiteStatusAb(eingabe);

  const hinweise = [...eingabe.hinweise];
  if (status === 'nicht_anwendbar' && eingabe.grund) {
    hinweise.push({ kriterium: eingabe.kriterium.id, text: eingabe.grund, herkunft: 'anwendbarkeit' });
  }

  return {
    kriterium: eingabe.kriterium.id,
    status,
    herkunft: eingabe.herkunft,
    befunde: [...eingabe.befunde],
    hinweise,
    offeneFragen: [...eingabe.offeneFragen],
    ...(eingabe.beantworteteFragen?.length ? { beantworteteFragen: [...eingabe.beantworteteFragen] } : {}),
  };
}

/**
 * Verdichtung auf Projektebene (ARCHITEKTUR 5.3).
 *
 * nicht_anwendbar        wenn auf allen Seiten nicht anwendbar
 * nicht_erfuellt         wenn auf mindestens einer Seite nicht erfuellt
 * pruefung_erforderlich  wenn sonst mindestens eine Seite offen ist
 * erfuellt               sonst
 *
 * Seiten mit dem Zustand `fehler` liefern keine Bewertung und bleiben aussen
 * vor — der Bericht fuehrt sie gesondert auf.
 */
export function verdichte(seiten: readonly SeitenErgebnis[], kriterien: readonly Kriterium[]): ProjektBewertung[] {
  const ergebnis: ProjektBewertung[] = [];

  for (const kriterium of kriterien) {
    const bewertungen = seiten
      .filter((s) => s.zustand === 'fertig')
      .map((s) => ({ url: s.url, bewertung: s.bewertungen.find((b) => b.kriterium === kriterium.id) }))
      .filter((e): e is { url: string; bewertung: Bewertung } => e.bewertung !== undefined);

    if (bewertungen.length === 0) {
      ergebnis.push({
        kriterium: kriterium.id,
        status: 'pruefung_erforderlich',
        acr: 'nicht_abschliessend_bewertet',
        betroffeneSeiten: [],
        anwendbareSeiten: 0,
      });
      continue;
    }

    const anwendbare = bewertungen.filter((e) => e.bewertung.status !== 'nicht_anwendbar');
    const betroffene = bewertungen.filter((e) => e.bewertung.status === 'nicht_erfuellt').map((e) => e.url);

    let status: Status;
    if (anwendbare.length === 0) status = 'nicht_anwendbar';
    else if (betroffene.length > 0) status = 'nicht_erfuellt';
    else if (anwendbare.some((e) => e.bewertung.status === 'pruefung_erforderlich')) status = 'pruefung_erforderlich';
    else status = 'erfuellt';

    ergebnis.push({
      kriterium: kriterium.id,
      status,
      acr: aufAcr(status, betroffene.length, anwendbare.length),
      betroffeneSeiten: betroffene,
      anwendbareSeiten: anwendbare.length,
    });
  }

  return ergebnis;
}

/**
 * Abbildung auf die ACR-Bewertungssprache (ARCHITEKTUR 5.4).
 *
 * `pruefung_erforderlich` wird niemals auf `unterstuetzt` abgebildet (X-14).
 */
export function aufAcr(status: Status, betroffeneSeiten: number, anwendbareSeiten: number): AcrBewertung {
  switch (status) {
    case 'erfuellt':
      return 'unterstuetzt';
    case 'nicht_anwendbar':
      return 'nicht_anwendbar';
    case 'pruefung_erforderlich':
      return 'nicht_abschliessend_bewertet';
    case 'nicht_erfuellt':
      return betroffeneSeiten > 0 && betroffeneSeiten < anwendbareSeiten
        ? 'teilweise_unterstuetzt'
        : 'unterstuetzt_nicht';
  }
}

/**
 * Ist das Gesamtergebnis ein Entwurf? (Regel 4)
 * Solange ein Kriterium offen ist, darf kein Bericht Konformitaet behaupten.
 */
export function istEntwurf(projektebene: readonly ProjektBewertung[]): boolean {
  return projektebene.some((p) => p.status === 'pruefung_erforderlich');
}
