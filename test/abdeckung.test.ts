/**
 * Abdeckungsmatrix und Verifikationsgrundlagen (PRD 10, Phase 8).
 *
 * Der Schwerpunkt liegt auf den Zusagen, deren Verletzung stillschweigend
 * durchginge: dass eine gemessene Lücke jede andere Einstufung schlägt, dass
 * ungemessene Kriterien in der Matrix stehen statt zu fehlen, und dass ein
 * Bericht ohne Messung das auch sagt, statt die Spalte leer zu lassen.
 *
 * Dazu kommen zwei Konsistenzproben, die keine Logik prüfen, sondern
 * Tippfehler: Jedes Kriterium in `soll.json` muss es im Katalog geben, und
 * jede Prüfung im Modellsatz muss es in `prompts/stufe2.md` geben. Beide
 * Fehler fielen sonst erst beim nächsten stundenlangen Messlauf auf.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { oeffneDatenbank } from '../src/db/index.js';
import { baueServer } from '../src/server/index.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import {
  abdeckungsmatrixSchema,
  ladeAbdeckung,
  leiteEinstufungAb,
  standardAbdeckungsPfad,
  EINSTUFUNG_TEXT,
} from '../src/katalog/abdeckung.js';
import type { Abdeckungsmatrix } from '../src/katalog/abdeckung.js';
import { ladePrompts } from '../src/stufe2/prompts.js';
import { verdichte } from '../src/scan/statusableitung.js';
import { baueBerichtsdaten } from '../src/bericht/daten.js';
import { alsHtml } from '../src/bericht/html.js';
import type { ScanErgebnis, SeitenErgebnis } from '../src/typen/index.js';

const WURZEL = projektWurzel();
const katalog = Katalog.laden();
const KRITERIEN_22 = katalog.fuerStandard('2.2');

// ------------------------------------------------------------- Einstufung

describe('Einstufung der Abdeckung', () => {
  it('nennt ein Kriterium ohne Testfall ungeprueft', () => {
    assert.equal(leiteEinstufungAb({ testfaelle: 0, belegtErkannt: 0, uebersehen: 0 }), 'ungeprueft');
  });

  it('nennt ein durchgehend belegtes Kriterium belegt', () => {
    assert.equal(leiteEinstufungAb({ testfaelle: 3, belegtErkannt: 3, uebersehen: 0 }), 'belegt');
  });

  it('nennt ein teilweise belegtes Kriterium teilweise', () => {
    assert.equal(leiteEinstufungAb({ testfaelle: 3, belegtErkannt: 1, uebersehen: 0 }), 'teilweise');
  });

  it('nennt ein nie belegtes Kriterium einen blossen Hinweis', () => {
    assert.equal(leiteEinstufungAb({ testfaelle: 2, belegtErkannt: 0, uebersehen: 0 }), 'nur_hinweis');
  });

  /*
    Der wichtigste Fall: Eine einzige Luecke schlaegt neun saubere Testfaelle.
    Wer das umdreht, bekommt eine Matrix, die genau dort beruhigend aussieht,
    wo das Werkzeug einen Verstoss durchgewunken hat.
  */
  it('laesst eine Luecke jede andere Einstufung schlagen', () => {
    assert.equal(leiteEinstufungAb({ testfaelle: 10, belegtErkannt: 9, uebersehen: 1 }), 'luecke');
    assert.equal(leiteEinstufungAb({ testfaelle: 1, belegtErkannt: 0, uebersehen: 1 }), 'luecke');
  });

  it('hat zu jeder Einstufung einen Anzeigetext', () => {
    for (const einstufung of ['belegt', 'teilweise', 'nur_hinweis', 'luecke', 'ungeprueft'] as const) {
      assert.ok(EINSTUFUNG_TEXT[einstufung].length > 10, `Text zu "${einstufung}" fehlt oder ist zu knapp`);
    }
  });
});

// ------------------------------------------------------------ Die Datei

