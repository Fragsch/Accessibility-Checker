/**
 * Zugriff auf die Schnittstelle des Servers (ARCHITEKTUR 6).
 *
 * Fehlermeldungen kommen vom Server auf Deutsch; hier wird nur noch ergaenzt,
 * was der Server nicht wissen kann — etwa dass er gar nicht antwortet.
 */

import type {
  Abdeckungsmatrix,
  Antwortwert,
  Auftrag,
  Berichtsdaten,
  Berichtsformat,
  Berichtsumfang,
  Crawlergebnis,
  Crawlvorgabe,
  Fragenliste,
  Kriterium,
  Profil,
  Projektansicht,
  ScanUebersicht,
  ScanZustand,
  Standard,
  Stufe2Zustand,
} from './typen';

export class ApiFehler extends Error {
  readonly status: number;

  constructor(nachricht: string, status: number) {
    super(nachricht);
    this.name = 'ApiFehler';
    this.status = status;
  }
}

async function hole<T>(pfad: string, optionen?: RequestInit): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetch(pfad, optionen);
  } catch {
    throw new ApiFehler('Der Server antwortet nicht. Läuft das Prüfwerkzeug noch?', 0);
  }

  if (!antwort.ok) {
    const koerper = (await antwort.json().catch(() => null)) as { fehler?: string; phase?: string } | null;
    const text = koerper?.fehler ?? `Der Server meldet Fehler ${antwort.status}.`;
    throw new ApiFehler(koerper?.phase ? `${text} (kommt mit Phase ${koerper.phase})` : text, antwort.status);
  }

  return (await antwort.json()) as T;
}

export async function ladeKatalog(standard: Standard): Promise<Kriterium[]> {
  const antwort = await hole<{ kriterien: Kriterium[] }>(`/api/katalog?standard=${standard}`);
  return antwort.kriterien;
}

/**
 * Gemessene Abdeckung je Kriterium (PRD 10).
 *
 * Liefert `null`, wenn nie gemessen wurde. Das ist kein Fehlerfall — die
 * Oberflaeche sagt dann, dass keine Messung vorliegt.
 */
export async function ladeAbdeckung(): Promise<{ matrix: Abdeckungsmatrix | null; hinweis?: string }> {
  return hole<{ matrix: Abdeckungsmatrix | null; hinweis?: string }>('/api/abdeckung');
}

/**
 * Startet einen Scan (K-01 bis K-09).
 *
 * Der Auftrag traegt seine Betriebsart bei sich: freie Adressen, ein
 * gespeichertes Profil oder ein Crawl. Beim Profil bestimmt der Server den
 * Pruefstandard aus dem Profil, damit Wiederholungslaeufe vergleichbar
 * bleiben (K-13).
 */
export async function starteScan(auftrag: Auftrag): Promise<number> {
  const antwort = await hole<{ scanId: number }>('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auftrag),
  });
  return antwort.scanId;
}

// ------------------------------------------------------------ Prüfprofile

export async function ladeProfile(): Promise<Profil[]> {
  const antwort = await hole<{ profile: Profil[] }>('/api/profile');
  return antwort.profile;
}

export interface ProfilEingabe {
  name: string;
  standard: Standard;
  seiten: { url: string; bezeichnung: string; zweck: string | null }[];
}

export async function legeProfilAn(eingabe: ProfilEingabe): Promise<Profil> {
  const antwort = await hole<{ profil: Profil }>('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eingabe),
  });
  return antwort.profil;
}

