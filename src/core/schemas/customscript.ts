import { z } from "zod";

const looseString = z.union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => v == null ? "" : String(v))
  .pipe(z.string());
const optionalLooseString = z.union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => v == null || v === "" ? undefined : String(v))
  .pipe(z.string().optional());
const looseBool = z.union([z.boolean(), z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = v.toLowerCase().trim();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '') return false;
    return undefined;
  });

export const customscriptSchema = z
  .object({
    comment: looseString,
    in: looseString,
    out: looseString,
    type: looseString,
    flag: optionalLooseString,
    ableFlag: looseBool,
  })
  .passthrough();

export type CustomScript = z.infer<typeof customscriptSchema>;
