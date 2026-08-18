# PRD — Accessibility-Checker

**Produkt:** Lokales Prüfwerkzeug für digitale Barrierefreiheit nach WCAG 2.1 Level AA
**Version:** 2.0
**Datum:** 17.08.2026
**Autor:** Fragsch

> **Änderungen gegenüber 1.9**
> Neuer Abschnitt 8.1: **Plattformunabhängigkeit** für Windows, macOS und Linux, mit bewusster Bausteinwahl zugunsten der Installierbarkeit und drei gekapselten plattformspezifischen Adaptern.
>
> **Änderungen gegenüber 1.8**
> Schwelle der Laufzeitwarnung auf 5 Minuten je Seite festgelegt. **Damit sind alle offenen Punkte entschieden — das Dokument ist umsetzungsreif.**
>
> **Änderungen gegenüber 1.7**
> Neuer Abschnitt 6.3.1: **geführte Einrichtung von Ollama**, Hardware-Erkennung mit Modellvorschlag, **unterstützter Betrieb ohne Grafikkarte** mit gemessener Laufzeitschätzung und **vollständige Abschaltbarkeit der Sprachmodell-Stufe**. Die Stufen 1 und 3 laufen auf jeder Hardware; Stufe 2 ist optional zuschaltbar.
>
> **Änderungen gegenüber 1.6**
> **URLs werden vollständig und lesbar gespeichert**, damit Befunde zur Gegenprobe wieder aufgerufen werden können; ausgenommen bleiben Sitzungskennungen und Anmeldetoken (neuer Abschnitt 6.1.3).
>
> **Änderungen gegenüber 1.5**
> Die Unkenntlichmachung von Belegen entfällt. Das Werkzeug dient der **internen Qualitätssicherung**; Belege bleiben lokal und werden unverändert gespeichert. An ihre Stelle treten Kennzeichnung betroffener Scans, ein Hinweis vor dem Export und eine Löschfunktion (überarbeiteter Abschnitt 6.1.2).
>
> **Änderungen gegenüber 1.4**
> Der Prüfstandard ist **je Scan auswählbar** — WCAG 2.1 AA als Voreinstellung, WCAG 2.2 AA als Option (neuer Abschnitt 5.4). Der Bericht bildet **ausschließlich den gewählten Standard** ab und erscheint **ausschließlich auf Deutsch**. Damit rückt WCAG 2.2 von „nach 1.0" in den Umfang der Version 1.0.
>
> **Änderungen gegenüber 1.3**
> Der Bericht folgt zwei etablierten Formaten: **WCAG-EM** für den Aufbau, **VPAT 2.5 / ACR** für die Bewertungssprache je Kriterium, **EARL** für den maschinenlesbaren Export (neuer Abschnitt 6.6.1). Nicht abschließend bewertete Kriterien dürfen nie als konform ausgegeben werden.
>
> **Änderungen gegenüber 1.2**
> Die Anmeldung an geschützten Bereichen erfolgt **manuell durch den Nutzer**; das Werkzeug erfasst und speichert keine Zugangsdaten (neuer Abschnitt 6.1.1). Ein neuer Abschnitt 6.1.2 regelt den Umgang mit Inhalten aus geschützten Bereichen. Die Anforderungs-IDs tragen ab dieser Fassung **gruppenspezifische Präfixe** (K/S/A/L/M/E/X), damit Ergänzungen keine Umnummerierung mehr auslösen.
>
> **Änderungen gegenüber 1.1**
> Der Prüfumfang wird über **drei Betriebsarten** geregelt. Standard ist das **Prüfprofil** — eine vorab festgelegte, benannte Seitenliste. Die Gesamtprüfung per Crawl bleibt als Option erhalten. Mehrseitige Ergebnisse werden sowohl je Seite als auch verdichtet auf Projektebene dargestellt (neuer Abschnitt 6.5.1). Die Anforderungs-IDs wurden dabei blockweise neu vergeben.
>
> **Änderungen gegenüber 1.0**
> Die Sprachmodell-Stufe läuft standardmäßig **lokal über Ollama** (Datenschutz, keine laufenden Kosten). Drei bisher als KI-Aufgaben geplante Prüfungen werden auf klassische Bibliotheken umgestellt, weil diese dort deterministisch und zuverlässiger arbeiten. Die bildbasierten Prüfungen — insbesondere die inhaltliche Bewertung von Alternativtexten — rücken in eine Ausbaustufe nach 1.0.

---

## 1. Problemstellung

Die Prüfung von Webseiten und Webanwendungen auf Barrierefreiheit ist heute entweder

- **oberflächlich** — bestehende Scanner melden isolierte technische Verstöße ohne Bezug zu den Erfolgskriterien und decken nur rund 57 % der WCAG-Verstöße ab, oder
- **teuer und langsam** — ein vollständiger BITV-Test mit 98 Prüfschritten ist manuelle Expertenarbeit von mehreren Personentagen.

Dazwischen fehlt ein Werkzeug, das den automatisierbaren Teil vollständig ausschöpft, den halbautomatisierbaren Teil intelligent vorbereitet und den verbleibenden manuellen Rest so weit strukturiert, dass er in Minuten statt Stunden abgearbeitet werden kann.

Mit dem Inkrafttreten des Barrierefreiheitsstärkungsgesetzes (BFSG) im Juni 2025 betrifft dieser Bedarf nicht mehr nur öffentliche Stellen, sondern auch privatwirtschaftliche Anbieter digitaler Dienstleistungen.

## 2. Produktziel

Ein lokal laufendes Werkzeug, das für eine beliebige URL — auch hinter Login — eine vollständige, nachvollziehbare Bewertung aller Erfolgskriterien der WCAG 2.1 Level AA erzeugt und zu jedem nicht erfüllten Kriterium eine konkrete, umsetzbare Handlungsempfehlung liefert. Der zugrunde gelegte Standard ist umschaltbar; WCAG 2.1 ist die Voreinstellung.

**Leitprinzip:** Die Erfolgskriterien sind die Struktur, die Prüf-Engines liefern lediglich Evidenz dazu. Nicht umgekehrt.

### Erfolgskriterien des Produkts

