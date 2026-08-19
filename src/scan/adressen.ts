/**
 * Umgang mit Adressen (PRD 6.1.3).
 *
 * **URLs werden vollständig gespeichert** — einschließlich Kennungen wie
 * `/konto/12345/` oder `?bestellung=9876`. Eine Ersetzung durch Platzhalter
 * findet nicht statt (S-30). Der Grund ist die Nachvollziehbarkeit: Ein Befund
 * ist nur etwas wert, wenn sich die betroffene Seite zur Gegenprobe wieder
 * aufrufen lässt.
 *
 * **Eine Ausnahme:** Sitzungskennungen und Anmeldetoken werden entfernt (S-07).
 * Hier fallen beide Erwägungen zusammen — ein Token in einem Bericht wäre ein
 * Sicherheitsrisiko, und für die Gegenprobe wäre es ohnehin wertlos, weil es
 * bis dahin abgelaufen ist. Die Entfernung kostet also nichts.
 */

/**
 * Musterliste der Parameter, die als Sitzungskennung oder Token gelten (S-32).
 *
 * Pflegbar gehalten und bewusst nicht zu weit gefasst: Wer hier `id` aufnimmt,
 * zerstört die Nachvollziehbarkeit für alle Seiten, die ihre Inhalte darüber
 * adressieren. Verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung.
 */
export const SITZUNGSPARAMETER: readonly string[] = [
  'sid',
  'sessionid',
  'session_id',
  'jsessionid',
  'phpsessid',
  'aspsessionid',
  'cfid',
  'cftoken',
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'auth',
  'auth_token',
  'authorization',
  'apikey',
  'api_key',
  'key',
  'signature',
  'sig',
  'code',
  'state',
  'ticket',
  'saml',
  'samlrequest',
  'samlresponse',
  'oauth_token',
  'oauth_verifier',
];

export interface BereinigteAdresse {
  /** Adresse ohne Sitzungskennungen — für Anzeige und Export. */
  adresse: string;
  /** Namen der entfernten Parameter; leer, wenn nichts entfernt wurde. */
  entfernt: string[];
}

/**
 * Entfernt Sitzungskennungen und Token aus einer Adresse.
 *
 * Pfad und alle übrigen Abfrageparameter bleiben unangetastet. Wurde etwas
 * entfernt, steht es in `entfernt` — die Oberfläche vermerkt das sichtbar
 * (S-33), damit niemand eine gekürzte Adresse für die vollständige hält.
 */
export function bereinigeAdresse(roh: string): BereinigteAdresse {
  let adresse: URL;
  try {
    adresse = new URL(roh);
  } catch {
    // Was keine gueltige Adresse ist, wird nicht angefasst.
    return { adresse: roh, entfernt: [] };
  }

  const entfernt: string[] = [];
  const muster = new Set(SITZUNGSPARAMETER.map((p) => p.toLowerCase()));

  for (const name of [...adresse.searchParams.keys()]) {
    if (!muster.has(name.toLowerCase())) continue;
    adresse.searchParams.delete(name);
    entfernt.push(name);
  }

  // Auch der Fragmentteil kann ein Token tragen — bei Anmeldeverfahren nach
  // OAuth ist das sogar die Regel.
  if (adresse.hash) {
    const fragment = new URLSearchParams(adresse.hash.replace(/^#/, ''));
    let geaendert = false;
    for (const name of [...fragment.keys()]) {
      if (!muster.has(name.toLowerCase())) continue;
      fragment.delete(name);
      entfernt.push(`#${name}`);
      geaendert = true;
    }
    if (geaendert) {
      const rest = fragment.toString();
      adresse.hash = rest ? `#${rest}` : '';
    }
  }

  // JSESSIONID steht in Java-Anwendungen im Pfad, nicht in der Abfrage.
  const imPfad = /;jsessionid=[^/?#]*/i;
  if (imPfad.test(adresse.pathname)) {
    adresse.pathname = adresse.pathname.replace(imPfad, '');
    entfernt.push('jsessionid');
  }

  return { adresse: adresse.href, entfernt };
}

/**
 * Prüft und ergänzt eine eingegebene Adresse.
 *
 * Ohne Schema wird `https://` angenommen — die häufigste Eingabe ist
 * `beispiel.de`, und ein Tippfehler soll nicht als Dateipfad enden.
 */
export function pruefeAdresse(eingabe: string): string | null {
  const roh = eingabe.trim();
  if (!roh) return null;

  const mitSchema = /^[a-z]+:\/\//i.test(roh) ? roh : `https://${roh}`;
  try {
    const adresse = new URL(mitSchema);
    if (!['http:', 'https:', 'file:'].includes(adresse.protocol)) return null;
    if (adresse.protocol !== 'file:' && !adresse.hostname) return null;
    return adresse.href;
  } catch {
    return null;
  }
}

/** Gehören zwei Adressen zur selben Herkunft? */
export function gleicheHerkunft(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Adresse ohne Fragment — für den Vergleich beim Crawl.
 * `/seite#abschnitt` und `/seite` sind dieselbe Seite.
 */
export function ohneFragment(roh: string): string {
  try {
    const adresse = new URL(roh);
    adresse.hash = '';
    return adresse.href;
  } catch {
    return roh;
  }
}
