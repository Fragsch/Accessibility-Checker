/**
 * Zugriff auf die Schnittstelle des Servers (ARCHITEKTUR 6).
 *
 * Fehlermeldungen kommen vom Server auf Deutsch; hier wird nur noch ergaenzt,
 * was der Server nicht wissen kann — etwa dass er gar nicht antwortet.
 */

import type { Kriterium, ScanZustand, Standard } from './typen';

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

export async function starteScan(urls: string[], standard: Standard): Promise<number> {
  const antwort = await hole<{ scanId: number }>('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, standard }),
  });
  return antwort.scanId;
}

export async function ladeScan(scanId: number): Promise<ScanZustand> {
  return hole<ScanZustand>(`/api/scan/${scanId}`);
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

  const arten = ['seite-begonnen', 'seite-fertig', 'befund', 'fortschritt', 'fehler', 'fertig'];
  for (const art of arten) {
    quelle.addEventListener(art, (ereignis) => {
      const daten = JSON.parse((ereignis as MessageEvent<string>).data) as Record<string, unknown>;
      beiEreignis({ art, daten });
    });
  }

  return () => quelle.close();
}
