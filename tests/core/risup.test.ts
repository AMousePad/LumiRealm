import { describe, expect, test } from 'bun:test';
import * as fflate from 'fflate';
import { encode as encodeMsgpack } from '@msgpack/msgpack';
import { encodeRPack } from '../../src/core/rpack/rpack.js';
import { decodeRisuPreset, isRisuPresetBytes } from '../../src/core/preset/risup-decoder.js';
import {
  parseRisuToggleSyntax,
  translateRisuPromptBlocks,
  translateRisuPreset,
} from '../../src/core/preset/risup-translator.js';
import { setupRealmBackend } from '../../src/realm/backend.js';

async function encryptBuffer(data: Uint8Array, keyStr: string): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto.subtle;
  const keyArray = await subtle.digest('SHA-256', new TextEncoder().encode(keyStr));
  const key = await subtle.importKey('raw', keyArray, 'AES-GCM', false, ['encrypt']);
  return await subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, data as unknown as BufferSource);
}

describe('Risu preset decoder', () => {
  test('isRisuPresetBytes detects .risup and .risupreset extensions', () => {
    expect(isRisuPresetBytes(new Uint8Array([1, 2, 3]), 'my_preset.risup')).toBe(true);
    expect(isRisuPresetBytes(new Uint8Array([1, 2, 3]), 'my_preset.risupreset')).toBe(true);
    expect(isRisuPresetBytes(new Uint8Array([1, 2, 3]), 'card.charx')).toBe(false);
  });

  test('isRisuPresetBytes detects JSON with promptTemplate', () => {
    const jsonBytes = new TextEncoder().encode('{"name":"Preset","promptTemplate":[]}');
    expect(isRisuPresetBytes(jsonBytes, 'preset.json')).toBe(true);
  });

  test('decodes JSON preset format', async () => {
    const preset = {
      name: 'Test JSON Preset',
      temperature: 80,
      maxResponse: 2000,
      promptTemplate: [
        { type: 'plain', role: 'system', text: 'System instruction' },
      ],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(preset));
    const decoded = await decodeRisuPreset(bytes, 'test.json');
    expect(decoded.name).toBe('Test JSON Preset');
    expect(decoded.temperature).toBe(80);
    expect(decoded.maxResponse).toBe(2000);
  });

  test('decodes encrypted .risup binary preset format', async () => {
    const rawPreset = {
      name: 'Synthetic Risu Preset',
      temperature: 100,
      maxResponse: 4096,
      maxContext: 32000,
      promptTemplate: [
        { type: 'plain', role: 'system', name: 'Main', text: 'You are an AI.' },
        { type: 'chat', name: 'Chat History' },
      ],
      customPromptTemplateToggle: '=Settings=group\nmode=Dark Mode\ntone=Tone=select=Friendly,Formal\nbio=Bio=text',
    };

    const innerBytes = encodeMsgpack(rawPreset);
    const encrypted = await encryptBuffer(new Uint8Array(innerBytes), 'risupreset');
    const container = encodeMsgpack({
      presetVersion: 2,
      type: 'preset',
      preset: new Uint8Array(encrypted),
    });
    const compressed = fflate.compressSync(container);
    const risupBytes = encodeRPack(compressed);

    const decoded = await decodeRisuPreset(risupBytes, 'synthetic.risup');
    expect(decoded.name).toBe('Synthetic Risu Preset');
    expect(decoded.temperature).toBe(100);
    expect(decoded.maxResponse).toBe(4096);
    expect(decoded.maxContext).toBe(32000);
    expect(decoded.promptTemplate?.length).toBe(2);
  });
});

describe('Risu toggle syntax parser', () => {
  test('parses switches, selects, texts, and groups', () => {
    const dsl = `
=Core Group=group
nsfw=Enable NSFW
model=Select Model=select=Model A,Model B,Model C
=Details=group
user_prefix=User Prefix=text
notes=Extra Notes=textarea
`;
    const groups = parseRisuToggleSyntax(dsl);
    expect(groups.length).toBe(2);

    expect(groups[0]!.name).toBe('Core Group');
    expect(groups[0]!.variables.length).toBe(2);
    expect(groups[0]!.variables[0]!.name).toBe('toggle_nsfw');
    expect(groups[0]!.variables[0]!.type).toBe('switch');

    expect(groups[0]!.variables[1]!.name).toBe('toggle_model');
    expect(groups[0]!.variables[1]!.type).toBe('select');
    if (groups[0]!.variables[1]!.type === 'select') {
      expect(groups[0]!.variables[1]!.options.length).toBe(3);
    }

    expect(groups[1]!.name).toBe('Details');
    expect(groups[1]!.variables.length).toBe(2);
    expect(groups[1]!.variables[0]!.name).toBe('toggle_user_prefix');
    expect(groups[1]!.variables[0]!.type).toBe('text');
    expect(groups[1]!.variables[1]!.name).toBe('toggle_notes');
    expect(groups[1]!.variables[1]!.type).toBe('textarea');
  });
});

