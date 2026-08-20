# Referenzseiten

Grundlage der Verifikation (PRD Abschnitt 10). Die Genauigkeit des Werkzeugs wird nicht behauptet, sondern gemessen.

## Aufbau

Jede mangelhafte Seite hat eine inhaltsgleiche saubere Fassung daneben. Das macht Fehlalarme sichtbar: Was auf der sauberen Fassung gemeldet wird, ist mit hoher Wahrscheinlichkeit einer.

| Paar | Deckt ab |
|---|---|
| `mangelhaft.html` / `sauber.html` | Die breite Seite: technische Verstöße quer durch alle vier Grundsätze |
| `bedienung-mangelhaft.html` / `bedienung-sauber.html` | 1.2.1, 1.3.2, 1.3.4, 2.1.4, 2.2.1, 2.4.3, 2.5.4, 2.5.7 |
| `fehlererkennung-mangelhaft.html` / `-sauber.html` | 3.3.1 und 3.3.8 — nur durch Absenden eines Formulars prüfbar |
| `fehlerempfehlung-mangelhaft.html` / `-sauber.html` | 3.3.3 — die Meldung benennt den Fehler, sagt aber nicht, wie er zu beheben ist |
| `tastaturfalle-mangelhaft.html` / `-sauber.html` | 2.1.2 |
| `fokuswechsel-mangelhaft.html` / `-sauber.html` | 3.2.1 |
| `mehrseitig-mangelhaft/` / `mehrseitig-sauber/` | 2.4.5, 3.2.3, 3.2.6 — nur über mehrere Seiten hinweg messbar |

`soll.json` hält fest, was das Werkzeug je Seite finden muss.

## Die Bilddateien

`team.jpg`, `trennlinie.png`, `aktion.png` und `captcha.png` sind erzeugt, nicht gezeichnet:

```bash
npm run referenzbilder
```

Was auf ihnen steht, steht als Text in `werkzeuge/referenzbilder.mjs` — nachlesbar, statt in einer Binärdatei zu verschwinden.

**Sie fehlten lange, und das ist teuer geworden.** Die Seiten verwiesen von Anfang an auf sie, vorhanden war keine. Für die beiden Testfälle zu 1.1.1 fiel das nicht auf: Ob ein `alt` fehlt oder den Dateinamen wiederholt, entscheidet sich am Markup. Für 1.4.5 schon — die Texterkennung lief nie. Sie meldete stattdessen „Bild konnte nicht geladen werden", und weil auch dieser Hinweis auf 1.4.5 zeigt, stand das Kriterium als „zur Prüfung vorgelegt" da und der Testfall galt als bestanden. Er hätte ebenso bestanden, wäre die Texterkennung vollständig ausgefallen.

Der Text auf `aktion.png` lautet deshalb bewusst **nicht** wie sein `alt`-Attribut in `mangelhaft.html`: Das Bild zeigt „20 %", das `alt` schreibt „20 Prozent". Wären beide wortgleich, prüfte der Testfall den Vergleich zweier Zeichenketten und nicht die Erkennung.

**Warum vier Seiten für sich stehen.** Die Tastaturfalle bricht den Tab-Durchlauf ab; was dahinter liegt, erreicht keine Prüfung mehr. Der Fokuswechsel wechselt beim bloßen Durchtabben den Zusammenhang; jede weitere Prüfung fände einen Zustand vor, den niemand absichtlich herbeigeführt hat. Die beiden Formularseiten hängen daran, dass genau ein Formular leer abgeschickt wird — geprüft wird immer das erste. Diese Verstöße auf der breiten Seite unterzubringen hieße, deren Messung zu verfälschen.

**Warum es eine Gruppe gibt.** Drei Kriterien tragen im Katalog `nurMehrseitig: true`. An einer Einzelseite sind sie zu Recht `nicht_anwendbar`; ihr Befund entsteht erst aus dem Vergleich mehrerer Seiten. Eine Gruppe wird deshalb als **ein** Scan über alle ihre Seiten geprüft, und gemessen wird die Projektebene.

## Verwendung

```bash
npm run verifikation                            # alles messen, Matrix schreiben
npm run verifikation -- --seite=sauber.html     # nur eine Seite oder Gruppe
npm run verifikation -- --nur-messen            # messen, ohne die Matrix zu schreiben
```

