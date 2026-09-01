import { describe, test, expect } from 'bun:test';
import { compileTrigger } from '../../src/core/triggers/compile.js';
import { interpretTrigger, type InterpConsole } from '../../src/interpreter/trigger-interpreter.js';
import { compareValues } from '../../src/interpreter/runtime/compare.js';
import {
  KNOWN_V1_EFFECTS,
  KNOWN_V2_OPCODES,
  KNOWN_CODE_EFFECTS,
  type TriggerScript,
  type TriggerEffect,
} from '../../src/core/schemas/triggerscript.js';
import type { RisuTriggerRuntime } from '../../src/interpreter/runtime.js';

const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

type LogEntry = string;

function makeRecordingRuntime(opts: { asyncHostGetters?: boolean } = {}): { rt: RisuTriggerRuntime; log: LogEntry[]; console: InterpConsole } {
  const log: LogEntry[] = [];
  let tick = 0;
  const rec = (m: string, args: unknown[]): void => {
    log.push(`${m}(${args.map((a) => safe(a)).join(',')})`);
  };
  const safe = (v: unknown): string => {
    try { return JSON.stringify(v); } catch { return String(v); }
  };

  const target: Record<string, unknown> = {
    displayMode: false,
    lowLevelAccess: false,
    characterId: 'cid',
    stopSending: false,
    sendAIprompt: false,

    resolve: (value: unknown, kind: string) => (kind === 'var' ? '0' : String(value)),
    setVar: (_n: string, _v: unknown) => {},
    getVar: (_n: string) => '0',
    declareLocalVar: (_n: string, _v: unknown, _i: number) => {},
    setvarV1: (_n: string, _o: string, _v: unknown) => {},
    setvarV2: (_n: string, _o: string, _v: unknown) => {},
    compare: (a: unknown, b: unknown, op: string) => compareValues(a, b, op),
    checkConditions: (_c: readonly unknown[]) => true,

    loopTick: () => ++tick,
    sleep: async (_ms: number) => {},

    impersonate: async () => {},
    systemPrompt: async () => {},
    command: async () => {},
    cutChat: async () => {},
    modifyChat: async () => {},
    updateGUI: async () => {},
    updateChatAt: async () => {},
    tokenize: () => 5,
    quickSearchChat: () => false,
    getLastMessage: () => 'msg',
    getMessageAtIndex: () => 'msg',
    getMessageCount: () => 0,
    getLastUserMessage: () => 'umsg',
    getLastCharMessage: () => 'cmsg',
    getFirstMessage: () => 'fmsg',

    showAlert: async () => {},
    alertInput: async () => 'in',
    alertSelect: async () => 'sel',
    runLLM: async () => 'llm',
    checkSimilarity: async () => ['sim'],
    runImgGen: async () => 'img',
    runTrigger: async () => {},
    runCode: async () => {},
    runLua: async () => 'lua',

    extractRegex: () => 'ex',
    regexTest: () => false,
    replaceString: () => 'rep',
    random: (min: unknown) => Number(min) || 0,
    setCharAt: () => 'sca',
    splitString: () => [],
    calculate: () => '2',

    makeArrayVar: () => {},
    arrayLength: () => 0,
    arrayGet: () => 'ag',
    arraySet: () => {},
    arrayPush: () => {},
    arrayPop: () => 'pop',
    arrayShift: () => 'shift',
    arrayUnshift: () => {},
    arraySplice: () => {},
    arraySlice: () => 'slice',
    arrayJoin: () => 'join',
    arrayIndexOf: () => 0,
    arrayRemoveIndex: () => {},

    makeDictVar: () => {},
    dictGet: () => 'dg',
    dictSet: () => {},
    dictDelete: () => {},
    dictHasKey: () => false,
    dictClear: () => {},
    dictSize: () => 0,
    dictKeys: () => [],
    dictValues: () => [],

    getCharacterDesc: () => opts.asyncHostGetters ? Promise.resolve('cdesc') : 'cdesc',
    setCharacterDesc: async () => {},
    getPersonaDesc: () => opts.asyncHostGetters ? Promise.resolve('pdesc') : 'pdesc',
    setPersonaDesc: async () => {},
    getReplaceGlobalNote: () => opts.asyncHostGetters ? Promise.resolve('rgn') : 'rgn',
    setReplaceGlobalNote: async () => {},
    getAuthorNote: () => opts.asyncHostGetters ? Promise.resolve('an') : 'an',
    setAuthorNote: async () => {},

    modifyLorebook: async () => {},
    getLorebookByKey: () => 'lb',
    getLorebookCount: () => 0,
    getLorebookEntry: () => 'lbe',
    setLorebookActivation: async () => {},
    getLorebookIndexViaName: () => 0,
    getAllLorebooks: () => [],
    getLorebookByName: () => [],
    getLorebookByIndex: () => 'lbi',
    createLorebook: async () => {},
    modifyLorebookByIndex: async () => {},
    deleteLorebookByIndex: async () => {},
    setLorebookAlwaysActive: async () => {},

    getDisplayState: () => 'ds',
    setDisplayState: () => {},
    getRequestState: () => 'rs',
    setRequestState: () => {},
    getRequestStateRole: () => 'rsr',
    setRequestStateRole: () => {},
    getRequestStateLength: () => 0,

    flush: async () => {},
    warnDroppedTriggerCode: () => {},
  };

  const rt = new Proxy(target, {
    get(t, prop) {
      const v = t[prop as string];
      if (typeof v === 'function') {
        return (...args: unknown[]) => {
          rec(String(prop), args);
          return (v as (...a: unknown[]) => unknown).apply(t, args);
        };
      }
      return v;
    },
    set(t, prop, value) {
      log.push(`set ${String(prop)}=${safe(value)}`);
      t[prop as string] = value;
      return true;
    },
  }) as unknown as RisuTriggerRuntime;

  const con: InterpConsole = {
    log: (...a: unknown[]) => log.push(`console.log(${a.map((x) => safe(x)).join(',')})`),
    warn: () => {},
    error: () => {},
    info: () => {},
  };

  return { rt, log, console: con };
}

