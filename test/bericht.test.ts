/**
 * Bericht nach WCAG-EM und ACR (PRD 6.6, X-01 bis X-22).
 *
 * Der Schwerpunkt liegt auf den Zusagen, deren Verletzung nicht auffiele:
 * dass ein offenes Kriterium nie als „Unterstützt" erscheint, dass jedes
 * Kriterium eine Anmerkung traegt, und dass ein Seitenbericht wirklich nur
 * ueber seine Seite spricht.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { oeffneDatenbank } from '../src/db/index.js';
import { legeProfilAn } from '../src/profil/index.js';
import { speichereScan } from '../src/db/scan-speichern.js';
import { baueServer } from '../src/server/index.js';
import { verdichte } from '../src/scan/statusableitung.js';
import { baueBerichtsdaten } from '../src/bericht/daten.js';
import { alsHtml } from '../src/bericht/html.js';
import { alsEarl } from '../src/bericht/earl.js';
import { baueErklaerung, erklaerungAlsHtml, leiteVereinbarkeitAb } from '../src/bericht/erklaerung.js';
import type { Bewertung, Kriterium, ScanErgebnis, SeitenErgebnis, Status } from '../src/typen/index.js';

const katalog = Katalog.laden();
const KRITERIEN_21 = katalog.fuerStandard('2.1');

/** Eine Bewertung mit dem gewuenschten Status, sonst so leer wie moeglich. */
function bewertung(kriterium: string, status: Status): Bewertung {
  const grund: Partial<Bewertung> =
    status === 'nicht_erfuellt'
      ? {
          befunde: [
            {
              kriterium,
              regelId: 'image-alt',
              engine: 'axe',
              selektor: 'img.logo',
              htmlAusschnitt: '<img class="logo" src="x.png">',
              beschreibung: 'Abbildung ohne Alternativtext',
              schwere: 'kritisch',
            },
          ],
        }
      : status === 'pruefung_erforderlich'
        ? {
            offeneFragen: [
              {
                id: `frage-${kriterium}`,
                kriterium,
                frage: 'Beschreibt der Alternativtext, was zu sehen ist?',
                kontextSelektor: null,
                betroffeneElemente: 1,
                herkunft: 'katalog',
              },
            ],
          }
        : {};

  return {
    kriterium,
    status,
    herkunft: 'auto/axe',
    befunde: [],
    hinweise: [],
    offeneFragen: [],
    ...grund,
  };
}

/**
 * Ein Scanergebnis mit gezielt gesetzten Status.
 *
 * `stati` bildet Kriterium auf Status ab; alles Uebrige gilt als erfuellt.
 * Damit lassen sich die Grenzfaelle der ACR-Abbildung genau ansteuern.
 */
function beispiel(
  seitenStati: Record<string, Record<string, Status>>,
  zusatz: Partial<ScanErgebnis> = {},
): ScanErgebnis {
  const seiten: SeitenErgebnis[] = Object.entries(seitenStati).map(([url, stati]) => ({
    url,
    bezeichnung: null,
    titel: 'Beispielseite',
    zustand: 'fertig',
    fehler: null,
    bewertungen: KRITERIEN_21.map((k) => bewertung(k.id, stati[k.id] ?? 'erfuellt')),
  }));

  return {
    scanId: 1,
    betriebsart: seiten.length > 1 ? 'profil' : 'einzelseite',
    standard: '2.1',
    gestartetAm: '2026-08-01T09:00:00.000Z',
    beendetAm: '2026-08-01T09:05:00.000Z',
    stufe2Aktiv: true,
    werkzeugVersion: '0.1.0',
    seiten,
    projektebene: verdichte(seiten, KRITERIEN_21),
    ...zusatz,
  };
}

function daten(ergebnis: ScanErgebnis, weiteres: Record<string, unknown> = {}) {
  return baueBerichtsdaten({
    ergebnis,
    kriterien: katalog.fuerStandard(ergebnis.standard),
    erstelltAm: '2026-08-19T12:00:00.000Z',
    ...weiteres,
  });
}

