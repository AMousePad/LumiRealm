#!/usr/bin/env bun
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeRisuPreset, isRisuPresetBytes, type RisuPresetRaw } from '../src/core/preset/risup-decoder.js';
import { translateRisuPreset, type TranslatedRisuPreset } from '../src/core/preset/risup-translator.js';

interface MockContext {
  charName: string;
  charDesc: string;
  charPersonality: string;
  charScenario: string;
  userName: string;
  userPersona: string;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const DEFAULT_MOCK: MockContext = {
  charName: 'Aria',
  charDesc: 'Aria is a serene and skilled herbalist living in the Whispering Vale.',
  charPersonality: 'Gentle, contemplative, perceptive, spoke softly with calm reassurance.',
  charScenario: 'The traveler arrives at Aria\'s apothecary seeking treatment for a rare poison.',
  userName: 'Traveler',
  userPersona: 'A battered wanderer from the northern ridges carrying old steel.',
  chatHistory: [
    { role: 'user', content: 'Aria, do you have something for night-shade fever?' },
    { role: 'assistant', content: 'Peace to you. Sit by the fire while I prepare silverleaf tea.' },
    { role: 'user', content: 'Thank you. The cold began two nights ago.' },
  ],
};

function truncate(str: string, len: number): string {
  const cleaned = (str || '').replace(/[\r\n]+/g, ' ').trim();
  return cleaned.length > len ? cleaned.slice(0, len - 3) + '...' : cleaned;
}

function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

// 1. Simulate RisuAI prompt assembly (matching PocketRisu src/ts/process/index.svelte.ts)
function simulateRisuAssembly(raw: RisuPresetRaw, ctx: MockContext = DEFAULT_MOCK) {
  const messages: Array<{ role: string; content: string; source: string }> = [];
  const template = raw.promptTemplate || [];

  for (const item of template) {
    const type = String(item.type || 'plain');
    const rawRole = String(item.role || 'system');
    const role = rawRole === 'bot' || rawRole === 'assistant' ? 'assistant' : rawRole === 'user' ? 'user' : 'system';
    const text = String(item.text || '');
    const inner = typeof item.innerFormat === 'string' ? item.innerFormat : null;

    switch (type) {
      case 'persona': {
        const body = ctx.userPersona;
        const formatted = inner ? inner.replace('{{slot}}', body) : (text || body);
        messages.push({ role, content: formatted, source: `persona (${item.name || 'User Persona'})` });
        break;
      }
      case 'description': {
        let desc = ctx.charDesc;
        if (ctx.charPersonality) desc += `\n\nDescription of {{char}}: ${ctx.charPersonality}`;
        if (ctx.charScenario) desc += `\n\nCircumstances and context of the dialogue: ${ctx.charScenario}`;
        const formatted = inner ? inner.replace('{{slot}}', desc) : (text || desc);
        messages.push({ role, content: formatted, source: `description (${item.name || 'Character Description'})` });
        break;
      }
      case 'lorebook': {
        messages.push({ role: 'system', content: '[Lorebook entries injected here if triggered]', source: 'lorebook' });
        break;
      }
      case 'chat': {
        for (const msg of ctx.chatHistory) {
          messages.push({ role: msg.role, content: msg.content, source: `chat (${item.name || 'History'})` });
        }
        break;
      }
      case 'authornote': {
        const note = '[Author\'s Note: Maintain immersive historical tone]';
        const formatted = inner ? inner.replace('{{slot}}', note) : (text || note);
        messages.push({ role, content: formatted, source: `authornote (${item.name || 'Note'})` });
        break;
      }
      case 'jailbreak': {
        const jb = text || '{{jailbreak}}';
        messages.push({ role, content: jb, source: `jailbreak (${item.name || 'Jailbreak'})` });
        break;
      }
      case 'postEverything': {
        // End marker for depth-0 lorebooks / instructions
        break;
      }
      case 'plain':
      default: {
        if (text) {
          messages.push({ role, content: text, source: `plain (${item.name || type})` });
        }
        break;
      }
    }
  }

  // Macro resolution
  return messages.map((m) => ({
    role: m.role,
    content: m.content
      .replaceAll('{{char}}', ctx.charName)
      .replaceAll('{{user}}', ctx.userName),
    source: m.source,
  }));
}

// 2. Simulate Lumiverse Loom prompt assembly (matching prompt-assembly.service.ts)
function simulateLumiverseAssembly(trans: TranslatedRisuPreset, ctx: MockContext = DEFAULT_MOCK) {
  const blocks = [...(trans.preset.prompt_order || [])].filter((b) => b.enabled !== false);
  const chatHistoryIdx = blocks.findIndex((b) => b.marker === 'chat_history');

  // Reorder non-marker blocks by position (reorderBlocksByPosition)
  if (chatHistoryIdx >= 0) {
    const moveToAfter = new Set<number>();
    const moveToBefore = new Set<number>();
    for (let i = 0; i < blocks.length; i++) {
      if (i === chatHistoryIdx) continue;
      const b = blocks[i]!;
      if (b.marker) continue;
      if (i < chatHistoryIdx && (b.position === 'post_history' || b.position === 'in_history')) {
        moveToAfter.add(i);
      } else if (i > chatHistoryIdx && b.position === 'pre_history') {
        moveToBefore.add(i);
      }
    }
    if (moveToAfter.size > 0 || moveToBefore.size > 0) {
      const result: typeof blocks = [];
      for (let i = 0; i < chatHistoryIdx; i++) {
        if (!moveToAfter.has(i)) result.push(blocks[i]!);
      }
      for (const idx of moveToBefore) result.push(blocks[idx]!);
      result.push(blocks[chatHistoryIdx]!);
      for (const idx of moveToAfter) result.push(blocks[idx]!);
      for (let i = chatHistoryIdx + 1; i < blocks.length; i++) {
        if (!moveToBefore.has(i)) result.push(blocks[i]!);
      }
      blocks.length = 0;
      blocks.push(...result);
    }
  }

  const messages: Array<{ role: string; content: string; source: string }> = [];

  for (const block of blocks) {
    if (block.marker === 'category') continue; // Category divider

    if (block.marker === 'chat_history') {
      for (const msg of ctx.chatHistory) {
        messages.push({ role: msg.role, content: msg.content, source: `chat_history (${block.name})` });
      }
      continue;
    }

    if (block.marker === 'char_description') {
      let desc = ctx.charDesc;
      if (ctx.charPersonality) desc += `\n\nDescription of {{char}}: ${ctx.charPersonality}`;
      if (ctx.charScenario) desc += `\n\nCircumstances and context of the dialogue: ${ctx.charScenario}`;
      const template = block.content || '{{description}}';
      const content = template.replaceAll('{{description}}', desc);
      messages.push({ role: block.role, content, source: `char_description (${block.name})` });
      continue;
    }

    if (block.marker === 'persona_description') {
      const template = block.content || '{{persona}}';
      const content = template.replaceAll('{{persona}}', ctx.userPersona);
      messages.push({ role: block.role, content, source: `persona_description (${block.name})` });
      continue;
    }

    if (block.marker === 'world_info_before' || block.marker === 'world_info_after') {
      messages.push({ role: block.role, content: '[World info / lorebook entries injected here]', source: `${block.marker} (${block.name})` });
      continue;
    }

    if (block.marker === 'jailbreak') {
      messages.push({ role: block.role, content: block.content || '', source: `jailbreak (${block.name})` });
      continue;
    }

    if (block.content) {
      messages.push({ role: block.role, content: block.content, source: `block (${block.name})` });
    }
  }

  return messages.map((m) => ({
    role: m.role,
    content: m.content
      .replaceAll('{{char}}', ctx.charName)
      .replaceAll('{{user}}', ctx.userName),
    source: m.source,
  }));
}

export async function comparePresetFile(filePath: string, doDryRun = false) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  const buf = fs.readFileSync(filePath);
  const raw = await decodeRisuPreset(buf, filePath);
  const trans = translateRisuPreset(raw);

