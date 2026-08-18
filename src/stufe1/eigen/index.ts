/**
 * Engine „eigen" — Prüfungen, die keine fremde Bibliothek abdeckt.
 *
 * Hier steckt der Teil der Automatik, den es fertig nicht zu kaufen gibt:
 * Verhalten. Ob der Fokus sichtbar ist, ob man aus einem Menue wieder
 * herauskommt, ob bei 320 Pixeln etwas verlorengeht — das zeigt sich erst,
 * wenn man die Seite tatsaechlich bedient.
 *
 * Die Reihenfolge der Teilprüfungen ist nicht beliebig:
 *
 *   1. DOM      — liest nur, veraendert nichts
 *   2. Tastatur — bewegt den Fokus, laesst die Seite sonst in Ruhe
 *   3. Formular — loest eine Zustandsaenderung aus
 *   4. Darstellung — veraendert Viewport und Stile, nimmt beides zurueck
 *
 * Was zuerst kommt, arbeitet auf dem unberuehrten Zustand. Andersherum
 * pruefte man am Ende eine Seite, die das Werkzeug selbst umgebaut hat.
 */

import type { EngineErgebnis, EngineKontext, PruefEngine } from '../engine.js';
import { fuegeZusammen } from '../engine.js';
import { DOM_REGELN, pruefeDom } from './dom.js';
import { TASTATUR_REGELN, pruefeTastatur } from './tastatur.js';
import { DARSTELLUNG_REGELN, pruefeDarstellung } from './darstellung.js';
import { FORMULAR_REGELN, pruefeFormulare } from './formulare.js';
import { MEHRSEITIGE_REGELN } from './mehrseitig.js';

export const EIGEN_REGELN = [
  ...DOM_REGELN,
  ...TASTATUR_REGELN,
  ...DARSTELLUNG_REGELN,
  ...FORMULAR_REGELN,
  ...MEHRSEITIGE_REGELN,
] as const;

export const eigenEngine: PruefEngine = {
  name: 'eigen',

  regeln(): readonly string[] {
    return EIGEN_REGELN;
  },

  async ausfuehren(kontext: EngineKontext, gewuenschteRegeln: readonly string[]): Promise<EngineErgebnis> {
    const dom = await pruefeDom(kontext, gewuenschteRegeln);
    const tastatur = await pruefeTastatur(kontext, gewuenschteRegeln);
    const formulare = await pruefeFormulare(kontext, gewuenschteRegeln);
    const darstellung = await pruefeDarstellung(kontext, gewuenschteRegeln);

    return fuegeZusammen([
      { befunde: dom.befunde, hinweise: [], ausgefuehrteRegeln: dom.ausgefuehrteRegeln },
      tastatur,
      formulare,
      { befunde: darstellung.befunde, hinweise: [], ausgefuehrteRegeln: darstellung.ausgefuehrteRegeln },
    ]);
  },
};
