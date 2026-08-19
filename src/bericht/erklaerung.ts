/**
 * Entwurf der Erklärung zur Barrierefreiheit (X-06).
 *
 * Gemeint ist die Erklärung nach § 12b BGG beziehungsweise Artikel 7 der
 * Richtlinie (EU) 2016/2102, deren Mustertext der Durchführungsbeschluss
 * (EU) 2018/1523 vorgibt. Öffentliche Stellen müssen sie veröffentlichen; die
 * Gliederung ist dort festgelegt und wird hier eingehalten.
 *
 * **Es ist ein Entwurf, und das steht auch drin.** Das Werkzeug kennt weder
 * den Anbieter noch dessen Kontaktweg, weder den Stand der Umsetzungsplanung
 * noch die Frage, was eine unverhältnismäßige Belastung darstellt. Alles, was
 * es nicht wissen kann, steht als ausgefüllte Lücke in eckigen Klammern — und
 * nicht als plausibel klingende Erfindung.
 *
 * **Der wichtigste Satz betrifft die Vereinbarkeit.** Solange Kriterien offen
 * sind, kann die Erklärung keine vollständige Vereinbarkeit behaupten (X-14,
 * Regel 4). Das ist keine Vorsicht um ihrer selbst willen: Die Erklärung ist
 * eine rechtsverbindliche Aussage der veröffentlichenden Stelle. Ein Werkzeug,
 * das dafür ungeprüfte Kriterien als erfüllt einsetzt, richtet Schaden an.
 */

import type { Berichtsdaten } from './daten.js';
import { datum, dokumentRahmen, esc } from './html.js';

/** Die drei Stufen der Mustererklärung. */
export type Vereinbarkeit = 'vollstaendig' | 'teilweise' | 'nicht';

export const VEREINBARKEIT_TEXT: Record<Vereinbarkeit, string> = {
  vollstaendig: 'vollständig vereinbar',
  teilweise: 'teilweise vereinbar',
  nicht: 'nicht vereinbar',
};

/**
 * Ein Abschnitt der Mustererklärung.
 *
 * Alle Felder sind **reiner Text ohne Auszeichnung**. Das ist Absicht: In die
 * Sätze fliessen Namen und Adressen aus geprüften Seiten und Profilen ein.
 * Enthielte das Modell Markup, müsste an jeder Einfügestelle einzeln
 * entschieden werden, was maskiert wird und was nicht — und irgendwann würde
 * es jemand vergessen. So maskiert die Ausgabe pauschal alles.
 */
export interface Erklaerungsabschnitt {
  ueberschrift: string;
  /** Hervorgehobener Kernsatz, sofern der Abschnitt einen hat. */
  kernsatz?: string;
  absaetze: string[];
  punkte?: string[];
}

export interface Erklaerung {
  titel: string;
  vereinbarkeit: Vereinbarkeit;
  /** Der Entwurf ist unvollständig, solange Kriterien offen sind (X-14). */
  entwurf: boolean;
  /** Stellen, die eine Person ausfüllen muss — als Erinnerung an einer Stelle. */
  offeneAngaben: string[];
  abschnitte: Erklaerungsabschnitt[];
}

const PLATZHALTER = {
  stelle: '[Name der öffentlichen Stelle]',
  kontakt: '[Name, E-Mail-Adresse und Telefonnummer der Ansprechperson]',
  aufsicht: '[Zuständige Durchsetzungs- oder Schlichtungsstelle mit Anschrift]',
} as const;

/**
 * Leitet die Vereinbarkeit aus den Ergebnissen ab.
 *
 * Die Reihenfolge ist bindend und entspricht ARCHITEKTUR 5.2: Ein belegter
 * Verstoß schlägt alles. Ein offenes Kriterium verhindert „vollständig" —
 * niemals aber macht es aus einem Verstoß etwas Milderes.
 */
export function leiteVereinbarkeitAb(daten: Berichtsdaten): Vereinbarkeit {
  const k = daten.zusammenfassung.kennzahlen;

  // Kein einziges anwendbares Kriterium erfüllt: Das ist der seltene, aber
  // moegliche Fall der Stufe „nicht vereinbar".
  if (k.nichtErfuellt > 0 && k.erfuellt === 0) return 'nicht';
  if (k.nichtErfuellt > 0) return 'teilweise';
  if (k.pruefungErforderlich > 0) return 'teilweise';
  return 'vollstaendig';
}

