/**
 * Eigene Prüfungen, die allein aus dem gerenderten DOM zu beantworten sind.
 *
 * Alles hier laeuft in einem einzigen Durchgang im Browser. Ein Aufruf statt
 * fuenfzehn spart nicht nur Zeit — die Seite bleibt dabei auch unveraendert,
 * was fuer alles Weitere (Tastatur, Viewports, Formulare) die Voraussetzung ist.
 *
 * Grundhaltung bei jeder dieser Regeln: Im Zweifel kein Befund. Ein Fehlalarm
 * kostet Vertrauen und Zeit; eine Luecke wird von der manuellen Stufe
 * aufgefangen. Zielwert ist eine Fehlalarmquote unter 5 Prozent (PRD 10).
 */

import type { Schwere } from '../../typen/index.js';
import type { EngineKontext, RohBefund } from '../engine.js';

/** Regeln, die dieses Modul abdeckt. */
export const DOM_REGELN = [
  'klickbar-ohne-fokus',
  'statusmeldung-live-region',
  'auto-submit-bei-aenderung',
  'dauerhafte-animation',
  'bewegungssensoren',
  'captcha-erkennung',
  'einfuegen-unterbunden',
  'tooltip-escape',
  'tooltip-hoverbar',
  'zielgroesse-24',
  'dom-reihenfolge-vs-visuell',
  'ziehen-ohne-alternative',
] as const;

interface RohTreffer {
  regelId: string;
  selektor: string;
  html: string;
  beschreibung: string;
  schwere: Schwere;
}

export async function pruefeDom(
  kontext: EngineKontext,
  gewuenschteRegeln: readonly string[],
): Promise<{ befunde: RohBefund[]; ausgefuehrteRegeln: string[] }> {
  const regeln = DOM_REGELN.filter((r) => gewuenschteRegeln.includes(r));
  if (regeln.length === 0) return { befunde: [], ausgefuehrteRegeln: [] };

  const treffer = await kontext.seite.evaluate(sammleImBrowser, regeln as unknown as string[]).catch((e: unknown) => {
    kontext.protokoll.warnung('eigen', `DOM-Pruefungen fehlgeschlagen: ${(e as Error).message}`);
    return null;
  });

  if (treffer === null) return { befunde: [], ausgefuehrteRegeln: [] };

  return {
    befunde: treffer.map((t) => ({
      regelId: t.regelId,
      engine: 'eigen' as const,
      selektor: t.selektor,
      htmlAusschnitt: t.html,
      beschreibung: t.beschreibung,
      schwere: t.schwere,
      breite: kontext.viewport.breite,
    })),
    ausgefuehrteRegeln: [...regeln],
  };
}

/**
 * Der Teil, der im Browser laeuft.
 *
 * Muss in sich geschlossen sein — er wird als Zeichenkette uebertragen und hat
 * keinen Zugriff auf irgendetwas ausserhalb.
 */