  const termWidth = Math.min(process.stdout.columns || 120, 140);
  const sep = '='.repeat(termWidth);
  const subSep = '-'.repeat(termWidth);

  console.log(`\n${sep}`);
  console.log(`  PRESET COMPARISON REPORT: ${raw.name || path.basename(filePath)}`);
  console.log(`${sep}`);
  console.log(`File: ${filePath}`);
  console.log(`Risu Version: ${raw.presetVersion ?? 'legacy'}`);
  console.log(`Target Model: Risu: ${raw.aiModel ?? '(unspecified)'} | SubModel: ${raw.subModel ?? '(unspecified)'}`);

  // 1. Samplers
  console.log(`\n${subSep}`);
  console.log(`1. SAMPLERS & GENERATION PARAMETERS`);
  console.log(`${subSep}`);
  const s = (trans.preset.parameters?.samplerOverrides ?? {}) as Record<string, unknown>;
  const samplerTable: Array<[string, unknown, unknown]> = [
    ['Temperature', raw.temperature !== undefined ? `${raw.temperature} (scale ${raw.temperature > 10 ? '/100' : 'raw'})` : 'unset', s?.temperature ?? 'default'],
    ['Max Response / Tokens', raw.maxResponse ?? 'unset', s?.maxTokens ?? 'default'],
    ['Max Context', raw.maxContext ?? 'unset', s?.contextSize ?? 'default'],
    ['Top-P', raw.top_p !== undefined ? `${raw.top_p} (scale ${raw.top_p > 1 ? '/100' : 'raw'})` : 'unset', s?.topP ?? 'default'],
    ['Top-K', raw.top_k ?? 'unset', s?.topK ?? 'default'],
    ['Min-P', raw.min_p !== undefined ? `${raw.min_p} (scale ${raw.min_p > 1 ? '/100' : 'raw'})` : 'unset', s?.minP ?? 'default'],
    ['Frequency Penalty', raw.frequencyPenalty ?? 'unset', s?.frequencyPenalty ?? 'default'],
    ['Presence Penalty', raw.PresensePenalty ?? 'unset', s?.presencePenalty ?? 'default'],
    ['Repetition Penalty', raw.repetition_penalty ?? 'unset', s?.repetitionPenalty ?? 'default'],
  ];