async function runCompiled(
  trigger: TriggerScript,
  opts: { displayMode: boolean; lowLevelAccess: boolean },
): Promise<LogEntry[]> {
  const compiled = compileTrigger(trigger, opts);
  const { rt, log, console } = makeRecordingRuntime();
  const fn = new AsyncFunctionCtor('__risu', 'console', '"use strict";\n' + compiled.body + '\n');
  await fn(rt, console);
  return log;
}

async function runInterpreted(
  trigger: TriggerScript,
  opts: { displayMode: boolean; lowLevelAccess: boolean },
): Promise<LogEntry[]> {
  const { rt, log, console } = makeRecordingRuntime();
  await interpretTrigger(trigger, rt, console, opts);
  return log;
}

function mk(effects: TriggerEffect[], conditions: unknown[] = []): TriggerScript {
  return { type: 'manual', comment: '', conditions, effect: effects } as unknown as TriggerScript;
}

const SINK: Record<string, unknown> = {
  var: 'v', value: '1', valueType: 'value', operator: '+=',
  outputVar: 'out', inputVar: 'inp',
  index: '0', indexType: 'value', start: '0', startType: 'value', end: '1', endType: 'value',
  source: 's', sourceType: 'value', source1: 'a', source1Type: 'value', source2: 'b', source2Type: 'value',
  target: 't', targetType: 'value', condition: 'equal',
  role: 'user', location: 'start', alertType: 'normal', model: 'model', streaming: false,
  regex: '\\d+', regexType: 'value', flags: 'g', flagsType: 'value', result: '$0', resultType: 'value',
  replacement: 'x', replacementType: 'value',
  delimiter: ',', delimiterType: 'value',
  min: '0', minType: 'value', max: '5', maxType: 'value',
  display: 'd', displayType: 'value', depth: '1', depthType: 'value',
  key: 'k', keyType: 'value', varType: 'var', item: 'i', itemType: 'value',
  name: 'n', nameType: 'value', content: 'c', contentType: 'value', insertOrder: '0', insertOrderType: 'value',
  expression: '1+1', expressionType: 'value', negValue: 'neg', negValueType: 'value',
  code: 'print(1)', indent: 0,
};

function sinkEffect(type: string): TriggerEffect {
  return { ...SINK, type } as unknown as TriggerEffect;
}

const OPT_COMBOS = [
  { displayMode: false, lowLevelAccess: false },
  { displayMode: true, lowLevelAccess: false },
  { displayMode: false, lowLevelAccess: true },
  { displayMode: true, lowLevelAccess: true },
];

const ALL_LEAF_OPCODES = [
  ...KNOWN_V1_EFFECTS,
  ...KNOWN_CODE_EFFECTS,
  ...KNOWN_V2_OPCODES.filter((o) => o !== 'v2Loop'),
];

describe('V2 interpreter ↔ compiled-emitter parity (per-opcode, all gating combos)', () => {
  for (const opcode of ALL_LEAF_OPCODES) {
    for (const opts of OPT_COMBOS) {
      test(`${opcode} [display=${opts.displayMode} lowLevel=${opts.lowLevelAccess}]`, async () => {
        const trigger = mk([sinkEffect(opcode)]);
        const [a, b] = await Promise.all([runCompiled(trigger, opts), runInterpreted(trigger, opts)]);
        expect(b).toEqual(a);
      });
    }
  }
});

