/**
 * Der Bericht als eigenständige HTML-Datei (X-02, X-10, X-18).
 *
 * **Eigenständig heißt eigenständig:** Kein Stylesheet, kein Skript, keine
 * Schriftart von außen. Die Datei muss nach Jahren auf einem Rechner ohne Netz
 * noch dasselbe zeigen — ein Bericht, dessen Aussehen von einem fremden Server
 * abhängt, ist als Nachweis wertlos.
 *
 * **Und barrierefrei:** Ein Bericht über Barrierefreiheit, den ein Teil seiner
 * Leser nicht lesen kann, widerlegt sich selbst. Deshalb: Überschriften in
 * lückenloser Ordnung, Tabellen mit `caption` und `scope`, keine Aussage
 * allein über Farbe, sichtbarer Fokus, Kontraste über 4,5:1.
 *
 * Abschnitt 6 ist in der HTML-Fassung aus der Tabelle heraus aufklappbar. Für
 * das PDF wird derselbe Baum mit `alleAufgeklappt` erzeugt: gedruckt gibt es
 * kein Aufklappen, und ein zugeklappter Abschnitt wäre im Druck verloren.
 */

import type {
  Belegstelle,
  Berichtsdaten,
  Detailbefund,
  Konformitaetszeile,
  Methodikzeile,
  Stichprobenseite,
  Vermerk,
} from './daten.js';
import type { AcrBewertung, Stufe } from '../typen/index.js';

export interface HtmlOptionen {
  /** Für die PDF-Fassung: Detailbefunde linear statt aufklappbar. */
  alleAufgeklappt?: boolean;
}

/** Erzeugt den vollständigen Bericht als HTML-Dokument. */
export function alsHtml(daten: Berichtsdaten, optionen: HtmlOptionen = {}): string {
  const offen = optionen.alleAufgeklappt === true;

  return dokumentRahmen(
    `Bericht zur Barrierefreiheit — ${daten.deckblatt.angebot}`,
    [
      deckblatt(daten),
      inhaltsverzeichnis(),
      '<main id="inhalt">',
      abschnittGeltungsbereich(daten),
      abschnittStichprobe(daten),
      abschnittZusammenfassung(daten),
      abschnittKonformitaet(daten, offen),
      abschnittDetailbefunde(daten, offen),
      abschnittMethodik(daten),
      '</main>',
      fusszeile(daten),
    ].join('\n'),
  );
}

/**
 * Gemeinsamer Rahmen aller erzeugten Dokumente.
 *
 * Auch der Entwurf der Erklärung zur Barrierefreiheit läuft hier durch: Ein
 * zweiter Stil für ein zweites Dokument wäre eine zweite Stelle, an der die
 * Barrierefreiheit der Ausgabe nachzuweisen ist.
 */
