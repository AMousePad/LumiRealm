import { z } from "zod";
import { customscriptSchema } from "./customscript.js";
import { loreBookSchema } from "./lorebook.js";
import { triggerscriptSchema } from "./triggerscript.js";

// MCP config is preserved but never executed, so unknown fields remain intact.
export const mcpModuleSchema = z.object({}).passthrough();
export type MCPModule = z.infer<typeof mcpModuleSchema>;

// Asset tuples tolerate missing trailing values because imports read by index.
export const moduleAssetSchema = z.preprocess(
  (v) => {
    if (!Array.isArray(v)) return v;
    const norm = (x: unknown) => x == null ? "" : String(x);
    return [norm(v[0]), norm(v[1]), norm(v[2])] as [string, string, string];
  },
  z.tuple([z.string(), z.string(), z.string()]),
);
export type ModuleAsset = z.infer<typeof moduleAssetSchema>;

const nullish = <T>(s: z.ZodType<T>) => s.nullish().transform((v) => v ?? undefined);

export const risuModuleSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    id: z.string(),
    lorebook: nullish(z.array(loreBookSchema)),
    regex: nullish(z.array(customscriptSchema)),
    cjs: nullish(z.string()),
    trigger: nullish(z.array(triggerscriptSchema)),
    lowLevelAccess: z
      .unknown()
      .nullish()
      .transform((v) => (v === undefined || v === null ? undefined : Boolean(v))),
    hideIcon: nullish(z.boolean()),
    backgroundEmbedding: nullish(z.string()),
    assets: nullish(z.array(moduleAssetSchema)),
    namespace: nullish(z.string()),
    customModuleToggle: nullish(z.string()),
    mcp: nullish(mcpModuleSchema),
    icon: nullish(z.string()),
  })
  .passthrough();

export type RisuModule = z.infer<typeof risuModuleSchema>;
