/**
 * Pin `core/preset/preset-labels.ts`: an imported preset's toggle group,
 * variable and option labels are the only strings the translator rewrites.
 * Variable names, option ids/values, defaults and block content must survive
 * verbatim, because they drive prompt behavior and the user's stored choices.
 */

import { describe, expect, test, mock } from 'bun:test';
import type { PromptBlockDTO, UserPresetCreateDTO } from 'lumiverse-spindle-types';
import {
  applyPresetLabelTranslations,
  buildPresetLabelPrompt,
  collectPresetLabels,
  parsePresetLabelResponse,
  translatePresetLabels,
} from '../../../src/core/preset/preset-labels.js';

function categoryBlock(over: Partial<PromptBlockDTO> = {}): PromptBlockDTO {
  return {
    id: 'block-toggle',
    name: '그룹 하나',
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
    variables: [
      {
        id: 'var-select',
        name: 'toggle_alpha',
        label: '선택 항목',
        type: 'select',
        defaultValue: '0',
        options: [
          { id: '0', label: '사용 안 함', value: '0' },
          { id: '1', label: '보통', value: '1' },
        ],
      },
      {
        id: 'var-switch',
        name: 'toggle_beta',
        label: '스위치 항목',
        type: 'switch',
        defaultValue: 0,
      },
      {
        id: 'var-text',
        name: 'toggle_text',
        label: '글 상자',
        type: 'text',
        defaultValue: '',
      },
    ],
    ...over,
  } as PromptBlockDTO;
}

function contentBlock(): PromptBlockDTO {
  return {
    id: 'block-main',
    name: 'Synthetic Rule',
    role: 'system',
    enabled: true,
    position: 'pre_history',
    depth: 0,
    marker: null,
    content: 'Synthetic instructions {{getglobalvar::x}}',
    isLocked: false,
    color: null,
    injectionTrigger: [],
    group: null,
  } as PromptBlockDTO;
}

function preset(over: Partial<UserPresetCreateDTO> = {}): UserPresetCreateDTO {
  return {
    name: 'Synthetic Preset',
    provider: 'loom',
    engine: 'classic',
    parameters: { samplerOverrides: { temperature: 0.8 } },
    prompt_order: [categoryBlock(), contentBlock()],
    metadata: { source: 'risupreset', promptVariables: { 'block-toggle': { toggle_cot: '0' } } },
    ...over,
  };
}

const TRANSLATIONS = new Map<string, string>([
  ['그룹 하나', 'Group one'],
  ['선택 항목', 'Selected item'],
  ['사용 안 함', 'Disabled'],
  ['보통', 'Normal'],
  ['스위치 항목', 'Switch item'],
  ['글 상자', 'Text box'],
]);

describe('collectPresetLabels', () => {
  test('collects category names, variable labels and option labels in document order', () => {
    expect(collectPresetLabels(preset())).toEqual([
      '그룹 하나',
      '선택 항목',
      '사용 안 함',
      '보통',
      '스위치 항목',
      '글 상자',
    ]);
  });

  test('ignores labels that are already Latin text, and non-category blocks', () => {
    const labels = collectPresetLabels(preset({ prompt_order: [categoryBlock({ name: 'Group one' }), contentBlock()] }));
    expect(labels).not.toContain('Group one');
    expect(labels).not.toContain('Synthetic Rule');
    // The variable labels are still Korean, so they stay in the request.
    expect(labels).toContain('선택 항목');
  });

  test('de-duplicates a label that repeats across variables', () => {
    const block = categoryBlock();
    (block.variables as Array<{ label: string }>)[1]!.label = '선택 항목';
    expect(collectPresetLabels(preset({ prompt_order: [block] }))).toEqual([
      '그룹 하나',
      '선택 항목',
      '사용 안 함',
      '보통',
      '글 상자',
    ]);
  });

  test('returns nothing for a preset without toggle categories', () => {
    expect(collectPresetLabels(preset({ prompt_order: [contentBlock()] }))).toEqual([]);
    expect(collectPresetLabels(preset({ prompt_order: [] }))).toEqual([]);
  });
});

describe('buildPresetLabelPrompt', () => {
  test('lists every label and demands a JSON reply keyed by the input strings', () => {
    const labels = ['그룹 하나', '사용 안 함'];
    const prompt = buildPresetLabelPrompt(labels);
    expect(prompt.system).toContain('JSON');
    for (const label of labels) expect(prompt.user).toContain(label);
  });
});