export function dokumentRahmen(titel: string, koerper: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="de">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(titel)}</title>`,
    `<style>${STIL}</style>`,
    '</head>',
    '<body>',
    '<a class="sprunglink" href="#inhalt">Zum Inhalt springen</a>',
    '<div class="blatt">',
    koerper,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}

// -------------------------------------------------------------- Abschnitte

function deckblatt(daten: Berichtsdaten): string {
  const d = daten.deckblatt;

  const zeilen: [string, string][] = [
    ['Geprüftes Angebot', d.angebot],
    ['Startadresse', d.startadresse],
    ['Zugrunde gelegter Standard', d.standardText],
    ['Geprüfte Fassung', datum(d.gepruefteFassung)],
    ['Bericht erstellt am', datum(d.erstelltAm)],
    ['Prüfende Person', d.pruefendePerson ?? 'nicht angegeben'],
    ['Werkzeug', d.werkzeug],
  ];

  return [
    '<header class="deckblatt">',
    '<p class="art">Bericht zur Barrierefreiheit nach WCAG-EM</p>',
    `<h1>${esc(d.angebot)}</h1>`,
    d.entwurf ? entwurfsband(d.offeneKriterien, d.kriterienGesamt) : '',
    '<dl class="angaben">',
    ...zeilen.map(([begriff, wert]) => `<dt>${esc(begriff)}</dt><dd>${esc(wert)}</dd>`),
    '</dl>',
    daten.vermerke.map(vermerkKasten).join('\n'),
    '</header>',
  ].join('\n');
}

/**
 * Der Entwurfsvermerk (X-14).
 *
 * Er steht auf dem Deckblatt und nicht im Kleingedruckten: Ein ACR ist eine
 * Aussage gegenüber Dritten. Wer den Bericht weiterreicht, muss auf den ersten
 * Blick sehen, dass er keine Konformität behauptet.
 */
function entwurfsband(offen: number, gesamt: number): string {
  return [
    '<p class="entwurf" role="note">',
    `<strong>Entwurf</strong> — ${offen} von ${gesamt} Kriterien sind nicht abschließend bewertet. `,
    'Dieser Bericht behauptet keine Konformität.',
    '</p>',
  ].join('');
}

function inhaltsverzeichnis(): string {
  const eintraege: [string, string][] = [
    ['#geltungsbereich', '2 — Geltungsbereich'],
    ['#stichprobe', '3 — Stichprobe'],
    ['#zusammenfassung', '4 — Zusammenfassung'],
    ['#konformitaet', '5 — Konformitätstabelle'],
    ['#detailbefunde', '6 — Detailbefunde'],
    ['#methodik', '7 — Methodik und Grenzen'],
  ];

  return [
    '<nav class="verzeichnis" aria-labelledby="verzeichnis-titel">',
    '<h2 id="verzeichnis-titel">Inhalt</h2>',
    '<ol>',
    ...eintraege.map(([ziel, text]) => `<li><a href="${ziel}">${esc(text)}</a></li>`),
    '</ol>',
    '</nav>',
  ].join('\n');
}

function abschnittGeltungsbereich(daten: Berichtsdaten): string {
  const g = daten.geltungsbereich;

  return [
    '<section id="geltungsbereich">',
    '<h2>2 — Geltungsbereich</h2>',
    '<dl class="angaben">',
    `<dt>Standard</dt><dd>${esc(g.standardText)}</dd>`,
    `<dt>Betriebsart</dt><dd>${esc(g.betriebsartText)}</dd>`,
    `<dt>Browser</dt><dd>${esc(g.browser)}</dd>`,
    `<dt>Fenstergrößen</dt><dd>${g.viewports.map(esc).join(', ')}</dd>`,
    '</dl>',
    '<h3>Einschränkungen</h3>',
    liste(g.einschraenkungen),
    '</section>',
  ].join('\n');
}

function abschnittStichprobe(daten: Berichtsdaten): string {
  const s = daten.stichprobe;

  return [
    '<section id="stichprobe">',
    '<h2>3 — Stichprobe</h2>',
    `<p>${esc(s.begruendung)}</p>`,
    `<p>Geprüft: ${s.gepruefteSeiten} ${s.gepruefteSeiten === 1 ? 'Seite' : 'Seiten'}` +
      (s.gescheiterteSeiten > 0 ? `, nicht ladbar: ${s.gescheiterteSeiten}` : '') +
      '.</p>',
    '<div class="tabellenrahmen" tabindex="0" role="region" aria-label="Geprüfte Seiten">',
    '<table>',
    '<caption>Geprüfte Seiten mit Bezeichnung und Zweck</caption>',
    '<thead><tr>',
    '<th scope="col">Bezeichnung</th>',
    '<th scope="col">Adresse</th>',
    '<th scope="col">Zweck</th>',
    '<th scope="col">Verstöße</th>',
    '<th scope="col">Offen</th>',
    '</tr></thead>',
    '<tbody>',
    ...s.seiten.map(stichprobenzeile),
    '</tbody>',
    '</table>',
    '</div>',
    '</section>',
  ].join('\n');
}

function stichprobenzeile(seite: Stichprobenseite): string {
  if (seite.zustand !== 'fertig') {
    return [
      '<tr>',
      `<th scope="row">${esc(seite.bezeichnung ?? seite.titel ?? '—')}</th>`,
      `<td class="adresse">${esc(seite.url)}</td>`,
      `<td colspan="3">Nicht geprüft${seite.fehler ? `: ${esc(seite.fehler)}` : '.'}</td>`,
      '</tr>',
    ].join('');
  }

  return [
    '<tr>',
    `<th scope="row">${esc(seite.bezeichnung ?? seite.titel ?? '—')}</th>`,
    `<td class="adresse">${esc(seite.url)}</td>`,
    `<td>${esc(seite.zweck ?? '—')}</td>`,
    `<td class="zahl">${seite.verstoesse}</td>`,
    `<td class="zahl">${seite.offen}</td>`,
    '</tr>',
  ].join('');
}

function abschnittZusammenfassung(daten: Berichtsdaten): string {
  const z = daten.zusammenfassung;
  const k = z.kennzahlen;

  const kennzahlen: [string, number, AcrBewertung][] = [
    ['Unterstützt', k.erfuellt, 'unterstuetzt'],
    ['Nicht unterstützt', k.nichtErfuellt, 'unterstuetzt_nicht'],
    ['Nicht abschließend bewertet', k.pruefungErforderlich, 'nicht_abschliessend_bewertet'],
    ['Nicht anwendbar', k.nichtAnwendbar, 'nicht_anwendbar'],
  ];

  const massnahmen =
    z.massnahmen.length > 0
      ? [
          '<h3>Die wirksamsten Maßnahmen</h3>',
          '<p>Nach Verbreitung geordnet: Was auf vielen Seiten gleich auftritt, ist meist an einer Stelle zu beheben.</p>',
          '<ol class="massnahmen">',
          ...z.massnahmen.map(
            (m) =>
              '<li>' +
              `<p class="mangel">${esc(m.titel)}</p>` +
              `<p class="bezug">${esc(m.kriterium)} ${esc(m.kriteriumTitel)} — auf ${m.betroffeneSeiten} ` +
              `${m.betroffeneSeiten === 1 ? 'Seite' : 'Seiten'}` +
              (m.baustein ? `, vermutlich im Bereich „${esc(m.baustein)}"` : '') +
              '</p>' +
              `<p>${esc(m.empfehlung)}</p>` +
              '</li>',
          ),
          '</ol>',
        ].join('\n')
      : '<p>Es liegen keine belegten Verstöße vor, aus denen sich Maßnahmen ableiten ließen.</p>';

  return [
    '<section id="zusammenfassung">',
    '<h2>4 — Zusammenfassung</h2>',
    `<p>${esc(z.gesamtbild)}</p>`,
    '<div class="tabellenrahmen" tabindex="0" role="region" aria-label="Kennzahlen">',
    '<table>',
    '<caption>Erfolgskriterien nach Bewertung</caption>',
    '<thead><tr><th scope="col">Bewertung</th><th scope="col">Anzahl</th></tr></thead>',
    '<tbody>',
    ...kennzahlen.map(
      ([text, anzahl, art]) =>
        `<tr><th scope="row"><span class="marke marke--${art}">${esc(text)}</span></th>` +
        `<td class="zahl">${anzahl}</td></tr>`,
    ),
    `<tr class="summe"><th scope="row">Gesamt</th><td class="zahl">${k.gesamt}</td></tr>`,
    '</tbody>',
    '</table>',
    '</div>',
    massnahmen,
    ranglisteTabelle(daten),
    '</section>',
  ].join('\n');
}

