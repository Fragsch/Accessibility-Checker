/**
 * Zustands-Traversierung an Formularen (A-07).
 *
 *   3.3.1 Fehlererkennung   — wird ein Fehler in Textform benannt?
 *   3.3.3 Fehlerempfehlung  — steht dabei, wie er zu beheben ist?
 *
 * Beide Fragen lassen sich am ruhenden DOM nicht beantworten: Fehlermeldungen
 * gibt es erst, wenn ein Fehler gemacht wurde. Also wird einer gemacht — ein
 * leeres Pflichtformular wird abgeschickt und danach nachgesehen, was sich
 * geaendert hat.
 *
 * **Gegen Regel 2 wird dabei nicht verstossen:** Es werden keine Werte
 * eingetragen. Abgeschickt wird das leere Formular, und zwar nur, wenn es
 * erkennbar keine Daten verschickt (kein Kauf, keine Anmeldung, keine
 * Loeschung). Formulare mit Passwortfeldern werden grundsaetzlich ausgelassen.
 */

import type { EngineKontext, RohBefund, RohHinweis } from '../engine.js';

export const FORMULAR_REGELN = ['fehlermeldung-erkennbar', 'fehlermeldung-vorhanden'] as const;

/** Formulare, die auf keinen Fall abgeschickt werden. */
const HEIKEL = /anmeld|login|signin|sign-in|passwor|kauf|bestell|checkout|zahlung|payment|loesch|delete|abmeld/i;

/*
  Woran eine Fehlermeldung als solche zu erkennen ist.

  „unvollstaendig" und „nicht ausgefuellt" sind in Phase 8 dazugekommen. Die
  Referenzseite `fehlerempfehlung-sauber.html` meldet vorbildlich
  „Die Buchung ist unvollstaendig. So wird sie vollstaendig: …" — und wurde
  trotzdem als 3.3.1 gefuehrt, weil kein Wort der Liste vorkam. Ein Fehlalarm,
  der ausgerechnet die saubere Loesung bestraft haette.

  Steht als Modulkonstante und nicht mehr in der Funktion: Seit auch der Text
  eines `role="alert"` daran gemessen wird, brauchen ihn zwei Stellen.
*/
const HINWEIS_AUF_FEHLER =
  /pflicht|erforderlich|ausf(ü|ue)llen|fehlt|fehlen|unvollst(ä|ae)ndig|nicht ausgef(ü|ue)llt|ung(ü|ue)ltig|nicht korrekt|bitte geben|bitte w(ä|ae)hlen|bitte erg(ä|ae)nzen|required|invalid|error/i;

interface FormularBefund {
  meldungGefunden: boolean;
  meldungstext: string;
  mitEmpfehlung: boolean;
  selektor: string;
}

