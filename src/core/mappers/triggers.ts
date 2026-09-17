import type { TriggerScript, TriggerBinding } from "../schemas/triggerscript.js";
import type { ScriptPackEntry, ScriptBindingEntry } from "../pipeline/types.js";
import { compileTrigger } from "../triggers/compile.js";


export interface CompileTriggersOptions {
  readonly characterId: string;
  readonly characterName?: string;
  readonly detectLua?: boolean;
  readonly runtimeLibrary?: string;
}

export interface CompileTriggersResult {
  readonly files: readonly ScriptPackEntry[];
  readonly issues: readonly { path: string; message: string }[];
  readonly opcodeUnimplemented: Readonly<Record<string, number>>;
  readonly luaCount: number;
}

const BINDING_EVENT_MAP: Readonly<Record<TriggerBinding, readonly string[]>> = {
  input: ["MESSAGE_SENT"],
  output: ["GENERATION_ENDED"],
  display: ["CHARACTER_MESSAGE_RENDERED"],
  start: ["ls:startup", "CHAT_CHANGED"],
  manual: [],
  request: ["GENERATION_STARTED"],
};

export function compileTriggers(
  triggers: readonly TriggerScript[],
  opts: CompileTriggersOptions,
): CompileTriggersResult {
  const files: ScriptPackEntry[] = [];
  const issues: { path: string; message: string }[] = [];
  const opcodeUnimplemented: Record<string, number> = {};
  let luaCount = 0;
  const seenSlugs = new Set<string>();

  triggers.forEach((t, i) => {
    if (!t.type || !Object.prototype.hasOwnProperty.call(BINDING_EVENT_MAP, t.type)) {
      issues.push({
        path: `trigger[${i}]`,
        message: `unknown binding type "${t.type}" — skipped`,
      });
      return;
    }

    const displayMode = t.type === "display";
    const lowLevelAccess = Boolean(t.lowLevelAccess);

    const compiled = compileTrigger(t, { displayMode, lowLevelAccess });
    for (const [opcode, count] of Object.entries(compiled.unimplementedCounts)) {
      opcodeUnimplemented[opcode] = (opcodeUnimplemented[opcode] ?? 0) + count;
    }
    for (const issue of compiled.issues) {
      if (issue.severity === "error") {
        issues.push({
          path: `trigger[${i}]`,
          message: `${issue.opcode}: ${issue.message}`,
        });
      }
    }

    const hasLua = Array.isArray(t.effect) && t.effect.some((e) => e.type === "triggerlua");
    if (hasLua) luaCount++;

    const slug = uniqueSlug(t.comment ?? "", t.type, i, seenSlugs);
    const events = BINDING_EVENT_MAP[t.type] ?? [];
    const runtimeLib = opts.runtimeLibrary ?? "risu-compat";
    const isManual = t.type === "manual";

    const code = renderTriggerCode({
      slug,
      name: nameFor(t, i, isManual ? "manual" : t.type),
      characterId: opts.characterId,
      binding: t.type,
      events,
      displayMode,
      lowLevelAccess,
      comment: t.comment ?? "",
      body: compiled.body,
      hasConditions: compiled.hasConditions,
      index: i,
      isManual,
      runtimeLib,
    });

    const bindings: readonly ScriptBindingEntry[] | undefined = isManual
      ? undefined
      : [
          {
            type: "character",
            characterId: opts.characterId,
            displayName: opts.characterName ?? opts.characterId,
          },
        ];

    const scriptName = isManual
      ? `risu-manual-${slug}`
      : `risu-trigger-${t.type}-${slug}`;

    const entry: ScriptPackEntry = {
      name: scriptName,
      code,
      type: isManual ? "library" : "trigger",
      folder: isManual ? "risu/manual" : `risu/${t.type}`,
      path: isManual
        ? `scripts/libraries/${scriptName}.js`
        : `scripts/triggers/${scriptName}.js`,
      ...(events.length > 0 ? { triggers: events } : {}),
      ...(bindings ? { bindings } : {}),
    };
    files.push(entry);
  });

  return { files, issues, opcodeUnimplemented, luaCount };
}

function nameFor(t: TriggerScript, i: number, fallback: string): string {
  const c = (t.comment ?? "").trim();
  return c.length > 0 ? c : `risu_${fallback}_${i}`;
}


interface RenderArgs {
  readonly slug: string;
  readonly name: string;
  readonly characterId: string;
  readonly binding: TriggerBinding;
  readonly events: readonly string[];
  readonly displayMode: boolean;
  readonly lowLevelAccess: boolean;
  readonly comment: string;
  readonly body: string;
  readonly hasConditions: boolean;
  readonly index: number;
  readonly isManual: boolean;
  readonly runtimeLib: string;
}

function renderTriggerCode(a: RenderArgs): string {
  const frontmatter = [
    `// @name       ${a.name}`,
    `// @type       ${a.isManual ? "library" : "trigger"}`,
    ...(a.events.length > 0
      ? [`// @triggers   ${a.events.join(", ")}`]
      : []),
    `// @folder     ${a.isManual ? "risu/manual" : `risu/${a.binding}`}`,
    `// @description LumiRealm translated trigger (character ${a.characterId}, binding ${a.binding}, source index ${a.index})`,
  ].join("\n");

  const comment = [
    `//`,
    `// source comment: ${sanitizeComment(a.comment)}`,
    `//`,
  ].join("\n");

  const rtOpts = JSON.stringify({
    displayMode: a.displayMode,
    lowLevelAccess: a.lowLevelAccess,
    binding: a.binding,
    characterId: a.characterId,
  });

  const bodyText = a.body.length > 0 ? a.body : "    // (empty trigger body)";

  const inner = [
    `const __rc = await script.require(${JSON.stringify(a.runtimeLib)});`,
    `const __risu = await __rc.makeRisuTriggerRuntime(api, data, script, ${a.isManual ? `{ ...${rtOpts}, invocationState: invokeCtx.invocationState }` : rtOpts});`,
    `try {`,
    bodyText,
    `} finally {`,
    `  await __risu.flush();`,
    `}`,
  ].join("\n");

  if (a.isManual) {
    return [
      frontmatter,
      comment,
      ``,
      `module.exports = {`,
      `  async run(invokeCtx) {`,
      `    const api = invokeCtx.api;`,
      `    const data = invokeCtx.data || {};`,
      `    const script = invokeCtx.script;`,
      indent(inner, "    "),
      `  },`,
      `};`,
      ``,
    ].join("\n");
  }

  return [frontmatter, comment, ``, inner, ``].join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}

function sanitizeComment(s: string): string {
  return s.replace(/\r?\n/g, " ").replace(/\*\//g, "*\\/").slice(0, 200);
}

function uniqueSlug(
  comment: string,
  type: TriggerBinding,
  index: number,
  seen: Set<string>,
): string {
  const base = slugify(comment) || `${type}_${index}`;
  let candidate = base;
  let n = 1;
  while (seen.has(candidate)) {
    n++;
    candidate = `${base}_${n}`;
  }
  seen.add(candidate);
  return candidate;
}

function slugify(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      c === 0x5f ||
      c === 0x2d
    ) {
      out.push(s[i]!);
    } else if (c === 0x20 || c === 0x09) {
      out.push("_");
    }
  }
  return out.join("").slice(0, 64);
}
