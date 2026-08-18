# Prüfkatalog

Der Katalog ist **Daten, nicht Code** (PRD NF-06). Er ist der eigentliche Wert des Werkzeugs und muss unabhängig von der Anwendung pflegbar bleiben.

## Dateien

| Datei | Inhalt |
|---|---|
| `schema.json` | JSON-Schema zur Validierung |
| `1-wahrnehmbarkeit.json` | Erfolgskriterien 1.x |
| `2-bedienbarkeit.json` | Erfolgskriterien 2.x |
| `3-verstaendlichkeit.json` | Erfolgskriterien 3.x |
| `4-robustheit.json` | Erfolgskriterien 4.x |

**56 Kriterien insgesamt:** 50 aus WCAG 2.1 (A + AA), dazu 6 aus WCAG 2.2. Welche gelten, entscheidet der Vermerk `standard` — der gewählte Prüfstandard wirkt als Filter über einen gemeinsamen Katalog.

```
Standard 2.1 → alle mit eingefuehrtMit ∈ {2.0, 2.1}                   = 50
Standard 2.2 → alle mit eingefuehrtMit ∈ {2.0, 2.1, 2.2}
               und entfallenAb ≠ "2.2"                                 = 55
```

## Aufbau eines Eintrags

```jsonc
{
  "id": "1.1.1",
  "titel": "Nicht-Text-Inhalte",
  "level": "A",
  "prinzip": "wahrnehmbarkeit",
  "standard": { "eingefuehrtMit": "2.0", "entfallenAb": null },

  // Was das Kriterium verlangt — in verständlichem Deutsch, ohne Normsprache
  "beschreibung": "…",

  // CSS-Selektor. Findet er nichts, gilt das Kriterium als nicht anwendbar.
  // null = immer anwendbar
  "anwendbarWenn": "img, svg, canvas, …",

  "pruefungen": [ … ],

  "empfehlung": {
    "text": "…",
    "codeBeispiel": { "vorher": "…", "nachher": "…" },
    "referenzen": [ { "titel": "…", "url": "…" } ]
  }
}
```

### Prüfungen

Jede Prüfung hat einen `typ`, der die Stufe bestimmt:

| `typ` | Stufe | Pflichtfelder |
|---|---|---|
| `auto` | 1 | `engine`, `regelIds` |
| `llm` | 2 | `pruefungsId`, `buendelGroesse` |
| `manuell` | 3 | `frage` |

**Engines für `typ: "auto"`**

| `engine` | Bedeutung |
|---|---|
| `axe` | axe-core; `regelIds` sind axe-Regelnamen |
| `ibm` | IBM equal-access |
| `html` | `html-validate` |
| `sprache` | Spracherkennung über `franc-min` |
| `ocr` | `tesseract.js` |
| `pixel` | Eigene Bildauswertung |
| `eigen` | Eigene Prüfung; `regelIds` verweisen auf `src/stufe1/` |

**`pruefungsId` bei `typ: "llm"`** verweist auf einen Prompt in `prompts/stufe2.md`.

## Wichtiger Hinweis zu den axe-Regelnamen

Die eingetragenen `regelIds` sind ein **geprüfter Ausgangspunkt, keine garantierte Endfassung**. axe-core benennt Regeln zwischen Hauptversionen gelegentlich um und ordnet sie neu zu.

**In Phase 1 verbindlich zu tun:** Die tatsächlich vorhandenen Regeln über `axe.getRules()` auslesen und gegen den Katalog abgleichen. Jede Regel-ID im Katalog, die es nicht gibt, und jede axe-Regel ohne Zuordnung im Katalog wird als Warnung protokolliert. Der Abgleich läuft als Test bei jedem Build.

Das ist keine Nachlässigkeit, sondern die einzig belastbare Vorgehensweise: Die Zuordnung muss gegen die installierte Version geprüft werden, nicht gegen eine Dokumentation.

## Regeln für die Pflege

1. **Keine Norm-Zitate.** Die Beschreibung erklärt, was zu tun ist, nicht was die Richtlinie sagt.
2. **Empfehlungen sind umsetzbar.** Wer sie liest, weiß danach, welche Zeile Code zu ändern ist.
3. **Codebeispiele sind echt.** Vorher/Nachher, lauffähig, minimal.
4. **Ein Engine-Befund gehört zu genau einem Kriterium.** Doppelzuordnungen erzeugen Doppelmeldungen.
5. **Manuelle Fragen sind konkret.** Nicht „Prüfe die Untertitel", sondern eine Frage, die mit Ja oder Nein zu beantworten ist.
6. **Nach jeder Änderung gegen `schema.json` validieren.**