describe('Risu preset translator', () => {
  test('translates samplers, prompt blocks, structural markers, and regex', () => {
    const raw = {
      name: 'Hero Preset',
      temperature: 70, // 70 -> 0.7
      maxResponse: 3000,
      maxContext: 64000,
      top_p: 95, // 95 -> 0.95
      top_k: 40,
      min_p: 5, // 5 -> 0.05
      frequencyPenalty: -1000, // disabled -> null
      PresensePenalty: 20, // 20
      repetition_penalty: 1.1,
      customPromptTemplateToggle: '=Main Config=group\nmode=RPG Mode',
      promptTemplate: [
        { type: 'plain', role: 'system', name: 'Rules', text: 'Act like a guide.' },
        { type: 'persona', name: 'User Persona', text: '{{persona}}' },
        { type: 'description', name: 'Char Desc', text: '{{description}}' },
        { type: 'lorebook', name: 'World Lore' },
        { type: 'chat', name: 'Chat Area' },
        { type: 'authornote', name: 'AN', text: 'Pacing notes' },
        { type: 'cache', name: 'Cache Point' },
        { type: 'plain', role: 'bot', name: 'Final Steer', text: 'Begin adventure.' },
      ],
      regex: [
        {
          comment: 'Format Tags',
          in: '<tag>(.+?)</tag>',
          out: '[$1]',
          type: 'editoutput',
          ableFlag: true,
        },
      ],
    };

    const translated = translateRisuPreset(raw);
    const { preset, regexScripts } = translated;

    expect(preset.name).toBe('Hero Preset');
    expect(preset.provider).toBe('loom');
    expect(preset.parameters?.samplerOverrides).toEqual({
      enabled: true,
      temperature: 0.7,
      maxTokens: 3000,
      contextSize: 64000,
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      frequencyPenalty: null,
      presencePenalty: 20,
      repetitionPenalty: 1.1,
      streaming: true,
    });

    const blocks = preset.prompt_order ?? [];
    // Category for toggle + Category for Prompt Assembly + 8 template items = 10 blocks
    expect(blocks.length).toBe(10);

    // Toggle category block
    expect(blocks[0]!.marker).toBe('category');
    expect(blocks[0]!.name).toBe('Main Config');
    expect(blocks[0]!.variables?.length).toBe(1);

    // Prompt Assembly category
    expect(blocks[1]!.marker).toBe('category');
    expect(blocks[1]!.name).toBe('🧩 Prompt Assembly');

    // Pre-history blocks
    expect(blocks[2]!.name).toBe('Rules');
    expect(blocks[2]!.position).toBe('pre_history');
    expect(blocks[2]!.role).toBe('system');

    expect(blocks[3]!.name).toBe('User Persona');
    expect(blocks[3]!.marker).toBe('persona_description');
    expect(blocks[3]!.position).toBe('pre_history');

    expect(blocks[4]!.name).toBe('Char Desc');
    expect(blocks[4]!.marker).toBe('char_description');
    expect(blocks[4]!.position).toBe('pre_history');

    expect(blocks[5]!.name).toBe('World Lore');
    expect(blocks[5]!.marker).toBe('world_info_before');
    expect(blocks[5]!.position).toBe('pre_history');

    // In-history block (chat_history)
    expect(blocks[6]!.name).toBe('Chat Area');
    expect(blocks[6]!.marker).toBe('chat_history');
    expect(blocks[6]!.position).toBe('in_history');

    // Post-history blocks
    expect(blocks[7]!.name).toBe('AN');
    expect(blocks[7]!.position).toBe('post_history');

    expect(blocks[8]!.name).toBe('Cache Point');
    expect(blocks[8]!.position).toBe('post_history');

    expect(blocks[9]!.name).toBe('Final Steer');
    expect(blocks[9]!.role).toBe('assistant');
    expect(blocks[9]!.position).toBe('post_history');

    // Regex scripts
    expect(regexScripts.length).toBe(1);
    expect(regexScripts[0]!.name).toBe('Format Tags');
    expect(regexScripts[0]!.find_regex).toBe('<tag>(.+?)</tag>');
    expect(regexScripts[0]!.replace_string).toBe('[$1]');
    expect(regexScripts[0]!.folder).toBe('Hero Preset');
  });

  test('translates jailbreak item and respects postEverything without breaking chat history', () => {
    const raw = {
      name: 'Jailbreak Preset',
      promptTemplate: [
        { type: 'postEverything', name: 'undefined' },
        { type: 'jailbreak', name: 'Jailbreak Slot', text: 'Unrestricted roleplay.' },
        { type: 'chat', name: 'Main Chat' },
        { type: 'plain', role: 'bot', text: 'Follow up.' },
      ],
    };
    const { preset } = translateRisuPreset(raw);
    const blocks = preset.prompt_order || [];

    const jb = blocks.find((b) => b.marker === 'jailbreak');
    expect(jb).toBeDefined();
    expect(jb!.name).toBe('Jailbreak Slot');
    expect(jb!.content).toBe('Unrestricted roleplay.');
    expect(jb!.position).toBe('pre_history');

    const chat = blocks.find((b) => b.marker === 'chat_history');
    expect(chat).toBeDefined();
    expect(chat!.position).toBe('in_history');

    const post = blocks.find((b) => b.content === 'Follow up.');
    expect(post).toBeDefined();
    expect(post!.position).toBe('post_history');
  });
});

