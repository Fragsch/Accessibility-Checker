# Accessibility-Checker

Lokales Prüfwerkzeug für digitale Barrierefreiheit nach **WCAG 2.1 Level AA**, umschaltbar auf WCAG 2.2.

Prüft Webseiten und Webanwendungen gegen alle Erfolgskriterien, zeigt je Kriterium einen von vier Status und liefert zu jedem Mangel eine konkrete Handlungsempfehlung. Läuft vollständig auf dem eigenen Rechner — geprüfte Inhalte verlassen ihn nicht.

## Stand

**Phase 0 abgeschlossen.** Der Prüfkatalog liegt vollständig vor. Die Anwendung selbst ist noch nicht gebaut.

## Was das Werkzeug können soll

| | |
|---|---|
| **Prüfumfang** | Einzelseite · gespeichertes Prüfprofil · Gesamtprüfung per Crawl |
| **Geschützte Bereiche** | ja — Anmeldung erfolgt durch den Menschen im sichtbaren Browserfenster |
| **Prüfstufen** | automatisch · lokales Sprachmodell · geführt manuell |
| **Abdeckung** | rund 85 % der Kriterien belastbar bewertet, ohne Sprachmodell rund 60 % |
| **Bericht** | Aufbau nach WCAG-EM, Bewertungssprache nach VPAT 2.5 / ACR, auf Deutsch |
| **Betriebssysteme** | Windows, macOS, Linux |

## Die vier Status

| | |
|---|---|
| ✅ **erfüllt** | Automatisch bestätigt, nichts offen |
| ❌ **nicht erfüllt** | Belegter Verstoß, mit Fundstelle und Empfehlung |
| ⚠️ **Prüfung erforderlich** | Modellhinweis oder offene manuelle Frage |
| ➖ **nicht anwendbar** | Auf dieser Seite gegenstandslos |

## Aufbau des Ordners

```
PRD.md              Was gebaut wird und warum — alle Entscheidungen samt Begründung
ARCHITEKTUR.md      Womit gebaut wird — Bibliotheken, Struktur, Datenbank, Ablaufregeln
CLAUDE.md           Arbeitsanweisung für die Umsetzung
ANLEITUNG-OLLAMA.md Sprachmodell einrichten und anbinden

katalog/          Der Prüfkatalog als Daten: 56 Kriterien, Schema, Pflegeanleitung
prompts/          Prompts der Sprachmodell-Stufe
werkzeuge/        Prüfskripte, die ohne Projektabhängigkeiten laufen
test/             Referenzseiten für die Verifikation
```

## Loslegen

```bash
npm run einrichten                   # Abhängigkeiten und Chromium installieren
node werkzeuge/katalog-pruefen.mjs   # Katalog prüfen — läuft sofort, ohne Installation
```

Der Katalog-Prüfer braucht nur Node und ist die schnellste Probe, ob die Grundlage unversehrt ist.

Die Bauabfolge steht in `ARCHITEKTUR.md` Abschnitt 9. Beginnen Sie dort, nicht bei der Oberfläche.

## Abgrenzung

Das Werkzeug ersetzt **keine** zertifizierte Prüfung. Für rechtsverbindliche Aussagen nach BFSG, BITV oder EN 301 549 ist weiterhin eine Prüfung durch qualifizierte Personen nötig. Es bereitet eine solche Prüfung vor, verkürzt sie erheblich und deckt den Großteil der Mängel vorab auf.

Solange Kriterien den Status ⚠️ tragen, ist der Bericht ausdrücklich ein Entwurf. Ungeprüfte Kriterien werden nie als konform ausgegeben.
