# Migrationen

`../schema.sql` ist das Grundschema, Fassung 1. Eine frische Datenbank entsteht
allein daraus.

Jede spätere Änderung kommt als eigene Datei hierher:

```
002-benennung-der-aenderung.sql
003-weitere-aenderung.sql
```

Die Zahl ist die Zielfassung. Angewendet wird in aufsteigender Reihenfolge, der
Stand steht in `PRAGMA user_version`. Eine bereits angewendete Datei wird nie
verändert — sonst laufen bestehende Datenbanken auseinander.

`schema.sql` bleibt dabei unangetastet: Es beschreibt Fassung 1. Wer wissen
will, wie das Schema heute aussieht, liest `schema.sql` und danach die
Migrationen der Reihe nach.
