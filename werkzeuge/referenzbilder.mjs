#!/usr/bin/env node
/**
 * Erzeugt die Bilddateien der Referenzseiten.
 *
 *   node werkzeuge/referenzbilder.mjs
 *
 * Die Seiten verwiesen von Anfang an auf `team.jpg`, `trennlinie.png`,
 * `aktion.png` und `captcha.png` — vorhanden war keine davon. Fuer die beiden
 * Testfaelle zu 1.1.1 fiel das nicht auf: Ob ein `alt` fehlt oder den
 * Dateinamen wiederholt, steht im Markup. Fuer 1.4.5 schon: Die Texterkennung
 * lief nie, sie meldete stattdessen "Bild konnte nicht geladen werden". Der
 * Testfall galt als bestanden und haette ebenso bestanden, waere die
 * Texterkennung vollstaendig kaputt gewesen.
 *
 * Die Bilder werden erzeugt und nicht gezeichnet: So steht ihr Inhalt als Text
 * im Quelltext dieser Datei und laesst sich nachlesen, statt in einer
 * Binaerdatei zu verschwinden. Wer sie neu braucht, ruft dieses Werkzeug auf.
 *
 * Nur Playwright, das ohnehin installiert ist — keine Bildbibliothek dafuer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ZIEL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'referenzseiten');

const SCHRIFT = 'Helvetica, Arial, sans-serif';

/**
 * Was in welchem Bild steht.
 *
 * `aktion.png` traegt bewusst **nicht** denselben Wortlaut wie sein
 * alt-Attribut auf `mangelhaft.html` ("20 Prozent Rabatt ..."). Ein Banner
 * schreibt "20 %", kein Mensch setzt dort das Wort aus. Waeren beide
 * wortgleich, pruefte der Testfall die Uebereinstimmung zweier Zeichenketten
 * und nicht die Texterkennung.
 */
const BILDER = [
  {
    datei: 'team.jpg',
    breite: 320,
    hoehe: 200,
    zweck: 'Foto ohne Text — es darf die Texterkennung nicht ausloesen',
    inhalt: `<body style="margin:0;height:200px;background:
        radial-gradient(circle at 30% 35%, #b9c7d6 0 18%, transparent 18%),
        radial-gradient(circle at 50% 30%, #c8d2dd 0 16%, transparent 16%),
        radial-gradient(circle at 70% 35%, #b3c2d2 0 18%, transparent 18%),
        linear-gradient(160deg, #5b6b7d, #8fa1b3)"></body>`,
  },
  {
    datei: 'trennlinie.png',
    breite: 320,
    hoehe: 8,
    zweck: 'schmueckende Linie — zu flach, um Text zu tragen',
    inhalt: `<body style="margin:0;height:8px;background:linear-gradient(90deg,#c9ced6,#8b93a0,#c9ced6)"></body>`,
  },
  {
    datei: 'aktion.png',
    breite: 600,
    hoehe: 120,
    zweck: 'Text als Bild — der eigentliche Testfall zu 1.4.5',
    inhalt: `<body style="margin:0;height:120px;display:flex;align-items:center;justify-content:center;
        background:#fff2cc;border:2px solid #d9a441;box-sizing:border-box;
        font-family:${SCHRIFT};font-size:30px;font-weight:700;color:#1a1a1a">
        20 % Rabatt auf alle Kurse bis 31.12.</body>`,
  },
  {
    datei: 'captcha.png',
    breite: 200,
    hoehe: 60,
    zweck: 'Sicherheitsabfrage — ebenfalls ein Bild eines Textes',
    inhalt: `<body style="margin:0;height:60px;display:flex;align-items:center;justify-content:center;
        background:#eceff3;font-family:${SCHRIFT};font-size:28px;font-weight:700;
        letter-spacing:6px;color:#333;font-style:italic">K7HP2M</body>`,
  },
];

const browser = await chromium.launch();
try {
  for (const bild of BILDER) {
    const seite = await browser.newPage({ viewport: { width: bild.breite, height: bild.hoehe } });
    await seite.setContent(bild.inhalt);

    const jpeg = bild.datei.endsWith('.jpg');
    const daten = await seite.screenshot(jpeg ? { type: 'jpeg', quality: 82 } : { type: 'png' });
    fs.writeFileSync(path.join(ZIEL, bild.datei), daten);
    await seite.close();

    console.log(`${bild.datei.padEnd(16)} ${String(daten.length).padStart(6)} Bytes  — ${bild.zweck}`);
  }
} finally {
  await browser.close();
}
