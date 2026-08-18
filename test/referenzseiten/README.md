# Referenzseiten

Grundlage der Verifikation (PRD Abschnitt 10). Die Genauigkeit des Werkzeugs wird nicht behauptet, sondern gemessen.

## Aufbau

| Datei | Zweck |
|---|---|
| `mangelhaft.html` | Enthält gezielt eingebaute Verstöße, einen je Kriterium |
| `sauber.html` | Dieselbe Seite, alle Mängel behoben |
| `soll.json` | Was das Werkzeug je Seite finden muss |

Beide Seiten sind inhaltlich gleich. Das macht Fehlalarme sichtbar: Was auf `sauber.html` gemeldet wird, ist mit hoher Wahrscheinlichkeit einer.

## Verwendung

```bash
npm run build
node dist/werkzeuge/verifikation.js test/referenzseiten/
```

Die Verifikation vergleicht die Befunde mit `soll.json` und gibt je Kriterium aus:

| Kennzahl | Bedeutung |
|---|---|
| **erkannt** | Verstoß in `soll.json` und gefunden |
| **übersehen** | Verstoß in `soll.json`, nicht gefunden |
| **Fehlalarm** | Befund auf `sauber.html` oder nicht in `soll.json` |

Zielwerte aus dem PRD: Fehlalarmquote unter 5 Prozent, Abdeckung mindestens 85 Prozent.

## Grenzen dieser Seiten

Die beiliegenden Seiten decken die **automatisch prüfbaren** Kriterien ab. Für Kriterien der Stufen 2 und 3 sind sie nur bedingt aussagekräftig, weil dort das Urteil vom Inhalt abhängt, nicht von der Technik.

Für die Verifikation der Sprachmodell-Stufe wird in Phase 8 ein eigener Satz gebraucht: je Prüfung aus `prompts/stufe2.md` etwa 20 Beispiele mit bekanntem Sollurteil, darunter bewusst Grenzfälle. Diesen Satz erstellt man am besten aus echten Seiten, nicht künstlich — Modelle scheitern an echter Uneindeutigkeit, nicht an konstruierten Beispielen.

## Ergänzend zu verwenden

- **W3C Before-and-After-Demonstration** — dieselbe Seite in barrierefreier und nicht barrierefreier Fassung, von der W3C-Initiative gepflegt: <https://www.w3.org/WAI/demos/bad/>
- **Eine echte, extern geprüfte Seite** als Gegenprobe. Ein Werkzeug, das nur auf eigens gebauten Testseiten funktioniert, ist wertlos.

## Pflege

Wird ein Kriterium im Katalog geändert, gehört die Referenzseite dazu. Eine neue Prüfung ohne Testfall ist unbelegt.

Beim Ergänzen von Verstößen: **einen Verstoß je Element**, damit die Zuordnung eindeutig bleibt. Ein Element, das gegen drei Kriterien gleichzeitig verstößt, macht die Auswertung mehrdeutig.
