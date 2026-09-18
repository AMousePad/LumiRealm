export interface EngineCase {
  readonly name: string;
  readonly code: string;
  readonly expected: readonly unknown[];
  readonly fengariDiverges?: boolean;
  readonly wasmoonDiverges?: boolean;
}

// Expected values are verified by the pinned Risu wrapper in the browser harness.
export const engineCases: readonly EngineCase[] = [
  {
    name: 'Lua version matches Risu',
    code: 'function probe() return _VERSION end',
    expected: ['Lua 5.4'], fengariDiverges: true,
  },
  {
    name: 'integer arithmetic retains the Lua 5.4 range',
    code: 'function probe() return tostring(2147483647 + 1).."|"..tostring(math.maxinteger) end',
    expected: ['2147483648|9223372036854775807'], fengariDiverges: true,
  },
  {
    name: 'unchanged code preserves Lua globals between invocations',
    code: 'counter = counter or 0; function probe() counter = counter + 1; return counter end',
    expected: [1, 2], fengariDiverges: true,
  },
  {
    name: 'async entry returns its resolved value',
    code: 'probe = async(function() return promiseValue():await() + 1 end)',
    expected: [3], fengariDiverges: true,
  },
  {
    name: 'async entry preserves boolean false',
    code: 'probe = async(function() return false end)',
    expected: [false], fengariDiverges: true,
  },
  {
    name: 'pcall catches a rejected awaited host promise',
    code: 'probe = async(function() local ok = pcall(function() return promiseReject():await() end); return tostring(ok) end)',
    expected: ['false'], fengariDiverges: true,
  },
  {
    name: 'the JavaScript caller receives the first Lua return value',
    code: 'function probe() return "one", "two" end',
    expected: ['one'], fengariDiverges: true,
  },
  {
    name: 'invalid state JSON raises a catchable Lua error',
    code: 'function probe(id) local ok, value = pcall(getState, id, "bad"); return tostring(ok).."|"..type(value) end',
    expected: ['false|string'], fengariDiverges: true, wasmoonDiverges: true,
  },
  {
    name: 'getRecentChats decodes the public wrapper result',
    code: 'function probe(id) return getRecentChats(id, 1)[1].data end',
    expected: ['Latest'], fengariDiverges: true, wasmoonDiverges: true,
  },
  {
    name: 'setStateChanged exposes the public wrapper',
    code: 'function probe(id) return setStateChanged(id, "count", 1) end',
    expected: [true], fengariDiverges: true, wasmoonDiverges: true,
  },
  {
    name: 'a plain callback can call synchronous cbs',
    code: 'function probe() return cbs("{{char}}") end',
    expected: ['Character'], wasmoonDiverges: true,
  },
  {
    name: 'top-level code can call synchronous cbs',
    code: 'local name = cbs("{{char}}"); function probe() return name end',
    expected: ['Character'], fengariDiverges: true,
  },
  {
    name: 'JSON and Unicode controls share the same representation',
    code: 'function probe() return json.encode(json.decode("{}")).."|"..json.encode(json.decode("[]")).."|"..#("😀").."|"..utf8.len("😀") end',
    expected: ['[]|[]|4|1'],
  },
  {
    name: 'JSON state retains false',
    code: 'function probe(id) setState(id, "value", false); return tostring(getState(id, "value")) end',
    expected: ['false'],
  },
  {
    name: 'plain callback returns false unchanged',
    code: 'function probe() return false end',
    expected: [false],
  },
];

export function engineGlobals(oracle = false): Record<string, unknown> {
  const state: Record<string, unknown> = { __bad: 'invalid json' };
  return {
    getChatVar: (_id: string, key: string) => state[key] ?? 'null',
    setChatVar: (_id: string, key: string, value: unknown) => { state[key] = value; },
    setChatVarChanged: (_id: string, key: string, value: unknown) => {
      const changed = state[key] !== value;
      state[key] = value;
      return changed;
    },
    getRecentChatsMain: () => '[{"role":"char","data":"Latest"}]',
    promiseValue: async () => 2,
    promiseReject: async () => { throw new Error('deliberate host rejection'); },
    ...(oracle ? { cbs: () => 'Character' } : { cbsMain: async () => 'Character' }),
  };
}