  console.log(`${pad('Parameter', 24)} ${pad('Raw Risu (.risup)', 30)} ${pad('Lumiverse (Loom)', 30)}`);
  console.log('-'.repeat(84));
  for (const [name, rVal, lVal] of samplerTable) {
    console.log(`${pad(name, 24)} ${pad(String(rVal), 30)} ${pad(String(lVal), 30)}`);
  }

  // 2. Blocks Side-by-Side Table
  console.log(`\n${subSep}`);
  console.log(`2. PROMPT BLOCKS ALIGNMENT (Risu promptTemplate vs Lumiverse prompt_order)`);
  console.log(`${subSep}`);
  console.log(`Raw Risu items: ${raw.promptTemplate?.length ?? 0} | Translated Loom blocks: ${trans.preset.prompt_order?.length ?? 0}`);
  console.log();

  console.log(
    `${pad('#', 4)} ` +
    `${pad('Risu Type', 12)} ` +
    `${pad('Role', 7)} ` +
    `${pad('Risu Name', 22)} ` +
    `${pad('Inner?', 7)} ` +
    `-> ` +
    `${pad('Loom Marker', 18)} ` +
    `${pad('Pos', 13)} ` +
    `${pad('Role', 7)} ` +
    `${pad('Loom Name', 24)}`
  );
  console.log('-'.repeat(125));

  const risuItems = raw.promptTemplate || [];
  const loomBlocks = trans.preset.prompt_order || [];

  // Filter category blocks from direct 1:1 row index for display
  const nonCategoryLoom = loomBlocks.filter((b) => b.marker !== 'category');
  const maxRows = Math.max(risuItems.length, nonCategoryLoom.length);

  for (let i = 0; i < maxRows; i++) {
    const r = risuItems[i];
    const l = nonCategoryLoom[i];

    const idxStr = pad(`[${i}]`, 4);
    const rType = pad(r ? String(r.type) : '-', 12);
    const rRole = pad(r ? String(r.role || 'sys') : '-', 7);
    const rName = pad(r ? truncate(String(r.name || '(empty)'), 20) : '-', 22);
    const rInner = pad(r?.innerFormat ? 'YES' : '-', 7);

    const lMarker = pad(l ? (l.marker || 'none') : '-', 18);
    const lPos = pad(l ? String(l.position) : '-', 13);
    const lRole = pad(l ? l.role : '-', 7);
    const lName = pad(l ? truncate(l.name || '(empty)', 22) : '-', 24);

    console.log(`${idxStr} ${rType} ${rRole} ${rName} ${rInner} -> ${lMarker} ${lPos} ${lRole} ${lName}`);
  }

