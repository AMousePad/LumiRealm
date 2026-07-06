import { z } from "zod";

export const loreBookModeSchema = z.enum([
  "multiple",
  "constant",
  "normal",
  "child",
  "folder",
]);
export type LoreBookMode = z.infer<typeof loreBookModeSchema>;

export const loreBookExtentionsSchema = z
  .object({
    risu_case_sensitive: z.boolean().optional(),
  })
  .passthrough();

export const loreCacheSchema = z
  .object({
    key: z.string(),
    data: z.array(z.string()),
  })
  .passthrough();

// Risu's TS types declare these as `number` but its runtime never validates,
// modules in the wild ship string forms because `>=`/`==` coerce.
const numberLike = z.union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  });
const boolLike = z.union([z.boolean(), z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = v.toLowerCase().trim();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '') return false;
    return undefined;
  });
const nullishNumber = numberLike;
const nullishBool = boolLike;
const nullishString = z.string().nullish().transform((v) => v ?? undefined);

const stringWithDefault = (dflt: string) =>
  z.union([z.string(), z.null(), z.undefined()]).transform((v) => v ?? dflt);
const numberWithDefault = (dflt: number) =>
  numberLike.transform((v) => v ?? dflt);
const boolWithDefault = (dflt: boolean) =>
  boolLike.transform((v) => v ?? dflt);

const modeWithDefault = z
  .union([loreBookModeSchema, z.null(), z.undefined()])
  .transform((v) => v ?? "normal");

export const loreBookSchema = z
  .object({
    key: stringWithDefault(""),
    secondkey: stringWithDefault(""),
    insertorder: numberWithDefault(100),
    comment: stringWithDefault(""),
    content: stringWithDefault(""),
    mode: modeWithDefault,
    alwaysActive: boolWithDefault(false),
    selective: boolWithDefault(false),
    extentions: loreBookExtentionsSchema.nullish().transform((v) => v ?? undefined),
    activationPercent: nullishNumber,
    // Risu's runtime activation cache. Types declare {key, data[]} but modules
    // in the wild ship a bare string, so tolerate any shape and keep only a
    // valid object (we don't consume it, just preserve provenance).
    loreCache: z.unknown().transform((v) => {
      const parsed = loreCacheSchema.safeParse(v);
      return parsed.success ? parsed.data : undefined;
    }),
    useRegex: nullishBool,
    bookVersion: nullishNumber,
    id: nullishString,
    folder: nullishString,
  })
  .passthrough();

export type LoreBook = z.infer<typeof loreBookSchema>;
