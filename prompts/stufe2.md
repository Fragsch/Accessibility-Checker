# Prompts der Sprachmodell-Stufe

**Bezug:** PRD Abschnitt 6.3, ARCHITEKTUR.md Abschnitt 5.7

Diese Datei enthält alle Prompts der Stufe 2. Sie werden über die `pruefungsId` aus dem Prüfkatalog angesprochen.

---

## Grundregeln

Sie gelten für **jeden** Prompt und sind der Grund, warum ein 4B-Modell hier brauchbare Ergebnisse liefert:

1. **Eine Frage, ein Element, eine Antwort.** Keine offenen Analyseaufträge.
2. **Feste Antwortmenge:** `ok`, `problem`, `unsicher`. Nichts sonst.
3. **Erzwungenes JSON-Schema** über Ollamas `format`-Parameter. Freitext wird verworfen.
4. **Temperatur 0.**
5. **`unsicher` ist erwünscht,** wenn die Entscheidung Kontext braucht, den das Modell nicht hat. Der Fall wandert dann in die manuelle Liste — das ist besser als ein geratenes Urteil.
6. **Bündelung:** mehrere Elemente je Aufruf, Antwort als Liste mit `i` als Index.
7. **Kein Deutsch-Englisch-Wechsel.** Prompts und Begründungen sind durchgehend deutsch.

## Gemeinsames Antwortschema

```json
{
  "type": "object",
  "required": ["ergebnisse"],
  "properties": {
    "ergebnisse": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["i", "urteil"],
        "properties": {
          "i":          { "type": "integer" },
          "urteil":     { "enum": ["ok", "problem", "unsicher"] },
          "begruendung":{ "type": "string", "maxLength": 200 }
        }
      }
    }
  }
}
```

`begruendung` ist bei `ok` verzichtbar und bei `problem` und `unsicher` Pflicht — sie erscheint in der Oberfläche als Entscheidungshilfe (M-06).

## Gemeinsame Systemanweisung

```
Du prüfst Webseiten auf Barrierefreiheit nach WCAG 2.1.
Du bewertest ausschließlich das, was dir vorgelegt wird.
Du antwortest ausschließlich im vorgegebenen JSON-Format.

Für jedes Element wählst du genau ein Urteil:
  ok        – die Anforderung ist erfüllt
  problem   – die Anforderung ist verletzt
  unsicher  – zur Entscheidung fehlt Kontext

Wähle "unsicher" lieber einmal zu oft als ein falsches Urteil.
Ein "unsicher" wird von einem Menschen nachgeprüft, ein falsches
"ok" bleibt unentdeckt.

Begründungen sind deutsch, sachlich und höchstens ein Satz.
```

---

## 1. `linkzweck` — Erfolgskriterium 2.4.4

**Frage:** Ist aus dem Linktext erkennbar, wohin der Link führt?

```
Screenreader können sich alle Links einer Seite als Liste ausgeben
lassen. Dann steht kein umgebender Text mehr zur Verfügung.

Beurteile für jeden Link, ob sein Text allein den Zweck erkennen lässt.

problem  – bei nichtssagenden Texten wie "hier", "mehr", "weiterlesen",
           "klicken Sie hier", "Details", ">>" oder einer nackten URL
ok       – wenn der Text das Ziel oder die Handlung benennt
unsicher – bei Abkürzungen, Produktnamen oder Fachbegriffen, die für
           die Zielgruppe klar sein können, für dich aber nicht

Der Umgebungstext ist nur zur Einordnung angegeben. Bewerte den Linktext.

Links:
{{#elemente}}
{{i}}. Linktext: "{{text}}"
   Umgebung: "{{kontext}}"
   Ziel: {{href}}
{{/elemente}}
```

**Bündelgröße:** 20 · **Sammelselektor:** `a[href]`

---

## 2. `seitentitel` — Erfolgskriterium 2.4.2

**Frage:** Beschreibt der Seitentitel den Inhalt der Seite?