describe('parsePresetLabelResponse', () => {
  test('reads a JSON object out of a fenced reply', () => {
    const parsed = parsePresetLabelResponse('```json\n{"사용 안 함":"Disabled"}\n```', ['사용 안 함']);
    expect(parsed.get('사용 안 함')).toBe('Disabled');
  });

  test('throws when a requested label is missing', () => {
    expect(() => parsePresetLabelResponse('{"사용 안 함":"Disabled"}', ['사용 안 함', '글 상자'])).toThrow(/omitted 1 of 2/);
  });

  test('throws when a label is answered with an empty string', () => {
    expect(() => parsePresetLabelResponse('{"사용 안 함":"  "}', ['사용 안 함'])).toThrow(/omitted 1 of 1/);
  });

  test('throws when the reply carries no JSON object', () => {
    expect(() => parsePresetLabelResponse('Disabled', ['사용 안 함'])).toThrow(/no JSON object/);
    expect(() => parsePresetLabelResponse('{not json}', ['사용 안 함'])).toThrow(/not valid JSON/);
  });
});

describe('applyPresetLabelTranslations', () => {
  test('rewrites only the label fields', () => {
    const before = preset();
    const after = applyPresetLabelTranslations(before, TRANSLATIONS);
    const block = after.prompt_order![0]!;
    expect(block.name).toBe('Group one');
    const variables = block.variables!;
    expect(variables.map((v) => v.label)).toEqual([
      'Selected item',
      'Switch item',
      'Text box',
    ]);
    expect(variables.map((v) => v.name)).toEqual(['toggle_alpha', 'toggle_beta', 'toggle_text']);
    expect(variables.map((v) => v.id)).toEqual(['var-select', 'var-switch', 'var-text']);
    const select = variables[0]!;
    if (select.type !== 'select') throw new Error('expected the select variable');
    expect(select.options).toEqual([
      { id: '0', label: 'Disabled', value: '0' },
      { id: '1', label: 'Normal', value: '1' },
    ]);
    expect(select.defaultValue).toBe('0');
    expect(variables[1]!.type === 'switch' && variables[1]!.defaultValue).toBe(0);
    // Content, placement and metadata are shared with the input preset.
    expect(after.prompt_order![1]).toBe(before.prompt_order![1]);
    expect(after.parameters).toBe(before.parameters);
    expect(after.metadata).toBe(before.metadata);
    expect(after.name).toBe('Synthetic Preset');
  });

  test('returns the preset untouched when no translation matches', () => {
    const before = preset();
    const after = applyPresetLabelTranslations(before, new Map([['없는 라벨', 'Missing label']]));
    expect(after).toBe(before);
  });

  test('leaves an unchanged label in place but still rewrites its siblings', () => {
    const after = applyPresetLabelTranslations(preset(), new Map([['사용 안 함', '사용 안 함']]));
    const select = after.prompt_order![0]!.variables![0]!;
    if (select.type !== 'select') throw new Error('expected the select variable');
    expect(select.options[0]!.label).toBe('사용 안 함');
    expect(select.label).toBe('선택 항목');
  });
});

describe('translatePresetLabels', () => {
  test('sends one request on the selected connection and applies the reply', async () => {
    const generate = mock(async () => JSON.stringify(Object.fromEntries(TRANSLATIONS)));
    const before = preset();

    const after = await translatePresetLabels(
      before,
      { connectionId: 'conn-2', userId: 'u1' },
      { generate },
    );

    expect(generate).toHaveBeenCalledTimes(1);
    const request = (generate.mock.calls[0] as unknown[])[0] as {
      user: string; connectionId: string; userId: string;
    };
    expect(request.connectionId).toBe('conn-2');
    expect(request.userId).toBe('u1');
    expect(request.user).toContain('선택 항목');
    expect(after.prompt_order![0]!.name).toBe('Group one');
    expect(after.prompt_order![0]!.variables!.map((v) => v.name)).toEqual([
      'toggle_alpha', 'toggle_beta', 'toggle_text',
    ]);
  });

  test('does not generate when the preset has no translatable label', async () => {
    const generate = mock(async () => '{}');
    const before = preset({ prompt_order: [contentBlock()] });
    expect(await translatePresetLabels(before, { connectionId: 'c', userId: 'u' }, { generate })).toBe(before);
    expect(generate).not.toHaveBeenCalled();
  });

  test('propagates a generate failure instead of importing untranslated labels', async () => {
    const generate = mock(async () => { throw new Error('connection refused'); });
    await expect(translatePresetLabels(preset(), { connectionId: 'c', userId: 'u' }, { generate }))
      .rejects.toThrow('connection refused');
  });
});