describe('Gemessene Abdeckungsmatrix', () => {
  it('liegt vor und entspricht dem Schema', () => {
    const roh = JSON.parse(fs.readFileSync(standardAbdeckungsPfad(), 'utf8')) as unknown;
    const ergebnis = abdeckungsmatrixSchema.safeParse(roh);
    assert.ok(ergebnis.success, `katalog/abdeckung.json entspricht nicht dem Schema: ${ergebnis.error?.message}`);
  });

  it('fuehrt jedes Kriterium des gemessenen Standards, auch die ungemessenen', () => {
    const matrix = ladeAbdeckung();
    assert.ok(matrix, 'Es liegt keine Messung vor — "npm run verifikation" erzeugt sie.');

    const kriterien = katalog.fuerStandard(matrix.standard);
    for (const kriterium of kriterien) {
      assert.ok(
        matrix.kriterien[kriterium.id],
        `${kriterium.id} fehlt in der Matrix — ein leerer Platz ist die ehrlichere Angabe als gar keine Zeile`,
      );
    }
    assert.equal(Object.keys(matrix.kriterien).length, kriterien.length);
  });

  /*
    Diese beiden Zahlen sind die Zusage des Werkzeugs an sich selbst. Sie
    stehen als Regel in CLAUDE.md und hier noch einmal als Test: Wer eine
    Engine aendert und die Verifikation nicht laufen laesst, faellt spaetestens
    hier auf.
  */
  it('weist weder uebersehene Verstoesse noch Fehlalarme aus', () => {
    const matrix = ladeAbdeckung();
    assert.ok(matrix);
    assert.equal(matrix.kennzahlen.uebersehen, 0, 'Ein uebersehener Verstoss sieht aus wie ein bestandener Test.');
    assert.equal(matrix.kennzahlen.fehlalarme, 0);
    assert.ok(!Object.values(matrix.kriterien).some((z) => z.einstufung === 'luecke'));
  });

  /*
    Die Zielwerte aus `soll.json` beziehen sich ausdruecklich nur auf die
    Stufe 1. Verstoesse der Stufen `llm` und `manuell` haengen am Urteil des
    Modells beziehungsweise des Menschen; sie in dieselbe Quote zu werfen
    hiesse, die Automatik fuer etwas verantwortlich zu machen, das sie gar
    nicht entscheiden soll.
  */
  it('weist die Erkennungsquote der Stufe 1 gesondert aus', () => {
    const matrix = ladeAbdeckung();
    assert.ok(matrix);
    assert.ok(matrix.kennzahlen.testfaelleAuto > 0);
    assert.ok(matrix.kennzahlen.testfaelleAuto <= matrix.kennzahlen.testfaelle);
    assert.ok(
      matrix.kennzahlen.erkennungsquoteAuto >= matrix.kennzahlen.erkennungsquote,
      'Die Automatik kann an ihren eigenen Faellen nicht schlechter abschneiden als am Gesamtsatz',
    );
  });

  it('gibt zu jedem ungemessenen Kriterium keinen Testfall vor', () => {
    const matrix = ladeAbdeckung();
    assert.ok(matrix);
    for (const [id, zeile] of Object.entries(matrix.kriterien)) {
      if (zeile.einstufung !== 'ungeprueft') continue;
      assert.equal(zeile.testfaelle, 0, `${id} gilt als ungemessen, hat aber Testfaelle`);
    }
  });

  it('meldet eine fehlende oder kaputte Datei als "nicht gemessen", nicht als Fehler', () => {
    assert.equal(ladeAbdeckung(path.join(WURZEL, 'katalog', 'gibt-es-nicht.json')), null);
    assert.equal(ladeAbdeckung(path.join(WURZEL, 'package.json')), null);
  });
});

// ------------------------------------------------------- Im Bericht (X-15)

/** Ein Scanergebnis, das nur den Methodikteil tragen muss. */
function beispiel(): ScanErgebnis {
  const seiten: SeitenErgebnis[] = [
    {
      url: 'https://a.example/',
      bezeichnung: null,
      titel: 'Beispielseite',
      zustand: 'fertig',
      fehler: null,
      bewertungen: KRITERIEN_22.map((k) => ({
        kriterium: k.id,
        status: 'erfuellt' as const,
        herkunft: 'auto/axe',
        befunde: [],
        hinweise: [],
        offeneFragen: [],
      })),
    },
  ];

  return {
    scanId: 1,
    betriebsart: 'einzelseite',
    standard: '2.2',
    gestartetAm: '2026-08-01T09:00:00.000Z',
    beendetAm: '2026-08-01T09:05:00.000Z',
    stufe2Aktiv: false,
    werkzeugVersion: '0.1.0',
    seiten,
    projektebene: verdichte(seiten, KRITERIEN_22),
  };
}