```
Der Seitentitel ist das Erste, was ein Screenreader vorliest, und er
steht in der Tab-Leiste. Er soll den Zweck der Seite benennen.

problem  – bei nichtssagenden Titeln wie "Startseite", "Dokument",
           "Unbenannt", nur dem Firmennamen oder einer URL
ok       – wenn der Titel den Seitenzweck erkennen lässt
unsicher – wenn der Titel zwar Inhalt trägt, aber nicht zur Seite passt

Seite:
  Titel:            "{{titel}}"
  Hauptüberschrift: "{{h1}}"
  Erster Absatz:    "{{einleitung}}"
```

**Bündelgröße:** 1

---

## 3. `ueberschrift-aussagekraft` — Erfolgskriterium 2.4.6

**Frage:** Beschreibt die Überschrift den folgenden Abschnitt?

```
Überschriften dienen der Orientierung beim Überfliegen. Sie sollen
erkennen lassen, was im folgenden Abschnitt steht.

problem  – bei inhaltsleeren Überschriften wie "Informationen",
           "Sonstiges", "Details", "Mehr", "Text", "Überschrift"
ok       – wenn die Überschrift zum folgenden Text passt und ihn benennt
unsicher – wenn die Überschrift zwar konkret ist, aber inhaltlich
           nicht zum Abschnitt zu passen scheint

Überschriften mit dem jeweils folgenden Textanfang:
{{#elemente}}
{{i}}. <{{ebene}}> "{{text}}"
   Folgender Text: "{{auszug}}"
{{/elemente}}
```

**Bündelgröße:** 20 · **Sammelselektor:** `h1, h2, h3, h4, h5, h6, legend`

---

## 4. `ueberschriftenhierarchie` — Erfolgskriterium 1.3.1

**Frage:** Bildet die Überschriftenebene die inhaltliche Gliederung ab?

```
Überschriftenebenen bilden eine Gliederung. Ein Unterabschnitt bekommt
eine tiefere Ebene als sein Oberabschnitt. Ebenen werden nicht wegen
der Schriftgröße gewählt.

Du bekommst die Überschriften in Dokumentreihenfolge mit ihrer Ebene.

problem  – wenn die Ebene nicht zur inhaltlichen Über- und Unterordnung
           passt, etwa wenn ein Unterpunkt eine höhere Ebene hat als
           sein Oberpunkt
ok       – wenn Ebene und inhaltliche Gliederung übereinstimmen
unsicher – wenn sich die inhaltliche Beziehung aus den Texten allein
           nicht erschließen lässt

Übersprungene Ebenen allein sind kein Verstoß gegen dieses Kriterium –
bewerte die inhaltliche Stimmigkeit.

Überschriften in Dokumentreihenfolge:
{{#elemente}}
{{i}}. Ebene {{ebene}}: "{{text}}"
{{/elemente}}
```

**Bündelgröße:** 20 · **Sammelselektor:** `h1, h2, h3, h4, h5, h6`

---

## 5. `sensorische-anweisungen` — Erfolgskriterium 1.3.3

**Frage:** Beruht die Anweisung allein auf Form, Farbe, Größe oder Position?

```
Anweisungen dürfen sich nicht ausschließlich auf sinnliche Merkmale
stützen. Wer die Seite nicht sieht, kann "die runde grüne Schaltfläche
rechts" nicht finden.

problem  – wenn ein Element ausschließlich über Form, Farbe, Größe oder
           Position benannt wird
ok       – wenn das Element auch beim Namen genannt wird, oder wenn der
           Text gar keine Anweisung enthält
unsicher – bei mehrdeutigen Formulierungen

Beachte: Ein zusätzlicher Hinweis auf Farbe oder Position ist erlaubt,
solange das Element auch benannt wird.

Textabschnitte:
{{#elemente}}
{{i}}. "{{text}}"
{{/elemente}}
```

**Bündelgröße:** 20 · **Sammelselektor:** `p, li, label, .hinweis, [role=note]`

---

## 6. `feldbeschriftung` — Erfolgskriterium 3.3.2

**Frage:** Ist eindeutig, was in das Feld einzugeben ist?