Je Kriterium wird ausgegeben:

| Kennzahl | Bedeutung |
|---|---|
| **belegt erkannt** | Verstoß in `soll.json` und als Verstoß gemeldet |
| **als offen gemeldet** | Verstoß in `soll.json`, als „Prüfung erforderlich“ gemeldet |
| **übersehen** | Verstoß in `soll.json`, als erfüllt oder nicht anwendbar geführt |
| **Fehlalarm** | Verstoß gemeldet, wo keiner steht |

Die Unterscheidung zwischen *übersehen* und *als offen gemeldet* ist der Kern: Ein Kriterium, das offen bleibt, kostet manuelle Arbeit. Eines, das fälschlich als erfüllt gilt, kostet die Gültigkeit des ganzen Berichts. **Nur das Zweite ist ein Fehler des Werkzeugs.**

## Die Abdeckungsmatrix

Der Lauf schreibt `katalog/abdeckung.json` — die Matrix, die PRD 10 verlangt. Sie ist **Teil der Anwendung**: Die Oberfläche zeigt sie unter „Was dieses Werkzeug findet“, und der Bericht führt sie im Methodikteil (X-15). Ohne sie sagt beides ausdrücklich, dass nicht gemessen wurde.

Fünf Einstufungen:

| Einstufung | Bedeutung |
|---|---|
| `belegt` | Jeder Testfall wurde als belegter Verstoß gemeldet |
| `teilweise` | Ein Teil belegt, der Rest zur Prüfung vorgelegt |
| `nur_hinweis` | Nie automatisch belegt — geht immer an Stufe 2 oder 3 |
| `luecke` | Ein eingebauter Verstoß blieb unbemerkt. Der einzige Wert, der ein Versagen beschreibt |
| `ungeprueft` | Kein Testfall vorhanden |

Eine einzige Lücke schlägt jede andere Einstufung. Wer das umdreht, bekommt eine Matrix, die genau dort beruhigend aussieht, wo ein Verstoß durchgewunken wurde.

## Grenzen dieser Seiten

Neun Kriterien haben keinen Testfall und werden auch keinen bekommen: **1.2.3, 1.2.4, 1.2.5, 2.3.1, 2.5.1, 2.5.2, 3.2.4, 3.3.4, 3.3.7.** Sie haben im Katalog keinen Automatikanteil — die Frage entscheidet sich am Inhalt oder am tatsächlichen Verhalten, nicht am Markup. Eine Referenzseite könnte dort nichts belegen.

Für die Verifikation der Sprachmodell-Stufe gibt es einen eigenen Satz: `test/modellsatz/`. Er wird mit `npm run modellvergleich` gemessen.

## Ergänzend zu verwenden

- **W3C Before-and-After-Demonstration** — dieselbe Seite in barrierefreier und nicht barrierefreier Fassung, von der W3C-Initiative gepflegt: <https://www.w3.org/WAI/demos/bad/>
- **Eine echte, extern geprüfte Seite** als Gegenprobe. Ein Werkzeug, das nur auf eigens gebauten Testseiten funktioniert, ist wertlos.

Beides ist bisher **nicht** in den Lauf eingebunden: Beide brauchen einen Netzzugriff, und die Verifikation läuft wie das Werkzeug selbst ohne Datenabfluss (NF-02). Wer sie heranzieht, spiegelt die Seiten lokal und trägt sie als weiteres Paar in `soll.json` ein — der Lauf braucht dafür keine Änderung.

## Pflege

Wird ein Kriterium im Katalog geändert, gehört die Referenzseite dazu. Eine neue Prüfung ohne Testfall ist unbelegt.

Beim Ergänzen von Verstößen: **einen Verstoß je Element**, damit die Zuordnung eindeutig bleibt. Ein Element, das gegen drei Kriterien gleichzeitig verstößt, macht die Auswertung mehrdeutig. Aus demselben Grund steht die Ausrichtungssperre in `bedienung-mangelhaft.html` auf einem kleinen Kasten und nicht auf `main`: Eine Drehung des ganzen Inhalts schiebt bei 200 Prozent Vergrößerung Text aus dem Bild und löst zusätzlich 1.4.4 aus.