function ranglisteTabelle(daten: Berichtsdaten): string {
  const rangliste = daten.zusammenfassung.rangliste.filter((r) => r.verstoesse > 0 || r.offen > 0);
  if (rangliste.length < 2) return '';

  return [
    '<h3>Seiten nach Fehlerlast</h3>',
    '<p>Gewichtet nach Schwere — zehn geringe Mängel sind nicht dasselbe wie zwei kritische.</p>',
    '<div class="tabellenrahmen" tabindex="0" role="region" aria-label="Seiten nach Fehlerlast">',
    '<table>',
    '<caption>Reihenfolge für die Abarbeitung</caption>',
    '<thead><tr>',
    '<th scope="col">Seite</th><th scope="col">Verstöße</th><th scope="col">Gewicht</th><th scope="col">Offen</th>',
    '</tr></thead>',
    '<tbody>',
    ...rangliste.map(
      (r) =>
        `<tr><th scope="row" class="adresse">${esc(r.bezeichnung ?? r.url)}</th>` +
        `<td class="zahl">${r.verstoesse}</td><td class="zahl">${r.gewicht}</td><td class="zahl">${r.offen}</td></tr>`,
    ),
    '</tbody>',
    '</table>',
    '</div>',
  ].join('\n');
}

/**
 * Abschnitt 5 — der übersichtliche Teil: eine Zeile je Kriterium.
 *
 * Die Detailbefunde hängen als aufklappbarer Block an der Zeile. Damit sind
 * beide Bedürfnisse ohne Kompromiss bedient: der Überblick bleibt kurz, die
 * Belege sind trotzdem einen Griff entfernt.
 */
function abschnittKonformitaet(daten: Berichtsdaten, alleAufgeklappt: boolean): string {
  const belegeNachKriterium = new Map(daten.detailbefunde.map((d) => [d.kriterium.id, d]));

  return [
    '<section id="konformitaet">',
    '<h2>5 — Konformitätstabelle</h2>',
    `<p>Alle ${daten.konformitaet.length} Erfolgskriterien nach ${esc(daten.geltungsbereich.standardText)}. ` +
      'Die Bewertungssprache stammt aus dem ACR-Vokabular (VPAT 2.5).</p>',
    '<div class="tabellenrahmen" tabindex="0" role="region" aria-label="Konformitätstabelle">',
    '<table class="konformitaet">',
    '<caption>Bewertung je Erfolgskriterium mit Anmerkung</caption>',
    '<thead><tr>',
    '<th scope="col">Kriterium</th>',
    '<th scope="col">Stufe</th>',
    '<th scope="col">Bewertung</th>',
    '<th scope="col">Anmerkung</th>',
    '</tr></thead>',
    '<tbody>',
    ...daten.konformitaet.map((zeile) =>
      konformitaetszeile(zeile, belegeNachKriterium.get(zeile.kriterium.id), alleAufgeklappt),
    ),
    '</tbody>',
    '</table>',
    '</div>',
    '</section>',
  ].join('\n');
}

