import type {
  PromptBlockDTO,
  PromptVariableDefDTO,
  RegexScriptCreateDTO,
  UserPresetCreateDTO,
} from 'lumiverse-spindle-types';
import type { RisuPresetRaw } from './risup-decoder.js';
import { mapRegex, type AtAtAction } from '../mappers/regex.js';
import { newUuid } from '../mappers/util.js';
import { TranslationError } from '../errors.js';

export interface ParsedToggleGroup {
  readonly name: string;
  readonly variables: PromptVariableDefDTO[];
}

export function parseRisuToggleSyntax(template: string | undefined): ParsedToggleGroup[] {
  if (!template || typeof template !== 'string') return [];
  const lines = template.split('\n');
  const groups: ParsedToggleGroup[] = [];
  let currentGroup: { name: string; variables: PromptVariableDefDTO[] } = {
    name: 'General Toggles',
    variables: [],
  };
  groups.push(currentGroup);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('=');
    const key = parts[0]?.trim();
    const value = parts[1]?.trim();
    const type = parts[2]?.trim();
    const option = parts[3]?.trim();

    if (type === 'group' || (trimmed.startsWith('=') && trimmed.endsWith('=group'))) {
      const gName = trimmed.replace(/^=*/, '').replace(/=group$/, '').replace(/=*$/, '').trim();
      currentGroup = {
        name: gName || 'Toggle Group',
        variables: [],
      };
      groups.push(currentGroup);
      continue;
    }

    if (type === 'divider' || type === 'caption') {
      continue;
    }

    if (key && value !== undefined) {
      const varName = 'toggle_' + key;
      const label = value;
      if (type === 'select' && option) {
        const rawOptions = option.split(',');
        const options = rawOptions.map((opt, idx) => ({
          id: String(idx),
          label: opt.trim() || `Option ${idx}`,
          value: String(idx),
        }));
        currentGroup.variables.push({
          id: newUuid(),
          name: varName,
          label: label || varName,
          type: 'select',
          defaultValue: options[0]?.value ?? '0',
          options,
        });
      } else if (type === 'text') {
        currentGroup.variables.push({
          id: newUuid(),
          name: varName,
          label: label || varName,
          type: 'text',
          defaultValue: '',
        });
      } else if (type === 'textarea') {
        currentGroup.variables.push({
          id: newUuid(),
          name: varName,
          label: label || varName,
          type: 'textarea',
          defaultValue: '',
        });
      } else {
        currentGroup.variables.push({
          id: newUuid(),
          name: varName,
          label: label || varName,
          type: 'switch',
          defaultValue: 0,
        });
      }
    }
  }

  return groups.filter((g) => g.variables.length > 0);
}


// Risu's risuChatParser closes the innermost block regardless of the closing label.
// The host instead requires a closing macro whose name matches its opener.
function namePresetBlockClosers(template: string): string {
  const blocks: string[] = [];
  const openings: number[] = [];
  let result = '';
  let copied = 0;
  for (const token of template.matchAll(/\{\{|\}\}/g)) {
    const offset = token.index!;
    if (token[0] === '{{') {
      openings.push(offset);
      continue;
    }
    const start = openings.pop();
    if (start === undefined || openings.length > 0) continue;
    const inner = template.slice(start + 2, offset);
    const opener = /^#([a-zA-Z_]+)\b/.exec(inner);
    if (opener) {
      blocks.push(opener[1]!);
    } else if (inner.startsWith('/') && !inner.startsWith('//')) {
      const name = blocks.pop();
      if (name !== undefined) {
        result += template.slice(copied, start) + `{{/${name}}}`;
        copied = offset + 2;
      }
    }
  }
  return result + template.slice(copied);
}