```
Eine Feldbeschriftung soll benennen, welche Angabe erwartet wird. Wo ein
bestimmtes Format nötig ist, muss das vorab erkennbar sein.

problem  – bei nichtssagenden Beschriftungen wie "Feld 1", "Wert",
           "Eingabe", oder wenn ein besonderes Format nötig ist,
           aber nirgends erklärt wird
ok       – wenn die Beschriftung die erwartete Angabe benennt
unsicher – bei Fachbegriffen, die im Kontext der Anwendung klar
           sein könnten

Felder:
{{#elemente}}
{{i}}. Beschriftung: "{{label}}"
   Feldtyp: {{typ}}
   Platzhalter: "{{placeholder}}"
   Zusatzhinweis: "{{beschreibung}}"
{{/elemente}}
```

**Bündelgröße:** 20 · **Sammelselektor:** `input:not([type=hidden]), select, textarea`

---

## 7. `fehlerempfehlung` — Erfolgskriterium 3.3.3

**Frage:** Nennt die Fehlermeldung einen Weg zur Behebung?

```
Eine Fehlermeldung soll nicht nur sagen, dass etwas falsch ist, sondern
auch, wie es richtig geht.

problem  – bei Meldungen, die nur den Fehler feststellen, etwa
           "Ungültige Eingabe", "Fehler", "Bitte korrigieren"
ok       – wenn die Meldung erkennen lässt, was zu tun ist, etwa
           durch Angabe des erwarteten Formats oder eines Beispiels
unsicher – wenn die Meldung zwar Hinweise enthält, aber unklar bleibt,
           ob sie zur Behebung ausreichen

Fehlermeldungen mit dem betroffenen Feld:
{{#elemente}}
{{i}}. Feld: "{{feld}}"
   Meldung: "{{meldung}}"
{{/elemente}}
```

**Bündelgröße:** 20

---

## 8. `konsistente-bezeichnung` — Erfolgskriterium 3.2.4

**Frage:** Werden gleiche Funktionen überall gleich benannt?

```
Gleiche Funktionen sollen über alle Seiten hinweg gleich heißen. Wer
"Suchen" gelernt hat, soll nicht auf der nächsten Seite "Finden" suchen
müssen.

Du bekommst Beschriftungen von Bedienelementen, gruppiert nach ihrer
vermuteten Funktion, mit Angabe der Seite.

problem  – wenn dieselbe Funktion unterschiedlich benannt wird
ok       – wenn die Benennung durchgängig ist, oder wenn die
           unterschiedlichen Bezeichnungen unterschiedliche
           Funktionen bezeichnen
unsicher – wenn nicht erkennbar ist, ob es sich um dieselbe
           Funktion handelt

Gruppen:
{{#elemente}}
{{i}}. Vermutete Funktion: {{funktion}}
   Vorkommen:
   {{#vorkommen}}
   – "{{beschriftung}}" auf {{seite}}
   {{/vorkommen}}
{{/elemente}}
```

**Bündelgröße:** 20 · **nur mehrseitig**

---

## 9. `konsistente-hilfe` — Erfolgskriterium 3.2.6 *(nur WCAG 2.2)*

**Frage:** Stehen Hilfsangebote auf allen Seiten an derselben Stelle?

```
Hilfsangebote – Kontaktmöglichkeit, Hilfeseite, Chat – sollen auf allen
Seiten an derselben Stelle in der Seitenstruktur stehen.

Maßgeblich ist die Position relativ zur Seitenstruktur, nicht die
pixelgenaue Lage.

problem  – wenn dasselbe Hilfsangebot auf verschiedenen Seiten an
           unterschiedlichen Stellen der Struktur erscheint
ok       – wenn die Position durchgängig gleich ist, oder wenn ein
           Angebot auf einer Seite gar nicht vorkommt
unsicher – wenn nicht erkennbar ist, ob es sich um dasselbe Angebot
           handelt

Hilfsangebote je Seite:
{{#elemente}}
{{i}}. Angebot: "{{beschriftung}}"
   {{#vorkommen}}
   – {{seite}}: Bereich {{bereich}}, Position {{position}}
   {{/vorkommen}}
{{/elemente}}
```