function konformitaetszeile(
  zeile: Konformitaetszeile,
  detail: Detailbefund | undefined,
  alleAufgeklappt: boolean,
): string {
  /*
    Aufklappbar, aber knapp: Was hier steht, ist die Kurzfassung — welche
    Maengel und wie verbreitet. Die vollstaendigen Belege samt Empfehlung
    stehen einmal in Abschnitt 6, nicht zweimal im selben Dokument. Ein
    Bericht, der jeden Befund doppelt fuehrt, ist doppelt so lang und keinen
    Deut aussagekraeftiger.

    Im aufgeklappten Bereich steht **nichts Fokussierbares**. Chromium meldet
    fuer Elemente in einem geschlossenen `details` weiterhin Masse; ein Verweis
    darin saehe fuer jede Pruefung — auch fuer die eigene — wie ein Sprung in
    der Lesereihenfolge aus (1.3.2). Der Verweis steht deshalb daneben, nicht
    darin. Die eigene Selbstpruefung hat das an diesem Bericht gefunden.
  */
  const belege =
    detail && detail.belege.length > 0
      ? `<details class="belege"${alleAufgeklappt ? ' open' : ''}>` +
        `<summary>${detail.belege.length} ${detail.belege.length === 1 ? 'Beleg' : 'Belege'}</summary>` +
        '<ul class="belege-kurz">' +
        detail.belege
          .map(
            (beleg) =>
              `<li>${esc(beleg.beschreibung)} <span class="bezug">(${beleg.seiten.length} ` +
              `${beleg.seiten.length === 1 ? 'Seite' : 'Seiten'})</span></li>`,
          )
          .join('') +
        '</ul>' +
        '</details>' +
        `<p><a href="#${ankerFuer(zeile.kriterium.id)}">Belege und Empfehlung zu ${esc(zeile.kriterium.id)}</a></p>`
      : '';

  return [
    '<tr>',
    `<th scope="row"><span class="kennung">${esc(zeile.kriterium.id)}</span> ${esc(zeile.kriterium.titel)}</th>`,
    `<td>${esc(zeile.kriterium.level)}</td>`,
    `<td><span class="marke marke--${zeile.acr}">${esc(zeile.acrText)}</span></td>`,
    `<td><p>${esc(zeile.anmerkung)}</p>${belege}</td>`,
    '</tr>',
  ].join('');
}

function abschnittDetailbefunde(daten: Berichtsdaten, alleAufgeklappt: boolean): string {
  if (daten.detailbefunde.length === 0) {
    return [
      '<section id="detailbefunde">',
      '<h2>6 — Detailbefunde</h2>',
      '<p>Es ist kein Verstoß belegt. Das bedeutet nicht, dass keiner vorliegt — es bedeutet, dass die ' +
        'durchgeführten Prüfungen keinen gefunden haben.</p>',
      '</section>',
    ].join('\n');
  }

  return [
    '<section id="detailbefunde">',
    '<h2>6 — Detailbefunde</h2>',
    '<p>Je nicht erfülltem Kriterium: die Belege und die Handlungsempfehlung. Gleichartige Belege sind über ' +
      'alle Seiten zusammengefasst.</p>',
    ...daten.detailbefunde.map((befund) => detailbefund(befund, alleAufgeklappt)),
    '</section>',
  ].join('\n');
}

function detailbefund(befund: Detailbefund, alleAufgeklappt: boolean): string {
  const beispiel = befund.empfehlung.codeBeispiel;

  return [
    `<article class="befund" id="${ankerFuer(befund.kriterium.id)}">`,
    `<h3><span class="kennung">${esc(befund.kriterium.id)}</span> ${esc(befund.kriterium.titel)}</h3>`,
    `<p class="bewertung"><span class="marke marke--unterstuetzt_nicht">${esc(befund.acrText)}</span></p>`,
    `<p>${esc(befund.kriterium.beschreibung)}</p>`,
    '<h4>Belege</h4>',
    ...befund.belege.map(belegstelle),
    '<h4>Empfehlung</h4>',
    `<p>${esc(befund.empfehlung.text)}</p>`,
    /*
      Offen und nicht aufklappbar.

      Aufgeklappt waere es huebscher, aber die Bloecke sind fokussierbar (2.1.1)
      — und Chromium meldet fuer fokussierbare Elemente in einem geschlossenen
      `details` weiterhin Masse. Fuer jede Pruefung sieht das aus, als spraenge
      die Lesereihenfolge. Zwei kurze Codebeispiele sind dieses Risiko nicht
      wert.
    */
    beispiel
      ? [
          '<h4>Vorher und nachher</h4>',
          '<p class="beispiel-titel">Vorher</p>',
          quelltext(beispiel.vorher),
          '<p class="beispiel-titel">Nachher</p>',
          quelltext(beispiel.nachher),
        ].join('\n')
      : '',
    befund.empfehlung.referenzen.length > 0
      ? '<h4>Weiterführend</h4>' +
        '<ul>' +
        befund.empfehlung.referenzen
          .map((r) => `<li><a href="${esc(r.url)}">${esc(r.titel)}</a></li>`)
          .join('') +
        '</ul>'
      : '',
    '</article>',
  ].join('\n');
}