// Risu's blockEndMatcher passes an each body through trimLines unless its header
// says ::keep, before any item is substituted, so the trim is static.
function trimEachBodies(template: string): string {
  const openings: number[] = [];
  const blocks: { readonly inner: string; readonly bodyStart: number }[] = [];
  let result = '';
  let copied = 0;
  for (const token of template.matchAll(/\{\{|\}\}/g)) {
    const offset = token.index!;
    if (token[0] === '{{') {
      openings.push(offset);
      continue;
    }
    const start = openings.pop();
    if (start === undefined || openings.length > 0) continue;
    const inner = template.slice(start + 2, offset);
    if (inner.startsWith('#')) {
      blocks.push({ inner, bodyStart: offset + 2 });
    } else if (inner.startsWith('/') && !inner.startsWith('//')) {
      const block = blocks.pop();
      if (block === undefined || blocks.length > 0) continue;
      let body = trimEachBodies(template.slice(block.bodyStart, start));
      if (/^#each\b/.test(block.inner) && !block.inner.slice(5).trim().startsWith('::keep ')) {
        body = body.trim().split('\n').map((line) => line.trimStart()).join('\n').trim();
      }
      result += template.slice(copied, block.bodyStart) + body;
      copied = start;
    }
  }
  return result + template.slice(copied);
}

/**
 * Rewrites one Risu macro in place while keeping a dynamic body intact. A plain
 * regex cannot: Risu allows a macro as another macro's argument
 * ({{getglobalvar::{{slot::x}}}}), so the macro ends at the matching closing
 * brace, not at the first `}}`.
 */
function rewriteMacroBody(template: string, name: string, build: (body: string) => string, open = `{{${name}::`): string {
  let result = '';
  let i = 0;
  while (i < template.length) {
    const start = template.indexOf(open, i);
    if (start === -1) return result + template.slice(i);
    let depth = 0;
    let j = start;
    while (j < template.length) {
      if (template.slice(j, j + 2) === '{{') {
        depth++;
        j += 2;
      } else if (template.slice(j, j + 2) === '}}') {
        depth--;
        j += 2;
        if (depth === 0) break;
      } else {
        j++;
      }
    }
    // An unterminated macro is left alone rather than guessed at.
    if (depth !== 0) return result + template.slice(i);
    result += template.slice(i, start) + build(template.slice(start + open.length, j - 2));
    i = j;
  }
  return result;
}

/** Splits a macro body on `::`, ignoring separators inside nested macros. */
function splitMacroArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length - 1; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{') {
      depth++;
      i++;
    } else if (two === '}}') {
      depth--;
      i++;
    } else if (depth === 0 && two === '::') {
      args.push(body.slice(start, i));
      i++;
      start = i + 1;
    }
  }
  args.push(body.slice(start));
  return args;
}

// Risu's each header (blockStartMatcher) is `[::keep] [as] LIST as NAME` or `LIST NAME`.
// risuList re-joins the Risu array on §, which the host loop splits on instead of
// commas; the # flag asks the host to keep item whitespace and blank items as Risu does.
function translateEachHeader(header: string): string {
  let t2 = header.trim();
  if (t2.startsWith('::keep ')) t2 = t2.substring(7).trim();
  if (t2.startsWith('as ')) t2 = t2.substring(3).trim();
  const asIndex = t2.lastIndexOf(' as ');
  const split = asIndex === -1 ? t2.lastIndexOf(' ') : asIndex;
  if (split === -1) return `{{#each${header}}}`;
  const name = t2.substring(split + (asIndex === -1 ? 1 : 4)).trim();
  return `{{#each::{{risuList::${t2.substring(0, split)}}}::${name}::§}}`;
}

