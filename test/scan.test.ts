/**
 * Vollstaendiger Scan gegen die mitgelieferten Seiten — mit echtem Browser.
 *
 * Das ist der Test, der zaehlt: er prueft, ob Anwendbarkeit, axe-Anbindung,
 * Zuordnung und Statusableitung zusammen ein richtiges Ergebnis ergeben.
 *
 * Bezug: ARCHITEKTUR 9 Schritte 4 bis 8 und "Abnahme von Phase 1 und 2"
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';

import { Browser } from '../src/scan/browser.js';
import { projektWurzel } from '../src/plattform/pfade.js';
import { Katalog } from '../src/katalog/laden.js';
import { Protokoll } from '../src/protokoll.js';
import { fuehreScanAus } from '../src/scan/runner.js';
import { vorhandeneEngines } from '../src/stufe1/index.js';
import type { ScanErgebnis } from '../src/typen/index.js';

const WURZEL = projektWurzel();
const ZEITLIMIT = 120_000;

function adresse(relativ: string): string {
  return pathToFileURL(path.join(WURZEL, relativ)).href;
}

describe('Scan einer Einzelseite', { timeout: ZEITLIMIT }, () => {
  const katalog = Katalog.laden();
  const protokoll = new Protokoll({ datei: null, konsoleAb: null });
  let browser: Browser;

  before(async () => {
    browser = await Browser.starten({ protokoll });
  });

  after(async () => {
    await browser.schliessen();
  });

  async function scanne(datei: string, standard: '2.1' | '2.2' = '2.1'): Promise<ScanErgebnis> {
    return fuehreScanAus({
      seiten: [{ url: adresse(datei) }],
      standard,
      katalog,
      browser,
      protokoll,
    });
  }

  it('findet auf der mangelhaften Seite die eingebauten Verstoesse', async () => {
    const ergebnis = await scanne('test/referenzseiten/mangelhaft.html');
    const seite = ergebnis.seiten[0];

    assert.equal(seite?.zustand, 'fertig');
    const nichtErfuellt = new Set(
      seite!.bewertungen.filter((b) => b.status === 'nicht_erfuellt').map((b) => b.kriterium),
    );

    // Kriterien, die axe zuverlaessig erkennt und die in soll.json stehen.
    for (const kriterium of ['1.1.1', '1.3.1', '1.4.3', '1.4.4', '2.4.3', '3.1.1', '3.3.2', '4.1.2']) {
      assert.ok(nichtErfuellt.has(kriterium), `${kriterium} haette als nicht erfuellt erkannt werden muessen`);
    }
  });

  it('meldet auf der sauberen Seite keinen einzigen Verstoss', async () => {
    const ergebnis = await scanne('test/referenzseiten/sauber.html');
    const verstoesse = ergebnis.seiten[0]!.bewertungen.filter((b) => b.status === 'nicht_erfuellt');
    assert.deepEqual(
      verstoesse.map((b) => `${b.kriterium}: ${b.befunde[0]?.beschreibung ?? ''}`),
      [],
      'jeder Befund auf der sauberen Seite ist ein Fehlalarm',
    );
  });

  it('bewertet jedes Kriterium des Standards mit genau einem Status', async () => {
    const ergebnis = await scanne('test/referenzseiten/sauber.html');
    const bewertungen = ergebnis.seiten[0]!.bewertungen;

    assert.equal(bewertungen.length, katalog.fuerStandard('2.1').length);
    assert.equal(new Set(bewertungen.map((b) => b.kriterium)).size, bewertungen.length);
    for (const bewertung of bewertungen) {
      assert.ok(
        ['erfuellt', 'nicht_erfuellt', 'pruefung_erforderlich', 'nicht_anwendbar'].includes(bewertung.status),
        `unbekannter Status ${bewertung.status}`,
      );
    }
  });

  it('setzt kein erfuellt ohne gelaufene Pruefung', async () => {
    const ergebnis = await scanne('test/referenzseiten/sauber.html');
    const gebaut = vorhandeneEngines();

    for (const bewertung of ergebnis.seiten[0]!.bewertungen) {
      if (bewertung.status !== 'erfuellt') continue;
      const kriterium = katalog.findeKriterium(bewertung.kriterium)!;

      // Ein Kriterium darf nur dann als erfuellt gelten, wenn jede seiner
      // Pruefungen automatisch ist und die zustaendige Engine auch existiert.
      // Sobald eine manuelle Frage oder eine Sprachmodell-Pruefung dazugehoert,
      // bleibt etwas offen — dann ist erfuellt eine Luege.
      for (const pruefung of kriterium.pruefungen) {
        assert.equal(
          pruefung.typ,
          'auto',
          `${bewertung.kriterium} gilt als erfuellt, hat aber eine Pruefung vom Typ "${pruefung.typ}"`,
        );
        if (pruefung.typ !== 'auto') continue;
        assert.ok(
          gebaut.has(pruefung.engine),
          `${bewertung.kriterium} gilt als erfuellt, obwohl die Engine "${pruefung.engine}" fehlt`,
        );
      }

      assert.match(bewertung.herkunft, /^auto\//, `${bewertung.kriterium} traegt die Herkunft "${bewertung.herkunft}"`);
    }
  });

  it('meldet jede Engine des Katalogs als gebaut oder als offen', () => {
    // Sobald der Katalog eine Engine nennt, die es nicht gibt, muessen die
    // betroffenen Kriterien offen bleiben. Faellt dieser Test, ist entweder
    // eine Engine dazugekommen oder eine aus dem Katalog verschwunden.
    const gebaut = vorhandeneEngines();
    const imKatalog = new Set(
      katalog
        .fuerStandard('2.2')
        .flatMap((k) => k.pruefungen)
        .filter((p) => p.typ === 'auto')
        .map((p) => p.engine),
    );

    assert.deepEqual([...imKatalog].sort(), ['axe', 'eigen', 'html', 'ocr', 'pixel', 'sprache']);
    for (const engine of imKatalog) {
      assert.ok(gebaut.has(engine), `Engine "${engine}" steht im Katalog, ist aber nicht gebaut`);
    }
  });

  it('meldet Kriterien ohne Gegenstand als nicht anwendbar (5.5)', async () => {
    const ergebnis = await scanne('test/beispielseiten/ohne-medien.html');
    const nichtAnwendbar = new Set(
      ergebnis.seiten[0]!.bewertungen.filter((b) => b.status === 'nicht_anwendbar').map((b) => b.kriterium),
    );

    // Seite ohne Video und Audio
    for (const kriterium of ['1.2.1', '1.2.2', '1.2.3', '1.2.5']) {
      assert.ok(nichtAnwendbar.has(kriterium), `${kriterium} haette nicht anwendbar sein muessen`);
    }
    // Seite ohne Formular
    assert.ok(nichtAnwendbar.has('3.3.1'), '3.3.1 haette nicht anwendbar sein muessen');
    // Immer anwendbare Kriterien bleiben anwendbar
    assert.ok(!nichtAnwendbar.has('2.4.2'), '2.4.2 gilt fuer jede Seite');
  });

  it('haelt mehrseitig zu beurteilende Kriterien bei einer Einzelseite fuer gegenstandslos', async () => {
    const ergebnis = await scanne('test/referenzseiten/mangelhaft.html', '2.2');
    const status = (id: string) => ergebnis.seiten[0]!.bewertungen.find((b) => b.kriterium === id)?.status;
    for (const kriterium of ['2.4.5', '3.2.3', '3.2.4', '3.2.6']) {
      assert.equal(status(kriterium), 'nicht_anwendbar', `${kriterium} ist allein an einer Seite nicht beurteilbar`);
    }
  });

  it('bewertet 4.1.1 je nach gewaehltem Standard', async () => {
    const unter21 = await scanne('test/referenzseiten/mangelhaft.html', '2.1');
    const unter22 = await scanne('test/referenzseiten/mangelhaft.html', '2.2');

    assert.ok(unter21.seiten[0]!.bewertungen.some((b) => b.kriterium === '4.1.1'));
    assert.ok(!unter22.seiten[0]!.bewertungen.some((b) => b.kriterium === '4.1.1'));
  });

  it('bricht bei einer nicht erreichbaren Seite nicht ab (5.6)', async () => {
    const ergebnis = await fuehreScanAus({
      seiten: [{ url: 'http://127.0.0.1:1/gibt-es-nicht' }, { url: adresse('test/beispielseiten/ohne-medien.html') }],
      standard: '2.1',
      katalog,
      browser,
      protokoll,
    });

    assert.equal(ergebnis.seiten.length, 2);
    assert.equal(ergebnis.seiten[0]?.zustand, 'fehler');
    assert.ok(ergebnis.seiten[0]?.fehler);
    assert.equal(ergebnis.seiten[0]?.bewertungen.length, 0);
    assert.equal(ergebnis.seiten[1]?.zustand, 'fertig');
  });

  it('verdichtet ueber mehrere Seiten hinweg', async () => {
    const ergebnis = await fuehreScanAus({
      seiten: [
        { url: adresse('test/referenzseiten/sauber.html'), bezeichnung: 'sauber' },
        { url: adresse('test/referenzseiten/mangelhaft.html'), bezeichnung: 'mangelhaft' },
      ],
      standard: '2.1',
      betriebsart: 'profil',
      katalog,
      browser,
      protokoll,
    });

    const projekt = ergebnis.projektebene.find((p) => p.kriterium === '1.1.1');
    assert.equal(projekt?.status, 'nicht_erfuellt');
    assert.equal(projekt?.acr, 'teilweise_unterstuetzt', 'nur eine von zwei Seiten ist betroffen');
    assert.deepEqual(projekt?.betroffeneSeiten.length, 1);
  });
});