function belegstelle(beleg: Belegstelle): string {
  return [
    '<div class="beleg">',
    `<p class="mangel">${esc(beleg.beschreibung)}</p>`,
    '<dl class="beleg-angaben">',
    `<dt>Schwere</dt><dd>${esc(beleg.schwere)}</dd>`,
    beleg.selektor ? `<dt>Stelle</dt><dd><code>${esc(beleg.selektor)}</code></dd>` : '',
    beleg.baustein ? `<dt>Bereich</dt><dd>${esc(beleg.baustein)}</dd>` : '',
    `<dt>Betroffene Seiten</dt><dd>${beleg.seiten.length}</dd>`,
    '</dl>',
    beleg.htmlAusschnitt ? quelltext(kuerze(beleg.htmlAusschnitt, 400)) : '',
    beleg.seiten.length > 1
      ? `<details><summary>Alle ${beleg.seiten.length} Adressen</summary>` +
        `<ul class="adressen">${beleg.seiten.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>`
      : `<p class="adresse">${esc(beleg.seiten[0] ?? '')}</p>`,
    '</div>',
  ].join('\n');
}

/**
 * Abschnitt 7 — Methodik, Abdeckung und Grenzen (X-15).
 *
 * Hier stehen auch die Qualitätshinweise (X-21): Mängel, für die es im
 * gewählten Standard kein Erfolgskriterium mehr gibt. Sie stehen ausdrücklich
 * **außerhalb** der Konformitätstabelle und ohne Einfluss auf die Bewertung.
 */
function abschnittMethodik(daten: Berichtsdaten): string {
  return [
    '<section id="methodik">',
    '<h2>7 — Methodik und Grenzen</h2>',
    '<p>Geprüft wird in drei Stufen: automatisch über Prüf-Engines, textbewertend über ein lokal laufendes ' +
      'Sprachmodell, und über gezielte Fragen an die prüfende Person. Die Tabelle nennt je Kriterium, welche ' +
      'Stufen der Prüfkatalog vorsieht, woher die Bewertung tatsächlich stammt und wie belastbar das Werkzeug ' +
      'bei diesem Kriterium gemessen wurde.</p>',
    abdeckungsherkunft(daten),
    '<div class="tabellenrahmen" tabindex="0" role="region" aria-label="Abdeckungsmatrix">',
    '<table>',
    '<caption>Abdeckungsmatrix</caption>',
    '<thead><tr>',
    '<th scope="col">Kriterium</th><th scope="col">Vorgesehene Stufen</th><th scope="col">Herkunft der Bewertung</th>' +
      '<th scope="col">Gemessene Abdeckung</th>',
    '</tr></thead>',
    '<tbody>',
    ...daten.methodik.map(methodikzeile),
    '</tbody>',
    '</table>',
    '</div>',
    qualitaetsabschnitt(daten),
    '<h3>Was dieser Bericht nicht leistet</h3>',
    liste([
      'Automatische Prüfungen belegen Verstöße, nicht deren Abwesenheit.',
      'Ein Urteil des Sprachmodells ist nie ein Verstoß, sondern immer ein Anlass zur Nachprüfung.',
      'Der Bericht ersetzt keine zertifizierte Prüfung und keinen Test mit assistiven Technologien.',
      'Kurze fremdsprachige Einschübe erkennt keine statistische Spracherkennung verlässlich.',
    ]),
    '</section>',
  ].join('\n');
}

function methodikzeile(zeile: Methodikzeile): string {
  return [
    '<tr>',
    `<th scope="row"><span class="kennung">${esc(zeile.kriterium)}</span> ${esc(zeile.titel)}</th>`,
    `<td>${zeile.stufen.map((s) => esc(STUFE_KURZ[s])).join(', ')}</td>`,
    `<td>${zeile.herkunft.length > 0 ? esc(zeile.herkunft.join('; ')) : 'nicht bewertet'}</td>`,
    `<td>${abdeckungszelle(zeile)}</td>`,
    '</tr>',
  ].join('');
}

/**
 * Die gemessene Abdeckung eines Kriteriums.
 *
 * Ausgeschrieben statt als Symbol: Ein Zeichen ohne Text wäre für die
 * Sprachausgabe nichts wert, und ausgerechnet in einem Bericht über
 * Barrierefreiheit ist das keine Kleinigkeit.
 */