describe('Berichtsdaten — Aufbau und Bewertungssprache', () => {
  it('fuehrt genau die Kriterien des gewaehlten Standards (X-19)', () => {
    const unter21 = daten(beispiel({ 'https://a.example/': {} }));
    assert.equal(unter21.konformitaet.length, 50);
    assert.ok(unter21.konformitaet.some((z) => z.kriterium.id === '4.1.1'));

    const unter22 = daten(beispiel({ 'https://a.example/': {} }, { standard: '2.2' }));
    assert.equal(unter22.konformitaet.length, 55);
    // 4.1.1 entfaellt mit 2.2 — auch nicht als "nicht bewertet".
    assert.ok(!unter22.konformitaet.some((z) => z.kriterium.id === '4.1.1'));
  });

  it('gibt zu jedem Kriterium eine Anmerkung, auch bei "Unterstuetzt" (X-12)', () => {
    const bericht = daten(beispiel({ 'https://a.example/': { '1.1.1': 'nicht_erfuellt' } }));

    for (const zeile of bericht.konformitaet) {
      assert.ok(zeile.anmerkung.length > 20, `${zeile.kriterium.id} traegt keine brauchbare Anmerkung`);
    }

    const unterstuetzt = bericht.konformitaet.find((z) => z.acr === 'unterstuetzt');
    assert.ok(unterstuetzt);
    assert.match(unterstuetzt.anmerkung, /Prüfweg/);
  });

  it('bildet einen Teilbefall auf "Teilweise unterstuetzt" ab (X-13)', () => {
    const bericht = daten(
      beispiel({
        'https://a.example/': { '1.1.1': 'nicht_erfuellt' },
        'https://b.example/': {},
        'https://c.example/': {},
      }),
    );

    const zeile = bericht.konformitaet.find((z) => z.kriterium.id === '1.1.1');
    assert.equal(zeile?.acr, 'teilweise_unterstuetzt');
    assert.equal(zeile?.acrText, 'Teilweise unterstützt');
    assert.match(zeile?.anmerkung ?? '', /1 von 3 anwendbaren Seiten/);
  });

  it('bildet einen Durchfall auf allen Seiten auf "Unterstuetzt nicht" ab', () => {
    const bericht = daten(
      beispiel({
        'https://a.example/': { '1.1.1': 'nicht_erfuellt' },
        'https://b.example/': { '1.1.1': 'nicht_erfuellt' },
      }),
    );

    assert.equal(bericht.konformitaet.find((z) => z.kriterium.id === '1.1.1')?.acr, 'unterstuetzt_nicht');
  });

  it('gibt ein offenes Kriterium niemals als "Unterstuetzt" aus (X-14)', () => {
    const bericht = daten(beispiel({ 'https://a.example/': { '1.4.1': 'pruefung_erforderlich' } }));

    const zeile = bericht.konformitaet.find((z) => z.kriterium.id === '1.4.1');
    assert.equal(zeile?.acr, 'nicht_abschliessend_bewertet');
    assert.match(zeile?.anmerkung ?? '', /nicht als erfüllt/);

    assert.equal(bericht.deckblatt.entwurf, true);
    assert.equal(bericht.deckblatt.offeneKriterien, 1);
    assert.ok(bericht.vermerke.some((v) => v.art === 'entwurf'));
  });

  it('kennzeichnet einen Bericht ohne offene Kriterien nicht als Entwurf', () => {
    const bericht = daten(beispiel({ 'https://a.example/': {} }));
    assert.equal(bericht.deckblatt.entwurf, false);
    assert.ok(!bericht.vermerke.some((v) => v.art === 'entwurf'));
  });

  it('nennt den zugrunde gelegten Standard auf dem Deckblatt und im Geltungsbereich (X-20)', () => {
    const bericht = daten(beispiel({ 'https://a.example/': {} }));
    assert.equal(bericht.deckblatt.standardText, 'WCAG 2.1, Level AA');
    assert.equal(bericht.geltungsbereich.standardText, 'WCAG 2.1, Level AA');
  });
});