  // 3. Toggles & DSL
  console.log(`\n${subSep}`);
  console.log(`3. TOGGLES & DSL VARIABLES`);
  console.log(`${subSep}`);
  if (raw.customPromptTemplateToggle) {
    const lines = raw.customPromptTemplateToggle.split('\n').filter((l) => l.trim().length > 0);
    console.log(`Raw Toggle DSL Lines: ${lines.length}`);
    const toggleCategories = loomBlocks.filter((b) => b.marker === 'category');
    console.log(`Created Category Blocks in Loom: ${toggleCategories.length}`);
    for (const cat of toggleCategories) {
      console.log(`  📁 Category "${cat.name}": ${cat.variables?.length ?? 0} variable(s)`);
      if (cat.variables) {
        for (const v of cat.variables) {
          console.log(`     - [${v.type}] ${v.name} ("${v.label}") default="${v.defaultValue}"`);
        }
      }
    }
  } else {
    console.log(`(No customPromptTemplateToggle DSL present in preset)`);
  }

  // 4. Regex Scripts
  console.log(`\n${subSep}`);
  console.log(`4. REGEX SCRIPTS`);
  console.log(`${subSep}`);
  console.log(`Risu Regex Rules: ${raw.regex?.length ?? 0} | Translated Loom Regex Scripts: ${trans.regexScripts.length}`);
  if (trans.regexScripts.length > 0) {
    for (let i = 0; i < Math.min(trans.regexScripts.length, 6); i++) {
      const rx = trans.regexScripts[i]!;
      console.log(`  [${i + 1}] "${rx.name}" target=${rx.target} placement=[${(rx.placement ?? []).join(',')}] pattern=/${rx.find_regex}/${rx.flags}`);
    }
    if (trans.regexScripts.length > 6) {
      console.log(`  ... and ${trans.regexScripts.length - 6} more regex script(s)`);
    }
  }

  // 5. Dry Run Comparison
  if (doDryRun) {
    console.log(`\n${subSep}`);
    console.log(`5. SIMULATED PROMPT DRY RUN (RisuAI vs Lumiverse Assembly)`);
    console.log(`${subSep}`);

    const risuMsgs = simulateRisuAssembly(raw);
    const lumiMsgs = simulateLumiverseAssembly(trans);

    console.log(`Risu Output Messages: ${risuMsgs.length}`);
    console.log(`Lumiverse Output Messages: ${lumiMsgs.length}`);
    console.log();

    console.log(`${pad('Risu Message Sequence', 58)} | ${pad('Lumiverse Message Sequence', 58)}`);
    console.log('-'.repeat(120));

    const maxMsgs = Math.max(risuMsgs.length, lumiMsgs.length);
    for (let i = 0; i < maxMsgs; i++) {
      const rm = risuMsgs[i];
      const lm = lumiMsgs[i];

      const rDesc = rm ? `[${rm.role}] ${rm.source}: "${truncate(rm.content, 35)}"` : '(none)';
      const lDesc = lm ? `[${lm.role}] ${lm.source}: "${truncate(lm.content, 35)}"` : '(none)';

      console.log(`${pad(rDesc, 58)} | ${pad(lDesc, 58)}`);
    }

    console.log(`\nSample Prompts Render Comparison (First Non-Chat System Block):`);
    const rFirst = risuMsgs.find((m) => m.role === 'system' && !m.source.includes('chat'));
    const lFirst = lumiMsgs.find((m) => m.role === 'system' && !m.source.includes('chat_history'));

    console.log(`\n[Risu First System Message]:\n${rFirst ? rFirst.content.slice(0, 300) : '(none)'}`);
    console.log(`\n[Lumiverse First System Message]:\n${lFirst ? lFirst.content.slice(0, 300) : '(none)'}`);
  } else {
    console.log(`\n(Pass --dry-run to simulate and display the side-by-side prompt message assembly)`);
  }

  console.log(`\n${sep}\n`);
}

// CLI entrypoint
async function main() {
  const args = process.argv.slice(2);
  const doDryRun = args.includes('--dry-run');
  const filteredArgs = args.filter((a) => a !== '--dry-run');

  if (filteredArgs.length === 0 || filteredArgs[0] === '--help') {
    console.log(`Usage: bun tools/compare-preset.ts <path-to-preset.risup|json> [--dry-run]`);
    console.log(`       bun tools/compare-preset.ts --all [presets-dir] [--dry-run]`);
    return;
  }

  if (filteredArgs[0] === '--all') {
    const dir = filteredArgs[1] || 'E:/presets';
    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      return;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.risup') || f.endsWith('.risupreset') || f.endsWith('.json'));
    console.log(`Found ${files.length} preset files in ${dir}\n`);
    for (const file of files) {
      await comparePresetFile(path.join(dir, file), doDryRun);
    }
    return;
  }

  await comparePresetFile(filteredArgs[0]!, doDryRun);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error running compare-preset:', err);
    process.exit(1);
  });
}