function sammleImBrowser(gewuenscht: string[]): RohTreffer[] {
  const treffer: RohTreffer[] = [];
  const aktiv = (regel: string): boolean => gewuenscht.includes(regel);

  // ------------------------------------------------------------- Werkzeug

  function selektorFuer(element: Element): string {
    if (element.id) return `#${CSS.escape(element.id)}`;

    const teile: string[] = [];
    let lauf: Element | null = element;
    while (lauf && teile.length < 4 && lauf !== document.documentElement) {
      let teil = lauf.tagName.toLowerCase();
      const klasse = Array.from(lauf.classList).find((k) => !/^\d/.test(k));
      if (klasse) teil += `.${CSS.escape(klasse)}`;
      else if (lauf.parentElement) {
        const geschwister = Array.from(lauf.parentElement.children).filter((g) => g.tagName === lauf!.tagName);
        if (geschwister.length > 1) teil += `:nth-of-type(${geschwister.indexOf(lauf) + 1})`;
      }
      teile.unshift(teil);
      if (lauf.id) {
        teile[0] = `#${CSS.escape(lauf.id)}`;
        break;
      }
      lauf = lauf.parentElement;
    }
    return teile.join(' > ');
  }

  function ausschnitt(element: Element): string {
    return element.outerHTML.replace(/\s+/g, ' ').slice(0, 300);
  }

  function sichtbar(element: Element): boolean {
    const stil = getComputedStyle(element);
    if (stil.display === 'none' || stil.visibility === 'hidden' || stil.opacity === '0') return false;
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false;

    /*
      Zugeklappte `details` verbergen ihren Inhalt — aber nicht so, dass es an
      den Massen ablesbar waere: Chromium blendet ihn ueber
      `content-visibility` aus, und `getBoundingClientRect` liefert fuer die
      Kinder weiterhin Werte. Ohne diese Ausnahme gelten sie als sichtbar und
      stehen an einer Stelle, an der nichts zu sehen ist.

      Das trifft nicht nur diesen Bericht: Aufklappbare Navigationen, FAQ-Listen
      und Filterbereiche sind Alltag. Die Regel zur Lesereihenfolge (1.3.2)
      meldete dort reihenweise Spruenge, die niemand sieht — ein Fehlalarm auf
      jeder zweiten Seite. Gefunden hat ihn die eigene Pruefung am erzeugten
      Bericht.
    */
    const zugeklappt = element.closest('details:not([open])');
    if (zugeklappt && element.closest('summary') === null) return false;

    const masse = element.getBoundingClientRect();
    return masse.width > 0 && masse.height > 0;
  }

  function melde(regelId: string, element: Element, beschreibung: string, schwere: Schwere): void {
    treffer.push({ regelId, selektor: selektorFuer(element), html: ausschnitt(element), beschreibung, schwere });
  }

  const FOKUSSIERBAR =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable=""], [contenteditable=true]';

  function istFokussierbar(element: Element): boolean {
    if (element.matches(FOKUSSIERBAR)) return true;
    const tabindex = element.getAttribute('tabindex');
    return tabindex !== null && tabindex !== '-1';
  }

  // ----------------------------------------- 2.1.1 klickbar ohne Tastatur

  if (aktiv('klickbar-ohne-fokus')) {
    const ROLLEN_MIT_BEDIENUNG = ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'option'];

    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (!sichtbar(element)) continue;
      if (istFokussierbar(element)) continue;

      const rolle = element.getAttribute('role');
      const hatKlickAttribut = element.hasAttribute('onclick');
      const hatBedienRolle = rolle !== null && ROLLEN_MIT_BEDIENUNG.includes(rolle);

      // Ein Klickbehandler auf einem umschliessenden Bereich ist Alltag und
      // kein Verstoss — gemeldet wird nur, was sich selbst als Bedienelement
      // ausgibt oder unmittelbar auf Klicks reagiert.
      if (!hatKlickAttribut && !hatBedienRolle) continue;

      // Enthaelt das Element ein echtes Bedienelement, ist die Tastatur bedient.
      if (element.querySelector(FOKUSSIERBAR)) continue;

      melde(
        'klickbar-ohne-fokus',
        element,
        hatBedienRolle
          ? `Das Element gibt sich als "${rolle}" aus, ist aber nicht mit der Tastatur erreichbar. ` +
              'Es braucht tabindex="0" und eine Behandlung von Eingabe- und Leertaste — oder besser ein <button>.'
          : 'Das Element reagiert auf Klicks, ist aber nicht mit der Tastatur erreichbar. ' +
              'Wer keine Maus benutzt, kann diese Funktion nicht ausloesen.',
        'ernst',
      );
    }
  }

  // ------------------------------------------ 4.1.3 Statusmeldungen

  if (aktiv('statusmeldung-live-region')) {
    /*
      Genaue Klassennamen, keine Teilzeichenketten.

      `[class*="status"]` trifft auch `status--nicht_erfuellt` und damit jede
      Zustandsauszeichnung nach BEM-Art. In der eigenen Oberflaeche waren das
      vier Zaehlkacheln und zwanzig Zeilen einer Ergebnisliste — allesamt
      Fehlalarme. Eine Statusmeldung traegt den Namen als eigenstaendige Klasse.
    */
    const MELDUNGSKLASSEN = [
      'alert', 'meldung', 'notification', 'toast', 'snackbar', 'flash',
      'error', 'fehler', 'success', 'erfolg', 'warning', 'warnung',
      'message', 'nachricht', 'status',
    ];
    const MIT_INHALT = MELDUNGSKLASSEN.map((k) => `.${k}`).join(', ');

    // Bereiche, deren Benennung eindeutig auf Statusmeldungen zeigt. Sie
    // zaehlen auch dann, wenn sie beim Laden noch leer sind — genau so sieht
    // ein Behaelter aus, den JavaScript spaeter fuellt. Das ist der Regelfall
    // und nicht die Ausnahme: Beim Laden gibt es noch nichts zu melden.
    //
    // Bewusst ohne "hinweis": Im Deutschen traegt gewoehnlicher Fliesstext
    // diese Klasse — ein Absatz mit einer Anmerkung ist keine Statusmeldung.
    // Der erste Entwurf hat damit auf der sauberen Referenzseite zwei
    // Fehlalarme erzeugt.
    const EINDEUTIG_BENANNT = [
      '[id*="status" i]', '[id*="meldung" i]', '[id*="alert" i]',
      '[id*="fehler" i]', '[id*="error" i]', '[id*="notification" i]',
      '.status', '.meldung', '.alert',
    ].join(', ');

    /*
      "Anmeldung" enthaelt "meldung" — und eine Anmeldemaske ist keine
      Statusmeldung.

      Ohne diese Ausnahme meldet die Regel auf jeder deutschen Seite mit einer
      Anmeldung einen Fehlalarm; in der eigenen Oberflaeche traf es den
      Hilfetext unter dem Ankreuzfeld fuer geschuetzte Bereiche. Dasselbe gilt
      fuer "Abmeldung" und "Ummeldung". "Rueckmeldung" steht bewusst nicht
      hier: das ist tatsaechlich eine Meldung.

      Faellt ein Element ausserdem ueber eine Meldungsklasse oder eine andere
      Kennung auf, bleibt es Kandidat — die Ausnahme gilt nur, wenn "meldung"
      der einzige Anlass war.
    */
    const ANDERER_ANLASS = [
      MIT_INHALT,
      '[id*="status" i]', '[id*="alert" i]', '[id*="fehler" i]',
      '[id*="error" i]', '[id*="notification" i]',
    ].join(', ');
    const istAnmeldung = (element: Element): boolean =>
      /(an|ab|um)meldung/i.test(element.id) && !element.matches(ANDERER_ANLASS);

    /*
      Ein Text, auf den ein Eingabefeld selbst zeigt, ist keine Statusmeldung.

      4.1.3 gilt fuer Meldungen, die *ohne* Fokuswechsel bemerkt werden
      muessen — das steht so in der Begriffsbestimmung. Zeigt ein Feld ueber
      `aria-describedby` oder `aria-errormessage` auf diesen Text, wird er mit
      dem Feld vorgelesen, und Formulare setzen den Fokus beim Abweisen genau
      dorthin. Hier zusaetzlich `role="alert"` zu verlangen, brachte denselben
      Satz zweimal: einmal als Alarm, einmal als Beschreibung des Feldes.

      Verlangt wird die ausdrueckliche Zuordnung durch ein Bedienelement, nicht
      blosse Naehe: Ein Text neben einem Eingabefeld, auf den nichts zeigt,
      bleibt ein Fund. Und die Ausnahme gilt nur fuer Formularfelder — ein
      beliebiges Element mit `aria-describedby` sagt nichts darueber aus, ob
      der beschriebene Text sich aendert.

      Gefunden an der eigenen Oberflaeche, nachdem deren Fehlermeldungen von
      einer Stelle je Formular an ihr jeweiliges Feld gewandert sind.
    */
    const FELD_MIT_BESCHREIBUNG = ['input', 'select', 'textarea']
      .flatMap((tag) => [`${tag}[aria-describedby]`, `${tag}[aria-errormessage]`])
      .join(', ');
    const istFeldbeschreibung = (element: Element): boolean => {
      if (!element.id) return false;
      return Array.from(document.querySelectorAll(FELD_MIT_BESCHREIBUNG)).some((feld) =>
        `${feld.getAttribute('aria-describedby') ?? ''} ${feld.getAttribute('aria-errormessage') ?? ''}`
          .split(/\s+/)
          .includes(element.id),
      );
    };

    const behandelt = new Set<Element>();
    const kandidaten = Array.from(document.querySelectorAll(`${MIT_INHALT}, ${EINDEUTIG_BENANNT}`)).filter(
      (element) => !istAnmeldung(element),
    );

    /*
      Wie oft kommt dieselbe Klassenkombination vor?

      Eine Statusmeldung gibt es einmal. Zwanzigmal dieselbe Klasse ist eine
      Liste — im eigenen Werkzeug etwa die Statusanzeige je Erfolgskriterium.
      Die Selbstpruefung hat genau diesen Fehlalarm zutage gefoerdert: zwanzig
      Meldungen fuer zwanzig Zeilen einer Ergebnisliste.
    */
    // Gruppiert wird ueber die erste Klasse, nicht ueber die ganze Klassenliste:
    // "status status--erfuellt" und "status status--nicht_erfuellt" sind
    // dasselbe Muster mit unterschiedlicher Auspraegung.
    const musterVon = (element: Element): string =>
      `${element.tagName}.${element.className.toString().trim().split(/\s+/)[0] ?? ''}`;

    const haeufigkeit = new Map<string, number>();
    for (const element of kandidaten) {
      const schluessel = musterVon(element);
      haeufigkeit.set(schluessel, (haeufigkeit.get(schluessel) ?? 0) + 1);
    }

    for (const element of kandidaten) {
      if (behandelt.has(element)) continue;
      behandelt.add(element);

      if (element.closest('[aria-live], [role=status], [role=alert], [role=log], output')) continue;

      /*
        `role="note"` ist die ausdrueckliche Auskunft des Autors, dass hier
        beilaeufiger, stehender Inhalt steht — kein Zustand, der sich aendert.
        Erlaeuterungskaesten heissen im Markup fast immer "meldung", "hinweis"
        oder "info"; ohne diese Ausnahme meldet die Regel jeden einzelnen von
        ihnen. Gefunden in Phase 8 an der eigenen Abdeckungsansicht.
      */
      if (element.closest('[role=note]')) continue;

      // Beschreibung eines Feldes, nicht Meldung an die Seite — siehe oben.
      if (istFeldbeschreibung(element)) continue;

      // Wiederkehrendes Muster: kein Einzelfall, also keine Meldung.
      if ((haeufigkeit.get(musterVon(element)) ?? 0) > 4) continue;

      // Eine Meldung ist ein eigener Block, keine Auszeichnung im Fliesstext.
      // Achtung: Ein Kind eines Flex-Behaelters bekommt vom Browser `flex`
      // statt `inline-flex` — an der Anzeigeart allein ist die Unterscheidung
      // deshalb nicht festzumachen. Massgeblich ist, ob das Element die Zeile
      // fuer sich hat.
      const anzeige = getComputedStyle(element).display;
      if (anzeige === 'inline' || anzeige === 'inline-flex' || anzeige === 'contents') continue;

      const eltern = element.parentElement;
      if (eltern) {
        const elternAnzeige = getComputedStyle(eltern).display;
        const nebenMir = Array.from(eltern.children).filter((g) => g !== element);
        const inZeileMitAnderen =
          (elternAnzeige === 'flex' || elternAnzeige === 'inline-flex') && nebenMir.length > 0;
        if (inZeileMitAnderen) continue;
      }

      const text = (element.textContent ?? '').trim();
      const leerUndBenannt = text.length === 0 && element.matches(EINDEUTIG_BENANNT);

      if (!leerUndBenannt) {
        if (!sichtbar(element)) continue;
        if (text.length < 5) continue;

        // Ein Bereich, der die Seite von Anfang an fuellt, ist meist Gestaltung
        // und keine Statusmeldung. Gemeldet wird nur, was klein und beilaeufig
        // ist — dort sitzen die Meldungen, die niemand angesagt bekommt.
        if (element.getBoundingClientRect().height > 300) continue;
      }

      melde(
        'statusmeldung-live-region',
        element,
        leerUndBenannt
          ? 'Dieser Bereich traegt einen Namen wie "status" oder "meldung", ist aber leer und kein ' +
              'Live-Bereich. Wird er spaeter per JavaScript gefuellt, bemerkt eine Sprachausgabe das nicht. ' +
              'Es braucht role="status" oder aria-live.'
          : 'Dieser Bereich sieht nach einer Statusmeldung aus, ist aber kein Live-Bereich. ' +
              'Ohne role="status" oder aria-live bemerkt eine Sprachausgabe die Meldung nicht. ' +
              'Bitte pruefen, ob der Inhalt erst nach einer Eingabe erscheint.',
        'maessig',
      );
    }
  }

  // ------------------------------------------- 3.2.2 Absenden bei Aenderung

  if (aktiv('auto-submit-bei-aenderung')) {
    for (const element of Array.from(document.querySelectorAll('select[onchange], input[onchange]'))) {
      const behandler = element.getAttribute('onchange') ?? '';
      if (!/\.submit\s*\(|\.form\.submit|location\s*=|location\.href|navigate\(/i.test(behandler)) continue;

      melde(
        'auto-submit-bei-aenderung',
        element,
        'Eine Aenderung an diesem Feld loest von sich aus einen Seitenwechsel aus. ' +
          'Wer sich mit der Tastatur durch die Auswahl bewegt, landet dabei auf der ersten Option. ' +
          'Besser: eine Schaltflaeche zum Bestaetigen.',
        'ernst',
      );
    }
  }

  // ----------------------------------------------- 2.2.2 Dauerhafte Bewegung

  if (aktiv('dauerhafte-animation')) {
    function hatSchalter(): boolean {
      const woerter = /pause|anhalten|stopp|stop|beenden/i;
      return Array.from(document.querySelectorAll('button, [role=button], a[href]')).some((b) =>
        woerter.test(`${b.textContent ?? ''} ${b.getAttribute('aria-label') ?? ''}`),
      );
    }

    const schalterDa = hatSchalter();

    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (!sichtbar(element)) continue;

      const stil = getComputedStyle(element);
      const dauerhaft =
        stil.animationIterationCount.split(',').some((w) => w.trim() === 'infinite') &&
        stil.animationName !== 'none' &&
        Number.parseFloat(stil.animationDuration) > 0;

      const istMarquee = element.tagName.toLowerCase() === 'marquee';
      if (!dauerhaft && !istMarquee) continue;

      // Kurze Schleifen sind Ladeanzeigen und Symbole — keine Inhalte, die
      // jemanden vom Lesen abhalten. Erst ab fuenf Sekunden wird es relevant.
      const dauer = Number.parseFloat(stil.animationDuration) || 0;
      if (!istMarquee && dauer < 5) continue;
      if (schalterDa) continue;

      melde(
        'dauerhafte-animation',
        element,
        'Dieser Inhalt bewegt sich dauerhaft und laesst sich nirgends anhalten. ' +
          'Bewegung, die laenger als fuenf Sekunden laeuft, braucht eine Moeglichkeit zum Pausieren.',
        'ernst',
      );
    }
  }

  // --------------------------------------------- 2.5.4 Bewegungssensoren

  if (aktiv('bewegungssensoren')) {
    const merker = (window as unknown as { __bewegungshoerer?: string[] }).__bewegungshoerer ?? [];
    for (const art of merker) {
      melde(
        'bewegungssensoren',
        document.body,
        `Die Seite wertet Geraetebewegung aus ("${art}"). Jede so ausgeloeste Funktion muss auch ` +
          'ueber Bedienelemente erreichbar sein, und die Auswertung muss sich abschalten lassen.',
        'maessig',
      );
    }
  }

  // ------------------------------------------------------- 3.3.8 Anmeldung

  if (aktiv('captcha-erkennung')) {
    const captcha = document.querySelector(
      '[class*="captcha" i], [id*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], .g-recaptcha, [data-sitekey]',
    );
    if (captcha) {
      melde(
        'captcha-erkennung',
        captcha,
        'Die Seite setzt ein Captcha ein. Ein kognitiver Test darf nicht die einzige Huerde sein — ' +
          'es braucht einen zweiten Weg ohne Erinnern, Abschreiben oder Bilderraten.',
        'ernst',
      );
    }
  }

  if (aktiv('einfuegen-unterbunden')) {
    for (const feld of Array.from(document.querySelectorAll('input[type=password], input[type=email], input[name*="user" i]'))) {
      const behandler = feld.getAttribute('onpaste') ?? '';
      if (!/return\s+false|preventDefault/i.test(behandler) && !feld.hasAttribute('data-no-paste')) continue;

      melde(
        'einfuegen-unterbunden',
        feld,
        'In dieses Feld laesst sich nichts einfuegen. Wer einen Passwortspeicher benutzt, ' +
          'muss das Passwort dann abtippen — genau das soll 3.3.8 verhindern.',
        'ernst',
      );
    }
  }

  // ------------------------------------- 1.4.13 Inhalt bei Hover oder Fokus

  if (aktiv('tooltip-escape')) {
    for (const element of Array.from(document.querySelectorAll('[title]'))) {
      const titel = (element.getAttribute('title') ?? '').trim();
      if (titel.length < 3) continue;
      // Bei iframe und Formularfeldern hat title eine andere, zulaessige Rolle.
      if (element.matches('iframe, input, select, textarea')) continue;

      melde(
        'tooltip-escape',
        element,
        'Der Zusatzinhalt steckt in einem title-Attribut. Der Browser-Tooltip laesst sich nicht ' +
          'mit der Escape-Taste schliessen, nicht mit dem Zeiger erreichen und erscheint bei ' +
          'Beruehrungsbedienung gar nicht.',
        'maessig',
      );
    }
  }

  if (aktiv('tooltip-hoverbar')) {
    for (const element of Array.from(document.querySelectorAll('[role=tooltip]'))) {
      const stil = getComputedStyle(element);
      if (stil.pointerEvents !== 'none') continue;

      melde(
        'tooltip-hoverbar',
        element,
        'Dieser Hinweis nimmt keine Zeigerereignisse an (pointer-events: none). ' +
          'Er laesst sich damit nicht mit dem Zeiger erreichen — noetig, um ihn zu lesen oder zu vergroessern.',
        'maessig',
      );
    }
  }

  // --------------------------------------------------- 2.5.8 Zielgroesse

  if (aktiv('zielgroesse-24')) {
    const MINDESTMASS = 24;
    const ziele = Array.from(document.querySelectorAll(FOKUSSIERBAR)).filter(sichtbar);
    const rechtecke = ziele.map((z) => z.getBoundingClientRect());

    ziele.forEach((ziel, nummer) => {
      const masse = rechtecke[nummer];
      if (!masse) return;
      if (masse.width >= MINDESTMASS && masse.height >= MINDESTMASS) return;

      // Ausnahme der Norm: Links im Fliesstext sind ausgenommen.
      const eltern = ziel.parentElement;
      if (ziel.tagName === 'A' && eltern && (eltern.textContent ?? '').trim() !== (ziel.textContent ?? '').trim()) {
        return;
      }

      // Ausnahme der Norm: genuegend Abstand zu allen anderen Zielen.
      const mitte = { x: masse.left + masse.width / 2, y: masse.top + masse.height / 2 };
      const zuNah = rechtecke.some((anderes, i) => {
        if (i === nummer || !anderes) return false;
        const andereMitte = { x: anderes.left + anderes.width / 2, y: anderes.top + anderes.height / 2 };
        const abstand = Math.hypot(mitte.x - andereMitte.x, mitte.y - andereMitte.y);
        return abstand < MINDESTMASS;
      });
      if (!zuNah) return;

      melde(
        'zielgroesse-24',
        ziel,
        `Dieses Bedienelement misst ${Math.round(masse.width)} mal ${Math.round(masse.height)} Pixel und ` +
          'liegt dicht an einem anderen. Verlangt sind mindestens 24 mal 24 Pixel oder entsprechender Abstand.',
        'maessig',
      );
    });
  }

  // ------------------------------------ 1.3.2 Reihenfolge im DOM und im Bild

  if (aktiv('dom-reihenfolge-vs-visuell')) {
    // Verglichen wird die Reihenfolge der Bedienelemente im DOM mit ihrer Lage
    // auf dem Bildschirm. Ein Sprung nach oben ist ein Anzeichen dafuer, dass
    // CSS die Reihenfolge umstellt — etwa ueber "order" oder "row-reverse".

    /*
      Nicht mitgezaehlt wird, was in einer stehenden oder mitfahrenden Leiste
      sitzt (`position: fixed` oder `sticky`).

      Deren Lage im Dokument laesst sich nicht messen: Eine stehende Kopfzeile
      steht immer am oberen Rand, ihre gerechnete Dokumentposition wandert
      deshalb mit dem Scrollstand mit. Auf einer gescrollten Seite liegt sie
      damit rechnerisch unterhalb von allem, was nach oben aus dem Bild
      gelaufen ist — und jedes dieser Elemente saehe wie ein Ruecksprung aus.
      Das trifft jede Seite mit stehender Kopfzeile und damit sehr viele; als
      Befund waere es ein Fehlalarm. Was eine solche Leiste wirklich umstellt,
      faellt ohnehin innerhalb der Leiste an und nicht zwischen ihr und dem
      Rest der Seite.
    */
    function inFesterLeiste(element: Element): boolean {
      for (let lauf: Element | null = element; lauf; lauf = lauf.parentElement) {
        const position = getComputedStyle(lauf).position;
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    }

    const elemente = Array.from(document.querySelectorAll(FOKUSSIERBAR))
      .filter(sichtbar)
      .filter((element) => !inFesterLeiste(element));
    let vorherigeZeile = -Infinity;
    let spruenge = 0;
    let ersterSprung: Element | null = null;

    for (const element of elemente) {
      const oben = element.getBoundingClientRect().top + window.scrollY;
      if (oben < vorherigeZeile - 60) {
        spruenge += 1;
        ersterSprung ??= element;
      }
      vorherigeZeile = Math.max(vorherigeZeile, oben);
    }

    // Ein einzelner Sprung ist Alltag (Fusszeile, schwebende Schaltflaeche).
    // Erst ein Muster deutet auf eine umgestellte Reihenfolge hin.
    if (spruenge >= 3 && ersterSprung) {
      melde(
        'dom-reihenfolge-vs-visuell',
        ersterSprung,
        `Die Reihenfolge im Quelltext weicht an ${spruenge} Stellen deutlich von der sichtbaren Anordnung ab. ` +
          'Sprachausgabe und Tastatur folgen dem Quelltext — bitte pruefen, ob die Lesereihenfolge noch stimmt.',
        'maessig',
      );
    }
  }

  // ---------------------------------------------- 2.5.7 Zeigerbewegungen

  if (aktiv('ziehen-ohne-alternative')) {
    for (const element of Array.from(document.querySelectorAll('[draggable=true]'))) {
      if (!sichtbar(element)) continue;

      melde(
        'ziehen-ohne-alternative',
        element,
        'Dieses Element wird durch Ziehen bedient. Es braucht denselben Vorgang auch ohne Ziehen — ' +
          'etwa ueber Schaltflaechen zum Verschieben oder ein Auswahlfeld.',
        'maessig',
      );
    }

    for (const element of Array.from(document.querySelectorAll('input[type=range]'))) {
      if (!sichtbar(element)) continue;
      // Ein Schieberegler ist mit der Tastatur bedienbar und damit in Ordnung —
      // gemeldet wird nur, wenn er dem Zugriff entzogen wurde.
      if (element.getAttribute('tabindex') !== '-1') continue;

      melde(
        'ziehen-ohne-alternative',
        element,
        'Dieser Schieberegler ist der Tastatur entzogen (tabindex="-1") und damit nur durch Ziehen bedienbar.',
        'ernst',
      );
    }
  }

  return treffer;
}

/**
 * Wird vor dem Laden eingespritzt und merkt sich, ob die Seite auf
 * Geraetebewegung hoert. Nachtraeglich ist das nicht mehr feststellbar —
 * registrierte Behandler sind aus dem DOM nicht auslesbar.
 */
export const BEWEGUNGSHOERER_SPITZEL = `
(() => {
  const merker = [];
  Object.defineProperty(window, '__bewegungshoerer', { get: () => merker });
  const urspruenglich = window.addEventListener.bind(window);
  window.addEventListener = function (art, ...rest) {
    if (art === 'devicemotion' || art === 'deviceorientation') merker.push(art);
    return urspruenglich(art, ...rest);
  };
})();
`;