export function baueErklaerung(daten: Berichtsdaten): Erklaerung {
  const vereinbarkeit = leiteVereinbarkeitAb(daten);
  const d = daten.deckblatt;
  const k = daten.zusammenfassung.kennzahlen;

  const nichtVereinbar = daten.konformitaet
    .filter((zeile) => zeile.status === 'nicht_erfuellt')
    .map((zeile) => `${zeile.kriterium.id} ${zeile.kriterium.titel} — ${zeile.acrText}. ${zeile.anmerkung}`);

  const offeneKriterien = daten.konformitaet
    .filter((zeile) => zeile.status === 'pruefung_erforderlich')
    .map((zeile) => `${zeile.kriterium.id} ${zeile.kriterium.titel}`);

  const abschnitte: Erklaerungsabschnitt[] = [
    {
      ueberschrift: 'Geltungsbereich',
      absaetze: [
        `${PLATZHALTER.stelle} ist bemüht, das Angebot „${d.angebot}" (${d.startadresse}) im Einklang mit ` +
          '§ 12b des Behindertengleichstellungsgesetzes des Bundes (BGG) barrierefrei zugänglich zu machen. ' +
          'Diese Erklärung zur Barrierefreiheit gilt für das genannte Angebot.',
      ],
    },
    {
      ueberschrift: 'Stand der Vereinbarkeit mit den Anforderungen',
      kernsatz:
        `Dieses Angebot ist mit ${d.standardText} beziehungsweise der Barrierefreie-Informationstechnik-Verordnung ` +
        `(BITV 2.0) ${VEREINBARKEIT_TEXT[vereinbarkeit]}.`,
      absaetze: [vereinbarkeitBegruendung(vereinbarkeit, k.nichtErfuellt, k.pruefungErforderlich, k.gesamt)],
    },
    {
      ueberschrift: 'Nicht barrierefreie Inhalte',
      absaetze:
        nichtVereinbar.length > 0
          ? ['Die nachstehend aufgeführten Inhalte sind aus folgenden Gründen nicht barrierefrei:']
          : ['Es wurde kein Verstoß belegt.'],
      ...(nichtVereinbar.length > 0 ? { punkte: nichtVereinbar } : {}),
    },
  ];

  if (offeneKriterien.length > 0) {
    abschnitte.push({
      ueberschrift: 'Noch nicht abschließend bewertete Anforderungen',
      kernsatz: 'Vor der Veröffentlichung ist die Bewertung zu vervollständigen.',
      absaetze: [
        `Zu ${offeneKriterien.length} von ${k.gesamt} Erfolgskriterien liegt noch kein abschließendes Urteil vor. ` +
          'Sie sind in dieser Erklärung weder als erfüllt noch als verletzt geführt. Eine Erklärung, die ' +
          'ungeprüfte Anforderungen unerwähnt lässt, ist unvollständig.',
      ],
      punkte: offeneKriterien,
    });
  }

  abschnitte.push(
    {
      ueberschrift: 'Unverhältnismäßige Belastung',
      absaetze: [
        '[Sofern für einzelne der oben genannten Inhalte eine unverhältnismäßige Belastung nach § 12a Absatz 6 BGG ' +
          'geltend gemacht wird: Hier die betroffenen Inhalte benennen und die Belastung begründen. Andernfalls ' +
          'diesen Abschnitt streichen.]',
      ],
    },
    {
      ueberschrift: 'Geplante Maßnahmen',
      absaetze: [
        '[Hier die geplanten Maßnahmen und den Zeitplan eintragen.] Die folgende Reihenfolge ergibt sich aus der ' +
          'Prüfung; sie ist ein Vorschlag, keine Festlegung:',
      ],
      punkte:
        daten.zusammenfassung.massnahmen.length > 0
          ? daten.zusammenfassung.massnahmen.map(
              (m) =>
                `${m.titel} (${m.kriterium} ${m.kriteriumTitel}, auf ${m.betroffeneSeiten} ` +
                `${m.betroffeneSeiten === 1 ? 'Seite' : 'Seiten'})`,
            )
          : ['Aus der Prüfung ergeben sich keine Maßnahmen.'],
    },
    {
      ueberschrift: 'Datum der Erstellung dieser Erklärung',
      absaetze: [
        `Diese Erklärung wurde am ${datum(d.erstelltAm)} erstellt. Grundlage ist eine Prüfung vom ` +
          `${datum(d.gepruefteFassung)}, durchgeführt mit ${d.werkzeug} — einer Selbstbewertung mit einem ` +
          'automatisierten Prüfwerkzeug und ergänzender manueller Prüfung. ' +
          '[Sofern eine Fremdbewertung stattgefunden hat: prüfende Stelle benennen.]',
      ],
    },
    {
      ueberschrift: 'Feedback und Kontaktangaben',
      absaetze: [
        'Sind Ihnen Mängel beim barrierefreien Zugang zu Inhalten dieses Angebots aufgefallen? Dann melden Sie ' +
          `sich gern bei uns: ${PLATZHALTER.kontakt}. Wir antworten Ihnen innerhalb eines Monats.`,
      ],
    },
    {
      ueberschrift: 'Durchsetzungsverfahren',
      absaetze: [
        'Falls Sie auf Ihre Rückmeldung keine zufriedenstellende Antwort erhalten, können Sie sich an die ' +
          `Schlichtungsstelle nach § 16 BGG wenden: ${PLATZHALTER.aufsicht}. Das Schlichtungsverfahren ist ` +
          'kostenlos; ein Rechtsbeistand ist nicht erforderlich.',
      ],
    },
  );

  return {
    titel: 'Erklärung zur Barrierefreiheit',
    vereinbarkeit,
    entwurf: d.entwurf,
    offeneAngaben: [
      PLATZHALTER.stelle,
      PLATZHALTER.kontakt,
      PLATZHALTER.aufsicht,
      'Unverhältnismäßige Belastung — geltend machen oder Abschnitt streichen',
      'Geplante Maßnahmen und Zeitplan',
    ],
    abschnitte,
  };
}