describe('Berichtsdaten — Stichprobe, Vermerke und Umfang', () => {
  it('uebernimmt Bezeichnung und Zweck aus dem Pruefprofil (X-16)', () => {
    const db = oeffneDatenbank({ pfad: ':memory:' });
    const profil = legeProfilAn(db, {
      name: 'Kernstrecke',
      standard: '2.1',
      seiten: [{ url: 'https://a.example/', bezeichnung: 'Startseite', zweck: 'Einstieg und Navigation' }],
    });

    const bericht = daten(beispiel({ 'https://a.example/': {} }, { betriebsart: 'profil' }), { profil });

    assert.equal(bericht.deckblatt.angebot, 'Kernstrecke');
    assert.equal(bericht.stichprobe.seiten[0]?.zweck, 'Einstieg und Navigation');
    assert.match(bericht.stichprobe.begruendung, /Kernstrecke/);
    db.close();
  });

  it('vermerkt Belege aus einem geschuetzten Bereich (X-17)', () => {
    const bericht = daten(beispiel({ 'https://a.example/': {} }, { geschuetzt: true }));
    assert.ok(bericht.vermerke.some((v) => v.art === 'geschuetzt'));
    assert.ok(bericht.geltungsbereich.einschraenkungen.some((e) => /angemeldeten Bereich/.test(e)));
  });

  it('nennt bei abgeschalteter Stufe 2 die dadurch manuell zu pruefenden Kriterien (X-22)', () => {
    const bericht = daten(beispiel({ 'https://a.example/': {} }, { stufe2Aktiv: false }));

    const vermerk = bericht.vermerke.find((v) => v.art === 'stufe2');
    assert.ok(vermerk);
    assert.ok((vermerk.kriterien?.length ?? 0) > 0);

    // Aufgezaehlt wird, was der Katalog der Stufe 2 zuweist — nicht einfach
    // alles, was offen ist.
    const mitLlm = new Set(
      KRITERIEN_21.filter((k) => k.pruefungen.some((p) => p.typ === 'llm')).map((k: Kriterium) => k.id),
    );
    for (const id of vermerk.kriterien ?? []) assert.ok(mitLlm.has(id), `${id} gehoert nicht zur Stufe 2`);
  });

  it('vermerkt einen Lauf ohne Endzeitpunkt als abgebrochen', () => {
    const bericht = daten(beispiel({ 'https://a.example/': {} }, { beendetAm: null }));
    assert.ok(bericht.vermerke.some((v) => v.art === 'abbruch'));
  });

  it('engt einen Seitenbericht wirklich auf seine Seite ein (X-05)', () => {
    const ergebnis = beispiel({
      'https://a.example/': { '1.1.1': 'nicht_erfuellt' },
      'https://b.example/': {},
    });

    const nurB = daten(ergebnis, { nurSeite: 'https://b.example/' });

    assert.equal(nurB.stichprobe.seiten.length, 1);
    // Der Mangel liegt auf der anderen Seite. Ein Seitenbericht, der ihn
    // trotzdem auffuehrte, behauptete etwas ueber eine Seite, das dort nicht
    // zutrifft.
    assert.equal(nurB.konformitaet.find((z) => z.kriterium.id === '1.1.1')?.acr, 'unterstuetzt');
    assert.equal(nurB.detailbefunde.length, 0);
  });

  it('ordnet die wirksamsten Massnahmen nach Verbreitung', () => {
    const bericht = daten(
      beispiel({
        'https://a.example/': { '1.1.1': 'nicht_erfuellt', '1.3.1': 'nicht_erfuellt' },
        'https://b.example/': { '1.1.1': 'nicht_erfuellt' },
      }),
    );

    assert.ok(bericht.zusammenfassung.massnahmen.length > 0);
    assert.equal(bericht.zusammenfassung.massnahmen[0]?.kriterium, '1.1.1');
    assert.equal(bericht.zusammenfassung.massnahmen[0]?.betroffeneSeiten, 2);
    assert.ok(bericht.zusammenfassung.massnahmen.length <= 3);
  });

  it('fuehrt Qualitaetshinweise ausserhalb der Konformitaetstabelle (X-21)', () => {
    const ergebnis = beispiel({ 'https://a.example/': {} }, { standard: '2.2' });
    ergebnis.seiten[0]!.qualitaetshinweise = [
      {
        regelId: 'close-order',
        engine: 'html',
        selektor: 'div',
        beschreibung: 'Ein Element wird in falscher Reihenfolge geschlossen.',
        schwere: 'maessig',
      },
    ];

    const bericht = daten(ergebnis);

    assert.equal(bericht.qualitaetshinweise.length, 1);
    assert.equal(bericht.qualitaetshinweise[0]?.seiten.length, 1);
    assert.ok(bericht.vermerke.some((v) => v.art === 'qualitaet'));

    // Und ohne jeden Einfluss auf die Bewertung: Kein Kriterium wird dadurch
    // verletzt, und 4.1.1 taucht unter 2.2 auch nicht wieder auf.
    assert.ok(!bericht.konformitaet.some((z) => z.status === 'nicht_erfuellt'));
    assert.ok(!bericht.konformitaet.some((z) => z.kriterium.id === '4.1.1'));
  });
});

