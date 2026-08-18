/**
 * Laufzeitschema des Pruefkatalogs.
 *
 * Spiegelt `katalog/schema.json`. Beide Fassungen muessen uebereinstimmen —
 * `test/katalog-schema.test.ts` gleicht sie automatisch ab, damit sie nicht
 * auseinanderlaufen.
 *
 * Der Katalog selbst bleibt Daten (Regel 1). Hier steht nur, welche Form diese
 * Daten haben duerfen, nicht welche Kriterien es gibt.
 */

import { z } from 'zod';

export const PRINZIPIEN = ['wahrnehmbarkeit', 'bedienbarkeit', 'verstaendlichkeit', 'robustheit'] as const;
export const LEVEL = ['A', 'AA'] as const;
export const ENGINES = ['axe', 'ibm', 'html', 'sprache', 'ocr', 'pixel', 'eigen'] as const;
export const PRUEFUNGS_TYPEN = ['auto', 'llm', 'manuell'] as const;
export const EINGEFUEHRT_MIT = ['2.0', '2.1', '2.2'] as const;

/** Dateien des Katalogs in fester Reihenfolge. */
export const KATALOG_DATEIEN = [
  '1-wahrnehmbarkeit',
  '2-bedienbarkeit',
  '3-verstaendlichkeit',
  '4-robustheit',
] as const;

const referenzSchema = z.strictObject({
  titel: z.string(),
  url: z.string().url(),
});

const empfehlungSchema = z.strictObject({
  text: z.string().min(20),
  codeBeispiel: z
    .strictObject({
      vorher: z.string(),
      nachher: z.string(),
    })
    .optional(),
  referenzen: z.array(referenzSchema),
});

const autoPruefungSchema = z.strictObject({
  typ: z.literal('auto'),
  engine: z.enum(ENGINES),
  regelIds: z.array(z.string()).min(1),
  hinweis: z.string().optional(),
});

const llmPruefungSchema = z.strictObject({
  typ: z.literal('llm'),
  pruefungsId: z.string().regex(/^[a-z0-9-]+$/),
  buendelGroesse: z.number().int().min(1).max(50),
  sammelSelektor: z.string().optional(),
  hinweis: z.string().optional(),
});

const manuellePruefungSchema = z.strictObject({
  typ: z.literal('manuell'),
  frage: z.string().min(10),
  kontextSelektor: z.string().optional(),
  hinweis: z.string().optional(),
});

export const pruefungSchema = z.discriminatedUnion('typ', [
  autoPruefungSchema,
  llmPruefungSchema,
  manuellePruefungSchema,
]);

export const kriteriumSchema = z.strictObject({
  id: z.string().regex(/^[1-4]\.[0-9]+\.[0-9]+$/),
  titel: z.string().min(3),
  level: z.enum(LEVEL),
  prinzip: z.enum(PRINZIPIEN),
  standard: z.strictObject({
    eingefuehrtMit: z.enum(EINGEFUEHRT_MIT),
    entfallenAb: z.literal('2.2').nullable(),
  }),
  beschreibung: z.string().min(20),
  anwendbarWenn: z.string().nullable(),
  nurMehrseitig: z.boolean().optional(),
  pruefungen: z.array(pruefungSchema).min(1),
  empfehlung: empfehlungSchema,
});

export const katalogDateiSchema = z.strictObject({
  prinzip: z.enum(PRINZIPIEN),
  kriterien: z.array(kriteriumSchema).min(1),
});

export type KatalogDatei = z.infer<typeof katalogDateiSchema>;
