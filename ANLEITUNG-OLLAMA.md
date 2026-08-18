# Ollama einrichten und anbinden

Anleitung für die Sprachmodell-Stufe (PRD 6.3, ARCHITEKTUR.md 5.7). Geschrieben für **macOS auf Apple Silicon**; die Abweichungen für Windows und Linux stehen am Ende.

**Wichtig vorab:** Die Stufe 2 ist optional. Das Werkzeug ist ohne sie vollständig nutzbar — die betroffenen zehn Kriterien wandern dann in die manuelle Liste. Sie können also mit Phase 1 bis 3 beginnen und Ollama später nachrüsten.

---

## 1. Arbeitsspeicher feststellen

Die Modellwahl hängt allein daran. Apple Silicon nutzt gemeinsamen Speicher — der Grafikteil bedient sich am selben RAM.

```bash
sysctl hw.memsize | awk '{printf "%.0f GB\n", $2/1073741824}'
```

| Ergebnis | Empfohlenes Modell | Erwartetes Tempo |
|---|---|---|
| **8 GB** | `phi4-mini` (3,8 Mrd. Parameter, ~2,3 GB) | 15–20 Token/s |
| **16 GB** | `qwen3:8b` (~5 GB) | 10–15 Token/s |
| **32 GB und mehr** | `phi4:14b` (~9 GB) | 10–15 Token/s, beste Urteilsqualität |

Bei 8 GB ist ein 8B-Modell zwar ladbar, verdrängt aber alles andere aus dem Speicher — Browser und Playwright laufen parallel. Nehmen Sie dort das kleinere Modell.

> **Zu MLX:** Ollama nutzt auf Apple Silicon seit Kurzem wahlweise MLX statt llama.cpp, was 15 bis 30 Prozent mehr Durchsatz bringt. MLX setzt jedoch **mindestens 32 GB** gemeinsamen Speicher voraus. Auf einem M1 mit 8 oder 16 GB greift es nicht — rechnen Sie mit den Werten oben.

## 2. Ollama installieren

```bash
brew install ollama
```

Alternativ die App von <https://ollama.com/download> laden. Der Unterschied: Die App legt ein Menüleistensymbol an und startet selbsttätig, die Homebrew-Fassung läuft als Dienst.

**Als Dienst starten:**

```bash
brew services start ollama
```

**Prüfen, ob er läuft:**

```bash
curl -s http://localhost:11434/api/version
```

Antwortet die Schnittstelle nicht, starten Sie Ollama im Vordergrund und sehen sich die Ausgabe an:

```bash
ollama serve
```

## 3. Modell laden

```bash
# bei 8 GB
ollama pull phi4-mini

# bei 16 GB
ollama pull qwen3:8b
```

Der Download liegt je nach Modell zwischen 2 und 9 GB.

**Kurz ausprobieren:**

```bash
ollama run phi4-mini "Antworte mit einem Wort: Ist der Linktext 'hier klicken' aussagekräftig?"
```

## 4. Strukturierte Ausgabe prüfen

Das ist der entscheidende Prüfschritt. Ohne erzwungenes Schema liefern kleine Modelle unbrauchbare Ergebnisse — mit Schema sind sie zuverlässig (L-02).

```bash
curl -s http://localhost:11434/api/chat -d '{
  "model": "phi4-mini",
  "stream": false,
  "options": { "temperature": 0 },
  "format": {
    "type": "object",
    "required": ["ergebnisse"],
    "properties": {
      "ergebnisse": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["i", "urteil"],
          "properties": {
            "i": { "type": "integer" },
            "urteil": { "enum": ["ok", "problem", "unsicher"] },
            "begruendung": { "type": "string" }
          }
        }
      }
    }
  },
  "messages": [{
    "role": "user",
    "content": "Beurteile, ob der Linktext allein den Zweck erkennen laesst.\n1. \"hier klicken\"\n2. \"Datenschutzerklaerung lesen\"\n3. \"mehr\""
  }]
}' | python3 -m json.tool
```

Erwartet wird eine Antwort, deren `message.content` genau dem Schema entspricht — mit `problem` für 1 und 3, `ok` für 2. Kommt etwas anderes zurück, stimmt die Ollama-Fassung nicht oder das Modell unterstützt die Funktion nicht.

## 5. Anbindung in der Anwendung

```bash
npm install ollama zod zod-to-json-schema
```

Der Adapter gehört nach `src/stufe2/adapter/ollama.ts`. Gerüst:

```ts
import { Ollama } from 'ollama';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const antwortSchema = z.object({
  ergebnisse: z.array(z.object({
    i: z.number().int(),
    urteil: z.enum(['ok', 'problem', 'unsicher']),
    begruendung: z.string().max(200).optional(),
  })),
});

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

export async function bewerteBuendel(
  modell: string,
  systemAnweisung: string,
  aufgabe: string,
): Promise<z.infer<typeof antwortSchema>['ergebnisse']> {

  const antwort = await ollama.chat({
    model: modell,
    stream: false,
    format: zodToJsonSchema(antwortSchema),
    keep_alive: '30m',          // siehe Fallstrick 2
    options: {
      temperature: 0,           // L-Regel: immer 0
      num_ctx: 8192,            // siehe Fallstrick 1
      num_predict: 1024,
    },
    messages: [
      { role: 'system', content: systemAnweisung },
      { role: 'user', content: aufgabe },
    ],
  });

  const gelesen = antwortSchema.safeParse(JSON.parse(antwort.message.content));

  // Schemaverstoss ist kein Fehler: alles gilt als 'unsicher'
  // und wandert in die manuelle Liste (L-23, ARCHITEKTUR 5.6).
  if (!gelesen.success) return [];

  return gelesen.data.ergebnisse;
}
```