describe('Abdeckung im Bericht (X-15)', () => {
  it('traegt die gemessene Einstufung in jede Methodikzeile', () => {
    const matrix = ladeAbdeckung();
    assert.ok(matrix);

    const bericht = baueBerichtsdaten({
      ergebnis: beispiel(),
      kriterien: KRITERIEN_22,
      erstelltAm: '2026-08-19T12:00:00.000Z',
      abdeckung: matrix,
    });

    assert.equal(bericht.methodik.length, KRITERIEN_22.length);
    for (const zeile of bericht.methodik) {
      assert.ok(zeile.abdeckung, `${zeile.kriterium} traegt keine Abdeckung`);
      assert.equal(zeile.abdeckung.einstufung, matrix.kriterien[zeile.kriterium]?.einstufung);
    }

    assert.ok(bericht.abdeckungsherkunft);
    assert.equal(bericht.abdeckungsherkunft.gemessenAm, matrix.gemessenAm);
    assert.equal(bericht.abdeckungsherkunft.kriterienGesamt, KRITERIEN_22.length);
  });

  /*
    Ohne Messung darf im Bericht keine Zahl stehen — aber es muss dort stehen,
    dass keine vorliegt. Eine stillschweigend leere Spalte saehe aus wie ein
    Ergebnis.
  */
  it('sagt ausdruecklich, wenn nicht gemessen wurde', () => {
    const bericht = baueBerichtsdaten({
      ergebnis: beispiel(),
      kriterien: KRITERIEN_22,
      erstelltAm: '2026-08-19T12:00:00.000Z',
      abdeckung: null,
    });

    assert.equal(bericht.abdeckungsherkunft, null);
    assert.ok(bericht.methodik.every((z) => z.abdeckung === null));

    const html = alsHtml(bericht, { alleAufgeklappt: true });
    assert.match(html, /keine Messung der Abdeckung/);
  });

  it('nennt im HTML die Herkunft der Zahlen und die Spalte', () => {
    const matrix = ladeAbdeckung();
    assert.ok(matrix);

    const html = alsHtml(
      baueBerichtsdaten({
        ergebnis: beispiel(),
        kriterien: KRITERIEN_22,
        erstelltAm: '2026-08-19T12:00:00.000Z',
        abdeckung: matrix,
      }),
      { alleAufgeklappt: true },
    );

    assert.match(html, /Gemessene Abdeckung/);
    assert.match(html, /Referenzseiten mit bekannter Fehlerlage/);
  });
});

// ------------------------------------------------------------- Die Route

describe('Route /api/abdeckung', { timeout: 30_000 }, () => {
  let server: FastifyInstance;
  let db: Database;

  before(() => {
    db = oeffneDatenbank({ pfad: ':memory:' });
    server = baueServer({ db, katalog, protokoll: new Protokoll({ datei: null, konsoleAb: null }) });
  });

  after(async () => {
    await server.close();
    db.close();
  });

  it('liefert die Matrix', async () => {
    const antwort = await server.inject({ method: 'GET', url: '/api/abdeckung' });
    assert.equal(antwort.statusCode, 200);

    const koerper = antwort.json() as { matrix: Abdeckungsmatrix | null; hinweis?: string };
    assert.ok(koerper.matrix, 'Ohne Messung fehlt die Grundlage — "npm run verifikation" erzeugt sie.');
    assert.ok(koerper.matrix.kennzahlen.kriterienGesamt > 0);
  });
});

// -------------------------------------------------- Grundlagen konsistent