| Ziel | Messgröße | Zielwert |
|---|---|---|
| Abdeckung *(mit Stufe 2)* | Anteil der Erfolgskriterien mit belastbarer Aussage (nicht „unbekannt") | ≥ 85 % |
| Abdeckung *(ohne Stufe 2)* | dito, bei abgeschaltetem Sprachmodell | ≥ 60 % |
| Präzision | Falsch-Positiv-Rate gegen Referenzseiten | < 5 % |
| Geschwindigkeit | Vollständiger Scan einer Einzelseite | < 60 Sekunden |
| Manueller Restaufwand | Zeit für die geführte Restliste pro Seite | < 15 Minuten |
| Verständlichkeit | Handlungsempfehlung ohne Rückfrage umsetzbar | qualitative Abnahme |

## 3. Zielgruppe und Nutzungskontext

**Primär:** Entwickler, Designer und Projektverantwortliche, die eigene oder betreute Webprojekte prüfen — mit Grundkenntnissen in Webtechnologie, aber ohne Barrierefreiheits-Spezialisierung.

**Sekundär:** Agenturmitarbeitende, die Kunden gegenüber den Stand der Barrierefreiheit belegen müssen.

**Typische Nutzungssituationen**

1. *Bestandsaufnahme* — „Wie steht es um unser Angebot?" Einmalige **Gesamtprüfung** per Crawl, um überhaupt zu sehen, wo Probleme sitzen. Dient zugleich dazu, die relevanten Seiten für ein Prüfprofil auszuwählen.
2. *Entwicklungsbegleitung* — „Habe ich das jetzt richtig gemacht?" Schneller Scan einer **Einzelseite** nach einer Änderung.
3. *Regelprüfung* — „Ist unser Standard noch gehalten?" Wiederholter Lauf desselben **Prüfprofils**, etwa vor jedem Release. Häufigster Fall im Alltag.
4. *Fortschrittskontrolle* — „Sind wir besser geworden?" Vergleich zweier Läufe desselben Prüfprofils über die Zeit. Setzt einen stabilen Prüfumfang voraus — genau dafür existieren Profile.
5. *Nachweis* — „Beleg für den Kunden." Export als Report mit dokumentiertem Prüfumfang.

## 4. Umfang

### In Scope (Version 1.0)

- Prüfung einzelner Seiten
- **Prüfprofile:** vorab festgelegte, benannte und wiederverwendbare Seitenlisten als Standardbetriebsart
- Optionale Gesamtprüfung per Crawl über eine Domain mit einstellbarer Tiefe und Seitenbegrenzung
- Prüfung geschützter Bereiche, wobei die Anmeldung ausschließlich durch den Nutzer selbst erfolgt — das Werkzeug erfasst keine Zugangsdaten
- Kennzeichnung und Hinweis beim Export von Berichten mit Belegen aus geschützten Bereichen
- Prüfung dynamischer Zustände (Modals, aufgeklappte Menüs, Formulare im Fehlerzustand)
- Alle 50 Erfolgskriterien WCAG 2.1 Level A und AA — **Standardeinstellung**
- Umschaltbar auf WCAG 2.2 Level A und AA (55 Erfolgskriterien) als Option
- Dreistufiges Prüfmodell (automatisch / lokales Sprachmodell / geführt manuell)
- Vollständig lokaler Betrieb ohne Übertragung geprüfter Inhalte an Dritte
- Lauffähigkeit unter Windows, macOS und Linux
- Deutschsprachige Oberfläche und Handlungsempfehlungen
- Export als HTML und PDF

### Out of Scope (Version 1.0)

- Level AAA
- Fremdsprachige Berichte — Oberfläche und Bericht sind ausschließlich deutschsprachig
- Native Apps (iOS/Android), PDF-Dokumente, Office-Dokumente
- Mehrbenutzerbetrieb, Rechteverwaltung, Cloud-Hosting
- Automatische Behebung gefundener Fehler
- Bildbasierte inhaltliche Bewertung, insbesondere die Beurteilung von Alternativtexten gegen das Bild (Ausbaustufe nach 1.0, siehe 6.3.2)
- Rechtsverbindliche Konformitätserklärung (siehe Abschnitt 11)

## 5. Das Prüfmodell

### 5.1 Drei Stufen

**Stufe 1 — Automatisch.** Deterministische Regelprüfung im gerenderten DOM. Liefert harte Aussagen (erfüllt / nicht erfüllt) ohne menschliches Zutun.

**Stufe 2 — Sprachmodell-gestützt, lokal.** Ein **lokal über Ollama betriebenes** Sprachmodell bewertet Texte, die technisch vorhanden, aber inhaltlich zu beurteilen sind: Ist der Linktext aus sich heraus verständlich? Beschreibt die Überschrift den folgenden Abschnitt? Sagt die Fehlermeldung, wie der Fehler zu beheben ist?

Alle Aufgaben dieser Stufe sind bewusst als **kurze Einzelklassifikationen** zugeschnitten — eine Frage, ein Element, eine Antwort aus einer festen Menge. Das ist die Aufgabenform, die kleine lokale Modelle zuverlässig beherrschen; offene Analyseaufträge sind es nicht.

Ergebnisse dieser Stufe sind **Hinweise**, keine Urteile, und werden in der Oberfläche entsprechend gekennzeichnet. „Unsicher" ist eine erlaubte und vorgesehene Antwort: Solche Fälle wandern in Stufe 3, statt eine falsche Feststellung zu erzeugen. Modellschwäche führt damit zu Mehrarbeit, nicht zu Fehlern.

**Stufe 3 — Geführt manuell.** Für Kriterien, die zwingend menschliches Urteil erfordern, erzeugt das Werkzeug gezielte Einzelfragen mit vorbereitetem Kontext. Statt „Prüfe die Untertitel" lautet die Frage: „Video 2 von 3 (`/schulung/einfuehrung.mp4`) hat keine Untertitelspur — ist der Inhalt anderweitig erschlossen?"

### 5.2 Statusmodell

Jedes Erfolgskriterium erhält genau einen von vier Zuständen:

| Status | Bedeutung |
|---|---|
| ✅ **Erfüllt** | Automatisch bestätigt, keine offenen Punkte |
| ❌ **Nicht erfüllt** | Mindestens ein belegter Verstoß |
| ⚠️ **Prüfung erforderlich** | Hinweis des Sprachmodells oder offene manuelle Frage |
| ➖ **Nicht anwendbar** | Auf dieser Seite gegenstandslos |

Die automatische Erkennung der Nicht-Anwendbarkeit ist ausdrücklich Teil des Produkts: Enthält eine Seite kein Video und kein Audio, fallen sämtliche Kriterien der Gruppe 1.2 sauber heraus, statt als „ungeprüft" Rauschen zu erzeugen.

### 5.3 Datenmodell eines Prüfschritts

```
Erfolgskriterium
├─ id                 "1.1.1"
├─ titel              "Nicht-Text-Inhalte"
├─ level              "A"
├─ prinzip            "Wahrnehmbarkeit"
├─ beschreibung       Kurzfassung in verständlichem Deutsch
├─ anwendbarWenn      Bedingung, z. B. "Seite enthält img|svg|canvas|input[type=image]"
├─ pruefungen[]
│   ├─ typ            "auto" | "llm" | "manuell"
│   ├─ engine         "axe" | "ibm" | "html-validator" | "ocr"
│   │                 | "sprache" | "pixel" | "eigen"
│   ├─ regelIds[]     z. B. ["image-alt", "input-image-alt", "area-alt"]
│   ├─ prompt         nur bei typ="llm"
│   ├─ antwortSchema  nur bei typ="llm", erzwungenes JSON-Schema
│   ├─ buendelGroesse nur bei typ="llm", Elemente je Modellaufruf
│   └─ frage          nur bei typ="manuell"
├─ empfehlung
│   ├─ text           Was zu tun ist, in verständlichem Deutsch
│   ├─ codeBeispiel   Vorher/Nachher
│   └─ referenzen[]   Links zu W3C-Techniken und weiterführender Doku
└─ wcag22Nachfolger   Vorbereitung für spätere Erweiterung
```

### 5.4 Auswählbarer Prüfstandard

Der zugrunde gelegte Standard wird je Scan gewählt. **WCAG 2.1 Level AA ist die Voreinstellung**, WCAG 2.2 Level AA steht als Option zur Verfügung.

| Standard | Erfolgskriterien A + AA |
|---|---|
| **WCAG 2.1** *(Standard)* | 50 |
| WCAG 2.2 | 55 |

Die beiden Fassungen unterscheiden sich in **sieben** Kriterien: WCAG 2.2 ergänzt sechs Kriterien auf den Stufen A und AA und erklärt eines für gegenstandslos.

**Ergänzt in WCAG 2.2**

| Kriterium | Level |
|---|---|
| 2.4.11 Fokus nicht verdeckt (Minimum) | AA |
| 2.5.7 Zeigerbewegungen | AA |
| 2.5.8 Zielgröße (Minimum) | AA |
| 3.2.6 Konsistente Hilfe | A |
| 3.3.7 Redundante Eingabe | A |
| 3.3.8 Barrierefreie Authentifizierung (Minimum) | AA |

**Entfallen in WCAG 2.2**

4.1.1 Syntaxanalyse wurde für gegenstandslos erklärt, weil Browser und Hilfsmittel fehlerhaftes Markup heute zuverlässig verarbeiten. Das Werkzeug prüft die zugrunde liegende HTML-Gültigkeit weiterhin, führt den Befund im Modus WCAG 2.2 aber nicht mehr als Erfolgskriterium, sondern als **allgemeinen Qualitätshinweis** ohne Einfluss auf die Konformitätsaussage.

**Umsetzung im Datenmodell.** Da WCAG 2.2 die 2.1-Kriterien unverändert übernimmt, ist keine zweite Katalogfassung nötig. Jedes Kriterium trägt lediglich einen Vermerk, ab welcher Fassung es gilt und ob es entfallen ist. Der aktive Standard wirkt damit als Filter über einen einzigen Katalog.

```
├─ standard
│   ├─ eingefuehrtMit   "2.0" | "2.1" | "2.2"
│   └─ entfallenAb      null | "2.2"
```

Diese Entscheidung erspart den doppelten Pflegeaufwand und macht eine spätere Erweiterung — etwa auf WCAG 3.0 — zu einer Katalogergänzung statt zu einem Umbau.

## 6. Funktionale Anforderungen

Anforderungs-IDs tragen ein Präfix nach Themengruppe. Das hält die Nummerierung stabil, wenn einzelne Gruppen wachsen.

| Präfix | Gruppe | Abschnitt |
|---|---|---|
| **K** | Konfiguration des Prüfumfangs | 6.1 |
| **S** | Schutz von Daten und Zugängen | 6.1.1 – 6.1.3 |
| **A** | Automatische Prüfung (Stufe 1) | 6.2 |
| **L** | Sprachmodell-Prüfung (Stufe 2) | 6.3 |
| **M** | Manuelle Prüfung (Stufe 3) | 6.4 |
| **E** | Ergebnisdarstellung | 6.5 |
| **X** | Export und Historie | 6.6 |
| **NF** | Nicht-funktionale Anforderungen | 7 |

### 6.1 Scan-Konfiguration

Das Werkzeug kennt **drei Betriebsarten**. Die mittlere ist die Voreinstellung.

| Betriebsart | Was geprüft wird | Bewertung |
|---|---|---|
| **Einzelseite** | Eine URL | eigenständig |
| **Prüfprofil** *(Standard)* | Eine vorab festgelegte, benannte Liste von Seiten | je Seite eigenständig, zusätzlich Projektübersicht |
| **Gesamtprüfung** | Automatischer Crawl über die Domain | verdichtet auf Projektebene, je Seite aufschlüsselbar |

Das **Prüfprofil** ist die Arbeitsform für den Regelbetrieb: eine kuratierte Auswahl repräsentativer Seiten — Startseite, Kontaktformular, Suchergebnisliste, Artikelansicht, Anmeldung, Warenkorb. Es wird einmal angelegt, benannt und danach wiederverwendet, sodass Scans über die Zeit vergleichbar bleiben. Dieses Vorgehen entspricht der Seitenauswahl etablierter Prüfverfahren und ist gegenüber einem Vollcrawl schneller, günstiger und aussagekräftiger, weil jede Seite bewusst ausgewählt wurde.

| ID | Anforderung | Priorität |
|---|---|---|
| K-01 | Eingabe einer URL und Start eines Scans | Muss |
| K-02 | Auswahl der Betriebsart: Einzelseite, Prüfprofil oder Gesamtprüfung | Muss |
| K-03 | Anlegen, Benennen, Speichern und Wiederverwenden von Prüfprofilen | Muss |
| K-04 | Je Seite im Profil eine Bezeichnung und ein Zweckvermerk („Kontaktformular", „Suchergebnis") | Muss |
| K-05 | Mehrere Profile je Projekt (z. B. „Schnellprüfung" mit 5 Seiten, „Vollabnahme" mit 25) | Soll |
| K-06 | Vorschlagsfunktion: einmaliger Crawl liefert eine Kandidatenliste, aus der Seiten ins Profil übernommen werden | Soll |
| K-07 | Import und Export eines Profils als JSON, damit es im Projekt versioniert werden kann. URLs bleiben dabei vollständig erhalten (siehe 6.1.3) | Soll |
| K-08 | Crawl-Parameter der Gesamtprüfung: maximale Tiefe, maximale Seitenzahl, Ein-/Ausschlussmuster für Pfade | Muss |
| K-09 | Respektierung von `robots.txt`, einstellbare Verzögerung zwischen Aufrufen | Muss |
| K-10 | Auswahl der zu prüfenden Viewports | Soll |
| K-11 | Abbrechen eines laufenden Scans; bereits geprüfte Seiten bleiben erhalten | Soll |
| K-12 | Auswahl des Prüfstandards je Scan: **WCAG 2.1 AA als Voreinstellung**, WCAG 2.2 AA als Option | Muss |
| K-13 | Speicherung des gewählten Standards im Prüfprofil, damit Wiederholungsläufe vergleichbar bleiben | Muss |
| K-14 | Warnung beim Vergleich zweier Scans mit unterschiedlichem Standard | Soll |

#### 6.1.1 Geschützte Bereiche — Anmeldung durch den Nutzer

**Grundsatz: Das Werkzeug erfasst, verarbeitet und speichert keine Zugangsdaten.** Es kennt weder Benutzernamen noch Kennwörter, es füllt keine Anmeldeformulare aus und es zeichnet keine Anmeldevorgänge auf.

Stattdessen erfolgt eine **Übergabe an den Nutzer**: Das Werkzeug öffnet ein sichtbares Browserfenster auf der Zielseite und wartet. Der Nutzer meldet sich selbst an — mit Kennwort, Zwei-Faktor-Verfahren, SSO oder jedem anderen Verfahren, das die Anwendung verlangt. Anschließend bestätigt er im Werkzeug, dass die Prüfung beginnen kann. Die Sitzung wird ausschließlich im Arbeitsspeicher gehalten und beim Beenden des Scans verworfen.

Dieses Vorgehen löst drei Probleme zugleich: Es entstehen keine schützenswerten Daten, es funktioniert mit jedem Anmeldeverfahren ohne Sonderbehandlung, und es entfällt der gesamte Aufwand für sichere Speicherung.

| ID | Anforderung | Priorität |
|---|---|---|
| S-01 | Öffnen eines sichtbaren Browserfensters und Warten auf die Anmeldung durch den Nutzer | Muss |
| S-02 | Ausdrückliche Bestätigung durch den Nutzer, dass die Prüfung starten kann | Muss |
| S-03 | **Keinerlei Erfassung, Verarbeitung oder Speicherung von Zugangsdaten oder personenbezogenen Daten** | Muss |
| S-04 | Sitzungsdaten (Cookies, Token) ausschließlich im Arbeitsspeicher; Verwerfen bei Scan-Ende, kein Schreiben in die Datenbank | Muss |
| S-05 | Erkennung eines Sitzungsverlusts während des Scans; Anhalten und Aufforderung zur erneuten Anmeldung statt stiller Fehlprüfung | Muss |
| S-06 | Auslassen sicherheitskritischer und irreversibler Bedienelemente während der Zustands-Traversierung (Abmelden, Löschen, Bestellen, Bezahlen) | Muss |
| S-07 | Entfernung von **Sitzungskennungen und Anmeldetoken** aus URLs vor Anzeige und Export — nicht jedoch von Pfad- und Abfrageparametern (siehe 6.1.3) | Muss |

#### 6.1.2 Umgang mit Inhalten aus geschützten Bereichen

Geschützte Bereiche enthalten regelmäßig personenbezogene Daten — Namen, Anschriften, Bestellungen, Nachrichten. Screenshots und HTML-Ausschnitte, die das Werkzeug als Beleg speichert, geben diese Inhalte unverändert wieder.

**Entscheidung: Es findet keine Unkenntlichmachung statt.** Das Werkzeug dient der internen Qualitätssicherung, läuft ausschließlich lokal und gibt keine Daten weiter. Die Belege verlassen den Rechner nicht — technisch entspricht die Lage einem Bildschirmfoto, das die prüfende Person selbst anfertigt. Eine Verfremdung würde den Nutzen mindern, weil Befunde am unveränderten Beleg leichter nachvollziehbar sind, und Aufwand erzeugen, dem kein Schutzbedarf gegenübersteht.

Die verbleibenden Maßnahmen setzen deshalb dort an, wo Inhalte den Rechner tatsächlich verlassen könnten: beim Export.

| ID | Anforderung | Priorität |
|---|---|---|
| S-20 | Belege werden unverändert gespeichert; keine Unkenntlichmachung, keine Verfremdung | Muss |
| S-21 | Speicherung ausschließlich lokal, ohne Übertragung an Dritte (siehe NF-02) | Muss |
| S-22 | Kennzeichnung von Scans, die Seiten aus geschützten Bereichen enthalten | Muss |
| S-23 | **Hinweis vor dem Export** eines Berichts, der solche Belege enthält, mit Angabe der betroffenen Seiten | Muss |
| S-24 | Löschen einzelner Scans einschließlich aller zugehörigen Belege | Muss |
| S-25 | Wahlweise Export ohne Screenshots und HTML-Ausschnitte, wenn ein Bericht weitergegeben werden soll | Soll |
| S-26 | Einstellbare Aufbewahrungsdauer, nach der Belege geschützter Bereiche automatisch entfallen | Kann |

#### 6.1.3 Speicherung von URLs

**URLs werden vollständig und unverändert gespeichert** — einschließlich Kennungen wie `/konto/12345/` oder `?bestellung=9876`. Eine Ersetzung durch Platzhalter findet nicht statt.

Der Grund ist die Nachvollziehbarkeit: Ein Befund ist nur dann etwas wert, wenn die betroffene Seite zur Gegenprobe wieder aufgerufen werden kann. Eine URL mit Platzhaltern wäre dafür unbrauchbar. Hinzu kommt, dass URL-Bestandteile in aller Regel keine schutzwürdigen Inhalte tragen, sondern nur Verweise darauf — die eigentlichen Daten liegen in der Seite, und für die gilt bereits die Entscheidung aus 6.1.2.

**Eine Ausnahme bleibt bestehen:** Sitzungskennungen und Anmeldetoken werden entfernt (S-07). Das ist kein Widerspruch, denn hier fallen beide Erwägungen zusammen — ein Token in einem Bericht wäre ein Sicherheitsrisiko, und für die Gegenprobe wäre es ohnehin wertlos, weil es bis dahin abgelaufen ist. Die Entfernung kostet also nichts.

| ID | Anforderung | Priorität |
|---|---|---|
| S-30 | Vollständige, unveränderte Speicherung von URLs einschließlich Pfad- und Abfrageparametern | Muss |
| S-31 | Aufruf der betroffenen Seite unmittelbar aus jedem Befund heraus, zur manuellen Gegenprobe | Muss |
| S-32 | Erkennung und Entfernung typischer Sitzungs- und Token-Parameter anhand einer pflegbaren Musterliste | Muss |
| S-33 | Sichtbarer Vermerk, wenn eine URL für Anzeige oder Export gekürzt wurde | Soll |

### 6.2 Automatische Prüfung

| ID | Anforderung | Priorität |
|---|---|---|
| A-01 | Rendering der Seite inklusive JavaScript vor der Prüfung | Muss |
| A-02 | Regelprüfung durch mehrere Engines mit Zusammenführung und Entdoppelung der Ergebnisse | Muss |
| A-03 | Zuordnung jedes Engine-Befunds zu genau einem Erfolgskriterium | Muss |
| A-04 | Prüfung in mehreren Viewports (320 px, 768 px, 1280 px) | Muss |
| A-05 | Tastatur-Durchlauf: schrittweises Durchtabben mit Erfassung von Reihenfolge und Fokusdarstellung | Muss |
| A-06 | Erkennung von Tastaturfallen | Muss |
| A-07 | Zustands-Traversierung: Öffnen von Modals und Menüs, Absenden leerer Formulare | Soll |
| A-08 | Anwendung erhöhter Textabstände und Prüfung auf Inhaltsverlust | Soll |
| A-09 | Prüfung des Verhaltens bei `prefers-reduced-motion` | Kann |
| A-10 | Kontrastberechnung auch bei Verlaufs- und Bildhintergründen | Soll |
| A-11 | Erkennung der Nicht-Anwendbarkeit von Kriterien anhand des Seiteninhalts | Muss |
| A-12 | Erkennung fremdsprachiger Textpassagen durch Spracherkennungs-Bibliothek | Muss |
| A-13 | Erkennung von Bildern mit hohem Textanteil durch OCR | Soll |
| A-14 | Kontrastprüfung grafischer Bedienelemente durch Pixelanalyse des Screenshots | Soll |

> **Hinweis zu A-12 bis A-14:** Diese drei Prüfungen waren in Version 1.0 der KI-Stufe zugeordnet. Sie sind mit klassischen Bibliotheken jedoch **deterministisch, schneller und ohne Modellrisiko** lösbar und gehören daher in die automatische Stufe. Konkret: Spracherkennung über `franc` oder `cld3`, Texterkennung über Tesseract, Kontrastwerte über direkte Pixelauswertung.

### 6.3 Sprachmodell-gestützte Prüfung (lokal)

Alle Prüfungen dieser Gruppe arbeiten ausschließlich auf **Text** und laufen über ein lokales Modell. Bildbasierte Bewertungen sind nicht Teil von Version 1.0 (siehe 6.3.2). Die Stufe ist optional und vollständig abschaltbar (siehe 6.3.1).

| ID | Anforderung | Priorität |
|---|---|---|
| L-01 | Bewertung der Aussagekraft von Linktexten im jeweiligen Kontext | Muss |
| L-02 | Bewertung des Seitentitels gegen den Seiteninhalt | Muss |
| L-03 | Bewertung von Überschriften gegen den jeweils folgenden Abschnitt | Muss |
| L-04 | Prüfung der Überschriftenhierarchie gegen die inhaltliche Gliederung | Muss |
| L-05 | Erkennung von Anweisungen, die allein auf Form, Farbe oder Position verweisen | Muss |
| L-06 | Bewertung von Formularbeschriftungen auf Eindeutigkeit | Soll |
| L-07 | Bewertung von Fehlermeldungen darauf, ob sie einen Behebungsweg nennen | Soll |
| L-08 | Erkennung uneinheitlicher Bezeichnungen gleicher Funktionen (seitenübergreifend) | Soll |

**Betriebsanforderungen der Stufe**

| ID | Anforderung | Priorität |
|---|---|---|
| L-20 | Betrieb über **Ollama als Standard**, vollständig lokal | Muss |
| L-21 | Erzwungenes JSON-Antwortschema je Prüfung; freie Modellausgabe wird verworfen | Muss |
| L-22 | Antwortmenge je Prüfung fest: `ok` / `problem` / `unsicher` plus Begründung | Muss |
| L-23 | `unsicher` überführt den Punkt automatisch in die manuelle Liste (Stufe 3) | Muss |
| L-24 | Bündelung mehrerer Elemente je Modellaufruf (Richtwert 20), Antwort als JSON-Liste | Muss |
| L-25 | Kennzeichnung aller Ergebnisse dieser Stufe als Hinweis, nie als Feststellung | Muss |
| L-26 | Betrieb des Werkzeugs bleibt ohne Sprachmodell möglich; Stufe 2 entfällt dann und die betroffenen Kriterien wandern vollständig in Stufe 3 | Muss |
| L-27 | Austauschbarer Modell-Adapter; neben Ollama optional ein Cloud-Anbieter | Soll |
| L-28 | Wiederverwendung bereits bewerteter Textbausteine über Inhaltshash — wirkt seitenübergreifend und über Scans hinweg | Soll |
| L-29 | Konfigurierbares Modell; Voreinstellung passend zur verfügbaren Hardware | Soll |

#### 6.3.1 Einrichtung, Hardware und Abschaltbarkeit

**Geführte Einrichtung.** Das Werkzeug setzt keine vorhandene Ollama-Installation voraus. Es erkennt, ob Ollama vorhanden ist, und bietet andernfalls an, es einzurichten und ein passendes Modell zu laden. Der Vorgang ist geführt und bestätigungspflichtig — niemals stillschweigend, da er einen Download in der Größenordnung mehrerer Gigabyte auslöst.

**Modellempfehlung nach Hardware.** Das Werkzeug erkennt Arbeitsspeicher und Grafikspeicher und schlägt entsprechend vor:

| Ausstattung | Vorschlag | Erwartetes Tempo |
|---|---|---|
| Ohne Grafikkarte (x86) | Phi-4-mini (3,8B) oder vergleichbar | ~12 Token/s |
| Apple Silicon | Qwen3 8B oder vergleichbar | zügig — gemeinsamer Speicher, siehe 8.1 |
| 8 GB Grafikspeicher | Qwen3 8B oder vergleichbar | zügig |
| 12 GB und mehr | Phi-4 (14B) oder vergleichbar | zügig, beste Urteilsqualität |

**Betrieb ohne Grafikkarte** ist ausdrücklich vorgesehen und auswählbar. Statt einer pauschalen Warnung misst das Werkzeug bei der Einrichtung einmalig die tatsächliche Verarbeitungsgeschwindigkeit und leitet daraus vor jedem Scan eine konkrete Laufzeitschätzung ab — „geschätzt 6 Minuten für diese Seite" ist brauchbar, „auf langsamer Hardware kann es dauern" ist es nicht.

**Abschaltbarkeit.** Die Sprachmodell-Stufe lässt sich vollständig deaktivieren. Das Werkzeug bleibt dann uneingeschränkt nutzbar; es muss jedoch klar benennen, was dadurch entfällt.

| ID | Anforderung | Priorität |
|---|---|---|
| L-40 | Erkennung einer vorhandenen Ollama-Installation | Muss |
| L-41 | Geführte, bestätigungspflichtige Einrichtung von Ollama und Modell, falls nicht vorhanden | Muss |
| L-42 | Erkennung von Arbeits- und Grafikspeicher, daraus abgeleiteter Modellvorschlag | Muss |
| L-43 | Betrieb ohne Grafikkarte auswählbar | Muss |
| L-44 | Einmalige Geschwindigkeitsmessung bei der Einrichtung; daraus **konkrete Laufzeitschätzung vor jedem Scan** statt pauschaler Warnung | Muss |
| L-45 | Warnung, wenn die geschätzte Laufzeit **5 Minuten je Seite** überschreitet, mit Angebot, die Stufe für diesen Lauf zu überspringen. Schwelle einstellbar, Voreinstellung 5 Minuten | Muss |
| L-46 | **Vollständige Abschaltbarkeit der Stufe 2**, dauerhaft oder für einzelne Läufe | Muss |
| L-47 | Bei abgeschalteter Stufe: sichtbarer Hinweis in Oberfläche und Bericht, welche Kriterien dadurch nicht automatisch bewertet werden (siehe unten) | Muss |
| L-48 | Bei abgeschalteter Stufe wandern die betroffenen Prüfungen in die geführte manuelle Liste — sie entfallen nicht | Muss |
| L-49 | Hintergrundausführung: Ergebnisse der Stufe 1 sind sofort sichtbar, Ergebnisse der Stufe 2 erscheinen nach und nach | Muss |
| L-50 | Empfehlung, die Stufe 2 auf schwacher Hardware nur für Einzelseiten zu nutzen; für Prüfprofile Hinweis auf einen Lauf außerhalb der Arbeitszeit | Soll |

**Was ohne Sprachmodell entfällt.** Zehn Kriterien sind betroffen, davon drei vollständig:

| Kriterium | Ohne Stufe 2 |
|---|---|
| 1.3.3 Sensorische Eigenschaften | vollständig manuell |
| 2.4.6 Überschriften und Beschriftungen | vollständig manuell |
| 3.2.4 Konsistente Bezeichnung | vollständig manuell |
| 1.3.1, 1.3.2, 2.4.2, 2.4.3, 2.4.4, 3.3.2, 3.3.3 | technischer Anteil bleibt automatisch, inhaltliche Beurteilung wird manuell |

Der Abdeckungsgrad sinkt damit von etwa 85 % auf etwa 64 % automatisch oder halbautomatisch bewerteter Kriterien. Die restlichen bleiben prüfbar — sie kosten nur mehr Zeit. Zusammen mit X-14 führt das dazu, dass der Bericht so lange als Entwurf gekennzeichnet bleibt, bis die manuelle Liste abgearbeitet ist. Eine stillschweigende Verschlechterung der Aussagekraft ist damit ausgeschlossen.

#### 6.3.2 Ausbaustufe nach 1.0 — bildbasierte Bewertung

Zurückgestellt, weil zwingend ein multimodales Modell erforderlich ist und der Nutzen den Aufwand in Version 1.0 nicht rechtfertigt:

| ID | Anforderung |
|---|---|
| L-93 | Bewertung der inhaltlichen Angemessenheit von Alternativtexten anhand des Bildes (1.1.1) |
| L-94 | Bildbasierte Beurteilung von Bedienelement-Kontrasten in Zweifelsfällen (1.4.11) |
| L-95 | Beurteilung, ob Farbe allein als Informationsträger dient (1.4.1) |

Bis dahin gilt für diese Kriterien: Der technische Anteil wird automatisch geprüft (Ist ein Alt-Text vorhanden? Ist er nicht leer und kein Dateiname?), die inhaltliche Beurteilung erfolgt über die geführte manuelle Liste.

### 6.4 Geführte manuelle Prüfung

| ID | Anforderung | Priorität |
|---|---|---|
| M-01 | Erzeugung gezielter Einzelfragen mit vorbereitetem Kontext | Muss |
| M-02 | Beantwortung mit erfüllt / nicht erfüllt / nicht anwendbar plus Freitextnotiz | Muss |
| M-03 | Persistente Speicherung der Antworten je URL | Muss |
| M-04 | Übernahme früherer Antworten bei erneutem Scan, sofern der Kontext unverändert ist | Soll |
| M-05 | Sprung von der Frage zur betroffenen Stelle auf der Seite | Soll |
| M-06 | Aufnahme aller mit `unsicher` bewerteten Punkte aus Stufe 2 in diese Liste, mit Angabe der Modellbegründung als Entscheidungshilfe | Muss |
| M-07 | Bei Prüfprofil und Gesamtprüfung: Zusammenfassung gleichartiger Fragen über Seiten hinweg zu einer Frage, sofern der Kontext identisch ist | Soll |

### 6.5 Ergebnisdarstellung

| ID | Anforderung | Priorität |
|---|---|---|
| E-01 | Übersicht aller 50 Erfolgskriterien mit Status, gruppiert nach den vier WCAG-Prinzipien | Muss |
| E-02 | Zusammenfassung: Anzahl je Status, Gesamtbewertung, Abdeckungsgrad | Muss |
| E-03 | Detailansicht je Kriterium mit allen Befunden | Muss |
| E-04 | Je Befund: CSS-Selektor, HTML-Ausschnitt, Screenshot des betroffenen Bereichs | Muss |
| E-05 | Je Befund: erkennbare Herkunft (welche Stufe, welche Engine bzw. welches Modell) | Muss |
| E-06 | Je nicht erfülltem Kriterium: Handlungsempfehlung mit Vorher/Nachher-Codebeispiel | Muss |
| E-07 | Filterung nach Status, Level, Prinzip und Herkunft | Soll |
| E-08 | Sortierung nach Schweregrad und Häufigkeit | Soll |
| E-09 | Vergleich zweier Scans desselben Prüfumfangs mit Hervorhebung von Verbesserung und Verschlechterung | Kann |

#### 6.5.1 Mehrseitige Ergebnisse

Bei Prüfprofil und Gesamtprüfung gilt **beides zugleich**: jede Seite behält ihre eigenständige Bewertung, zusätzlich entsteht eine verdichtete Projektebene. Der Nutzer wechselt zwischen beiden Sichten.

| ID | Anforderung | Priorität |
|---|---|---|
| E-20 | Projektübersicht über alle 50 Kriterien, verdichtet über alle geprüften Seiten | Muss |
| E-21 | Verdichtungsregel: Ein Kriterium gilt auf Projektebene als **nicht erfüllt**, sobald es auf mindestens einer Seite nicht erfüllt ist. Als **nicht anwendbar** nur, wenn es auf allen Seiten nicht anwendbar ist. | Muss |
| E-22 | Je Kriterium Angabe, auf wie vielen von wie vielen Seiten ein Verstoß auftritt, mit Sprung zur betroffenen Seite | Muss |
| E-23 | Vollständige Einzelseiten-Ansicht bleibt jederzeit erreichbar | Muss |
| E-24 | Seitenrangliste nach Anzahl und Schwere der Verstöße | Soll |
| E-25 | **Musterkennung:** Verstöße mit identischem Selektor und Kontext auf mehreren Seiten werden als *ein* Befund mit Seitenliste dargestellt, nicht als n Befunde | Muss |
| E-26 | Kennzeichnung erkannter Muster als vermutlicher Vorlagen- oder Bausteinfehler (Kopfbereich, Fußbereich, Navigation) | Soll |
| E-27 | Fortschrittsanzeige während des Scans je Seite und je Stufe | Soll |

**Warum die Musterkennung (E-25) mehr ist als Kosmetik:** Ein fehlerhafter Sprungmarken-Link im Kopfbereich erscheint auf 25 geprüften Seiten. Ohne Zusammenfassung liest sich der Report als 25 Probleme; tatsächlich ist es *eine* Zeile Code. Die Musterkennung macht aus einer unübersichtlichen Fehlerliste eine priorisierte Aufgabenliste — und sie ist dieselbe Mechanik, die über den Inhaltshash (L-28) auch die Laufzeit der Sprachmodell-Stufe senkt.

### 6.6 Export und Historie

| ID | Anforderung | Priorität |
|---|---|---|
| X-01 | Speicherung aller Scans mit Zeitstempel und verwendetem Prüfumfang | Muss |
| X-02 | Export als eigenständige HTML-Datei nach der Berichtsstruktur aus 6.6.1 | Muss |
| X-03 | Export als PDF, gleiche Struktur, linear gesetzt | Soll |
| X-04 | Export der Rohdaten als JSON im **EARL**-Vokabular des W3C, damit die Ergebnisse maschinell weiterverarbeitbar sind | Soll |
| X-05 | Bei mehrseitigen Scans: Export wahlweise als Projektbericht oder je Seite | Soll |
| X-06 | Erzeugung eines Entwurfs für die „Erklärung zur Barrierefreiheit" aus den Ergebnissen | Kann |

#### 6.6.1 Berichtsstruktur

Der Bericht lehnt sich an **zwei etablierte Formate** an, die unterschiedliche Aufgaben erfüllen und sich ergänzen:

- **WCAG-EM** (*Website Accessibility Conformance Evaluation Methodology*, W3C) liefert den **Aufbau des Dokuments**. Die Methodik ist um die Festlegung eines Geltungsbereichs und einer repräsentativen Seitenstichprobe herum gebaut — also genau um das, was in diesem Werkzeug das Prüfprofil ist. Der Bericht dokumentiert damit nicht nur Ergebnisse, sondern auch, worauf sie sich beziehen.
- **VPAT 2.5 / ACR** (*Accessibility Conformance Report*, ITI) liefert die **Bewertungssprache je Kriterium**. Die EU-Ausgabe bezieht sich auf EN 301 549 und ist im europäischen Raum das gängige Format, wenn Konformität gegenüber Dritten belegt werden soll.

**Gliederung**

| # | Abschnitt | Inhalt |
|---|---|---|
| 1 | Deckblatt | Geprüftes Angebot, Datum, geprüfte Fassung, prüfende Person, Werkzeugversion, **zugrunde gelegter Standard** |
| 2 | Geltungsbereich | Gewählter Standard (WCAG 2.1 AA oder WCAG 2.2 AA), geprüfte Browser und Viewports, Betriebsart, Einschränkungen |
| 3 | Stichprobe | Alle geprüften Seiten mit Bezeichnung und Zweckvermerk aus dem Prüfprofil, samt Begründung der Auswahl |
| 4 | Zusammenfassung | Kennzahlen je Status, Gesamtbild, die drei wirksamsten Maßnahmen |
| 5 | Konformitätstabelle | Alle Erfolgskriterien des gewählten Standards mit ACR-Bewertung und Anmerkung — eine Zeile je Kriterium |
| 6 | Detailbefunde | Je nicht erfülltem Kriterium: Belege und Handlungsempfehlung |
| 7 | Methodik | Welche Stufe hat welches Kriterium geprüft, Abdeckungsmatrix, ausdrückliche Grenzen |

Abschnitt 5 ist der **übersichtliche** Teil — 50 Zeilen, auf einen Blick erfassbar. Abschnitt 6 ist der **informative** Teil. In der HTML-Fassung sind die Detailbefunde aus der Tabelle heraus aufklappbar, sodass beide Bedürfnisse ohne Kompromiss bedient werden; im PDF folgen sie linear.

**Bewertungssprache**

| Status im Werkzeug | Bewertung im Bericht |
|---|---|
| ✅ Erfüllt | **Unterstützt** *(Supports)* |
| ❌ Nicht erfüllt, einzelne Vorkommen oder Seiten betroffen | **Teilweise unterstützt** *(Partially Supports)* |
| ❌ Nicht erfüllt, durchgängig | **Unterstützt nicht** *(Does Not Support)* |
| ➖ Nicht anwendbar | **Nicht anwendbar** *(Not Applicable)* |
| ⚠️ Prüfung erforderlich | **Nicht abschließend bewertet** — siehe unten |

Im Bericht erscheinen ausschließlich die deutschen Begriffe. Die englischen Originalbezeichnungen sind hier nur zur Einordnung angegeben, damit die Herkunft aus dem ACR-Vokabular nachvollziehbar bleibt.

| ID | Anforderung | Priorität |
|---|---|---|
| X-10 | Bericht nach der Gliederung aus 6.6.1 | Muss |
| X-11 | Konformitätstabelle mit ACR-Bewertungssprache | Muss |
| X-12 | Zu **jedem** Kriterium eine schriftliche Anmerkung, auch bei „Unterstützt" — VPAT 2.5 verlangt dies ausdrücklich | Muss |
| X-13 | Automatische Ableitung von „Teilweise unterstützt" aus der Verdichtung (E-21): Anzahl betroffener Seiten und Vorkommen | Muss |
| X-14 | **Offene Punkte werden nie als „Unterstützt" ausgegeben.** Solange Kriterien den Status ⚠️ tragen, trägt der Bericht sichtbar den Vermerk *Entwurf — n von 50 Kriterien nicht abschließend bewertet* | Muss |
| X-15 | Abschnitt 7 nennt je Kriterium die Herkunft der Bewertung (Stufe 1, 2 oder 3) und die bekannten Grenzen des Verfahrens | Muss |
| X-16 | Dokumentation der Stichprobe mit Bezeichnung und Zweck je Seite gemäß WCAG-EM | Muss |
| X-17 | Vermerk im Bericht, wenn er Belege aus geschützten Bereichen enthält (siehe S-22) | Muss |
| X-18 | **Bericht ausschließlich in deutscher Sprache** — Gliederung, Bewertungssprache, Kriterienbezeichnungen und Handlungsempfehlungen | Muss |
| X-22 | Vermerk im Bericht, wenn die Sprachmodell-Stufe abgeschaltet war, mit Auflistung der dadurch manuell zu prüfenden Kriterien (siehe L-47) | Muss |
| X-19 | **Der Bericht bezieht sich ausschließlich auf den gewählten Standard.** Bei WCAG 2.1 erscheinen genau die 50 Kriterien der Fassung 2.1, bei WCAG 2.2 genau die 55 Kriterien der Fassung 2.2. Kriterien der jeweils anderen Fassung tauchen nicht auf — auch nicht als „nicht bewertet" | Muss |
| X-20 | Nennung des zugrunde gelegten Standards auf dem Deckblatt und im Geltungsbereich | Muss |
| X-21 | Im Modus WCAG 2.2: Befunde zur HTML-Gültigkeit als allgemeiner Qualitätshinweis außerhalb der Konformitätstabelle, ohne Einfluss auf die Bewertung | Soll |

**Warum X-14 nicht verhandelbar ist:** Ein ACR ist eine Aussage gegenüber Dritten. Würde das Werkzeug ungeprüfte Kriterien stillschweigend als „Unterstützt" führen, erzeugte es eine falsche Konformitätsbehauptung — mit dem Anschein von Belastbarkeit, weil sie in einem anerkannten Format daherkommt. Der Bericht bleibt daher so lange als Entwurf gekennzeichnet, bis die geführte manuelle Liste abgearbeitet ist. Das ist zugleich der wirksamste Anreiz, sie tatsächlich abzuarbeiten.

## 7. Nicht-funktionale Anforderungen

| ID | Anforderung |
|---|---|
| NF-01 | **Die Oberfläche des Werkzeugs erfüllt selbst WCAG 2.1 AA.** Ein Barrierefreiheits-Prüfwerkzeug, das nicht barrierefrei ist, ist unbrauchbar. Das Werkzeug prüft sich selbst als Teil der Abnahme. |
| NF-02 | **Vollständig lokaler Betrieb in der Standardkonfiguration.** Geprüfte Inhalte verlassen den Rechner nicht — auch nicht in der Sprachmodell-Stufe. Eine Übertragung an externe Dienste findet ausschließlich statt, wenn ein Cloud-Adapter ausdrücklich konfiguriert wurde, und wird in der Oberfläche dauerhaft sichtbar angezeigt. |
| NF-03 | **Keine Erhebung von Zugangsdaten.** Das Werkzeug erfasst und speichert weder Benutzernamen noch Kennwörter noch sonstige Anmeldedaten. Belege aus geschützten Bereichen können personenbezogene Inhalte enthalten; diese verbleiben lokal und werden bewusst unverändert gespeichert (6.1.2). |
| NF-11 | Sitzungsdaten geschützter Bereiche bestehen nur im Arbeitsspeicher und nur für die Dauer eines Scans |
| NF-12 | Scans geschützter Bereiche sind nicht unbeaufsichtigt lauffähig — eine bewusst in Kauf genommene Folge des Anmeldeverfahrens nach 6.1.1 |
| NF-04 | **Stufe 1 allein: Einzelseiten-Scan unter 20 Sekunden, unabhängig von der Hardware.** Mit GPU-gestützter Stufe 2 unter 60 Sekunden. Ohne Grafikkarte ist mit mehreren Minuten je Seite zu rechnen; die tatsächliche Dauer wird gemessen und vorab angezeigt (L-44). |
| NF-09 | **Die Stufen 1 und 3 laufen auf jeder Hardware.** Stufe 2 ist optional und hardwareabhängig; das Werkzeug erkennt die Ausstattung und schlägt ein passendes Modell vor (6.3.1). Ein Rechner ohne Grafikkarte ist ein unterstützter, kein geduldeter Fall. |
| NF-10 | Die Stufen sind entkoppelt: Ergebnisse der automatischen Stufe stehen in der Oberfläche zur Verfügung, während die Sprachmodell-Stufe noch läuft. |
| NF-05 | Oberfläche, Empfehlungen und Berichte ausschließlich in deutscher Sprache. Eine Mehrsprachfähigkeit wird nicht angestrebt; Texte dürfen unmittelbar im Prüfkatalog stehen |
| NF-06 | Der Prüfkatalog ist Daten, nicht Code — neue Kriterien und Regeln lassen sich ohne Eingriff in die Anwendungslogik ergänzen |
| NF-07 | Installation über einen Befehl, Start über einen Befehl |
| NF-13 | **Lauffähig unter Windows, macOS und Linux.** Kein System ist Zweitbürger; die Abnahme erfolgt auf allen dreien (siehe 8.1) |
| NF-14 | Keine Abhängigkeit von Laufzeitumgebungen außerhalb von Node.js. Insbesondere wird keine Java-Installation vorausgesetzt |
| NF-15 | Plattformspezifischer Code ausschließlich in gekapselten Adaptern: Ollama-Einrichtung, Hardware-Erkennung, Speicherorte |
| NF-08 | Nachvollziehbarkeit: zu jedem Befund ist erkennbar, welche Engine oder welche Stufe ihn erzeugt hat |

## 8. Technische Architektur

```
┌─────────────────────────────────────────────┐
│  Oberfläche  (Vite + React, WCAG 2.1 AA)    │
└───────────────────┬─────────────────────────┘
                    │ HTTP
┌───────────────────┴─────────────────────────┐
│  Backend  (Node + TypeScript, Fastify)      │
│  ┌───────────┬────────────┬───────────────┐ │
│  │ Scan-     │ Prüf-      │ Report-       │ │
│  │ Steuerung │ katalog    │ Erzeugung     │ │
│  └─────┬─────┴─────┬──────┴───────────────┘ │
│        │           │                        │
│  ┌─────┴─────┐ ┌───┴──────┐ ┌────────────┐  │
│  │ Playwright│ │ Normali- │ │ Modell-    │  │
│  │ Runner    │ │ sierung  │ │ Adapter    │  │
│  └─────┬─────┘ └───┬──────┘ └─────┬──────┘  │
│        │           │              │         │
│  ┌─────┴───────────┴───────┐  ┌───┴──────┐  │
│  │ Stufe 1 — automatisch   │  │ Stufe 2  │  │
│  │ axe-core                │  │          │  │
│  │ IBM equal-access        │  │ Ollama   │  │
│  │ Nu HTML-Validator       │  │ (lokal,  │  │
│  │ franc/cld3  (Sprache)   │  │  Standard│  │
│  │ Tesseract   (OCR)       │  │          │  │
│  │ Pixelanalyse (Kontrast) │  │ Cloud    │  │
│  │ eigene Regeln           │  │ (optional│  │
│  └─────────────────────────┘  └──────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ SQLite: Scans, Befunde, Antworten     │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Zentrale Entwurfsentscheidungen**

1. *Playwright statt Puppeteer* — mehrere Browser-Engines, robusteres Warten auf Zustände, ausgereifte Session-Behandlung für Login-Szenarien.
2. *Mehrere Prüf-Engines statt einer* — axe-core ist die beste Einzelquelle, findet aber nicht alles. IBM equal-access und ein HTML-Validator ergänzen sich sinnvoll. Die Zusammenführungsschicht ist notwendig, weil dieselben Verstöße sonst mehrfach erscheinen.
3. *Prüfkatalog als Datei, nicht als Code* — der Katalog ist der eigentliche Wert des Produkts und muss unabhängig von der Anwendung pflegbar bleiben. Ermöglicht später den Wechsel auf WCAG 2.2 ohne Umbau.
4. *SQLite statt Dateiablage* — Historie, Vergleich und Wiederverwendung manueller Antworten setzen Abfragbarkeit voraus.
5. *Sprachmodell lokal als Standard, nicht als Rückfallebene* — Ollama ist die Voreinstellung. Das erfüllt NF-02 ohne Einschränkung, verursacht keine laufenden Kosten und macht das Werkzeug auch für die Prüfung geschützter Kundenbereiche einsetzbar. Ein Cloud-Adapter bleibt optional und ist ausdrücklich zu aktivieren.

6. *Klassische Bibliothek vor Sprachmodell* — wo eine deterministische Lösung existiert, wird sie genutzt. Spracherkennung, Texterkennung in Bildern und Kontrastberechnung sind keine Sprachmodell-Aufgaben. Das erhöht die Zuverlässigkeit und verkleinert die Stufe 2 auf das, was sie wirklich braucht: acht kurze Textklassifikationen.

7. *Enge Aufgabenzuschnitte statt offener Analyse* — jede Anfrage an das Sprachmodell betrifft ein Element und erlaubt drei Antworten. Zusammen mit dem erzwungenen JSON-Schema ist das die Voraussetzung dafür, dass ein 8B-Modell brauchbare Ergebnisse liefert. Offene Aufträge wie „bewerte diese Seite" sind ausdrücklich nicht vorgesehen.

8. *Bündelung und Inhaltshash gegen Laufzeit* — nicht die Urteilsqualität, sondern die Geschwindigkeit ist das Hauptrisiko lokaler Modelle. 20 Elemente je Aufruf senken die Anfragezahl auf etwa zehn pro Seite; der Inhaltshash verhindert, dass dieselben Navigationslinks auf 50 Seiten 50-mal bewertet werden.

9. *Reines JavaScript vor nativer Abhängigkeit* — wo eine gleichwertige JS- oder WebAssembly-Lösung existiert, wird sie der nativen vorgezogen, selbst wenn sie etwas langsamer ist. Der Gewinn an Installierbarkeit über drei Betriebssysteme wiegt schwerer als der Leistungsunterschied (siehe 8.1).

### 8.1 Plattformunabhängigkeit

Das Werkzeug läuft unter **Windows, macOS und Linux**. Das ergibt sich weitgehend aus der Bauform: Ein Node-Server mit Oberfläche im Browser braucht kein natives Fenster-Toolkit, das je Betriebssystem angepasst werden müsste.

| Baustein | Windows | macOS | Linux | Anmerkung |
|---|---|---|---|---|
| Node.js, TypeScript | ✓ | ✓ | ✓ | |
| Playwright | ✓ | ✓ | ✓ | lädt die Browser je Plattform selbst |
| axe-core, IBM equal-access | ✓ | ✓ | ✓ | reines JavaScript |
| Ollama | ✓ | ✓ | ✓ | Einrichtung je Plattform verschieden |
| SQLite | ✓ | ✓ | ✓ | vorgefertigte Binärdateien |
| PDF-Erzeugung | ✓ | ✓ | ✓ | über Playwright, keine zusätzliche Abhängigkeit |

**Bewusste Bausteinwahl zugunsten der Installierbarkeit**

| Aufgabe | Nicht gewählt | Gewählt | Grund |
|---|---|---|---|
| HTML-Gültigkeit | Nu HTML-Validator (`vnu.jar`) | JavaScript-Validator | vermeidet Java-Laufzeitumgebung |
| Texterkennung | Tesseract als Systemprogramm | `tesseract.js` (WebAssembly) | keine plattformweise Einrichtung |
| Spracherkennung | `cld3` (native Bindings) | `franc` (reines JavaScript) | keine Kompilierung beim Installieren |

**Drei gekapselte Adapter** enthalten den einzigen plattformspezifischen Code:

1. **Ollama-Einrichtung** — Installer bzw. `winget` unter Windows, `brew` oder DMG unter macOS, Installationsskript unter Linux. Die Erkennung einer bestehenden Installation ist plattformgleich.
2. **Hardware-Erkennung** — Auslesen des Grafikspeichers über `nvidia-smi`, Metal oder ROCm.
3. **Speicherorte** — Datenbank, Belege und Berichte folgen den jeweils üblichen Verzeichniskonventionen.

**Hinweis zu Apple Silicon:** Macs mit Apple-Silicon besitzen zwar keine gesonderte Grafikkarte, nutzen aber gemeinsamen Speicher und Metal-Beschleunigung. Sprachmodelle laufen dort deutlich flüssiger als auf x86-Rechnern ohne Grafikkarte. Für die Hardware-Erkennung nach L-42 ist Apple Silicon daher **nicht** wie „ohne Grafikkarte" zu behandeln.

## 9. Umsetzung in Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0** | Projektaufbau, Prüfkatalog-Datenmodell mit allen 50 Kriterien auf Deutsch, Gültigkeitsvermerke für die Standardumschaltung | Fundament |
| **1** | Playwright-Runner, axe-core-Anbindung, Zuordnung Regel → Kriterium, Nicht-Anwendbarkeits-Erkennung | Erster vollständiger Scan |
| **2** | Oberfläche: Übersicht, Detailansicht, Handlungsempfehlungen | **Erstes nutzbares Werkzeug** |
| **3** | Weitere Engines, Viewports, Tastatur-Durchlauf, Zustands-Traversierung, Textabstände, Spracherkennung, OCR, Pixel-Kontrast | Automatik ausgereizt |
| **4** | Sprachmodell-Stufe lokal über Ollama: geführte Einrichtung, Hardware-Erkennung, Adapter, Antwortschema, Bündelung, Inhaltshash, Abschaltbarkeit | Abdeckung ca. 85 % — **optional zuschaltbar** |
| **5** | Geführte manuelle Prüfliste mit Persistenz | Vollständige Bewertung |
| **6** | Prüfprofile, Verdichtung und Musterkennung, Gesamtprüfung per Crawl, Anmeldung durch den Nutzer, Scan-Verwaltung mit Löschfunktion | Mehrseitig und WebApp-fähig |
| **7** | Bericht nach WCAG-EM/ACR als HTML und PDF, EARL-Export, Entwurf Erklärung zur Barrierefreiheit | Vorzeigbares Ergebnis |
| **8** | Verifikation gegen Referenzseiten, Messung der Falsch-Positiv- und Falsch-Negativ-Rate, Modellvergleich, **Abnahme auf allen drei Betriebssystemen** | Belastbarkeit nachgewiesen |
| **8b** | Ergänzung der sechs WCAG-2.2-Kriterien im Katalog, Freischaltung der Standardauswahl | WCAG 2.2 wählbar |
| **9+** | *Nach 1.0:* multimodales Modell für die bildbasierten Prüfungen L-93 bis L-95 | Alt-Text-Bewertung |

Nach Phase 2 liegt ein eigenständig nutzbares Werkzeug vor. Alle weiteren Phasen sind Ausbau ohne Umbau.

## 10. Verifikation

Die Genauigkeit wird nicht behauptet, sondern gemessen. Grundlage sind Referenzseiten mit bekannter Fehlerlage:

- W3C Before-and-After-Demonstration (jeweils barrierefreie und nicht barrierefreie Fassung derselben Seite)
- Eigens erstellte Testseiten mit gezielt eingebauten Verstößen, je einer pro Erfolgskriterium
- Eine reale, extern geprüfte Seite als Gegenprobe

Gemessen werden je Erfolgskriterium: erkannte Verstöße, übersehene Verstöße, Fehlalarme. Ergebnis ist eine Abdeckungsmatrix, die offenlegt, wo das Werkzeug zuverlässig ist und wo nicht. Diese Matrix wird Teil der Anwendung, damit Nutzende die Aussagekraft eines Ergebnisses einschätzen können.

### 10.1 Modellvergleich

Ob ein lokales Modell in der benötigten Größenordnung ausreichend zuverlässig urteilt, ist eine **empirische Frage und wird nicht vorab beantwortet.** Phase 8 vergleicht daher auf demselben Testsatz mindestens:

- ein 8B-Modell (Zielhardware: 8 GB VRAM)
- ein 12–14B-Modell (Zielhardware: 12 GB VRAM)
- ein Cloud-Modell als Referenzobergrenze

Bewertet wird je Prüfung aus 6.3: Trefferquote, Fehlalarmquote, Anteil `unsicher` und Laufzeit. Der Anteil `unsicher` ist dabei kein Mangel, sondern eine Kenngröße — er bestimmt, wie viel manuelle Nacharbeit anfällt.

Zeigt sich, dass ein 8B-Modell für einzelne Prüfungen nicht genügt, sind diese Prüfungen abschaltbar und gehen vollständig in Stufe 3 über. Der Modell-Adapter macht den Wechsel zu einer Konfigurationsänderung.

## 11. Abgrenzung und Haftungshinweis

Das Werkzeug ersetzt **keine** zertifizierte Prüfung. Für rechtsverbindliche Aussagen zur Konformität nach BFSG, BITV oder EN 301 549 ist weiterhin eine Prüfung durch qualifizierte Personen erforderlich. Das Werkzeug bereitet eine solche Prüfung vor, verkürzt sie erheblich und deckt den Großteil der Mängel vorab auf.

Ergebnisse der Sprachmodell-Stufe sind Hinweise zur Nachprüfung, keine Feststellungen. Die Oberfläche stellt diesen Unterschied durchgängig dar.

## 12. Offene Punkte

| # | Frage | Zu klären bis |
|---|---|---|
| ~~1~~ | ~~Welcher KI-Anbieter für Stufe 2?~~ **Entschieden:** Ollama lokal als Standard, austauschbarer Adapter, Cloud optional. Konkretes Modell folgt aus dem Vergleich in Phase 8. | erledigt |
| ~~2~~ | ~~Verdichtung mehrseitiger Ergebnisse?~~ **Entschieden:** Drei Betriebsarten, Prüfprofil als Standard. Jede Seite bleibt eigenständig bewertet, zusätzlich entsteht eine verdichtete Projektebene (6.5.1). Beide Sichten sind jederzeit erreichbar. | erledigt |
| ~~3~~ | ~~Umfang der Login-Unterstützung?~~ **Entschieden:** Die Anmeldung erfolgt manuell durch den Nutzer im geöffneten Browserfenster. Das Werkzeug erfasst keine Zugangsdaten. Damit ist jedes Anmeldeverfahren ohne Sonderbehandlung abgedeckt (6.1.1). | erledigt |
| ~~4~~ | ~~Gestaltung des Exports?~~ **Entschieden:** Aufbau nach **WCAG-EM**, Bewertungssprache nach **VPAT 2.5 / ACR**, maschinenlesbarer Export als **EARL** (6.6.1). Offene Kriterien werden nie als konform ausgegeben. | erledigt |
| ~~5~~ | ~~Zeitpunkt der Erweiterung auf WCAG 2.2?~~ **Entschieden:** Bereits in 1.0 als **auswählbarer Standard** (5.4). WCAG 2.1 bleibt Voreinstellung. Umsetzung über Gültigkeitsvermerke in einem gemeinsamen Katalog statt zweier Fassungen. | erledigt |
| ~~6~~ | ~~Ollama selbst installieren?~~ **Entschieden:** Ja — geführte, bestätigungspflichtige Einrichtung samt Modelldownload (L-41). | erledigt |
| ~~7~~ | ~~Verhalten ohne GPU?~~ **Entschieden:** Betrieb ohne Grafikkarte ist auswählbar und unterstützt, mit gemessener Laufzeitschätzung statt pauschaler Warnung (L-43, L-44). Stufe 2 ist zudem vollständig abschaltbar (L-46). | erledigt |
| ~~12~~ | ~~Schwelle für die Laufzeitwarnung?~~ **Entschieden:** 5 Minuten je Seite, einstellbar (L-45). | erledigt |

**Stand:** Alle zum jetzigen Zeitpunkt aufgeworfenen Fragen sind entschieden. Neue offene Punkte werden hier fortlaufend ergänzt.
| ~~8~~ | ~~Verfahren der Unkenntlichmachung in Screenshots?~~ **Entschieden:** Entfällt. Das Werkzeug dient der internen Qualitätssicherung, Belege verlassen den Rechner nicht. Stattdessen Kennzeichnung und Hinweis beim Export (6.1.2). | erledigt |
| ~~9~~ | ~~URLs mit Kennungen in Prüfprofilen?~~ **Entschieden:** URLs werden vollständig und lesbar gespeichert, damit die Gegenprobe möglich bleibt. Nur Sitzungskennungen und Anmeldetoken werden entfernt (6.1.3). | erledigt |
| ~~10~~ | ~~Sollen WCAG-2.2-Kriterien im Bericht mitlaufen?~~ **Entschieden:** Nein. Der Bericht bildet ausschließlich den gewählten Standard ab (X-19). | erledigt |
| ~~11~~ | ~~Englische Berichtsfassung?~~ **Entschieden:** Nein. Bericht ausschließlich auf Deutsch (X-18, NF-05). | erledigt |

---

## Anhang A — Abdeckungsübersicht der 50 Erfolgskriterien

Erwartete Zuordnung zu den Prüfstufen. Wird in Phase 8 gegen die tatsächlich gemessene Abdeckung gestellt.

*Legende:* **auto** = Stufe 1 (Engine oder Bibliothek) · **LLM** = Stufe 2 (lokales Sprachmodell, nur Text) · **manuell** = Stufe 3 (geführte Frage) · *kursiv in Klammern* = eingesetzte Technik

**1 — Wahrnehmbarkeit**

| Kriterium | Level | Stufe |
|---|---|---|
| 1.1.1 Nicht-Text-Inhalte | A | auto + manuell — *Vorhandensein automatisch, Inhalt manuell; Vision nach 1.0* |
| 1.2.1 Reine Audio-/Videoinhalte | A | manuell |
| 1.2.2 Untertitel (aufgezeichnet) | A | auto + manuell |
| 1.2.3 Audiodeskription oder Volltext-Alternative | A | manuell |
| 1.2.4 Untertitel (live) | AA | manuell |
| 1.2.5 Audiodeskription (aufgezeichnet) | AA | manuell |
| 1.3.1 Info und Beziehungen | A | auto + LLM |
| 1.3.2 Bedeutungstragende Reihenfolge | A | auto + LLM |
| 1.3.3 Sensorische Eigenschaften | A | LLM |
| 1.3.4 Anzeigerichtung | AA | auto |
| 1.3.5 Eingabezweck bestimmen | AA | auto |
| 1.4.1 Benutzung von Farbe | A | auto + manuell — *Pixelanalyse; Vision nach 1.0* |
| 1.4.2 Audio-Steuerelement | A | auto |
| 1.4.3 Kontrast (Minimum) | AA | auto |
| 1.4.4 Textgröße ändern | AA | auto |
| 1.4.5 Bilder eines Textes | AA | auto — *OCR* ⟵ *war KI* |
| 1.4.10 Reflow | AA | auto |
| 1.4.11 Nicht-Text-Kontrast | AA | auto — *Pixelanalyse* ⟵ *war KI* |
| 1.4.12 Textabstand | AA | auto |
| 1.4.13 Inhalt bei Hover/Fokus | AA | auto + manuell |

**2 — Bedienbarkeit**

| Kriterium | Level | Stufe |
|---|---|---|
| 2.1.1 Tastatur | A | auto |
| 2.1.2 Keine Tastaturfalle | A | auto |
| 2.1.4 Tastenkurzbefehle | A | auto + manuell |
| 2.2.1 Zeiteinteilung anpassbar | A | manuell |
| 2.2.2 Pausieren, beenden, ausblenden | A | auto + manuell |
| 2.3.1 Dreimaliges Blitzen | A | manuell |
| 2.4.1 Blöcke umgehen | A | auto |
| 2.4.2 Seite mit Titel versehen | A | auto + LLM |
| 2.4.3 Fokus-Reihenfolge | A | auto + LLM |
| 2.4.4 Linkzweck (im Kontext) | A | auto + LLM |
| 2.4.5 Verschiedene Methoden | AA | auto |
| 2.4.6 Überschriften und Beschriftungen | AA | LLM |
| 2.4.7 Fokus sichtbar | AA | auto |
| 2.5.1 Zeigergesten | A | manuell |
| 2.5.2 Zeiger-Abbruch | A | manuell |
| 2.5.3 Beschriftung im Namen | A | auto |
| 2.5.4 Betätigung durch Bewegung | A | manuell |

**3 — Verständlichkeit**

| Kriterium | Level | Stufe |
|---|---|---|
| 3.1.1 Sprache der Seite | A | auto |
| 3.1.2 Sprache von Teilen | AA | auto — *Spracherkennungs-Bibliothek* ⟵ *war KI* |
| 3.2.1 Bei Fokus | A | auto |
| 3.2.2 Bei Eingabe | A | auto + manuell |
| 3.2.3 Konsistente Navigation | AA | auto (nur im Crawl) |
| 3.2.4 Konsistente Bezeichnung | AA | LLM (nur im Crawl) |
| 3.3.1 Fehlererkennung | A | auto |
| 3.3.2 Beschriftungen oder Anweisungen | A | auto + LLM |
| 3.3.3 Fehlerempfehlung | AA | auto + LLM |
| 3.3.4 Fehlervermeidung (rechtlich, finanziell, Daten) | AA | manuell |

**4 — Robustheit**

| Kriterium | Level | Stufe |
|---|---|---|
| 4.1.1 Syntaxanalyse | A | auto — *entfällt im Modus WCAG 2.2* |
| 4.1.2 Name, Rolle, Wert | A | auto |
| 4.1.3 Statusmeldungen | AA | auto + manuell |

**Nur im Modus WCAG 2.2**

| Kriterium | Level | Stufe |
|---|---|---|
| 2.4.11 Fokus nicht verdeckt (Minimum) | AA | auto — *ergibt sich aus dem Tastatur-Durchlauf (A-05)* |
| 2.5.7 Zeigerbewegungen | AA | auto + manuell |
| 2.5.8 Zielgröße (Minimum) | AA | auto — *Messung der Schaltflächenmaße, gut automatisierbar* |
| 3.2.6 Konsistente Hilfe | A | auto + LLM (nur mehrseitig) |
| 3.3.7 Redundante Eingabe | A | manuell |
| 3.3.8 Barrierefreie Authentifizierung (Minimum) | AA | auto + manuell — *Erkennung von CAPTCHA und unterbundenem Einfügen automatisch* |

Bemerkenswert: Fünf der sechs neuen Kriterien haben einen automatischen Anteil, drei davon sind sogar vollständig automatisch prüfbar. Die WCAG-2.2-Erweiterung verschlechtert den Abdeckungsgrad also nicht — sie verbessert ihn leicht.

### Verteilung

Werte gemessen am umgesetzten Katalog (`katalog/*.json`), nicht geschätzt.

| Zuordnung | Anzahl |
|---|---|
| rein automatisch | 22 |
| gemischt (automatisch + Sprachmodell und/oder manuell) | 18 |
| rein Sprachmodell | 2 |
| rein manuell | 8 |
| **Summe (WCAG 2.1)** | **50** |

**40 Kriterien** haben einen automatischen Anteil, **10** einen Sprachmodell-Anteil, **18** einen manuellen Anteil.

Nur **8 Kriterien** sind rein manuell: 1.2.1, 1.2.3, 1.2.4, 1.2.5, 2.3.1, 2.5.1, 2.5.2 und 3.3.4. Sie betreffen fast ausschließlich Medieninhalte und Zeigergesten — Bereiche, in denen kein Verfahren die menschliche Beurteilung ersetzen kann. Auf einer Seite ohne Videos und ohne Gestensteuerung fallen die meisten davon als „nicht anwendbar" heraus, sodass in der Praxis oft nur ein bis zwei Fragen offen bleiben.

Der umgesetzte Katalog liegt damit **über** der ursprünglichen Schätzung: 2.2.1, 2.5.4 und 2.4.6 haben einen automatischen Vorprüfschritt bekommen, der in der Planung noch nicht vorgesehen war.

Nach Umsetzung der Ausbaustufe (L-93 bis L-95) verschieben sich 1.1.1, 1.4.1 und 1.4.11 weiter Richtung Automatik.

Im Modus **WCAG 2.2** ergeben sich 55 Kriterien: 50 aus 2.1, minus 4.1.1, plus die sechs oben genannten. Davon sind 25 rein automatisch, 11 rein manuell.

---

## Anhang B — Quellen

- [The Automated Accessibility Coverage Report — Deque](https://www.deque.com/automated-accessibility-coverage-report/)
- [axe-core — Deque](https://www.deque.com/axe/axe-core/)
- [Prüfschritte BIK BITV-Test + WCAG 2.2 (Web)](https://bitvtest.de/pruefverfahren/bitv-20-plus-web)
- [Wieviele Prüfschritte hat der BITV-Test? — Barrierekompass](https://barrierekompass.de/aktuelles/detail/wieviele-pruefschritte-hat-der-bitv-test.html)
- [Web Content Accessibility Guidelines (WCAG) 2.1 — W3C](https://www.w3.org/TR/WCAG21/)
- [Best Ollama Models 2026 — Morph](https://www.morphllm.com/best-ollama-models)
- [Best Small Language Models 2026: Top SLMs Ranked (1B–14B) — Local AI Master](https://localaimaster.com/blog/small-language-models-guide-2026)
- [Best Ollama Models in 2026: A Practical Guide by Use Case — ML Journey](https://mljourney.com/best-ollama-models-in-2026-a-practical-guide-by-use-case/)
- [Website Accessibility Conformance Evaluation Methodology (WCAG-EM) — W3C](https://www.w3.org/TR/WCAG-EM/)
- [VPAT — Information Technology Industry Council](https://www.itic.org/policy/accessibility/vpat)
- [ACR 2026: Accessibility Conformance Report nach VPAT 2.5 — Never Code Alone](https://nevercodealone.de/de/glossare/nca-glossar-barrierefreiheit/acr-accessibility-conformance-report)
- [WCAG-EM Report Tool — hellbusch.de](https://www.hellbusch.de/wcag-em-report-tool/)
- [Evaluation and Report Language (EARL) — W3C](https://www.w3.org/TR/EARL10-Schema/)
- [What's New in WCAG 2.2 — W3C WAI](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
- [WCAG 2.2 vs 2.1: Every Change Explained — WCAGsafe](https://wcagsafe.com/blog/wcag-2-2-vs-wcag-2-1)
- [CPU-Only LLM 2026: Phi-4 Mini Runs 12 tok/s, No GPU — PromptQuorum](https://www.promptquorum.com/local-llms/best-cpu-only-llm)
- [CPU-Only LLMs 2026: Real tok/s, Best Models — InsiderLLM](https://insiderllm.com/guides/cpu-only-llms-what-actually-works/)
