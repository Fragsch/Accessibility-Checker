/**
 * Ausgabe der Rohdaten im EARL-Vokabular des W3C (X-04).
 *
 * EARL — *Evaluation and Report Language* — ist das Austauschformat für
 * Prüfergebnisse zur Barrierefreiheit. Der Sinn dieses Ausgabewegs ist die
 * **maschinelle Weiterverarbeitung**: Der HTML-Bericht ist für Menschen, das
 * EARL-Dokument für Werkzeuge, die Ergebnisse zusammenführen, über die Zeit
 * vergleichen oder in eine Aufgabenverwaltung übernehmen.
 *
 * Ausgegeben wird JSON-LD mit **eingebettetem Kontext**. Ein Kontext, der beim
 * Lesen aus dem Netz nachgeladen werden müsste, machte die Datei von einem
 * fremden Server abhängig — dieselbe Überlegung wie beim eigenständigen HTML.
 *
 * **Kriterien werden über ihre Nummer bezeichnet, nicht über eine geratene
 * Adresse.** Die WCAG-Fundstellen tragen englische Textmarken, die dieses
 * Werkzeug nicht führt; sie zu erfinden hiesse, im Austauschformat auf gut
 * Glück zu verweisen (Regel 8). Nummer und Titel sind eindeutig genug.
 */

import type { ScanErgebnis, Status } from '../typen/index.js';
import type { Berichtsdaten } from './daten.js';
import { stufenDesKriteriums } from './daten.js';

/** Abbildung der vier Status auf die EARL-Ergebnisse. */
const AUSGANG: Record<Status, string> = {
  erfuellt: 'earl:passed',
  nicht_erfuellt: 'earl:failed',
  // `cantTell` ist die genaue Entsprechung: geprüft, aber nicht entschieden.
  // Ein `earl:untested` wäre falsch — es *wurde* geprüft (X-14).
  pruefung_erforderlich: 'earl:cantTell',
  nicht_anwendbar: 'earl:inapplicable',
};

const KONTEXT = {
  earl: 'http://www.w3.org/ns/earl#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  ptr: 'http://www.w3.org/2009/pointers#',
};

export interface EarlDokument {
  '@context': typeof KONTEXT;
  '@graph': unknown[];
}

export interface EarlOptionen {
  ergebnis: ScanErgebnis;
  daten: Berichtsdaten;
}

/**
 * Baut das EARL-Dokument.
 *
 * Es enthält zwei Sorten von Aussagen, die sich am Subjekt unterscheiden:
 * je Seite eine Aussage pro Kriterium — das sind die Rohdaten — und zusätzlich
 * die verdichtete Bewertung mit dem Angebot als Subjekt. Beides getrennt
 * auszuweisen ist wichtig: Eine Verdichtung ist ein abgeleitetes Urteil und
 * keine Beobachtung an einer Seite.
 */
export function alsEarl(optionen: EarlOptionen): EarlDokument {
  const { ergebnis, daten } = optionen;
  const kriterien = new Map(daten.konformitaet.map((z) => [z.kriterium.id, z.kriterium]));

  const werkzeug = {
    '@id': '_:werkzeug',
    '@type': ['earl:Assertor', 'earl:Software'],
    'foaf:name': daten.deckblatt.werkzeug,
    'dct:description': 'Lokales Prüfwerkzeug für digitale Barrierefreiheit nach WCAG, Level AA.',
  };

  const angebot = {
    '@id': '_:angebot',
    '@type': ['earl:TestSubject', 'dct:Collection'],
    'dct:title': daten.deckblatt.angebot,
    'dct:source': daten.deckblatt.startadresse,
    'dct:conformsTo': daten.deckblatt.standardText,
    'dct:date': daten.deckblatt.gepruefteFassung,
  };

  const graph: unknown[] = [werkzeug, angebot];

  for (const [nummer, seite] of ergebnis.seiten.entries()) {
    const seitenId = `_:seite${nummer}`;

    graph.push({
      '@id': seitenId,
      '@type': ['earl:TestSubject', 'foaf:Document'],
      'dct:source': seite.url,
      'dct:title': seite.titel ?? seite.bezeichnung ?? seite.url,
      'dct:isPartOf': { '@id': '_:angebot' },
    });

    if (seite.zustand !== 'fertig') continue;

    for (const bewertung of seite.bewertungen) {
      const kriterium = kriterien.get(bewertung.kriterium);
      if (!kriterium) continue;

      graph.push({
        '@type': 'earl:Assertion',
        'earl:assertedBy': { '@id': '_:werkzeug' },
        'earl:subject': { '@id': seitenId },
        'earl:test': pruefkriterium(bewertung.kriterium, kriterium.titel, kriterium.level),
        'earl:mode': modus(stufenDesKriteriums(kriterium)),
        'earl:result': {
          '@type': 'earl:TestResult',
          'earl:outcome': { '@id': AUSGANG[bewertung.status] },
          'dct:description': bewertung.herkunft,
          ...(bewertung.befunde.length > 0
            ? {
                'earl:pointer': bewertung.befunde.map((befund) => ({
                  '@type': 'ptr:CSSSelectorPointer',
                  'ptr:expression': befund.selektor ?? '',
                  'dct:description': befund.beschreibung,
                })),
              }
            : {}),
        },
      });
    }
  }

  for (const zeile of daten.konformitaet) {
    graph.push({
      '@type': 'earl:Assertion',
      'earl:assertedBy': { '@id': '_:werkzeug' },
      'earl:subject': { '@id': '_:angebot' },
      'earl:test': pruefkriterium(zeile.kriterium.id, zeile.kriterium.titel, zeile.kriterium.level),
      'earl:mode': modus(stufenDesKriteriums(zeile.kriterium)),
      'earl:result': {
        '@type': 'earl:TestResult',
        'earl:outcome': { '@id': AUSGANG[zeile.status] },
        // Die ACR-Bewertung ist feiner als das EARL-Ergebnis: `earl:failed`
        // unterscheidet nicht zwischen „teilweise" und „gar nicht". Deshalb
        // steht sie hier zusaetzlich im Klartext.
        'dct:description': `${zeile.acrText}. ${zeile.anmerkung}`,
      },
    });
  }

  return { '@context': KONTEXT, '@graph': graph };
}

function pruefkriterium(id: string, titel: string, level: string): Record<string, string> {
  return {
    '@type': 'earl:TestCriterion',
    'dct:identifier': `WCAG:${id}`,
    'dct:title': `${id} ${titel}`,
    'dct:hasVersion': level,
  };
}

/** Prüfweise nach EARL. Mehrere Stufen ergeben eine gemischte Prüfung. */
function modus(stufen: readonly string[]): { '@id': string } {
  if (stufen.includes('manuell')) return { '@id': stufen.length > 1 ? 'earl:semiAuto' : 'earl:manual' };
  if (stufen.includes('llm')) return { '@id': 'earl:semiAuto' };
  return { '@id': 'earl:automatic' };
}