describe('Referenzseiten und Sollwerte', () => {
  const soll = JSON.parse(
    fs.readFileSync(path.join(WURZEL, 'test/referenzseiten/soll.json'), 'utf8'),
  ) as {
    standard: '2.1' | '2.2';
    seiten: Record<string, { erwarteteVerstoesse: { kriterium: string; stufe: string }[] }>;
    gruppen?: Record<string, { seiten: string[]; erwarteteVerstoesse: { kriterium: string }[] }>;
  };

  it('nennt nur Kriterien, die es im Katalog gibt', () => {
    // Beide Fassungen: Ein Eintrag mit `nurStandard: "2.1"` — derzeit 4.1.1 —
    // gehoert dazu, obwohl gegen 2.2 gemessen wird.
    const bekannt = new Set([
      ...katalog.fuerStandard('2.1').map((k) => k.id),
      ...katalog.fuerStandard('2.2').map((k) => k.id),
    ]);
    const alle = [
      ...Object.values(soll.seiten).flatMap((s) => s.erwarteteVerstoesse),
      ...Object.values(soll.gruppen ?? {}).flatMap((g) => g.erwarteteVerstoesse),
    ];

    assert.ok(alle.length > 0);
    for (const verstoss of alle) {
      assert.ok(bekannt.has(verstoss.kriterium), `soll.json nennt das unbekannte Kriterium ${verstoss.kriterium}`);
    }
  });

  it('verweist nur auf Dateien, die es gibt', () => {
    for (const datei of Object.keys(soll.seiten)) {
      assert.ok(
        fs.existsSync(path.join(WURZEL, 'test/referenzseiten', datei)),
        `Referenzseite ${datei} fehlt`,
      );
    }
    for (const gruppe of Object.values(soll.gruppen ?? {})) {
      for (const datei of gruppe.seiten) {
        assert.ok(fs.existsSync(path.join(WURZEL, 'test/referenzseiten', datei)), `Referenzseite ${datei} fehlt`);
      }
    }
  });

  /*
    Zu jeder mangelhaften Seite gehoert eine saubere. Ohne sie waere nur
    messbar, was gefunden wird — nicht, was faelschlich gemeldet wird. Und
    genau das ist die Zahl, die ein Werkzeug unbrauchbar macht.
  */
  it('stellt jeder mangelhaften Seite eine saubere Gegenprobe zur Seite', () => {
    for (const datei of Object.keys(soll.seiten)) {
      if (!datei.includes('mangelhaft')) continue;
      const gegenprobe = datei.replace('mangelhaft', 'sauber');
      assert.ok(soll.seiten[gegenprobe], `Zu ${datei} fehlt die Gegenprobe ${gegenprobe}`);
      assert.equal(soll.seiten[gegenprobe]?.erwarteteVerstoesse.length, 0);
    }
    for (const name of Object.keys(soll.gruppen ?? {})) {
      if (!name.includes('mangelhaft')) continue;
      assert.ok(soll.gruppen?.[name.replace('mangelhaft', 'sauber')], `Zu ${name} fehlt die saubere Gruppe`);
    }
  });
});

describe('Testsatz des Modellvergleichs (PRD 10.1)', () => {
  const satz = JSON.parse(fs.readFileSync(path.join(WURZEL, 'test/modellsatz/satz.json'), 'utf8')) as {
    pruefungen: Record<
      string,
      {
        kriterium: string;
        art: 'buendel' | 'folge' | 'seite';
        faelle: {
          soll?: string;
          elemente?: { soll: string }[];
        }[];
      }
    >;
  };

  it('nennt nur Pruefungen, die es in prompts/stufe2.md gibt', () => {
    const prompts = ladePrompts();
    for (const [id, pruefung] of Object.entries(satz.pruefungen)) {
      const prompt = prompts.nachId.get(id);
      assert.ok(prompt, `Der Modellsatz nennt die unbekannte Pruefung "${id}"`);
      assert.equal(prompt.kriterium, pruefung.kriterium, `Kriterium zu "${id}" weicht vom Prompt ab`);
    }
  });

  it('deckt jede Pruefung aus prompts/stufe2.md ab', () => {
    for (const id of ladePrompts().nachId.keys()) {
      assert.ok(satz.pruefungen[id], `Zur Pruefung "${id}" gibt es keinen Testfall`);
    }
  });

  /*
    „unsicher" ist eine gemessene Kenngroesse, nie ein Sollwert. Wer es als
    Soll zulaesst, macht aus dem Ausweichen des Modells ein bestandenes
    Ergebnis — und misst damit genau das Gegenteil dessen, was gemessen
    werden soll.
  */
  it('kennt als Sollurteil nur "ok" und "problem"', () => {
    for (const [id, pruefung] of Object.entries(satz.pruefungen)) {
      const urteile = pruefung.faelle.flatMap((f) => (f.elemente ? f.elemente.map((e) => e.soll) : [f.soll]));
      for (const urteil of urteile) {
        assert.ok(urteil === 'ok' || urteil === 'problem', `"${id}" nennt das Sollurteil "${urteil}"`);
      }
    }
  });

  it('stellt jeder Pruefung beide Sorten von Faellen', () => {
    for (const [id, pruefung] of Object.entries(satz.pruefungen)) {
      const urteile = pruefung.faelle.flatMap((f) => (f.elemente ? f.elemente.map((e) => e.soll) : [f.soll]));
      assert.ok(urteile.includes('problem'), `"${id}" hat keinen einzigen Verstossfall`);
      assert.ok(urteile.includes('ok'), `"${id}" hat keinen einzigen einwandfreien Fall — Fehlalarme waeren nicht messbar`);
    }
  });
});
