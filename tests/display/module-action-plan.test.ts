import { describe, expect, test } from 'bun:test';
import { buildModuleDisplayPlan } from '../../src/display/module-action-plan.js';
import type { FeRegexScript } from '../../src/display/regex-apply.js';
import type { RuntimeAtAtAction } from '../../src/interpreter/at-actions-runtime.js';

function script(
  id: string,
  sourceIndex: number,
  sourceRowIndex: number,
  replace = '@@emo Joy',
): FeRegexScript {
  return {
    id,
    find_regex: 'happy',
    replace_string: replace,
    flags: 'gi',
    placement: ['ai_output', 'user_input'],
    substitute_macros: 'none',
    trim_strings: [],
    min_depth: null,
    max_depth: null,
    metadata: {
      _risu: {
        module_id: 'module-a',
        phase: 'editdisplay',
        source_type: 'editdisplay',
        source_index: sourceIndex,
        source_row_index: sourceRowIndex,
      },
    },
  };
}

function action(
  liveScriptId = 'row-a',
  sourceIndex = 0,
  sourceRowIndex = 0,
): RuntimeAtAtAction {
  return {
    action: 'emo',
    directAction: 'emo',
    findRegex: 'old',
    flag: 'g',
    out: '@@emo Old',
    phase: 'editdisplay',
    order: 0,
    sourceIndex,
    sourceRowIndex,
    sourceOrigin: 'module:module-a',
    liveScriptId,
  };
}

describe('module display action plan', () => {
  test('binds exact runtime identity to the editable live row', () => {
    const plan = buildModuleDisplayPlan(
      [script('row-a', 0, 0)],
      [action()],
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]?.kind).toBe('action');
    if (plan[0]?.kind !== 'action') return;
    expect(plan[0].action.findRegex).toBe('happy');
    expect(plan[0].action.flag).toBe('gi');
    expect(plan[0].action.out).toBe('@@emo Joy');
  });

  test('uses current host order', () => {
    const plan = buildModuleDisplayPlan(
      [
        script('row-b', 1, 1, '@@emo Second'),
        script('row-a', 0, 0, '@@emo First'),
      ],
      [action('row-a', 0, 0), action('row-b', 1, 1)],
    );
    expect(plan.map((step) => step.script.id)).toEqual(['row-b', 'row-a']);
  });

  test('does not execute a deleted or disabled row from raw metadata', () => {
    expect(buildModuleDisplayPlan([], [action()])).toEqual([]);
  });

  test('fails closed when the live id points at another source row', () => {
    const plan = buildModuleDisplayPlan(
      [script('row-a', 1, 1)],
      [action('row-a', 0, 0)],
    );
    expect(plan[0]?.kind).toBe('skip');
  });

  test('fails closed when more than one descriptor claims the row', () => {
    const plan = buildModuleDisplayPlan(
      [script('row-a', 0, 0)],
      [action(), action()],
    );
    expect(plan[0]?.kind).toBe('skip');
  });

  test('runs an action row as an ordinary regex after its action is removed', () => {
    const plan = buildModuleDisplayPlan(
      [script('row-a', 0, 0, '<div>ordinary</div>')],
      [action()],
    );
    expect(plan[0]?.kind).toBe('script');
  });

  test('leaves host-owned move syntax as an ordinary script row', () => {
    const plan = buildModuleDisplayPlan(
      [script('row-a', 0, 0, '@@move_top $&')],
      [],
    );
    expect(plan[0]?.kind).toBe('script');
  });

  test('leaves unrelated host rows alone', () => {
    const native = {
      ...script('native', 0, 0, 'native'),
      metadata: {},
    };
    expect(buildModuleDisplayPlan([native], [])[0]?.kind).toBe('script');
  });
});
