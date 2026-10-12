import type { TriggerScript, TriggerBinding } from "../schemas/triggerscript.js";
import { isImplementedTriggerEffect } from "../../interpreter/trigger-interpreter.js";

const BINDING_EVENT_MAP: Readonly<Record<TriggerBinding, readonly string[]>> = {
  input: ["MESSAGE_SENT"],
  output: ["GENERATION_ENDED"],
  display: ["CHARACTER_MESSAGE_RENDERED"],
  start: ["ls:startup", "CHAT_CHANGED"],
  manual: [],
  request: ["GENERATION_STARTED"],
};

export function prepareTriggerEntries(triggers: readonly TriggerScript[]) {
  const seen = new Set<string>();
  return triggers.flatMap((source, index) => {
    if (!Object.hasOwn(BINDING_EVENT_MAP, source.type)) return [];
    const slug = uniqueSlug(source.comment ?? '', source.type, index, seen);
    return [{
      name: source.type === 'manual' ? `risu-manual-${slug}` : `risu-trigger-${source.type}-${slug}`,
      type: source.type === 'manual' ? 'library' as const : 'trigger' as const,
      triggers: BINDING_EVENT_MAP[source.type],
      source,
    }];
  });
}

export function analyzeTriggers(triggers: readonly TriggerScript[]) {
  const issues: { path: string; message: string }[] = [];
  const opcodeUnimplemented: Record<string, number> = {};
  let count = 0;
  let luaCount = 0;
  triggers.forEach((trigger, index) => {
    if (!Object.hasOwn(BINDING_EVENT_MAP, trigger.type)) {
      issues.push({ path: `trigger[${index}]`, message: `unknown binding type "${trigger.type}" — skipped` });
      return;
    }
    count++;
    if (trigger.effect?.some(effect => effect.type === 'triggerlua')) luaCount++;
    for (const effect of trigger.effect ?? []) {
      if (!isImplementedTriggerEffect(effect.type)) {
        opcodeUnimplemented[effect.type] = (opcodeUnimplemented[effect.type] ?? 0) + 1;
      }
    }
  });
  return { count, issues, opcodeUnimplemented, luaCount };
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