describe('Katalog — Regeln ohne Kriterium im Standard (X-21)', () => {
  it('kennt unter 2.1 keine solchen Regeln', () => {
    assert.equal(katalog.qualitaetsRegeln('2.1').size, 0);
  });

  it('fuehrt unter 2.2 die Regeln des entfallenen 4.1.1', () => {
    const regeln = katalog.qualitaetsRegeln('2.2');
    assert.ok(regeln.size > 0);
    assert.ok(regeln.has('close-order'));
    // Regeln, die ein geltendes Kriterium weiterhin braucht, bleiben aussen vor.
    assert.ok(!regeln.has('element-required-content'));
  });
});

describe('Bericht als HTML (X-02)', () => {
  const bericht = daten(beispiel({ 'https://a.example/': { '1.1.1': 'nicht_erfuellt' } }));
  const html = alsHtml(bericht);

  it('ist eigenstaendig — nichts wird von aussen nachgeladen', () => {
    assert.ok(!/<link\b/i.test(html));
    assert.ok(!/<script\b/i.test(html));
    assert.ok(!/src\s*=\s*["']https?:/i.test(html));
  });

  it('traegt die deutsche Bewertungssprache und die sieben Abschnitte (X-10, X-18)', () => {
    assert.match(html, /<html lang="de">/);
    for (const ueberschrift of [
      'Geltungsbereich',
      'Stichprobe',
      'Zusammenfassung',
      'Konformitätstabelle',
      'Detailbefunde',
      'Methodik',
    ]) {
      assert.ok(html.includes(ueberschrift), `Abschnitt fehlt: ${ueberschrift}`);
    }
    assert.ok(html.includes('Unterstützt'));
    assert.ok(!/Partially Supports|Does Not Support/.test(html));
  });

  it('maskiert HTML-Ausschnitte aus der geprueften Seite', () => {
    const boesartig = beispiel({ 'https://a.example/': { '1.1.1': 'nicht_erfuellt' } });
    const treffer = boesartig.seiten[0]?.bewertungen.find((b) => b.kriterium === '1.1.1');
    treffer!.befunde[0]!.htmlAusschnitt = '<script>alert(1)</script>';

    const ausgabe = alsHtml(daten(boesartig));
    assert.ok(!ausgabe.includes('<script>alert(1)</script>'));
    assert.ok(ausgabe.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  it('setzt den Entwurfsvermerk auf das Deckblatt (X-14)', () => {
    const offen = alsHtml(daten(beispiel({ 'https://a.example/': { '1.4.1': 'pruefung_erforderlich' } })));
    assert.match(offen, /Entwurf/);
    assert.match(offen, /behauptet keine Konformität/);
  });
});

describe('Rohdaten als EARL (X-04)', () => {
  const ergebnis = beispiel({
    'https://a.example/': { '1.1.1': 'nicht_erfuellt', '1.4.1': 'pruefung_erforderlich' },
  });
  const dokument = alsEarl({ ergebnis, daten: daten(ergebnis) });

  function aussagenZu(kriterium: string): Record<string, unknown>[] {
    return dokument['@graph'].filter(
      (eintrag): eintrag is Record<string, unknown> =>
        typeof eintrag === 'object' &&
        eintrag !== null &&
        (eintrag as Record<string, unknown>)['@type'] === 'earl:Assertion' &&
        ((eintrag as Record<string, Record<string, string>>)['earl:test']?.['dct:identifier'] ?? '') ===
          `WCAG:${kriterium}`,
    );
  }

  it('bringt seinen Kontext mit, statt ihn nachzuladen', () => {
    assert.equal(dokument['@context'].earl, 'http://www.w3.org/ns/earl#');
  });

  it('bildet die vier Status auf die EARL-Ergebnisse ab', () => {
    const ausgang = (kriterium: string): unknown =>
      (aussagenZu(kriterium)[0]?.['earl:result'] as Record<string, Record<string, string>>)['earl:outcome']?.['@id'];

    assert.equal(ausgang('1.1.1'), 'earl:failed');
    // Geprueft, aber nicht entschieden — nicht "untested" (X-14).
    assert.equal(ausgang('1.4.1'), 'earl:cantTell');
  });

  it('trennt die Beobachtung an der Seite von der Verdichtung', () => {
    const aussagen = aussagenZu('1.1.1');
    const subjekte = aussagen.map((a) => (a['earl:subject'] as Record<string, string>)['@id']);
    assert.ok(subjekte.includes('_:seite0'));
    assert.ok(subjekte.includes('_:angebot'));
  });
});

describe('Entwurf der Erklaerung zur Barrierefreiheit (X-06)', () => {
  it('leitet die Vereinbarkeit aus den Ergebnissen ab', () => {
    assert.equal(leiteVereinbarkeitAb(daten(beispiel({ 'https://a.example/': {} }))), 'vollstaendig');

    assert.equal(
      leiteVereinbarkeitAb(daten(beispiel({ 'https://a.example/': { '1.1.1': 'nicht_erfuellt' } }))),
      'teilweise',
    );

    // Offen ist nicht erfuellt: Auch ohne einen einzigen Verstoss reicht es
    // dann nicht fuer "vollstaendig vereinbar" (X-14).
    assert.equal(
      leiteVereinbarkeitAb(daten(beispiel({ 'https://a.example/': { '1.4.1': 'pruefung_erforderlich' } }))),
      'teilweise',
    );
  });

  it('weist alles aus, was das Werkzeug nicht wissen kann', () => {
    const erklaerung = baueErklaerung(daten(beispiel({ 'https://a.example/': { '1.1.1': 'nicht_erfuellt' } })));

    assert.ok(erklaerung.offeneAngaben.length >= 3);
    const volltext = erklaerung.abschnitte.flatMap((a) => [...a.absaetze, a.kernsatz ?? '']).join(' ');
    assert.match(volltext, /\[Name der öffentlichen Stelle\]/);
    assert.match(volltext, /Schlichtungsstelle/);
  });

  it('haelt die Gliederung der Mustererklaerung ein', () => {
    const erklaerung = baueErklaerung(daten(beispiel({ 'https://a.example/': {} })));
    const ueberschriften = erklaerung.abschnitte.map((a) => a.ueberschrift);

    for (const pflicht of [
      'Geltungsbereich',
      'Stand der Vereinbarkeit mit den Anforderungen',
      'Nicht barrierefreie Inhalte',
      'Datum der Erstellung dieser Erklärung',
      'Feedback und Kontaktangaben',
      'Durchsetzungsverfahren',
    ]) {
      assert.ok(ueberschriften.includes(pflicht), `Abschnitt fehlt: ${pflicht}`);
    }
  });

  it('warnt in der HTML-Fassung vor einer unvollstaendigen Pruefung', () => {
    const bericht = daten(beispiel({ 'https://a.example/': { '1.4.1': 'pruefung_erforderlich' } }));
    const html = erklaerungAlsHtml(baueErklaerung(bericht), bericht.deckblatt.angebot);

    assert.match(html, /keine veröffentlichungsfähige Erklärung/);
    assert.match(html, /Prüfung ist nicht abgeschlossen/);
    assert.ok(html.includes('<mark class="luecke">'));
  });
});

describe('Berichtsroute', () => {
  let server: FastifyInstance;
  let db: Database;
  let scanId: number;

  before(async () => {
    db = oeffneDatenbank({ pfad: ':memory:' });
    scanId = speichereScan(db, beispiel({ 'https://a.example/': { '1.1.1': 'nicht_erfuellt' } }));
    server = baueServer({ db, katalog, protokoll: new Protokoll({ datei: null, konsoleAb: 'fehler' }) });
    await server.ready();
  });

  after(async () => {
    await server.close();
    db.close();
  });

  it('liefert den Bericht als eigenstaendiges HTML', async () => {
    const antwort = await server.inject({ method: 'GET', url: `/api/scan/${scanId}/bericht` });

    assert.equal(antwort.statusCode, 200);
    assert.match(antwort.headers['content-type'] as string, /text\/html/);
    assert.match(antwort.headers['content-disposition'] as string, /Barrierefreiheitsbericht-/);
    assert.match(antwort.body, /Konformitätstabelle/);
  });

  it('liefert die Rohdaten im EARL-Vokabular', async () => {
    const antwort = await server.inject({ method: 'GET', url: `/api/scan/${scanId}/bericht?format=earl` });

    assert.equal(antwort.statusCode, 200);
    assert.match(antwort.headers['content-type'] as string, /application\/ld\+json/);
    assert.ok(Array.isArray((antwort.json() as { '@graph': unknown[] })['@graph']));
  });

  it('liefert den Entwurf der Erklaerung', async () => {
    const antwort = await server.inject({ method: 'GET', url: `/api/scan/${scanId}/bericht?format=erklaerung` });

    assert.equal(antwort.statusCode, 200);
    assert.match(antwort.body, /Erklärung zur Barrierefreiheit/);
  });

  it('weist einen Seitenbericht ohne bekannte Adresse ab (X-05)', async () => {
    const ohneAdresse = await server.inject({
      method: 'GET',
      url: `/api/scan/${scanId}/bericht?umfang=seite`,
    });
    assert.equal(ohneAdresse.statusCode, 400);

    const fremd = await server.inject({
      method: 'GET',
      url: `/api/scan/${scanId}/bericht?umfang=seite&url=${encodeURIComponent('https://fremd.example/')}`,
    });
    assert.equal(fremd.statusCode, 404);
  });

  it('meldet einen unbekannten Scan mit 404 und ein unbekanntes Format mit 400', async () => {
    assert.equal((await server.inject({ method: 'GET', url: '/api/scan/9999/bericht' })).statusCode, 404);
    assert.equal(
      (await server.inject({ method: 'GET', url: `/api/scan/${scanId}/bericht?format=docx` })).statusCode,
      400,
    );
  });
});