Systemanweisung und Aufgabentexte stehen in `prompts/stufe2.md` und werden von dort geladen — nicht im Code wiederholen.

## 6. Drei Fallstricke

### Fallstrick 1 — zu kleines Kontextfenster

**Der wichtigste Punkt dieser Anleitung.** Ollama setzt das Kontextfenster ohne ausdrückliche Angabe auf einen kleinen Standardwert. Ein Bündel aus 20 Linktexten samt Umgebung sprengt ihn leicht.

Die Folge ist heimtückisch: Es gibt keine Fehlermeldung. Der Anfang der Anfrage wird abgeschnitten — meist die Systemanweisung — und das Modell antwortet auf eine Aufgabe, die es nur halb gesehen hat. Das Ergebnis sieht gültig aus und ist falsch.

**Setzen Sie `num_ctx` immer ausdrücklich.** 8192 reicht für Bündel von 20 Elementen. Wer größere Bündel fährt, muss den Wert anheben — und beachten, dass ein größeres Fenster mehr Speicher belegt.

### Fallstrick 2 — Modell wird zwischen Aufrufen entladen

Ohne `keep_alive` entlädt Ollama das Modell nach kurzer Untätigkeit aus dem Speicher. Beim nächsten Aufruf wird es neu geladen, was auf einem M1 mehrere Sekunden kostet. Bei zehn Aufrufen je Seite summiert sich das erheblich.

`keep_alive: '30m'` hält das Modell für die Dauer eines Scans geladen. Nach dem Scan sollte die Anwendung es freigeben:

```ts
await ollama.chat({ model: modell, messages: [], keep_alive: 0 });
```

### Fallstrick 3 — Ollama läuft nicht

Der Adapter darf beim Fehlen von Ollama nicht abstürzen. Prüfen Sie vor dem Scan die Erreichbarkeit und behandeln Sie den Fehlschlag als abgeschaltete Stufe 2 (L-26): Das Werkzeug läuft weiter, die betroffenen Kriterien gehen in die manuelle Liste, der Bericht vermerkt es (X-22).

## 7. Geschwindigkeit messen (L-44)

Die Anwendung soll die tatsächliche Geschwindigkeit einmal bei der Einrichtung messen, statt zu schätzen. Ollama liefert die nötigen Werte in jeder Antwort:

| Feld | Bedeutung |
|---|---|
| `prompt_eval_count` | verarbeitete Eingabetoken |
| `prompt_eval_duration` | dafür benötigte Zeit in Nanosekunden |
| `eval_count` | erzeugte Ausgabetoken |
| `eval_duration` | dafür benötigte Zeit in Nanosekunden |

```ts
const ausgabeTempo = antwort.eval_count / (antwort.eval_duration / 1e9);      // Token/s
const eingabeTempo = antwort.prompt_eval_count / (antwort.prompt_eval_duration / 1e9);
```

Daraus lässt sich die Dauer eines Scans vorab berechnen und anzeigen. Überschreitet die Schätzung fünf Minuten je Seite, warnt die Anwendung und bietet an, die Stufe zu überspringen (L-45).

**Grober Anhalt für einen M1:** rund 10 Modellaufrufe je Seite, etwa 1500 Eingabe- und 250 Ausgabetoken je Aufruf. Bei 15 Token/s Ausgabe und 300 Token/s Eingabe sind das etwa **3 bis 4 Minuten je Seite**. Mit der Vorfilterung aus `prompts/stufe2.md` halbiert sich das.

Für ein Prüfprofil aus 25 Seiten bleiben damit ein bis zwei Stunden — ein Lauf über Mittag oder über Nacht, nichts für zwischendurch. Für Einzelseiten während der Entwicklung ist es brauchbar.

## 8. Abweichungen für Windows und Linux

Nur die Installation unterscheidet sich; Schnittstelle, Adapter und Fallstricke sind gleich (ARCHITEKTUR.md 8.1).

| System | Installation |
|---|---|
| **Windows** | `winget install Ollama.Ollama` oder Installationsdatei von ollama.com; läuft danach als Dienst |
| **Linux** | `curl -fsSL https://ollama.com/install.sh \| sh`; Dienst über `systemctl start ollama` |

**Ohne Grafikkarte** — etwa auf einem gewöhnlichen Windows-Notebook — rechnen Sie mit rund 12 Token/s bei einem 3,8B-Modell und entsprechend 6 bis 10 Minuten je Seite. Der Betrieb ist unterstützt und auswählbar (L-43), aber nur für Einzelseiten sinnvoll.

## 9. Sicherheitshinweis

Ollama lauscht ohne Zutun nur auf `127.0.0.1`. **Belassen Sie es dabei.** Die Umgebungsvariable `OLLAMA_HOST=0.0.0.0` öffnet den Dienst für das gesamte Netz — ohne jede Zugangskontrolle. Da geprüfte Seiteninhalte durch das Modell laufen und diese aus geschützten Bereichen stammen können, widerspräche das NF-02.

---

## Kurzfassung

```bash
sysctl hw.memsize | awk '{printf "%.0f GB\n", $2/1073741824}'   # Speicher prüfen
brew install ollama
brew services start ollama
ollama pull phi4-mini          # bei 8 GB; bei 16 GB: qwen3:8b
curl -s http://localhost:11434/api/version
npm install ollama zod zod-to-json-schema
```

Danach den Adapter aus Abschnitt 5 anlegen und `num_ctx` sowie `keep_alive` **nicht** vergessen.
