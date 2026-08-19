# Testsatz für den Modellvergleich

Grundlage von PRD Abschnitt 10.1. Ob ein lokales Modell in der benötigten Größenordnung zuverlässig genug urteilt, ist eine **empirische Frage** — und wird hier beantwortet, nicht vorab entschieden.

## Aufbau

| Datei | Zweck |
|---|---|
| `satz.json` | Beispiele mit bekanntem Sollurteil, je Prüfung aus `prompts/stufe2.md` |
| `ergebnis-<modell>.json` | Messergebnis eines Laufs, erzeugt von `npm run modellvergleich` |

Jede Prüfung trägt eine `art`:

| Art | Bedeutung |
|---|---|
| `buendel` | Jeder Fall ist ein Element. Alle Fälle gehen gebündelt in einen Aufruf — genau wie im Betrieb |
| `folge` | Jeder Fall ist eine Abfolge und braucht einen eigenen Aufruf; das Urteil hängt am Zusammenhang |
| `seite` | Jeder Fall beschreibt eine ganze Seite und braucht einen eigenen Aufruf |

Der Aufruf wird mit derselben Vorlage und derselben Bündelgröße gestellt wie im Betrieb. Ein eigener, „sauberer“ Prompt für die Messung wäre wertlos: Gemessen wird, was die Anwendung tatsächlich fragt.

## Was gemessen wird

| Kennzahl | Bedeutung |
|---|---|
| **Trefferquote** | Anteil der Verstoßfälle, die das Modell als `problem` erkennt |
| **Fehlalarmquote** | Anteil der einwandfreien Fälle, die es als `problem` meldet |
| **Anteil unsicher** | Anteil aller Fälle mit dem Urteil `unsicher` |
| **falsches ok** | Verstoßfälle, die das Modell durchwinkt |
| **Laufzeit** | Dauer des Laufs und erzeugte Ausgabetoken je Sekunde |

**`unsicher` ist kein Mangel.** Es ist eine Kenngröße: Sie bestimmt, wie viel manuelle Nacharbeit anfällt. Ein Modell, das im Zweifel `unsicher` sagt, ist besser als eines, das rät.

**Ein durchgewunkener Verstoß ist ein Mangel.** Er sieht aus wie ein bestandener Test — dasselbe Muster wie „übersehen“ bei den Referenzseiten und aus demselben Grund die gefährlichste Zahl der Messung.

Ein Sollurteil ist deshalb immer `ok` oder `problem`, nie `unsicher`. Wer `unsicher` als Soll zuließe, machte aus dem Ausweichen des Modells ein bestandenes Ergebnis.

## Verwendung

```bash
npm run modellvergleich                            # alle lokal vorhandenen Modelle
npm run modellvergleich -- --modelle=a:8b,b:14b    # nur diese
npm run modellvergleich -- --pruefung=linkzweck    # nur eine Prüfung
```

Ohne laufendes Ollama passiert nichts, und das ist richtig so: Stufe 2 ist optional. Das Werkzeug sagt, was fehlt, und beendet sich.

## Stand der Messung

Bisher gemessen wurde ausschließlich **phi4-mini (3,8 B)** — das einzige Modell, das auf dem Abnahmerechner lag. Ergebnis über 130 Fälle:

| Kennzahl | Wert |
|---|---|
| Trefferquote | 32 % |
| Fehlalarmquote | 12 % |
| Anteil unsicher | 52 % |
| Durchgewunkene Verstöße | 10 |

Drei Prüfungen — `seitentitel`, `ueberschriftenhierarchie`, `lesereihenfolge` — antwortete das Modell zu **100 % mit `unsicher`**: Es entscheidet dort überhaupt nicht. Bei `konsistente-bezeichnung` und `konsistente-hilfe` lag die Fehlalarmquote bei 50 %.

**Damit ist belegt, dass ein Modell dieser Größe für Stufe 2 nicht genügt.** Das ist kein Ausfall des Werkzeugs — genau diese Aussage sollte die Messung liefern.

## Was noch aussteht

PRD 10.1 verlangt den Vergleich von mindestens drei Modellen:

| Modell | Zielhardware | Stand |
|---|---|---|
| 8 B | 8 GB VRAM | steht aus — nicht installiert |
| 12–14 B | 12 GB VRAM | steht aus — nicht installiert |
| Cloud-Modell als Referenzobergrenze | — | steht aus; es gibt bislang nur den Ollama-Adapter |

Die beiden lokalen Modelle sind Downloads von mehreren Gigabyte; sie werden nicht ungefragt nachgeladen. Nach `ollama pull <modell>` misst `npm run modellvergleich` sie ohne weitere Änderung mit.

Für das Cloud-Modell fehlt ein zweiter Adapter. Der Vertrag dafür steht (`src/stufe2/adapter/typ.ts`) und ist bewusst so geschnitten, dass ein weiterer Anbieter eine Konfigurationsänderung ist und kein Umbau — aber gebaut ist er nicht. Ein Cloud-Adapter bleibt ausdrücklich zu aktivieren und ist nie Voreinstellung.

## Pflege

Der Satz umfasst derzeit 130 Fälle. PRD und `test/referenzseiten/README.md` nennen als Ziel etwa 20 Beispiele je Prüfung, **aus echten Seiten gewonnen** — Modelle scheitern an echter Uneindeutigkeit, nicht an konstruierten Beispielen. Der vorliegende Satz ist konstruiert und deshalb eher zu freundlich als zu streng.

Wer einen Prompt in `prompts/stufe2.md` nachschärft, misst danach neu. Genau dafür ist der Satz da: **Prompts mit hoher Fehlalarmquote werden nachgeschärft, nicht die Modelle gewechselt.**