describe('Preset import via Realm backend', () => {
  test('imports .risup file creating preset and regex scripts', async () => {
    let createdPresetInput: any = null;
    const createdRegex: any[] = [];
    const toasts: string[] = [];

    const rawPreset = {
      name: 'Import Integration Test',
      temperature: 90,
      promptTemplate: [
        { type: 'plain', role: 'system', text: 'Instructions' },
        { type: 'chat' },
      ],
      regex: [
        { comment: 'Rule 1', in: 'abc', out: 'xyz', type: 'editoutput', ableFlag: true },
      ],
    };

    const innerBytes = encodeMsgpack(rawPreset);
    const encrypted = await encryptBuffer(new Uint8Array(innerBytes), 'risupreset');
    const container = encodeMsgpack({
      presetVersion: 2,
      type: 'preset',
      preset: new Uint8Array(encrypted),
    });
    const compressed = fflate.compressSync(container);
    const risupBytes = encodeRPack(compressed);

    const backend = setupRealmBackend({
      send: () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
      importCardFromBytes: async () => {},
      createPreset: async (input) => {
        createdPresetInput = input;
        return {
          id: 'preset-123',
          name: input.name,
          provider: input.provider,
          engine: input.engine ?? 'classic',
          parameters: input.parameters ?? {},
          prompt_order: input.prompt_order ?? [],
          prompts: {},
          metadata: input.metadata ?? {},
          cache_revision: 0,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
      },
      regexApi: {
        list: async () => ({ data: [], total: 0 }),
        create: async (input) => {
          createdRegex.push(input);
          return {
            id: `script-${createdRegex.length}`,
            can_mutate: true,
            ...input,
          } as any;
        },
        update: async () => {
          throw new Error('unexpected regex update');
        },
      },
      toast: (msg) => {
        toasts.push(msg);
      },
    });

    await backend.importAnyFormat(risupBytes, 'test_preset.risup', 'user-1');

    expect(createdPresetInput).not.toBeNull();
    expect(createdPresetInput.name).toBe('Import Integration Test');
    expect(createdRegex.length).toBe(1);
    expect(createdRegex[0].name).toBe('Rule 1');
    expect(createdRegex[0].folder).toBe('Import Integration Test');
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain('Import Integration Test');
      // Ensure all translated blocks conform to allowed PromptBlock schema
    const ALLOWED_BLOCK_KEYS = new Set([
      'id', 'name', 'content', 'role', 'enabled', 'position', 'depth',
      'marker', 'isLocked', 'color', 'injectionTrigger', 'characterTagTrigger',
      'group', 'categoryMode', 'variables',
    ]);
    for (const block of createdPresetInput.prompt_order) {
      for (const key of Object.keys(block)) {
        expect(ALLOWED_BLOCK_KEYS.has(key)).toBe(true);
      }
      expect((block as any).order).toBeUndefined();
      expect((block as any).parameters).toBeUndefined();
    }
});
});