function vereinbarkeitBegruendung(
  vereinbarkeit: Vereinbarkeit,
  nichtErfuellt: number,
  offen: number,
  gesamt: number,
): string {
  switch (vereinbarkeit) {
    case 'vollstaendig':
      return (
        `Von ${gesamt} geprüften Erfolgskriterien wurde keines verletzt und keines blieb offen. ` +
        'Zu beachten bleibt: Eine automatisierte Prüfung belegt Verstöße, nicht deren Abwesenheit. ' +
        'Ein Test mit assistiven Technologien und mit Nutzerinnen und Nutzern ist damit nicht ersetzt.'
      );
    case 'teilweise':
      return (
        (nichtErfuellt > 0
          ? `${nichtErfuellt} von ${gesamt} Erfolgskriterien sind nicht erfüllt. `
          : `Alle geprüften Erfolgskriterien sind erfüllt, `) +
        (offen > 0
          ? `Zu ${offen} weiteren liegt noch kein abschließendes Urteil vor. `
          : '') +
        'Die Aufzählung im folgenden Abschnitt nennt die betroffenen Anforderungen.'
      );
    case 'nicht':
      return (
        `Keines der ${gesamt} geprüften Erfolgskriterien konnte bestätigt werden, während ${nichtErfuellt} ` +
        'verletzt sind. Das Angebot ist in seiner gegenwärtigen Form für Menschen mit Behinderungen weitgehend ' +
        'nicht nutzbar.'
      );
  }
}

/**
 * Die Erklärung als eigenständige HTML-Datei.
 *
 * Die Platzhalter sind auch gestalterisch hervorgehoben. Wer den Text
 * übernimmt, ohne sie zu ersetzen, veröffentlicht eine Erklärung mit Lücken —
 * das soll auffallen, bevor es passiert.
 */
export function erklaerungAlsHtml(erklaerung: Erklaerung, angebot: string): string {
  const koerper = [
    '<header class="deckblatt">',
    '<p class="art">Entwurf, zu prüfen und zu ergänzen</p>',
    `<h1>${esc(erklaerung.titel)}</h1>`,
    `<p>für das Angebot „${esc(angebot)}"</p>`,
    '<div class="vermerk vermerk--entwurf">',
    '<p class="vermerk-titel"><strong>Dies ist ein Entwurf, keine veröffentlichungsfähige Erklärung.</strong></p>',
    '<p>Die Erklärung zur Barrierefreiheit ist eine verbindliche Aussage der veröffentlichenden Stelle. ' +
      'Das Werkzeug kann nur beitragen, was es geprüft hat; alle übrigen Angaben sind in eckigen Klammern ' +
      'ausgewiesen und von einer verantwortlichen Person zu ergänzen.</p>',
    `<p class="bezug">Noch auszufüllen: ${erklaerung.offeneAngaben.length} Angaben.</p>`,
    '</div>',
    erklaerung.entwurf
      ? '<div class="vermerk vermerk--geschuetzt"><p class="vermerk-titel"><strong>Die zugrunde liegende ' +
        'Prüfung ist nicht abgeschlossen.</strong></p><p>Es sind Kriterien offen. Diese Erklärung darf erst ' +
        'veröffentlicht werden, wenn die Bewertung vollständig ist.</p></div>'
      : '',
    '</header>',
    '<main id="inhalt">',
    ...erklaerung.abschnitte.map(abschnitt),
    '</main>',
  ].join('\n');

  return dokumentRahmen(`${erklaerung.titel} — ${angebot}`, koerper);
}

function abschnitt(teil: Erklaerungsabschnitt): string {
  return [
    '<section>',
    `<h2>${esc(teil.ueberschrift)}</h2>`,
    teil.kernsatz ? `<p class="kernsatz"><strong>${hebeplatzhalter(teil.kernsatz)}</strong></p>` : '',
    ...teil.absaetze.map((text) => `<p>${hebeplatzhalter(text)}</p>`),
    teil.punkte && teil.punkte.length > 0
      ? `<ul>${teil.punkte.map((punkt) => `<li>${esc(punkt)}</li>`).join('')}</ul>`
      : '',
    '</section>',
  ].join('\n');
}

/**
 * Maskiert den Text und hebt danach die eckigen Klammern hervor.
 *
 * Die Reihenfolge ist wichtig: Erst maskieren, dann auszeichnen. Andersherum
 * würde das eingefügte `<mark>` gleich wieder maskiert.
 */
function hebeplatzhalter(text: string): string {
  return esc(text).replace(/\[([^\]]+)\]/g, '<mark class="luecke">[$1]</mark>');
}
