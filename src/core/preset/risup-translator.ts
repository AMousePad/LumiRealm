import type {
  PromptBlockDTO,
  PromptVariableDefDTO,
  RegexScriptCreateDTO,
  UserPresetCreateDTO,
} from 'lumiverse-spindle-types';
import type { RisuPresetRaw } from './risup-decoder.js';
import { mapRegex } from '../mappers/regex.js';
import { newUuid } from '../mappers/util.js';

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

export function translateRisuPromptBlocks(
  template: readonly Record<string, unknown>[] | undefined,
  toggleGroups: readonly ParsedToggleGroup[],
): { blocks: PromptBlockDTO[]; defaultsByBlockId: Record<string, Record<string, unknown>> } {
  const blocks: PromptBlockDTO[] = [];
  const defaultsByBlockId: Record<string, Record<string, unknown>> = {};
  let nextOrder = 0;

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
      order: nextOrder++,
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
      order: nextOrder++,
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
  if (Array.isArray(template)) {
    for (const item of template) {
      const type = typeof item['type'] === 'string' ? item['type'] : 'plain';
      const rawRole = typeof item['role'] === 'string' ? item['role'] : 'system';
      const role: 'system' | 'user' | 'assistant' =
        rawRole === 'bot' || rawRole === 'assistant' || rawRole === 'char'
          ? 'assistant'
          : rawRole === 'user'
          ? 'user'
          : 'system';
      const text = typeof item['text'] === 'string' ? item['text'] : '';
      const name = typeof item['name'] === 'string' && item['name'].trim() && item['name'] !== 'undefined'
        ? item['name'].trim()
        : null;
      const type2 = typeof item['type2'] === 'string' ? item['type2'] : 'normal';
      const enabled = type2 !== 'disabled' && item['enabled'] !== false;

      if (type === 'plain') {
        blocks.push({
          id: newUuid(),
          name: name || (type2 === 'main' ? '# System Rule' : 'Prompt Block'),
          role,
          enabled,
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
          marker: null,
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      } else if (type === 'chat') {
        if (!seenChat) {
          seenChat = true;
          blocks.push({
            id: newUuid(),
            name: name || 'Chat History',
            role: 'system',
            enabled: true,
            position: 'in_history',
            depth: 0,
            order: nextOrder++,
            marker: 'chat_history',
            content: '',
            isLocked: false,
            color: null,
            injectionTrigger: [],
      group: null,
          } as PromptBlockDTO);
        } else {
          blocks.push({
            id: newUuid(),
            name: name || 'Chat History (Split)',
            role,
            enabled,
            position: 'in_history',
            depth: 0,
            order: nextOrder++,
            marker: null,
            content: text,
            isLocked: false,
            color: null,
            injectionTrigger: [],
      group: null,
          } as PromptBlockDTO);
        }
      } else if (type === 'persona') {
        blocks.push({
          id: newUuid(),
          name: name || 'User Persona',
          role: role === 'system' ? 'user' : role,
          enabled,
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
          marker: 'persona_description',
          content: text || '{{persona}}',
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      } else if (type === 'description') {
        blocks.push({
          id: newUuid(),
          name: name || 'Character Description',
          role: role === 'system' ? 'user' : role,
          enabled,
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
          marker: 'char_description',
          content: text || '{{description}}',
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
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
          marker: seenChat ? 'world_info_after' : 'world_info_before',
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
        } as PromptBlockDTO);
      } else if (type === 'authornote') {
        blocks.push({
          id: newUuid(),
          name: name || "Author's Note",
          role,
          enabled,
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
          marker: null,
          content: text || '{{authors_note}}',
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
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
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
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
          marker: null,
          content: text,
          isLocked: false,
          color: null,
          injectionTrigger: [],
      group: null,
          parameters: { cache_breakpoint: true },
        } as PromptBlockDTO);
      } else if (type === 'jailbreak') {
        blocks.push({
          id: newUuid(),
          name: name || 'Jailbreak',
          role: role === 'assistant' ? 'assistant' : (role === 'user' ? 'user' : 'system'),
          enabled,
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
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
          position: seenChat ? 'post_history' : 'pre_history',
          depth: 0,
          order: nextOrder++,
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
      order: nextOrder++,
      marker: 'chat_history',
      content: '',
      isLocked: false,
      color: null,
      injectionTrigger: [],
      group: null,
    } as PromptBlockDTO);
  }

  return { blocks, defaultsByBlockId };
}

export interface TranslatedRisuPreset {
  readonly preset: UserPresetCreateDTO;
  readonly regexScripts: RegexScriptCreateDTO[];
}

export function translateRisuPreset(raw: RisuPresetRaw, fallbackName = 'Imported Preset'): TranslatedRisuPreset {
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName;

  const cleanSampler = (val: unknown): number | null => {
    if (typeof val !== 'number' || !Number.isFinite(val) || val <= -1000) return null;
    return val;
  };

  let temp: number | null = cleanSampler(raw.temperature);
  if (temp !== null) {
    if (temp < 0) temp = null;
    else if (temp > 10) temp = temp / 100;
  }

  let topP: number | null = cleanSampler(raw.top_p);
  if (topP !== null && topP > 1) {
    topP = topP / 100;
  }

  let minP: number | null = cleanSampler(raw.min_p);
  if (minP !== null && minP > 1) {
    minP = minP / 100;
  }

  const samplerOverrides = {
    enabled: true,
    temperature: temp,
    maxTokens: cleanSampler(raw.maxResponse),
    contextSize: cleanSampler(raw.maxContext),
    topP,
    topK: cleanSampler(raw.top_k),
    minP,
    frequencyPenalty: cleanSampler(raw.frequencyPenalty),
    presencePenalty: cleanSampler(raw.PresensePenalty),
    repetitionPenalty: cleanSampler(raw.repetition_penalty),
    streaming: true,
  };

    const toggleGroups = parseRisuToggleSyntax(raw.customPromptTemplateToggle);
  const { blocks, defaultsByBlockId } = translateRisuPromptBlocks(raw.promptTemplate, toggleGroups);

  const regexScripts: RegexScriptCreateDTO[] = [];
  if (Array.isArray(raw.regex) && raw.regex.length > 0) {
    const mapRes = mapRegex(raw.regex as any, {
      characterId: 'global-preset',
      scope: 'global',
      scopeId: null,
      folder: name,
    });
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
    },
  };

  return { preset, regexScripts };
}