export async function aendereProfil(id: number, eingabe: ProfilEingabe): Promise<Profil> {
  const antwort = await hole<{ profil: Profil }>(`/api/profile/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eingabe),
  });
  return antwort.profil;
}

export async function loescheProfil(id: number): Promise<void> {
  await hole(`/api/profile/${id}`, { method: 'DELETE' });
}

/** Profil als JSON, versionierbar im Projekt (K-07). */
export async function holeProfilAustausch(id: number): Promise<unknown> {
  const antwort = await hole<{ austausch: unknown }>(`/api/profile/${id}`);
  return antwort.austausch;
}

export async function importiereProfil(austausch: unknown): Promise<Profil> {
  const antwort = await hole<{ profil: Profil }>('/api/profile/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(austausch),
  });
  return antwort.profil;
}

/** Kandidatenliste für ein Profil aus einem einmaligen Crawl (K-06). */
export async function schlageSeitenVor(vorgabe: Crawlvorgabe): Promise<Crawlergebnis> {
  return hole<Crawlergebnis>('/api/profile/vorschlag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vorgabe),
  });
}

// --------------------------------------------- Anmeldung und Scanverwaltung

/** Bestätigt, dass die Anmeldung steht und die Prüfung beginnen darf (S-02). */
export async function meldeAnmeldungFertig(scanId: number): Promise<void> {
  await hole(`/api/scan/${scanId}/anmeldung-fertig`, { method: 'POST' });
}

export async function ladeScans(): Promise<ScanUebersicht[]> {
  const antwort = await hole<{ scans: ScanUebersicht[] }>('/api/scans');
  return antwort.scans;
}

/** Löscht einen Scan samt aller Belege (S-24). */
export async function loescheScan(scanId: number): Promise<void> {
  await hole(`/api/scan/${scanId}`, { method: 'DELETE' });
}

/** Verdichtete Sicht über alle Seiten: Projektebene, Muster, Rangliste (E-20 bis E-26). */
export async function ladeProjekt(scanId: number): Promise<Projektansicht> {
  return hole<Projektansicht>(`/api/scan/${scanId}/projekt`);
}

/** Zustand der Sprachmodell-Stufe: Hardware, Ollama, Modellvorschlag (L-40, L-42). */
/**
 * Adresse eines Berichts (X-02 bis X-06).
 *
 * Bewusst eine Adresse und kein Abruf: Die Oberflaeche verweist darauf, statt
 * das Dokument selbst zu holen und weiterzureichen. So laedt der Browser die
 * Datei mit dem Namen herunter, den der Server im Kopf mitgibt, und das PDF
 * entsteht erst, wenn es jemand tatsaechlich anfordert — es dauert ein paar
 * Sekunden.
 */
export function berichtAdresse(
  scanId: number,
  format: Berichtsformat,
  umfang: Berichtsumfang = { art: 'projekt' },
  person?: string,
): string {
  const felder = new URLSearchParams({ format });
  if (umfang.art === 'seite') {
    felder.set('umfang', 'seite');
    felder.set('url', umfang.url);
  }
  if (person) felder.set('person', person);

  return `/api/scan/${scanId}/bericht?${felder.toString()}`;
}

/** Die Berichtsdaten als JSON — fuer die Vorschau in der Oberflaeche. */
export async function ladeBerichtsdaten(
  scanId: number,
  umfang: Berichtsumfang = { art: 'projekt' },
): Promise<Berichtsdaten> {
  return hole<Berichtsdaten>(berichtAdresse(scanId, 'daten', umfang));
}

export async function ladeStufe2Zustand(standard: Standard): Promise<Stufe2Zustand> {
  return hole<Stufe2Zustand>(`/api/system/ollama?standard=${standard}`);
}

export async function ladeScan(scanId: number): Promise<ScanZustand> {
  return hole<ScanZustand>(`/api/scan/${scanId}`);
}

/** Offene und beantwortete Fragen eines Scans (M-01, M-06, M-07). */
export async function ladeFragen(scanId: number): Promise<Fragenliste> {
  return hole<Fragenliste>(`/api/scan/${scanId}/fragen`);
}

export interface AntwortEingabe {
  url: string;
  kriterium: string;
  frageHash: string;
  antwort: Antwortwert;
  notiz: string | null;
}

/** Beantwortet eine Frage (M-02). Die Antwort bleibt gespeichert (M-03). */
export async function beantworteFrage(scanId: number, eingabe: AntwortEingabe): Promise<void> {
  await hole(`/api/scan/${scanId}/antwort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eingabe),
  });
}

export async function nimmAntwortZurueck(scanId: number, url: string, frageHash: string): Promise<void> {
  const abfrage = new URLSearchParams({ url, frageHash });
  await hole(`/api/scan/${scanId}/antwort?${abfrage.toString()}`, { method: 'DELETE' });
}

export async function brichScanAb(scanId: number): Promise<void> {
  await hole(`/api/scan/${scanId}/abbrechen`, { method: 'POST' });
}

export interface Ereignis {
  art: string;
  daten: Record<string, unknown>;
}

/**
 * Meldet sich am Ereignisstrom des Scans an (SSE).
 *
 * Wiederholte Abfragen im Takt waeren die einfachere Loesung, aber eine
 * schlechtere: ein Scan dauert Minuten, und Befunde sollen erscheinen, sobald
 * sie da sind (NF-10).
 */
export function hoereAufScan(scanId: number, beiEreignis: (ereignis: Ereignis) => void): () => void {
  const quelle = new EventSource(`/api/scan/${scanId}/ereignisse`);

  const arten = [
    'seite-begonnen',
    'seite-fertig',
    'befund',
    'fortschritt',
    'anmeldung-noetig',
    'sitzung-verloren',
    'fehler',
    'fertig',
  ];
  for (const art of arten) {
    quelle.addEventListener(art, (ereignis) => {
      const daten = JSON.parse((ereignis as MessageEvent<string>).data) as Record<string, unknown>;
      beiEreignis({ art, daten });
    });
  }

  return () => quelle.close();
}