function abdeckungszelle(zeile: Methodikzeile): string {
  const gemessen = zeile.abdeckung;
  if (!gemessen) return 'nicht gemessen';

  const zahlen =
    gemessen.testfaelle > 0
      ? ` <span class="kennung">${gemessen.belegtErkannt} von ${gemessen.testfaelle} Testfällen belegt</span>`
      : '';

  return `${esc(gemessen.einstufungText)}${zahlen}`;
}

/** Woher die Abdeckungszahlen stammen. Fehlt die Messung, wird das gesagt. */
function abdeckungsherkunft(daten: Berichtsdaten): string {
  const herkunft = daten.abdeckungsherkunft;

  if (!herkunft) {
    return (
      '<p class="vermerk">Zu diesem Werkzeugstand liegt <strong>keine Messung der Abdeckung</strong> vor. ' +
      'Die Spalte „Gemessene Abdeckung" bleibt daher leer — nicht, weil das Werkzeug nichts fände, sondern ' +
      'weil nicht überprüft wurde, was es findet.</p>'
    );
  }

  return (
    `<p>Die Spalte „Gemessene Abdeckung" stammt aus einem Lauf gegen ${herkunft.referenzseiten} Referenzseiten ` +
    `mit bekannter Fehlerlage, gemessen am ${datum(herkunft.gemessenAm)} mit ${esc(herkunft.werkzeug)} unter ` +
    `WCAG ${esc(herkunft.standard)}. Für ${herkunft.kriterienMitTestfall} der ${herkunft.kriterienGesamt} ` +
    `Kriterien gab es dabei mindestens einen Testfall; ${Math.round(herkunft.erkennungsquote * 100)} Prozent ` +
    `der eingebauten Verstöße wurden belegt erkannt, ${herkunft.uebersehen} übersehen und ` +
    `${herkunft.fehlalarme} Befunde ohne Sollwert gemeldet.</p>`
  );
}

/** Kurzform der Prüfstufen — die Matrix in Abschnitt 7 hat wenig Platz. */
const STUFE_KURZ: Record<Stufe, string> = {
  auto: 'automatisch',
  llm: 'Sprachmodell',
  manuell: 'manuell',
};

function qualitaetsabschnitt(daten: Berichtsdaten): string {
  if (daten.qualitaetshinweise.length === 0) return '';

  return [
    '<h3>Allgemeine Qualitätshinweise</h3>',
    `<p>Mängel der HTML-Gültigkeit, für die es unter ${esc(daten.geltungsbereich.standardText)} kein ` +
      'Erfolgskriterium mehr gibt. Sie stehen außerhalb der Konformitätstabelle und haben <strong>keinen ' +
      'Einfluss</strong> auf die Bewertung.</p>',
    '<ul class="qualitaet">',
    ...daten.qualitaetshinweise.map(
      (eintrag) =>
        `<li><p>${esc(eintrag.hinweis.beschreibung)}</p>` +
        `<p class="bezug">Regel <code>${esc(eintrag.hinweis.regelId)}</code>` +
        (eintrag.hinweis.selektor ? `, Stelle <code>${esc(eintrag.hinweis.selektor)}</code>` : '') +
        `, auf ${eintrag.seiten.length} ${eintrag.seiten.length === 1 ? 'Seite' : 'Seiten'}</p></li>`,
    ),
    '</ul>',
  ].join('\n');
}

function vermerkKasten(vermerk: Vermerk): string {
  const kriterien =
    vermerk.kriterien && vermerk.kriterien.length > 0
      ? `<p class="bezug">Betroffen: ${esc(vermerk.kriterien.join(', '))}</p>`
      : '';

  return [
    `<div class="vermerk vermerk--${vermerk.art}">`,
    `<p class="vermerk-titel"><strong>${esc(vermerk.ueberschrift)}</strong></p>`,
    `<p>${esc(vermerk.text)}</p>`,
    kriterien,
    '</div>',
  ].join('\n');
}

function fusszeile(daten: Berichtsdaten): string {
  return [
    '<footer class="fusszeile">',
    `<p>Erstellt mit ${esc(daten.deckblatt.werkzeug)} am ${esc(datum(daten.deckblatt.erstelltAm))}. ` +
      'Die Prüfung lief vollständig auf dem Rechner der prüfenden Person; geprüfte Inhalte wurden nicht ' +
      'übertragen.</p>',
    '</footer>',
  ].join('\n');
}

// ------------------------------------------------------------- Werkzeuge