function rewriteCalculations(template: string): string {
  let result = '';
  let i = 0;
  const n = template.length;
  while (i < n) {
    if (template.slice(i, i + 3) === '{{?') {
      let depth = 1;
      let j = i + 3;
      while (j < n && depth > 0) {
        if (template.slice(j, j + 2) === '{{') {
          depth++;
          j += 2;
        } else if (template.slice(j, j + 2) === '}}') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      if (depth !== 0) return result + template.slice(i);
      const expr = rewriteCalculations(template.slice(i + 3, j - 2).trim());
      result += `{{risuCalc::${expr}}}`;
      i = j;
    } else {
      result += template[i];
      i++;
    }
  }

  return result;
}

/**
 * Translates embedded Risu CBS expressions in preset blocks into Lumiverse-compatible macros.
 * Recursively maps {{? expr}} -> {{risuCalc::expr}}, variable lookups, and boolean helpers.
 */
export function transformPresetTemplate(template: string): string {
  if (!template || typeof template !== 'string' || !template.includes('{{')) {
    return template;
  }

  let result = rewriteCalculations(template);

  // 2. Map global-variable getters: {{getglobalvar::x}} -> {{risuGlobalVar::x}}.
  //    Preset blocks are evaluated by the HOST macro engine (prompt-assembly
  //    passes sourceOwner:"host", which skips macro interceptor chains), so the
  //    value must come from a LumiRealm-registered host macro. `{{var::}}` is the
  //    wrong reader: it resolves the preset prompt-variable store, which holds
  //    only the import-time toggle defaults and never the user's State → Toggles
  //    choice. risuGlobalVar applies the same effective-globals overlay (chat
  //    globals + persisted user toggle preferences) LumiRealm's own engine uses.
  result = rewriteMacroBody(result, 'getglobalvar', (body) => `{{risuGlobalVar::${body}}}`);
  // Risu's getvar reads the chat variables the host holds in `variables.chat`,
  // so it is mapped before the rewrites below emit the host's local {{getvar}}.
  result = rewriteMacroBody(result, 'getvar', (body) => `{{risuChatVar::${body}}}`);

  // 3. Risu loop and scratch reads -> the host's local scope. Risu's #each
  //    substitutes {{slot::NAME}} textually; the host's {{each}} binds the loop
  //    variable in `variables.local`, which {{getvar::}} reads. Risu temp
  //    variables live for a single parser pass and no host surface carries
  //    per-pass state, so they share that local scope, which the host resets per
  //    assembly and which extension macros (unlike host built-ins) cannot write.
  result = result.replace(/\{\{slot::([a-zA-Z0-9_]+)\}\}/g, '{{getvar::$1}}');
  result = result.replace(/\{\{(?:get)?tempvar::([a-zA-Z0-9_]+)\}\}/g, '{{getvar::$1}}');
  result = rewriteMacroBody(result, 'settempvar', (body) => {
    const args = splitMacroArgs(body);
    // Risu reads a missing argument as "", so the one-argument form clears it.
    return `{{setvar::${args[0] ?? ''}::${args[1] ?? ''}}}`;
  });

  // 4. Normalize pure-if conditionals: {{#if_pure ...}} -> {{#if ...}}, {{/if_pure}} -> {{/if}}
  result = result.replace(/\{\{#if_pure\b/g, '{{#if');
  result = result.replace(/\{\{\/if_pure\}\}/g, '{{/if}}');

  result = namePresetBlockClosers(result);
  result = trimEachBodies(result);

  // 5. Map common CBS helpers to namespaced compatibility macros. Risu's list
  //    construction ({{array::a::b}}) becomes the § list Risu's parseArray reads
  //    back as the same items.
  result = rewriteMacroBody(result, '#each', translateEachHeader, '{{#each');
  result = rewriteMacroBody(result, 'array', (body) => splitMacroArgs(body).join('§'));
  result = result.replace(/\{\{contains::/g, '{{risuContains::');
  result = result.replace(/\{\{length::/g, '{{risuLength::');
  result = result.replace(/\{\{and::/g, '{{risuAnd::');
  result = result.replace(/\{\{or::/g, '{{risuOr::');
  result = result.replace(/\{\{any::/g, '{{risuAny::');
  result = result.replace(/\{\{not::/g, '{{risuNot::');
  result = result.replace(/\{\{equal::/g, '{{risuEqual::');
  // Risu's primary name and its alias both mean the same macro (cbs.ts notequal).
  result = result.replace(/\{\{notequal::/g, '{{risuNotEqual::');
  result = result.replace(/\{\{not_equal::/g, '{{risuNotEqual::');

  return result;
}

/** A Risu chat item's slice as offsets from the chat end (0 is the end); a null start is the first message. */
export interface RisuChatRange {
  readonly start: number | null;
  readonly end: number;
}

export const isFromEnd = (bound: unknown): bound is number => Number.isInteger(bound) && (bound as number) < 0;

// Risu's sendChat 'chat' case slices its chat list per item. Positive indices count from Risu's example
// and separator prefix, which the host history lacks, and one host history cannot repeat or reorder messages.
function risuChatRanges(template: readonly Record<string, unknown>[]): RisuChatRange[] {
  const ranges: RisuChatRange[] = [];
  for (const item of template) {
    if (item['type'] !== 'chat') continue;
    const { rangeStart = 0, rangeEnd = 'end' } = item;
    const label = `Risu chat item range [${JSON.stringify(rangeStart)}, ${JSON.stringify(rangeEnd)}]`;
    let range: RisuChatRange = { start: null, end: 0 };
    if (rangeStart !== -1000) {
      if (!(rangeStart === 0 || isFromEnd(rangeStart)) || !(rangeEnd === 'end' || isFromEnd(rangeEnd))) {
        throw new TranslationError('risup/unsupported_chat_range', `${label} is not relative to the chat end`);
      }
      range = { start: rangeStart === 0 ? null : rangeStart, end: rangeEnd === 'end' ? 0 : rangeEnd };
    }
    const previous = ranges.at(-1);
    if ((range.start !== null && range.start >= range.end) || (previous && (range.start === null || range.start < previous.end))) {
      throw new TranslationError('risup/unsupported_chat_range', `${label} is empty or overlaps an earlier chat item`);
    }
    ranges.push(range);
  }
  return ranges;
}

export function translateRisuPromptBlocks(
  template: readonly Record<string, unknown>[] | undefined,
  toggleGroups: readonly ParsedToggleGroup[],
): { blocks: PromptBlockDTO[]; defaultsByBlockId: Record<string, Record<string, unknown>>; chatRanges: RisuChatRange[] } {
  const blocks: PromptBlockDTO[] = [];
  const defaultsByBlockId: Record<string, Record<string, unknown>> = {};

  // 1. Structural category blocks for toggle groups
  for (const group of toggleGroups) {
    const blockId = newUuid();
    const defaults: Record<string, unknown> = {};
    for (const v of group.variables) {
      defaults[v.name] = v.defaultValue;
    }
    defaultsByBlockId[blockId] = defaults;

    blocks.push({
      id: blockId,
      name: group.name,
      role: 'system',
      enabled: true,
      position: 'pre_history',
      depth: 0,
      marker: 'category',
      content: '',
      isLocked: false,
      color: null,
      injectionTrigger: [],
      group: null,
      variables: group.variables,
    } as PromptBlockDTO);
  }

  // 2. Structural category block for prompt assembly (if toggles exist)
  if (toggleGroups.length > 0) {
    blocks.push({
      id: newUuid(),
      name: '🧩 Prompt Assembly',
      role: 'system',
      enabled: true,
      position: 'pre_history',
      depth: 0,
      marker: 'category',
      content: '',
      isLocked: false,
      color: null,
      injectionTrigger: [],
      group: null,
    } as PromptBlockDTO);
  }

  // 3. Prompt template items
  let seenChat = false;
  let seenPersona = false;
  let chats = 0;
  // Without a template Risu sends the whole chat.
  let chatRanges: RisuChatRange[] = [{ start: null, end: 0 }];
  if (Array.isArray(template)) {
    chatRanges = risuChatRanges(template);
    for (const item of template) {
      const type = typeof item['type'] === 'string' ? item['type'] : 'plain';
      const roleField = ['persona', 'description', 'authornote'].includes(type) ? 'role2' : 'role';
      const rawRole = typeof item[roleField] === 'string' ? item[roleField] : 'system';
      const role: 'system' | 'user' | 'assistant' =
        rawRole === 'bot' || rawRole === 'assistant' || rawRole === 'char'
          ? 'assistant'
          : rawRole === 'user'
          ? 'user'
          : 'system';
      const rawText = typeof item['text'] === 'string' ? item['text'] : '';
      const text = transformPresetTemplate(rawText);
      const name = typeof item['name'] === 'string' && item['name'].trim() && item['name'] !== 'undefined'
        ? item['name'].trim()
        : null;
      const type2 = typeof item['type2'] === 'string' ? item['type2'] : 'normal';
      const enabled = type2 !== 'disabled' && item['enabled'] !== false;
      // The host renders one history, so items between two chat items sit inside it where the earlier slice ends.
      const position = !seenChat ? 'pre_history' : chats < chatRanges.length ? 'in_history' : 'post_history';
      const depth = position === 'in_history' ? -chatRanges[chats - 1]!.end : 0;

      if (type === 'plain') {
        blocks.push({
          id: newUuid(),
          name: name || (type2 === 'main' ? '# System Rule' : 'Prompt Block'),
          role,
          enabled,
          position,
          depth,
          marker: null,
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      } else if (type === 'chat') {
        chats++;
        if (!seenChat) {
          seenChat = true;
          blocks.push({
            id: newUuid(),
            name: name || 'Chat History',
            role: 'system',
            enabled: true,
            position: 'in_history',
            depth: 0,
            marker: 'chat_history',
            content: '',
            isLocked: false,
            color: null,
            injectionTrigger: [],
      group: null,
          } as PromptBlockDTO);
        }
      } else if (type === 'persona') {
        // innerFormat holds the item's own CBS code, so it needs the same macro
        // translation the plain path applies to `text`.
        const rawInner = typeof item['innerFormat'] === 'string' && item['innerFormat'].trim().length > 0 ? item['innerFormat'] : null;
        const personaContent = rawInner
          ? transformPresetTemplate(rawInner.includes('{{slot}}') ? rawInner.replace('{{slot}}', '{{persona}}') : rawInner)
          : (text || '{{persona}}');
        // Host structural markers ignore content, including wrappers and placement gates.
        const personaMarker: PromptBlockDTO['marker'] = !seenPersona && personaContent === '{{persona}}'
          ? 'persona_description'
          : null;
        seenPersona = true;
        blocks.push({
          id: newUuid(),
          name: name || 'User Persona',
          role,
          enabled,
          position,
          depth,
          marker: personaMarker,
          content: personaContent,
          isLocked: false,
          color: null,
          injectionTrigger: [],
          group: null,
        } as PromptBlockDTO);
      } else if (type === 'description') {
        const rawInner = typeof item['innerFormat'] === 'string' && item['innerFormat'].trim().length > 0 ? item['innerFormat'] : null;
        const descContent = rawInner
          ? transformPresetTemplate(rawInner.includes('{{slot}}') ? rawInner.replace('{{slot}}', '{{description}}') : rawInner)
          : (text || '{{description}}');
        blocks.push({
          id: newUuid(),
          name: name || 'Character Description',
          role,
          enabled,
          position,
          depth,
          marker: descContent === '{{description}}' ? 'char_description' : null,
          content: descContent,
          isLocked: false,
          color: null,
          injectionTrigger: [],
          group: null,
        } as PromptBlockDTO);
      } else if (type === 'lorebook') {
        blocks.push({
          id: newUuid(),
          name: name || 'World Info',
          role: 'system',
          enabled,
          position,
          depth,
          marker: seenChat ? 'world_info_after' : 'world_info_before',
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
          group: null,
        } as PromptBlockDTO);
      } else if (type === 'authornote') {
        const rawInner = typeof item['innerFormat'] === 'string' && item['innerFormat'].trim().length > 0 ? item['innerFormat'] : null;
        // {{authornote}} is the slot name Risu and LumiRealm's own evaluator use;
        // neither it nor {{authors_note}} is registered in the host macro
        // registry, so this slot needs a host macro to resolve.
        const anContent = rawInner
          ? transformPresetTemplate(rawInner.includes('{{slot}}') ? rawInner.replace('{{slot}}', '{{authornote}}') : rawInner)
          : (text || '{{authornote}}');
        blocks.push({
          id: newUuid(),
          name: name || "Author's Note",
          role,
          enabled,
          position,
          depth,
          marker: null,
          content: anContent,
          isLocked: false,
          color: null,
          injectionTrigger: [],
          group: null,
        } as PromptBlockDTO);
      } else if (type === 'memory') {
        blocks.push({
          id: newUuid(),
          name: name || 'Long Term Memory',
          role: 'system',
          enabled,
          position,
          depth,
          marker: null,
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      } else if (type === 'cache') {
        blocks.push({
          id: newUuid(),
          name: name || 'Cache Point',
          role: 'system',
          enabled,
          position,
          depth,
          marker: null,
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      } else if (type === 'jailbreak') {
        blocks.push({
          id: newUuid(),
          name: name || 'Jailbreak',
          role: role === 'assistant' ? 'assistant' : (role === 'user' ? 'user' : 'system'),
          enabled,
          position,
          depth,
          marker: 'jailbreak',
          content: text || '{{jailbreak}}',
          isLocked: false,
          color: null,
          injectionTrigger: [],
          group: null,
        } as PromptBlockDTO);
      } else if (type === 'postEverything') {
        // End-injected prompts marker in Risu; do not prematurely override chat history.
      } else {
        blocks.push({
          id: newUuid(),
          name: name || String(type),
          role,
          enabled,
          position,
          depth,
          marker: null,
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      }
    }
  }

  if (!seenChat) {
    blocks.push({
      id: newUuid(),
      name: 'Chat History',
      role: 'system',
      enabled: true,
      position: 'in_history',
      depth: 0,
      marker: 'chat_history',
      content: '',
      isLocked: false,
      color: null,
      injectionTrigger: [],
      group: null,
    } as PromptBlockDTO);
  }

  return { blocks, defaultsByBlockId, chatRanges };
}

export interface TranslatedRisuPreset {
  readonly preset: UserPresetCreateDTO;
  readonly regexScripts: RegexScriptCreateDTO[];
  /** Rules that need the card at-action runtime, which a preset row cannot reach. */
  readonly skippedRegex: readonly AtAtAction[];
}

export function translateRisuPreset(raw: RisuPresetRaw, fallbackName = 'Imported Preset'): TranslatedRisuPreset {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName;

  const cleanSampler = (val: unknown): number | null => {
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= -1000) return null;
    return val;
  };

  const percentageSampler = (val: unknown): number | null => {
    const value = cleanSampler(val);
    return value === null ? null : value / 100;
  };

  const samplerOverrides = {
    enabled: true,
    temperature: percentageSampler(raw.temperature),
    maxTokens: cleanSampler(raw.maxResponse),
    contextSize: cleanSampler(raw.maxContext),
    topP: cleanSampler(raw.top_p),
    topK: cleanSampler(raw.top_k),
    minP: cleanSampler(raw.min_p),
    frequencyPenalty: percentageSampler(raw.frequencyPenalty),
    presencePenalty: percentageSampler(raw.PresensePenalty),
    repetitionPenalty: cleanSampler(raw.repetition_penalty),
    streaming: true,
  };

    const toggleGroups = parseRisuToggleSyntax(raw.customPromptTemplateToggle);
  const { blocks, defaultsByBlockId, chatRanges } = translateRisuPromptBlocks(raw.promptTemplate, toggleGroups);
  // The host always renders the whole history, so the prompt interceptor drops what these slices leave out.
  const wholeHistory = chatRanges.at(-1)?.end === 0
    && chatRanges.every((range, i) => range.start === (chatRanges[i - 1]?.end ?? null));

  const regexScripts: RegexScriptCreateDTO[] = [];
  let skippedRegex: readonly AtAtAction[] = [];
  if (Array.isArray(raw.regex) && raw.regex.length > 0) {
    const mapRes = mapRegex(raw.regex as any, {
      characterId: 'global-preset',
      scope: 'global',
      scopeId: null,
      folder: name,
    });
    skippedRegex = mapRes.skipped;
    for (const r of mapRes.rows) {
      regexScripts.push({
        name: r.name,
        find_regex: r.find_regex,
        replace_string: r.replace_string,
        flags: r.flags,
        placement: [...r.placement],
        scope: r.scope,
        scope_id: r.scope_id,
        target: r.target,
        min_depth: r.min_depth,
        max_depth: r.max_depth,
        trim_strings: [...r.trim_strings],
        run_on_edit: r.run_on_edit,
        substitute_macros: r.substitute_macros,
        disabled: r.disabled,
        sort_order: r.sort_order,
        description: r.description,
        folder: r.folder,
        metadata: r.metadata,
      });
    }
  }

  const preset: UserPresetCreateDTO = {
    name,
    provider: 'loom',
    engine: 'classic',
    parameters: {
      samplerOverrides,
      completionSettings: {
        useSystemPrompt: true,
        squashSystemMessages: false,
        enableFunctionCalling: true,
        namesBehavior: 0,
      },
    },
    prompt_order: blocks,
    metadata: {
      source: 'risupreset',
      risuPresetName: raw.name ?? name,
      ...(raw.aiModel ? { risuAiModel: raw.aiModel } : {}),
      ...(raw.subModel ? { risuSubModel: raw.subModel } : {}),
      promptVariables: defaultsByBlockId,
      ...(wholeHistory ? {} : { lumirealm: { chatRanges } }),
    },
  };

  return { preset, regexScripts, skippedRegex };
}
