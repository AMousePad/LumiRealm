import jsonLuaSource from './lua-json.lua' with { type: 'text' };

interface WasmoonEngine {
  global: {
    set: (n: string, v: unknown) => void;
    get: (n: string) => unknown;
    close?: () => void;
  };
  doString: (s: string) => Promise<unknown>;
}
interface WasmoonFactory {
  mountFile: (p: string, c: string) => Promise<void>;
  createEngine: (o?: { injectObjects?: boolean; enableProxy?: boolean }) => Promise<WasmoonEngine>;
}

const PRELUDE = `
json = require 'json'

function getChat(id, index)
  return json.decode(getChatMain(id, index))
end

function getFullChat(id)
  return json.decode(getFullChatMain(id))
end

function setFullChat(id, value)
  setFullChatMain(id, json.encode(value))
end

function log(value)
  logMain(json.encode(value))
end

function getLoreBooks(id, search)
  return json.decode(getLoreBooksMain(id, search))
end

function loadLoreBooks(id)
  return json.decode(loadLoreBooksMain(id):await())
end

function LLM(id, prompt, useMultimodal, options)
  useMultimodal = useMultimodal or false
  options = options or {}
  return json.decode(LLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function axLLM(id, prompt, useMultimodal, options)
  useMultimodal = useMultimodal or false
  options = options or {}
  return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function getCharacterImage(id)
  return getCharacterImageMain(id):await()
end

function getPersonaImage(id)
  return getPersonaImageMain(id):await()
end

function cbs(value)
  return cbsMain(value):await()
end

function getDescription(id)
  return getDescriptionMain(id):await()
end

function setDescription(id, value)
  return setDescriptionMain(id, value):await()
end

function getPersonaDescription(id)
  return getPersonaDescriptionMain(id):await()
end

function getAuthorsNote(id)
  return getAuthorsNoteMain(id):await()
end

local editRequestFuncs = {}
local editDisplayFuncs = {}
local editInputFuncs = {}
local editOutputFuncs = {}

function listenEdit(type, func)
  if type == 'editRequest' then editRequestFuncs[#editRequestFuncs + 1] = func return end
  if type == 'editDisplay' then editDisplayFuncs[#editDisplayFuncs + 1] = func return end
  if type == 'editInput' then editInputFuncs[#editInputFuncs + 1] = func return end
  if type == 'editOutput' then editOutputFuncs[#editOutputFuncs + 1] = func return end
  error('Invalid type')
end

function getState(id, name)
  local escapedName = '__' .. name
  local raw = getChatVar(id, escapedName)
  if raw == nil or raw == '' or raw == 'null' then return nil end
  local ok, v = pcall(json.decode, raw)
  if ok then return v end
  return nil
end

function setState(id, name, value)
  local escapedName = '__' .. name
  setChatVar(id, escapedName, json.encode(value))
end

function async(callback)
  return function(...)
    local co = coroutine.create(callback)
    local safe, result = coroutine.resume(co, ...)
    return Promise.create(function(resolve, reject)
      local checkresult
      local step = function()
        if coroutine.status(co) == "dead" then
          local send = safe and resolve or reject
          return send(result)
        end
        safe, result = coroutine.resume(co)
        checkresult()
      end
      checkresult = function()
        if safe and result == Promise.resolve(result) then
          result:finally(step)
        else
          step()
        end
      end
      checkresult()
    end)
  end
end

callListenMain = async(function(type, id, value, meta)
  local realValue = json.decode(value)
  local realMeta = json.decode(meta)
  if type == 'editRequest' then for _, f in ipairs(editRequestFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editDisplay' then for _, f in ipairs(editDisplayFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editInput' then for _, f in ipairs(editInputFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editOutput' then for _, f in ipairs(editOutputFuncs) do realValue = f(id, realValue, realMeta) end
  end
  return json.encode(realValue)
end)
`;

interface EngineEntry {
  engine: WasmoonEngine;
  code: string | null;
  tail: Promise<unknown>;
  current: Record<string, unknown>;
  bound: Set<string>;
}

let factoryPromise: Promise<WasmoonFactory> | null = null;
const engines = new Map<string, Promise<EngineEntry>>();

async function ensureFactory(): Promise<WasmoonFactory> {
  if (factoryPromise) return factoryPromise;
  factoryPromise = (async (): Promise<WasmoonFactory> => {
    const [mod, glue] = await Promise.all([
      import('wasmoon') as unknown as Promise<{ LuaFactory: new (uri?: string) => WasmoonFactory }>,
      import('../display/_glue-wasm-b64.js'),
    ]);
    const factory = new mod.LuaFactory(glue.GLUE_WASM_DATA_URI);
    await factory.mountFile('json.lua', jsonLuaSource);
    return factory;
  })();
  return factoryPromise;
}

function getEngineEntry(key: string): Promise<EngineEntry> {
  const existing = engines.get(key);
  if (existing) return existing;
  const created = (async (): Promise<EngineEntry> => {
    const factory = await ensureFactory();
    const engine = await factory.createEngine({ injectObjects: true });
    return { engine, code: null, tail: Promise.resolve(), current: {}, bound: new Set<string>() };
  })();
  engines.set(key, created);
  return created;
}

export function clearWasmoonEngine(key: string): void {
  engines.delete(key);
}

export interface WasmoonExecuteOpts {
  readonly entry?: string;
  readonly args?: readonly unknown[];
  readonly wasmoonKey: string;
}

export async function executeWasmoon(
  code: string,
  globals: Record<string, unknown>,
  opts: WasmoonExecuteOpts,
): Promise<unknown> {
  const entry = await getEngineEntry(opts.wasmoonKey);
  const run = entry.tail.then(async () => {
    if (entry.code !== null && entry.code !== code) {
      entry.engine.global.close?.();
      const factory = await ensureFactory();
      entry.engine = await factory.createEngine({ injectObjects: true });
      entry.code = null;
      entry.bound.clear();
    }
    const engine = entry.engine;
    entry.current = globals;
    for (const name of Object.keys(globals)) {
      if (typeof globals[name] !== 'function' || entry.bound.has(name)) continue;
      engine.global.set(name, (...args: unknown[]) => (entry.current[name] as (...a: unknown[]) => unknown)(...args));
      entry.bound.add(name);
    }
    if (entry.code === null) {
      await engine.doString(PRELUDE + '\n' + code);
      entry.code = code;
    }
    const fn = engine.global.get(String(opts.entry ?? 'callListenMain'));
    if (typeof fn === 'function') {
      return await (fn as (...a: unknown[]) => unknown)(...(opts.args ?? []));
    }
    return undefined;
  });
  entry.tail = run.catch(() => undefined);
  return run;
}