/**
 * Ein Quelltextblock.
 *
 * `tabindex="0"` ist kein Beiwerk: Der Block scrollt waagerecht, und was mit
 * dem Zeiger scrollbar ist, muss mit der Tastatur erreichbar sein (2.1.1).
 * Ohne den Griff kommt niemand an den rechten Teil einer langen Zeile.
 *
 * Ein `role="region"` waere hier falsch, obwohl es naheliegt: Der Bericht
 * enthaelt Dutzende Quelltextbloecke, und jeder einzelne erschiene dann als
 * eigene Landmarke in der Uebersicht der Sprachausgabe — mit gleichlautendem
 * Namen. Die eigene Pruefung hat genau das beanstandet (2.4.1).
 */
function quelltext(inhalt: string): string {
  return `<pre tabindex="0"><code>${esc(inhalt)}</code></pre>`;
}

/** Sprungziel eines Kriteriums — Punkte sind in einer Kennung nicht zulässig. */
function ankerFuer(kriterium: string): string {
  return `befund-${kriterium.replace(/\./g, '-')}`;
}

function liste(eintraege: readonly string[]): string {
  return `<ul>${eintraege.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
}

/**
 * Maskiert alles, was im HTML eine Bedeutung hat.
 *
 * Das ist hier kein Formalismus: Belege enthalten HTML-Ausschnitte der
 * geprüften Seite. Ohne Maskierung würde der Bericht sie ausführen — und wäre
 * damit über eine fremde Seite steuerbar.
 */
export function esc(wert: string): string {
  return wert
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function kuerze(text: string, hoechstlaenge: number): string {
  return text.length <= hoechstlaenge ? text : `${text.slice(0, hoechstlaenge)} …`;
}

/** ISO-Zeitstempel als deutsches Datum mit Uhrzeit. */
export function datum(iso: string): string {
  const zeitpunkt = new Date(iso);
  if (Number.isNaN(zeitpunkt.getTime())) return iso;

  const zweistellig = (zahl: number): string => String(zahl).padStart(2, '0');
  return (
    `${zweistellig(zeitpunkt.getDate())}.${zweistellig(zeitpunkt.getMonth() + 1)}.${zeitpunkt.getFullYear()}, ` +
    `${zweistellig(zeitpunkt.getHours())}:${zweistellig(zeitpunkt.getMinutes())} Uhr`
  );
}

/*
  Die Gestaltung.

  Kontraste durchgehend über 4,5:1 gegen Weiss, die Marken zusaetzlich mit
  eigener Randfarbe — die Bewertung darf nicht allein an der Fuellfarbe
  haengen (1.4.1). Schriftgroessen in rem, damit die Zoomstufe des Browsers
  wirkt (1.4.4). Der Fokus ist sichtbar und nicht wegdefiniert (2.4.7).
*/
const STIL = `
:root {
  --grund: #ffffff;
  --text: #1a1a1a;
  --gedaempft: #55595e;
  --linie: #c8ccd0;
  --flaeche: #f4f6f8;
  --rot: #a4262c;
  --rot-flaeche: #fdf3f3;
  --gelb: #8a6100;
  --gelb-flaeche: #fdf8ee;
  --gruen: #1f6b3b;
  --gruen-flaeche: #f1f8f3;
  --blau: #14548c;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--grund);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 1rem;
  line-height: 1.6;
}
.blatt { max-width: 62rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.sprunglink {
  position: absolute; left: -9999px; top: 0;
  background: var(--text); color: #fff; padding: .75rem 1rem; z-index: 2;
}
.sprunglink:focus { left: 0; }
a { color: var(--blau); }
a:focus-visible, summary:focus-visible, .tabellenrahmen:focus-visible, pre:focus-visible {
  outline: 3px solid var(--blau); outline-offset: 2px;
}
h1 { font-size: 2rem; line-height: 1.25; margin: .25rem 0 1rem; }
h2 { font-size: 1.5rem; margin: 2.5rem 0 .75rem; padding-top: 1.5rem; border-top: 2px solid var(--linie); }
h3 { font-size: 1.2rem; margin: 1.75rem 0 .5rem; }
h4 { font-size: 1rem; margin: 1.25rem 0 .35rem; }
/*
  Adressen und Selektoren sind lange Zeichenfolgen ohne Leerzeichen. Ohne
  diese Regel sprengen sie bei 320 Pixeln die Seite und erzwingen waagerechtes
  Scrollen (1.4.10) — beanstandet von der eigenen Pruefung am Entwurf der
  Erklaerung, wo die Startadresse mitten im Fliesstext steht.
*/
p, li, dd, td, th { overflow-wrap: break-word; }
p { margin: 0 0 .75rem; }
.art { color: var(--gedaempft); text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; margin: 0; }
.deckblatt { border-bottom: 2px solid var(--linie); padding-bottom: 1.5rem; }
.entwurf {
  background: var(--gelb-flaeche); border: 2px solid var(--gelb); border-left-width: .5rem;
  padding: .75rem 1rem; margin: 1rem 0;
}
.angaben { display: grid; grid-template-columns: minmax(10rem, auto) 1fr; gap: .25rem 1.5rem; margin: 1rem 0; }
.angaben dt { font-weight: 600; }
.angaben dd { margin: 0; overflow-wrap: anywhere; }
.vermerk { border: 1px solid var(--linie); border-left: .5rem solid var(--gedaempft); padding: .75rem 1rem; margin: .75rem 0; background: var(--flaeche); }
.vermerk--entwurf { border-left-color: var(--gelb); background: var(--gelb-flaeche); }
.vermerk--geschuetzt { border-left-color: var(--rot); background: var(--rot-flaeche); }
.vermerk-titel { margin-bottom: .25rem; }
.verzeichnis ol { margin: .5rem 0 0; padding-left: 1.25rem; }
.tabellenrahmen {
  overflow-x: auto; margin: 0 0 1.5rem; position: relative; border: 1px solid var(--linie);
}
table { border-collapse: collapse; width: 100%; font-size: .95rem; }
caption { text-align: left; padding: .6rem .75rem; font-weight: 600; background: var(--flaeche); }
th, td { text-align: left; vertical-align: top; padding: .55rem .75rem; border-top: 1px solid var(--linie); }
thead th { background: var(--flaeche); font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; }
tbody th { font-weight: 600; }
.zahl { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.summe th, .summe td { border-top: 2px solid var(--text); font-weight: 700; }
.adresse { overflow-wrap: anywhere; color: var(--gedaempft); font-size: .9rem; }
.kennung { display: inline-block; font-variant-numeric: tabular-nums; margin-right: .35rem; color: var(--gedaempft); }
.marke {
  display: inline-block; padding: .1rem .5rem; border: 1px solid var(--gedaempft); border-radius: .2rem;
  background: var(--flaeche); font-size: .85rem; white-space: nowrap;
}
.marke--unterstuetzt { border-color: var(--gruen); background: var(--gruen-flaeche); color: var(--gruen); }
.marke--unterstuetzt_nicht { border-color: var(--rot); background: var(--rot-flaeche); color: var(--rot); }
.marke--teilweise_unterstuetzt { border-color: var(--rot); background: var(--rot-flaeche); color: var(--rot); }
.marke--nicht_abschliessend_bewertet { border-color: var(--gelb); background: var(--gelb-flaeche); color: var(--gelb); }
.marke--nicht_anwendbar { border-color: var(--gedaempft); color: var(--gedaempft); }
details { margin: .5rem 0; }
summary { cursor: pointer; padding: .25rem 0; font-weight: 600; }
.befund { border: 1px solid var(--linie); border-left: .5rem solid var(--rot); padding: 1rem 1.25rem; margin: 1.5rem 0; }
.beleg { border-top: 1px solid var(--linie); padding-top: .75rem; margin-top: .75rem; }
.beleg:first-of-type { border-top: 0; }
.mangel { font-weight: 600; margin-bottom: .35rem; }
.bezug { color: var(--gedaempft); font-size: .9rem; }
.beleg-angaben { display: grid; grid-template-columns: minmax(8rem, auto) 1fr; gap: .1rem 1rem; margin: .35rem 0; font-size: .9rem; }
.beleg-angaben dt { color: var(--gedaempft); }
.beleg-angaben dd { margin: 0; overflow-wrap: anywhere; }
pre {
  background: var(--flaeche); border: 1px solid var(--linie); padding: .6rem .75rem;
  overflow-x: auto; font-size: .85rem; margin: .5rem 0;
}
code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }
.beispiel-titel { font-weight: 600; margin: .5rem 0 .1rem; }
.belege-kurz { padding-left: 1.25rem; margin: .25rem 0; }
.kernsatz { font-size: 1.05rem; }
mark.luecke { background: var(--gelb-flaeche); border-bottom: 2px solid var(--gelb); color: var(--text); padding: 0 .15rem; }
.massnahmen { padding-left: 1.25rem; }
.massnahmen li { margin-bottom: 1rem; }
.adressen { padding-left: 1.25rem; font-size: .9rem; overflow-wrap: anywhere; }
.qualitaet { padding-left: 1.25rem; }
.fusszeile { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--linie); color: var(--gedaempft); font-size: .9rem; }

/* Gedruckt gibt es kein Aufklappen und keine Bildschirmbreite. */
@media print {
  .blatt { max-width: none; padding: 0; }
  .sprunglink, .verzeichnis { display: none; }
  .tabellenrahmen { overflow: visible; }
  h2 { break-before: page; }
  .deckblatt + .verzeichnis + main > section:first-child h2 { break-before: auto; }
  .befund, tr, .beleg { break-inside: avoid; }
  a { color: inherit; text-decoration: underline; }
}
`;
