/**
 * Gesamtprüfung und Verdichtung über mehrere Seiten.
 * Bezug: PRD 6.1 (K-06, K-08, K-09) und 6.5.1 (E-21, E-24 bis E-26)
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { Browser } from '../src/scan/browser.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import { stillesProtokoll } from '../src/protokoll.js';
import { crawle, passt, rateZweck, werteRobotsAus } from '../src/scan/crawl.js';
import { erkenneMuster, musterHash, ranglisteSeiten, rateBaustein } from '../src/bericht/muster.js';
import type { Befund, ScanErgebnis, Schwere, SeitenErgebnis } from '../src/typen/index.js';

describe('Crawl-Grenzen (K-08)', () => {
  it('laesst nur Pfade zu, die auf ein Einschlussmuster passen', () => {
    assert.equal(passt('https://a.de/produkte/hut', ['/produkte/*']), true);
    assert.equal(passt('https://a.de/impressum', ['/produkte/*']), false);
  });

  it('haelt sich zuerst an den Ausschluss', () => {
    assert.equal(passt('https://a.de/archiv/2019', undefined, ['/archiv/*']), false);
    assert.equal(passt('https://a.de/archiv/2019', ['/archiv/*'], ['/archiv/*']), false, 'Ausschluss schlaegt Einschluss');
  });

  it('laesst ohne Muster alles durch', () => {
    assert.equal(passt('https://a.de/beliebig'), true);
    assert.equal(passt('keine adresse'), false);
  });
});

describe('robots.txt (K-09)', () => {
  it('beachtet Verbote der Gruppe fuer alle', () => {
    const robots = werteRobotsAus(['User-agent: *', 'Disallow: /intern/'].join('\n'));
    assert.equal(robots.erlaubt('https://a.de/intern/seite'), false);
    assert.equal(robots.erlaubt('https://a.de/oeffentlich'), true);
  });

  it('laesst die laengste Regel gewinnen', () => {
    const robots = werteRobotsAus(['User-agent: *', 'Disallow: /intern/', 'Allow: /intern/freigegeben/'].join('\n'));
    assert.equal(robots.erlaubt('https://a.de/intern/freigegeben/seite'), true);
    assert.equal(robots.erlaubt('https://a.de/intern/geheim'), false);
  });

  it('uebernimmt eine angegebene Wartezeit', () => {
    const robots = werteRobotsAus(['User-agent: *', 'Crawl-delay: 2'].join('\n'));
    assert.equal(robots.verzoegerungMs, 2000);
  });

  it('geht Regeln fremder Gruppen nichts an', () => {
    const robots = werteRobotsAus(['User-agent: Suchmaschine', 'Disallow: /'].join('\n'));
    assert.equal(robots.erlaubt('https://a.de/beliebig'), true, 'die Gruppe gilt einem anderen Werkzeug');
  });

  it('haelt eine leere oder unbrauchbare Datei fuer erlaubend', () => {
    assert.equal(werteRobotsAus('').erlaubt('https://a.de/x'), true);
    assert.equal(werteRobotsAus('# nur ein Kommentar').erlaubt('https://a.de/x'), true);
  });
});

describe('Zweckvorschlag beim Crawl (K-06)', () => {
  it('raet aus Adresse und Titel', () => {
    assert.equal(rateZweck('https://a.de/kontakt', 'Kontakt'), 'Kontaktformular');
    assert.equal(rateZweck('https://a.de/', 'Willkommen'), 'Startseite');
    assert.equal(rateZweck('https://a.de/warenkorb', ''), 'Warenkorb oder Kasse');
  });

  it('raet lieber nichts als etwas Falsches', () => {
    assert.equal(rateZweck('https://a.de/xyz123', 'Etwas'), null);
  });
});

describe('Crawl über eine kleine Seite (K-08)', { timeout: 120_000 }, () => {
  const start = pathToFileURL(path.join(projektWurzel(), 'test', 'beispielseiten', 'crawl', 'start.html')).href;
  let browser: Browser;

  before(async () => {
    browser = await Browser.starten({ protokoll: stillesProtokoll });
  });

  after(async () => {
    await browser.schliessen();
  });

  it('folgt Verweisen bis zur angegebenen Tiefe', async () => {
    const ergebnis = await crawle({ start, browser, protokoll: stillesProtokoll, hoechsttiefe: 1, verzoegerungMs: 0 });

    const namen = ergebnis.seiten.map((s) => s.url.split('/').pop());
    assert.ok(namen.includes('start.html'));
    assert.ok(namen.includes('kontakt.html'));
    assert.ok(!namen.includes('tief.html'), 'die dritte Ebene liegt hinter der Grenze');
    assert.equal(ergebnis.grenzeErreicht, 'tiefe');
  });

  it('laesst aus, was keine pruefbare Seite ist, und bleibt bei der Herkunft', async () => {
    const ergebnis = await crawle({ start, browser, protokoll: stillesProtokoll, hoechsttiefe: 2, verzoegerungMs: 0 });

    assert.ok(!ergebnis.seiten.some((s) => s.url.endsWith('.pdf')), 'hinter einem PDF steckt keine Seite');
    assert.ok(!ergebnis.seiten.some((s) => s.url.includes('beispiel.test')), 'fremde Herkunft bleibt aussen vor');
    assert.equal(
      ergebnis.seiten.filter((s) => s.url.includes('kontakt.html')).length,
      1,
      'eine Sprungmarke macht keine zweite Seite',
    );
  });

  it('achtet auf Ausschlussmuster und Hoechstzahl', async () => {
    const ohneArchiv = await crawle({
      start,
      browser,
      protokoll: stillesProtokoll,
      hoechsttiefe: 2,
      verzoegerungMs: 0,
      ausschluss: ['*archiv*'],
    });
    assert.ok(!ohneArchiv.seiten.some((s) => s.url.includes('archiv')));

    const gedeckelt = await crawle({
      start,
      browser,
      protokoll: stillesProtokoll,
      hoechsttiefe: 3,
      hoechstzahl: 2,
      verzoegerungMs: 0,
    });
    assert.equal(gedeckelt.seiten.length, 2);
    assert.equal(gedeckelt.grenzeErreicht, 'anzahl');
  });

  it('haelt an, wenn abgebrochen wird (K-11)', async () => {
    const abbruch = new AbortController();
    abbruch.abort();

    const ergebnis = await crawle({
      start,
      browser,
      protokoll: stillesProtokoll,
      verzoegerungMs: 0,
      abbruch: abbruch.signal,
    });
    assert.equal(ergebnis.seiten.length, 0);
  });
});

describe('Gesamtprüfung von Ende zu Ende', { timeout: 300_000 }, () => {
  it('sucht die Seiten erst im Crawl und prüft sie danach', async () => {
    const { oeffneDatenbank } = await import('../src/db/index.js');
    const { Katalog } = await import('../src/katalog/laden.js');
    const { Protokoll } = await import('../src/protokoll.js');
    const { baueServer } = await import('../src/server/index.js');

    const db = oeffneDatenbank({ pfad: ':memory:' });
    const server = baueServer({
      db,
      katalog: Katalog.laden(),
      protokoll: new Protokoll({ datei: null, konsoleAb: null }),
    });

    try {
      const start = pathToFileURL(path.join(projektWurzel(), 'test', 'beispielseiten', 'crawl', 'start.html')).href;

      const gestartet = await server.inject({
        method: 'POST',
        url: '/api/scan',
        payload: {
          betriebsart: 'gesamt',
          crawl: { start, hoechsttiefe: 1, hoechstzahl: 2, verzoegerungMs: 0, robotsBeachten: false },
        },
      });
      assert.equal(gestartet.statusCode, 201);
      const { scanId } = gestartet.json() as { scanId: number };

      // Beim Start ist die Seitenliste noch leer — sie entsteht erst im Crawl.
      const seitenZuBeginn = db.prepare(`SELECT COUNT(*) AS n FROM scan_seite WHERE scan_id = ?`).get(scanId) as {
        n: number;
      };
      assert.equal(seitenZuBeginn.n, 0);

      interface Stand {
        laeuft: boolean;
        ergebnis: { seiten: { url: string }[] } | null;
      }

      let stand: Stand | null = null;
      for (let versuch = 0; versuch < 600; versuch += 1) {
        stand = (await server.inject({ method: 'GET', url: `/api/scan/${scanId}` })).json() as Stand;
        if (!stand.laeuft) break;
        await new Promise((weiter) => setTimeout(weiter, 250));
      }

      assert.ok(stand && !stand.laeuft, 'der Scan wurde nicht fertig');
      assert.equal(stand.ergebnis?.seiten.length, 2, 'die Hoechstzahl begrenzt den Umfang');

      const projekt = await server.inject({ method: 'GET', url: `/api/scan/${scanId}/projekt` });
      assert.equal(projekt.statusCode, 200);
      const sicht = projekt.json() as { projektebene: unknown[]; rangliste: unknown[]; seiten: unknown[] };
      assert.equal(sicht.projektebene.length, 50, 'die Projektebene deckt alle Kriterien des Standards ab');
      assert.equal(sicht.seiten.length, 2);
      assert.ok(sicht.rangliste.length >= 1);
    } finally {
      await server.close();
      db.close();
    }
  });
});

// ------------------------------------------------------------ Musterkennung

function befund(teile: Partial<Befund> = {}): Befund {
  return {
    kriterium: '1.1.1',
    regelId: 'image-alt',
    engine: 'axe',
    selektor: 'header > img',
    htmlAusschnitt: '<img src="logo.png">',
    beschreibung: 'Dem Bild fehlt eine Textalternative.',
    schwere: 'kritisch',
    ...teile,
  };
}

function seite(url: string, befunde: Befund[], schwere: Schwere = 'kritisch'): SeitenErgebnis {
  return {
    url,
    bezeichnung: null,
    titel: null,
    zustand: 'fertig',
    fehler: null,
    bewertungen: [
      {
        kriterium: '1.1.1',
        status: befunde.length > 0 ? 'nicht_erfuellt' : 'erfuellt',
        herkunft: 'auto/axe',
        befunde: befunde.map((b) => ({ ...b, schwere })),
        hinweise: [],
        offeneFragen: [],
      },
    ],
  };
}

function ergebnis(seiten: SeitenErgebnis[]): ScanErgebnis {
  return {
    scanId: 1,
    betriebsart: 'profil',
    standard: '2.1',
    gestartetAm: '2026-01-01T10:00:00.000Z',
    beendetAm: '2026-01-01T10:05:00.000Z',
    stufe2Aktiv: false,
    werkzeugVersion: '0.1.0',
    seiten,
    projektebene: [],
  };
}

describe('Musterkennung (E-25, E-26)', () => {
  it('macht aus demselben Befund auf drei Seiten einen Eintrag mit Seitenliste', () => {
    const muster = erkenneMuster(
      ergebnis([
        seite('https://a.de/1', [befund()]),
        seite('https://a.de/2', [befund()]),
        seite('https://a.de/3', [befund()]),
      ]),
    );

    assert.equal(muster.length, 1, 'ein Vorlagenfehler ist ein Problem, nicht drei');
    assert.equal(muster[0]?.seiten.length, 3);
    assert.equal(muster[0]?.baustein, 'kopfbereich', 'der Selektor verraet den Baustein (E-26)');
  });

  it('haelt den HTML-Ausschnitt aus dem Hash heraus', () => {
    // Derselbe Vorlagenfehler traegt auf jeder Seite anderen Text — er bleibt
    // trotzdem derselbe Fehler.
    const eins = musterHash(befund({ htmlAusschnitt: '<img src="a.png">' }));
    const zwei = musterHash(befund({ htmlAusschnitt: '<img src="b.png">' }));
    assert.equal(eins, zwei);
  });

  it('trennt, was sich in Regel, Selektor oder Beschreibung unterscheidet', () => {
    assert.notEqual(musterHash(befund()), musterHash(befund({ selektor: 'footer > img' })));
    assert.notEqual(musterHash(befund()), musterHash(befund({ regelId: 'image-redundant-alt' })));
    assert.notEqual(musterHash(befund()), musterHash(befund({ beschreibung: 'Etwas anderes.' })));
  });

  it('stellt oben hin, was viele Seiten betrifft', () => {
    const selten = befund({ selektor: 'main > img', beschreibung: 'Nur hier.' });
    const muster = erkenneMuster(
      ergebnis([seite('https://a.de/1', [befund(), selten]), seite('https://a.de/2', [befund()])]),
    );

    assert.equal(muster[0]?.seiten.length, 2);
    assert.equal(muster[1]?.seiten.length, 1);
  });

  it('raet den Baustein aus dem Selektor — oder gar nicht', () => {
    assert.equal(rateBaustein('nav ul li a'), 'navigation');
    assert.equal(rateBaustein('footer .hinweis'), 'fussbereich');
    assert.equal(rateBaustein('form input[name=suche]'), 'formular');
    assert.equal(rateBaustein('.xyz-123'), null);
    assert.equal(rateBaustein(null), null);
  });

  it('laesst Seiten aus, die nicht geprueft werden konnten', () => {
    const kaputt: SeitenErgebnis = { ...seite('https://a.de/2', [befund()]), zustand: 'fehler' };
    const muster = erkenneMuster(ergebnis([seite('https://a.de/1', [befund()]), kaputt]));
    assert.equal(muster[0]?.seiten.length, 1);
  });
});

describe('Seitenrangliste (E-24)', () => {
  it('gewichtet nach Schwere, nicht nur nach Anzahl', () => {
    const vieleKleine = seite('https://a.de/klein', [befund(), befund({ selektor: 'a' }), befund({ selektor: 'b' })], 'gering');
    const einSchwerer = seite('https://a.de/schwer', [befund()], 'kritisch');

    const rangliste = ranglisteSeiten(ergebnis([vieleKleine, einSchwerer]));
    assert.equal(rangliste[0]?.url, 'https://a.de/schwer', 'vier Gewicht schlaegt drei');
    assert.equal(rangliste[0]?.gewicht, 4);
    assert.equal(rangliste[1]?.gewicht, 3);
  });

  it('zaehlt offene Kriterien getrennt von belegten Verstoessen', () => {
    const offen: SeitenErgebnis = {
      ...seite('https://a.de/offen', []),
      bewertungen: [
        {
          kriterium: '1.3.3',
          status: 'pruefung_erforderlich',
          herkunft: 'manuell',
          befunde: [],
          hinweise: [],
          offeneFragen: [],
        },
      ],
    };

    const rangliste = ranglisteSeiten(ergebnis([offen]));
    assert.equal(rangliste[0]?.verstoesse, 0);
    assert.equal(rangliste[0]?.offen, 1);
  });
});