export async function pruefeFormulare(
  kontext: EngineKontext,
  gewuenschteRegeln: readonly string[],
): Promise<{ befunde: RohBefund[]; hinweise: RohHinweis[]; ausgefuehrteRegeln: string[] }> {
  const regeln = FORMULAR_REGELN.filter((r) => gewuenschteRegeln.includes(r));
  if (regeln.length === 0) return { befunde: [], hinweise: [], ausgefuehrteRegeln: [] };

  const seite = kontext.seite;
  const befunde: RohBefund[] = [];
  const hinweise: RohHinweis[] = [];

  const kandidaten = await findeKandidaten(seite);

  if (kandidaten.length === 0) {
    hinweise.push({
      regelId: regeln[0] ?? 'fehlermeldung-erkennbar',
      engine: 'eigen',
      text:
        'Auf der Seite steht kein Formular, das gefahrlos mit leeren Pflichtfeldern abgeschickt werden koennte. ' +
        'Die Fehlerbehandlung wurde daher nicht ausgeloest — bitte von Hand pruefen.',
    });
    return { befunde, hinweise, ausgefuehrteRegeln: [] };
  }

  const urlVorher = seite.url();
  let ergebnis: FormularBefund | null = null;

  try {
    ergebnis = await sendeLeerAb(seite, kandidaten[0]!);
  } catch (e) {
    kontext.protokoll.warnung('eigen', `Formularpruefung abgebrochen: ${(e as Error).message}`);
  }

  // Ist die Seite gewechselt, ist der Zustand fuer alles Weitere unbrauchbar.
  if (seite.url() !== urlVorher) {
    await seite.goto(urlVorher, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await seite.waitForTimeout(300).catch(() => undefined);
  }

  if (!ergebnis) {
    hinweise.push({
      regelId: regeln[0] ?? 'fehlermeldung-erkennbar',
      engine: 'eigen',
      text: 'Das Formular liess sich nicht abschicken. Die Fehlerbehandlung wurde nicht geprueft.',
    });
    return { befunde, hinweise, ausgefuehrteRegeln: [] };
  }

  if (regeln.includes('fehlermeldung-erkennbar') && !ergebnis.meldungGefunden) {
    befunde.push({
      regelId: 'fehlermeldung-erkennbar',
      engine: 'eigen',
      selektor: ergebnis.selektor,
      htmlAusschnitt: null,
      beschreibung:
        'Das Formular wurde mit leeren Pflichtfeldern abgeschickt, danach war keine Fehlermeldung in Textform ' +
        'zu finden. Ein Fehler muss benannt werden — eine rote Umrandung allein genuegt nicht.',
      schwere: 'ernst',
    });
  }

  if (regeln.includes('fehlermeldung-vorhanden') && ergebnis.meldungGefunden && !ergebnis.mitEmpfehlung) {
    befunde.push({
      regelId: 'fehlermeldung-vorhanden',
      engine: 'eigen',
      selektor: ergebnis.selektor,
      htmlAusschnitt: null,
      beschreibung:
        `Die Fehlermeldung lautet "${ergebnis.meldungstext}" und sagt nur, dass etwas fehlt — nicht, was ` +
        'zu tun ist. Wenn die richtige Eingabe bekannt ist, muss sie vorgeschlagen werden.',
      schwere: 'maessig',
    });
  }

  return { befunde, hinweise, ausgefuehrteRegeln: [...regeln] };
}

/** Sucht Formulare, die sich gefahrlos leer abschicken lassen. */
async function findeKandidaten(seite: import('playwright').Page): Promise<string[]> {
  return seite
    .evaluate((heikelQuelle) => {
      const heikel = new RegExp(heikelQuelle, 'i');

      function selektorFuer(el: Element, nummer: number): string {
        return el.id ? `#${CSS.escape(el.id)}` : `form:nth-of-type(${nummer + 1})`;
      }

      const ergebnis: string[] = [];

      Array.from(document.querySelectorAll('form')).forEach((formular, nummer) => {
        // Keine Zugangsdaten anfassen (Regel 2, S-03).
        if (formular.querySelector('input[type=password]')) return;

        const kennzeichnung = `${formular.id} ${formular.className} ${formular.getAttribute('action') ?? ''} ${
          formular.getAttribute('name') ?? ''
        } ${formular.textContent ?? ''}`.slice(0, 400);
        if (heikel.test(kennzeichnung)) return;

        // Nur Formulare mit Pflichtfeldern erzeugen ueberhaupt einen Fehler.
        if (!formular.querySelector('[required], [aria-required=true]')) return;

        // Suchformulare mit einem einzigen Feld sind uninteressant.
        const felder = formular.querySelectorAll('input:not([type=hidden]), select, textarea');
        if (felder.length < 2) return;

        if (!formular.querySelector('button, input[type=submit]')) return;

        ergebnis.push(selektorFuer(formular, nummer));
      });

      return ergebnis;
    }, HEIKEL.source)
    .catch(() => []);
}

/**
 * Schickt das Formular leer ab und sieht nach, was danach anders ist.
 *
 * Verglichen wird der Text vorher und nachher: Was neu hinzugekommen ist, ist
 * die Reaktion des Formulars. Das ist verlaesslicher, als nach bestimmten
 * Klassennamen zu suchen — die heissen auf jeder Seite anders.
 *
 * Der Vergleich allein genuegt aber nicht, und das war lange nicht zu sehen:
 * Stand die Fehlermeldung schon vor dem Absenden da — weil das Formular vorher
 * bereits einmal abgewiesen wurde —, dann aendert derselbe Fehler ein zweites
 * Mal nichts am Text. Die Regel meldete daraufhin, es gebe keine Meldung, und
 * zwar ausgerechnet bei einem Formular, das gerade eine anzeigte.
 *
 * Aufgefallen ist das an der eigenen Oberflaeche, nachdem sie ihr erstes
 * Pflichtfeld bekam: Bis dahin hatte sie keines, und ein Formular ohne
 * Pflichtfeld sieht diese Regel gar nicht erst an.
 *
 * Deshalb wird zweitens nach einer *ausgezeichneten* Fehlermeldung gesehen —
 * `aria-errormessage` an einem als ungueltig markierten Feld, sonst ein
 * sichtbares `role="alert"`. Das ist keine Aufweichung: Gesucht wird dabei
 * nicht nach irgendeinem Text, sondern nach genau den Auszeichnungen, mit
 * denen ein Fehler programmatisch benannt wird. Ein Formular ohne
 * Fehlerbehandlung hat sie nicht.
 */
async function sendeLeerAb(seite: import('playwright').Page, selektor: string): Promise<FormularBefund | null> {
  const textVorher = await seite.evaluate(() => document.body.innerText);

  const abgeschickt = await seite
    .evaluate((sel) => {
      const formular = document.querySelector(sel);
      if (!formular) return false;
      const knopf = formular.querySelector('button:not([type=button]), input[type=submit]');
      if (!(knopf instanceof HTMLElement)) return false;
      knopf.click();
      return true;
    }, selektor)
    .catch(() => false);

  if (!abgeschickt) return null;

  await seite.waitForTimeout(700);

  const textNachher = await seite.evaluate(() => document.body.innerText);
  const neu = neuerText(textVorher, textNachher);

  /*
    „unvollstaendig" und „nicht ausgefuellt" sind in Phase 8 dazugekommen. Die
    Referenzseite `fehlerempfehlung-sauber.html` meldet vorbildlich
    „Die Buchung ist unvollstaendig. So wird sie vollstaendig: …" — und wurde
    trotzdem als 3.3.1 gefuehrt, weil kein Wort der Liste vorkam. Ein Fehlalarm,
    der ausgerechnet die saubere Loesung bestraft haette.
  */
  const HINWEIS_AUF_EMPFEHLUNG =
    /bitte|beispiel|format|mindestens|h(ö|oe)chstens|muss .*(enthalten|beginnen|bestehen)|z\.\s?B\.|etwa|geben Sie/i;

  const meldungszeile = neu.find((zeile) => HINWEIS_AUF_FEHLER.test(zeile));

  // Auch die eingebaute Pruefung des Browsers zaehlt: sie meldet in Textform.
  const browserMeldung = await seite
    .evaluate((sel) => {
      const formular = document.querySelector(sel);
      if (!formular) return '';
      for (const feld of Array.from(formular.querySelectorAll('input, select, textarea'))) {
        const meldung = (feld as HTMLInputElement).validationMessage;
        if (meldung) return meldung;
      }
      return '';
    }, selektor)
    .catch(() => '');

  const ausgezeichnete = meldungszeile || browserMeldung ? '' : await ausgezeichneteFehlermeldung(seite, selektor);

  const text = meldungszeile ?? (browserMeldung || ausgezeichnete);

  return {
    meldungGefunden: Boolean(text),
    meldungstext: (text || '').trim().slice(0, 120),
    mitEmpfehlung: Boolean(text) && HINWEIS_AUF_EMPFEHLUNG.test(text),
    selektor,
  };
}

/**
 * Eine Fehlermeldung, die nicht neu ist, aber ausdruecklich als solche
 * ausgezeichnet.
 *
 * Zwei Wege, in dieser Reihenfolge:
 *
 * 1. Ein Feld mit `aria-invalid="true"`, dessen `aria-errormessage` oder
 *    `aria-describedby` auf einen Text zeigt. Das ist die ausdrueckliche
 *    Zuordnung „dieser Text ist der Fehler dieses Feldes" — deutlicher laesst
 *    sich 3.3.1 nicht erfuellen, und ein Wortfilter waere hier fehl am Platz:
 *    Was das Formular selbst als Fehlermeldung ausweist, ist eine.
 * 2. Sonst ein sichtbares `role="alert"`. Das kann auch eine Erfolgsmeldung
 *    tragen, deshalb muss der Text hier durch den Wortfilter.
 *
 * Unsichtbares zaehlt in beiden Faellen nicht: Eine Meldung, die niemand
 * sieht, ist keine — auch wenn sie im Baum steht.
 */
async function ausgezeichneteFehlermeldung(
  seite: import('playwright').Page,
  selektor: string,
): Promise<string> {
  return seite
    .evaluate(
      ({ sel, wortfilterQuelle }) => {
        const wortfilter = new RegExp(wortfilterQuelle, 'i');

        function sichtbarerText(el: Element | null): string {
          if (!(el instanceof HTMLElement)) return '';
          if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return '';
          return (el.innerText || '').trim();
        }

        const formular = document.querySelector(sel);
        if (!formular) return '';

        for (const feld of Array.from(formular.querySelectorAll('[aria-invalid="true"]'))) {
          const verweise = `${feld.getAttribute('aria-errormessage') ?? ''} ${
            feld.getAttribute('aria-describedby') ?? ''
          }`.trim();
          for (const id of verweise.split(/\s+/).filter(Boolean)) {
            const text = sichtbarerText(document.getElementById(id));
            if (text) return text;
          }
        }

        // Der Alarm darf auch ausserhalb des Formulars stehen — manche
        // Oberflaechen sammeln Meldungen an einer Stelle der Seite.
        for (const alarm of Array.from(document.querySelectorAll('[role="alert"]'))) {
          const text = sichtbarerText(alarm);
          if (text && wortfilter.test(text)) return text;
        }

        return '';
      },
      { sel: selektor, wortfilterQuelle: HINWEIS_AUF_FEHLER.source },
    )
    .catch(() => '');
}

/** Zeilen, die nach dem Absenden neu hinzugekommen sind. */
function neuerText(vorher: string, nachher: string): string[] {
  const alt = new Set(
    vorher
      .split('\n')
      .map((z) => z.trim())
      .filter(Boolean),
  );
  return nachher
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z.length > 3 && !alt.has(z));
}