**Bündelgröße:** 20 · **nur mehrseitig, nur WCAG 2.2**

---

## 10. `fokusreihenfolge` — Erfolgskriterium 2.4.3

**Frage:** Ist die Reihenfolge der Tastaturstopps sinnvoll?

```
Der Tastaturfokus wandert beim Drücken der Tabulatortaste von Element zu
Element. Die Reihenfolge soll der Bedienlogik folgen.

Du bekommst die Fokusstopps in der Reihenfolge, in der sie erreicht
werden, mit ihrer Beschriftung und ihrer Zugehörigkeit zu einem
Seitenbereich.

problem  – wenn die Reihenfolge dem Bedienablauf widerspricht, etwa
           wenn zwischen zwei Formularfeldern die Fußzeile liegt, oder
           wenn die Absenden-Schaltfläche vor den Eingabefeldern kommt
ok       – wenn die Reihenfolge dem erwarteten Ablauf folgt
unsicher – wenn sich der beabsichtigte Ablauf aus den Beschriftungen
           allein nicht erschließen lässt

Die rein visuelle Anordnung wurde bereits automatisch geprüft. Beurteile
die inhaltliche Bedienlogik.

Fokusstopps in Reihenfolge:
{{#stopps}}
{{i}}. [{{element}}] "{{beschriftung}}"  (Bereich: {{bereich}})
{{/stopps}}
```

**Bündelgröße:** 1

---

## 11. `lesereihenfolge` — Erfolgskriterium 1.3.2

**Frage:** Bleibt der Inhalt in der Quelltextreihenfolge verständlich?

```
Screenreader lesen den Inhalt in Quelltextreihenfolge vor. Diese muss
sinnvoll sein, auch wenn die Gestaltung eine andere Anordnung erzeugt.

Du bekommst die Textblöcke in Quelltextreihenfolge.

problem  – wenn die Abfolge inhaltlich nicht aufgeht, etwa wenn eine
           Bildunterschrift vor dem Bild steht, eine Antwort vor der
           Frage oder ein Ergebnis vor der Eingabe
ok       – wenn die Abfolge sinnvoll ist
unsicher – bei knappen Textfragmenten ohne erkennbaren Zusammenhang

Textblöcke in Quelltextreihenfolge:
{{#bloecke}}
{{i}}. [{{element}}] "{{text}}"
{{/bloecke}}
```

**Bündelgröße:** 1

---

## Umsetzungshinweise

**Vorfilterung spart die meiste Zeit.** Schicken Sie nur Zweifelsfälle an das Modell:

- Linktexte, die bereits mehr als drei Wörter haben und ein Substantiv enthalten, sind fast immer in Ordnung
- Eine Sperrliste (`hier`, `mehr`, `weiterlesen`, `klicken`, `Details`, `Link`) fängt die klaren Verstöße ohne Modellaufruf ab
- Nur was weder klar gut noch klar schlecht ist, geht an die Stufe 2

Das reduziert die Modellaufrufe je Seite typischerweise um mehr als die Hälfte — auf schwacher Hardware der wirksamste Hebel.

**Inhaltshash vor jedem Aufruf prüfen.** Der Hash bildet sich aus `pruefungsId` + normalisiertem Elementinhalt + Modellname. Navigationslinks, die auf jeder Seite gleich sind, werden dadurch genau einmal bewertet (L-28).

**Schemaverstoß ist kein Fehler.** Antwortet das Modell nicht schemakonform, gilt das betroffene Element als `unsicher`. Kein erneuter Versuch, keine Fehlermeldung — der Fall wandert in die manuelle Liste.

**Prompts sind Teil der Verifikation.** In Phase 8 wird jeder Prompt mit jedem Modell gegen den Testsatz gemessen. Prompts mit hoher Fehlalarmquote werden nachgeschärft, nicht die Modelle gewechselt.