describe('V2 interpreter ↔ compiled-emitter parity (control flow)', () => {
  const fixtures: Record<string, TriggerEffect[]> = {
    'loop+break': [
      { ...SINK, type: 'v2Loop', indent: 0 },
      { ...SINK, type: 'v2SetVar', indent: 1 },
      { ...SINK, type: 'v2BreakLoop', indent: 1 },
      { ...SINK, type: 'v2EndIndent', indent: 1 },
    ] as unknown as TriggerEffect[],
    'if/else': [
      { ...SINK, type: 'v2If', indent: 0 },
      { ...SINK, type: 'v2SetVar', indent: 1, var: 'a' },
      { ...SINK, type: 'v2EndIndent', indent: 1 },
      { ...SINK, type: 'v2Else', indent: 0 },
      { ...SINK, type: 'v2SetVar', indent: 1, var: 'b' },
      { ...SINK, type: 'v2EndIndent', indent: 1 },
    ] as unknown as TriggerEffect[],
    'if-advanced-no-else': [
      { ...SINK, type: 'v2IfAdvanced', indent: 0, sourceType: 'value' },
      { ...SINK, type: 'v2ConsoleLog', indent: 1 },
      { ...SINK, type: 'v2EndIndent', indent: 1 },
    ] as unknown as TriggerEffect[],
    'loopN': [
      { ...SINK, type: 'v2LoopNTimes', indent: 0, value: '3' },
      { ...SINK, type: 'v2SetVar', indent: 1 },
      { ...SINK, type: 'v2EndIndent', indent: 1 },
    ] as unknown as TriggerEffect[],
    'nested-loop-if-break': [
      { ...SINK, type: 'v2LoopNTimes', indent: 0, value: '2' },
      { ...SINK, type: 'v2If', indent: 1 },
      { ...SINK, type: 'v2BreakLoop', indent: 2 },
      { ...SINK, type: 'v2EndIndent', indent: 2 },
      { ...SINK, type: 'v2EndIndent', indent: 1 },
    ] as unknown as TriggerEffect[],
    'stoptrigger-midway': [
      { ...SINK, type: 'v2SetVar', indent: 0 },
      { ...SINK, type: 'v2StopTrigger', indent: 0 },
      { ...SINK, type: 'v2SetVar', indent: 0, var: 'after' },
    ] as unknown as TriggerEffect[],
    'breakloop-toplevel-return': [
      { ...SINK, type: 'v2SetVar', indent: 0 },
      { ...SINK, type: 'v2BreakLoop', indent: 0 },
      { ...SINK, type: 'v2SetVar', indent: 0, var: 'after' },
    ] as unknown as TriggerEffect[],
    'orphan-endindent-else': [
      { ...SINK, type: 'v2EndIndent', indent: 0 },
      { ...SINK, type: 'v2Else', indent: 0 },
      { ...SINK, type: 'v2SetVar', indent: 0 },
    ] as unknown as TriggerEffect[],
  };

  for (const [name, effects] of Object.entries(fixtures)) {
    for (const opts of OPT_COMBOS) {
      test(`${name} [display=${opts.displayMode} lowLevel=${opts.lowLevelAccess}]`, async () => {
        const trigger = mk(effects);
        const [a, b] = await Promise.all([runCompiled(trigger, opts), runInterpreted(trigger, opts)]);
        expect(b).toEqual(a);
      });
    }
  }

  test('conditions gate fires checkConditions', async () => {
    const trigger = mk([sinkEffect('v2SetVar')], [{ type: 'var', var: 'x', value: '1', operator: '=' }]);
    const opts = { displayMode: false, lowLevelAccess: false };
    const [a, b] = await Promise.all([runCompiled(trigger, opts), runInterpreted(trigger, opts)]);
    expect(b).toEqual(a);
    expect(a[0]).toMatch(/^checkConditions\(/);
  });
});

test('host-backed V2 getters await values before storing them', async () => {
  const { rt, log, console } = makeRecordingRuntime({ asyncHostGetters: true });
  await interpretTrigger(mk([
    sinkEffect('v2GetCharacterDesc'),
    { ...sinkEffect('v2GetPersonaDesc'), outputVar: 'persona' } as TriggerEffect,
    { ...sinkEffect('v2GetReplaceGlobalNote'), outputVar: 'global_note' } as TriggerEffect,
    { ...sinkEffect('v2GetAuthorNote'), outputVar: 'author_note' } as TriggerEffect,
  ]), rt, console, { displayMode: false, lowLevelAccess: false });

  expect(log.filter((entry) => entry.startsWith('setVar('))).toEqual([
    'setVar("out","cdesc")',
    'setVar("persona","pdesc")',
    'setVar("global_note","rgn")',
    'setVar("author_note","an")',
  ]);
});
