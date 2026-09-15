/**
 * Pin the preset label-translation path in `realm/backend.ts`: the importer
 * forwards the user's connection choice to the label translator, rewrites only
 * display labels, and fails loudly instead of importing a half-translated
 * preset. No live model call: the generator is a mock.
 */

import { describe, expect, test, mock } from 'bun:test';
import type { PromptBlockDTO } from 'lumiverse-spindle-types';
import { translatePresetLabels } from '../../src/core/preset/preset-labels.js';
import {
  SYNTHETIC_REGEX,
  makePresetBackend,
  makeRegexStore,
  syntheticPresetRaw,
} from './preset-regex-fixture.js';

const USER = 'u1';

// Fabricated toggle template. A Risu preset carries its toggles as
// `key=label=type=options` lines; only the labels are user-visible.
const TOGGLE_TEMPLATE = [
  '=그룹 하나=group',
  'alpha=선택 항목=select=사용 안 함,보통,최대',
  'beta=스위치 항목=switch',
].join('\n');

const TRANSLATED: Readonly<Record<string, string>> = {
  '그룹 하나': 'Group one',
  '선택 항목': 'Selected item',
  '사용 안 함': 'Disabled',
  '보통': 'Normal',
  '최대': 'Maximum',
  '스위치 항목': 'Switch item',
};

function togglePresetBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    ...syntheticPresetRaw(),
    customPromptTemplateToggle: TOGGLE_TEMPLATE,
  }));
}

function categoryBlocks(created: { prompt_order?: PromptBlockDTO[] }): PromptBlockDTO[] {
  return (created.prompt_order ?? []).filter((b) => b.marker === 'category' && b.variables !== undefined);
}

function okGenerate(): ReturnType<typeof mock> {
  return mock(async () => JSON.stringify(TRANSLATED));
}

describe('preset import with label translation', () => {
  test('translates group, variable and option labels and leaves the rest alone', async () => {
    const store = makeRegexStore();
    const generate = okGenerate();
    const { backend, creates } = makePresetBackend(store, {
      translatePresetLabels: (preset, opts) => translatePresetLabels(preset, opts, { generate }),
    });

    await backend.importAnyFormat(togglePresetBytes(), 'synthetic.risup', USER, {
      labelTranslation: { connectionId: 'conn-1' },
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const request = (generate.mock.calls[0] as unknown[])[0] as { connectionId: string; userId: string };
    expect(request.connectionId).toBe('conn-1');
    expect(request.userId).toBe(USER);

    const created = creates[0]!;
    const toggleBlock = categoryBlocks(created).find((b) => b.variables!.length === 2)!;
    expect(toggleBlock.name).toBe('Group one');
    const variables = toggleBlock.variables!;
    expect(variables.map((v) => v.name)).toEqual(['toggle_alpha', 'toggle_beta']);
    expect(variables.map((v) => v.label)).toEqual([
      'Selected item',
      'Switch item',
    ]);
    const select = variables[0]!;
    if (select.type !== 'select') throw new Error('expected the select variable');
    expect(select.options).toEqual([
      { id: '0', label: 'Disabled', value: '0' },
      { id: '1', label: 'Normal', value: '1' },
      { id: '2', label: 'Maximum', value: '2' },
    ]);
    expect(select.defaultValue).toBe('0');
    const toggle = variables[1]!;
    if (toggle.type !== 'switch') throw new Error('expected the switch variable');
    expect(toggle.defaultValue).toBe(0);

    // Prompt content and the import-time default map are untouched: the
    // translation must not reach prompt behavior or stored values.
    const assembly = (created.prompt_order ?? []).find((b) => b.name === '🧩 Prompt Assembly')!;
    expect(assembly).toBeDefined();
    const rule = (created.prompt_order ?? []).find((b) => b.name === 'Synthetic Rule')!;
    expect(rule.content).toBe('Synthetic instructions.');
    const defaults = (created.metadata as { promptVariables: Record<string, Record<string, unknown>> })
      .promptVariables[toggleBlock.id]!;
    expect(defaults).toEqual({ toggle_alpha: '0', toggle_beta: 0 });
  });

  test('still imports the preset regex rules on the translated path', async () => {
    const store = makeRegexStore();
    const { backend } = makePresetBackend(store, {
      translatePresetLabels: (preset, opts) => translatePresetLabels(preset, opts, { generate: okGenerate() }),
    });

    await backend.importAnyFormat(togglePresetBytes(), 'synthetic.risup', USER, {
      labelTranslation: { connectionId: 'conn-1' },
    });

    expect(store.rowsFor(USER)).toHaveLength(SYNTHETIC_REGEX.length);
  });

  test('a plain import never calls the model and keeps the imported labels', async () => {
    const store = makeRegexStore();
    const generate = okGenerate();
    const { backend, creates } = makePresetBackend(store, {
      translatePresetLabels: (preset, opts) => translatePresetLabels(preset, opts, { generate }),
    });

    await backend.importAnyFormat(togglePresetBytes(), 'synthetic.risup', USER);

    expect(generate).not.toHaveBeenCalled();
    const toggleBlock = categoryBlocks(creates[0]!).find((b) => b.variables!.length === 2)!;
    expect(toggleBlock.name).toBe('그룹 하나');
    expect(toggleBlock.variables!.map((v) => v.label)).toEqual([
      '선택 항목',
      '스위치 항목',
    ]);
  });

  test('a host without label translation reports the missing capability', async () => {
    const store = makeRegexStore();
    const { backend, creates } = makePresetBackend(store);

    await expect(backend.importAnyFormat(togglePresetBytes(), 'synthetic.risup', USER, {
      labelTranslation: { connectionId: 'conn-1' },
    })).rejects.toThrow(/label translation is unavailable/);
    expect(creates).toHaveLength(0);
  });

  test('a reply that drops a label aborts the import', async () => {
    const store = makeRegexStore();
    const { backend, creates } = makePresetBackend(store, {
      translatePresetLabels: (preset, opts) =>
        translatePresetLabels(preset, opts, { generate: mock(async () => '{}') }),
    });

    await expect(backend.importAnyFormat(togglePresetBytes(), 'synthetic.risup', USER, {
      labelTranslation: { connectionId: 'conn-1' },
    })).rejects.toThrow(/omitted 6 of 6/);
    expect(creates).toHaveLength(0);
  });
});
