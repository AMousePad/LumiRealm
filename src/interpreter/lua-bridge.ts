// fengari-web adapter with coroutine-based Promise bridge.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - fengari-web has no published TypeScript types.
import * as fengari from 'fengari-web';
// Bun text loader inlines at build time, avoids node:fs (Lumi blocks it).
import jsonLuaSource from './lua-json.lua' with { type: 'text' };
import { makeSafeLogger } from '../util/safe-log.js';
import { perfEnabled, perfRecord, perfBump } from '../util/perf.js';

type LuaState = unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fen = fengari as any;
const lua = fen.lua;
const lauxlib = fen.lauxlib;
const lualib = fen.lualib;
const toL = fen.to_luastring as (s: string) => unknown;
const toJS = fen.to_jsstring as (s: unknown) => string;

const _luaLog = makeSafeLogger('lua-bridge');
function flog(msg: string): void { _luaLog.info(msg); }
// Gate verbose phase markers behind RISU_COMPAT_VERBOSE=1.
const LUA_BRIDGE_VERBOSE: boolean = (() => {
  try {
    return typeof process !== 'undefined'
      && (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RISU_COMPAT_VERBOSE === '1';
  } catch { return false; }
})();
function fverbose(msg: string): void { if (LUA_BRIDGE_VERBOSE) flog(msg); }
function flogErr(msg: string): void { _luaLog.error(msg); }

function getJsonLuaSource(): string {
  fverbose(`getJsonLuaSource: returning bundled source (${jsonLuaSource.length} chars)`);
  return jsonLuaSource;
}

function pushJs(L: LuaState, v: unknown): void {
  if (v === null || v === undefined) { lua.lua_pushnil(L); return; }
  if (typeof v === 'boolean') { lua.lua_pushboolean(L, v ? 1 : 0); return; }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) lua.lua_pushinteger(L, v);
    else lua.lua_pushnumber(L, v);
    return;
  }
  if (typeof v === 'string') { lua.lua_pushstring(L, toL(v)); return; }
  if (Array.isArray(v)) {
    lua.lua_createtable(L, v.length, 0);
    for (let i = 0; i < v.length; i++) {
      pushJs(L, v[i]);
      lua.lua_rawseti(L, -2, i + 1);
    }
    return;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    lua.lua_createtable(L, 0, keys.length);
    for (const k of keys) {
      lua.lua_pushstring(L, toL(k));
      pushJs(L, obj[k]);
      lua.lua_settable(L, -3);
    }
    return;
  }
  lua.lua_pushnil(L);
}

function luaToJs(L: LuaState, idx: number): unknown {
  const t = lua.lua_type(L, idx);
  if (t === lua.LUA_TNIL) return null;
  if (t === lua.LUA_TBOOLEAN) return !!lua.lua_toboolean(L, idx);
  if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
  if (t === lua.LUA_TSTRING) return toJS(lua.lua_tostring(L, idx));
  if (t === lua.LUA_TTABLE) {
    const absIdx = lua.lua_absindex(L, idx);
    const arr: unknown[] = [];
    const len = lua.lua_rawlen(L, absIdx);
    for (let i = 1; i <= len; i++) {
      lua.lua_rawgeti(L, absIdx, i);
      arr.push(luaToJs(L, -1));
      lua.lua_pop(L, 1);
    }
    let isArray = true;
    lua.lua_pushnil(L);
    while (lua.lua_next(L, absIdx) !== 0) {
      const keyType = lua.lua_type(L, -2);
      if (keyType !== lua.LUA_TNUMBER) { isArray = false; lua.lua_pop(L, 2); break; }
      const k = lua.lua_tonumber(L, -2);
      if (!Number.isInteger(k) || k < 1 || k > len) { isArray = false; lua.lua_pop(L, 2); break; }
      lua.lua_pop(L, 1);
    }
    if (isArray) return arr;
    const obj: Record<string, unknown> = {};
    lua.lua_pushnil(L);
    while (lua.lua_next(L, absIdx) !== 0) {
      const key = lua.lua_type(L, -2) === lua.LUA_TSTRING
        ? toJS(lua.lua_tostring(L, -2))
        : String(luaToJs(L, -2));
      obj[key] = luaToJs(L, -1);
      lua.lua_pop(L, 1);
    }
    return obj;
  }
  return null;
}

interface PendingPromise {
  promise: Promise<void>;
  pushValue: (L: LuaState) => void;
  failed: boolean;
}

// Registry references and continuations belong to one execution, never another VM.
function createPromiseBridge(root: LuaState) {
  const pending = new Map<number, PendingPromise>();
  let nextToken = 1;
  let disposed = false;

  function retain(L: LuaState, index: number): (target: LuaState) => void {
    lua.lua_checkstack(L, 4);
    lua.lua_pushvalue(L, index);
    const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    return target => lua.lua_rawgeti(target, lua.LUA_REGISTRYINDEX, ref);
  }

  function tokenAt(L: LuaState, index: number): number {
    lua.lua_getfield(L, index, toL('__token'));
    const token = lua.lua_tointeger(L, -1);
    lua.lua_pop(L, 1);
    return token;
  }

  function pushPromise(L: LuaState, rec: PendingPromise): void {
    const token = nextToken++;
    pending.set(token, rec);
    // Attach a rejection observer immediately, including for detached workers.
    void rec.promise.catch(() => {});
    lua.lua_createtable(L, 0, 3);
    lua.lua_pushinteger(L, token);
    lua.lua_setfield(L, -2, toL('__token'));
    lua.lua_pushjsfunction(L, (thread: LuaState) => {
      const awaited = pending.get(tokenAt(thread, 1));
      if (!awaited) return lauxlib.luaL_error(thread, toL('invalid promise'));
      lua.lua_pushinteger(thread, tokenAt(thread, 1));
      // The continuation raises inside Lua, so pcall can catch host rejections.
      return lua.lua_yieldk(thread, 1, 0, (resumed: LuaState) => {
        awaited.pushValue(resumed);
        if (awaited.failed) return lua.lua_error(resumed);
        return 1;
      });
    });
    lua.lua_setfield(L, -2, toL('await'));
    lua.lua_getglobal(L, toL('__risuFinally'));
    lua.lua_setfield(L, -2, toL('finally'));
  }

  async function drive(co: LuaState, nargs: number): Promise<void> {
    let status = lua.lua_resume(co, root, nargs);
    while (status === lua.LUA_YIELD) {
      const token = lua.lua_tointeger(co, -1);
      lua.lua_settop(co, 0);
      const rec = pending.get(token);
      if (!rec) throw new Error('Unsupported Lua yield: expected a promise token');
      await rec.promise.catch(() => {});
      if (disposed) throw new Error('Lua execution disposed');
      status = lua.lua_resume(co, root, 0);
    }
    if (status !== lua.LUA_OK) {
      const raw = lua.lua_tostring(co, -1);
      throw new Error(raw ? toJS(raw) : 'Lua coroutine failed (non-string error)');
    }
  }

  function start(L: LuaState): number {
    lauxlib.luaL_checktype(L, 1, lua.LUA_TFUNCTION);
    const nargs = lua.lua_gettop(L) - 1;
    const co = lua.lua_newthread(L);
    lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    for (let i = 1; i <= nargs + 1; i++) lua.lua_pushvalue(L, i);
    lua.lua_xmove(L, co, nargs + 1);
    const rec: PendingPromise = { promise: Promise.resolve(), failed: false, pushValue: target => lua.lua_pushnil(target) };
    rec.promise = drive(co, nargs).then(() => {
      if (disposed) return;
      // Risu's async wrapper resolves its first return value only.
      if (lua.lua_gettop(co)) rec.pushValue = retain(co, 1);
    }, err => {
      rec.failed = true;
      if (!disposed && lua.lua_gettop(co)) rec.pushValue = retain(co, -1);
      else rec.pushValue = target => pushJs(target, String(err));
      throw err;
    });
    pushPromise(L, rec);
    return 1;
  }

  function all(L: LuaState): number {
    lauxlib.luaL_checktype(L, 1, lua.LUA_TTABLE);
    const records: PendingPromise[] = [];
    for (let i = 1; i <= lua.lua_rawlen(L, 1); i++) {
      lua.lua_rawgeti(L, 1, i);
      const rec = pending.get(tokenAt(L, -1));
      lua.lua_pop(L, 1);
      if (!rec) return lauxlib.luaL_error(L, toL('invalid aggregate promise'));
      records.push(rec);
    }
    const rec: PendingPromise = { promise: Promise.resolve(), failed: false, pushValue: target => {
      lua.lua_createtable(target, records.length, 0);
      records.forEach((item, index) => {
        item.pushValue(target);
        lua.lua_rawseti(target, -2, index + 1);
      });
    } };
    rec.promise = Promise.all(records.map(item => item.promise.catch(err => {
      if (!rec.failed) { rec.failed = true; rec.pushValue = item.pushValue; }
      throw err;
    }))).then(() => {});
    pushPromise(L, rec);
    return 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeWrapper(fn: (...args: any[]) => unknown) {
    return function (L: LuaState): number {
      const args: unknown[] = [];
      for (let i = 1; i <= lua.lua_gettop(L); i++) args.push(luaToJs(L, i));
      let result: unknown;
      try { result = fn(...args); }
      catch (err) { return lauxlib.luaL_error(L, toL('JS error: ' + String(err))); }
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        const rec: PendingPromise = { promise: Promise.resolve(), failed: false, pushValue: target => lua.lua_pushnil(target) };
        rec.promise = Promise.resolve(result).then(value => {
          rec.pushValue = target => pushJs(target, value);
        }, err => {
          rec.failed = true;
          rec.pushValue = target => pushJs(target, err instanceof Error ? err.message : String(err));
          throw err;
        });
        pushPromise(L, rec);
        return 1;
      }
      if (result === undefined) return 0;
      pushJs(L, result);
      return 1;
    };
  }

  return { makeWrapper, start, all, drive, dispose() { disposed = true; pending.clear(); } };
}

function registerJsonModule(L: LuaState): void {
  const preloadCode = 'package.preload.json = function() ' + getJsonLuaSource() + ' end';
  const status = lauxlib.luaL_loadstring(L, toL(preloadCode));
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return;
  }
  lua.lua_pcall(L, 0, 0, 0);
}

export interface ExecuteOpts {
  readonly entry?: string;
  readonly args?: readonly unknown[];
}

const __luaBytecodeCache = new Map<number, Uint8Array>();
function __luaCodeHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

export async function execute(
  code: string,
  globals: Record<string, unknown>,
  opts: ExecuteOpts = {},
): Promise<unknown> {
  const tStart = Date.now();
  const codeStr = String(code || '');
  const globalKeys = (globals && typeof globals === 'object') ? Object.keys(globals) : [];
  flog(`execute: START code_len=${codeStr.length} globals=${globalKeys.length} entry=${String(opts.entry ?? '<none>')} args=${JSON.stringify(opts.args ?? [])}`);
  fverbose(`execute: globals_keys=${globalKeys.join(',').slice(0, 400)}`);
  fverbose(`execute: code[0..300]=${JSON.stringify(codeStr.slice(0, 300))}`);
  const __perfCreate0 = perfEnabled() ? Date.now() : 0;
  const L = lauxlib.luaL_newstate();
  const bridge = createPromiseBridge(L);
  try {
    lualib.luaL_openlibs(L);
    fverbose(`execute: luaL_openlibs done`);
    registerJsonModule(L);
    fverbose(`execute: registerJsonModule done`);
    if (__perfCreate0) perfRecord("lua.vmCreate", Date.now() - __perfCreate0);

    if (globals && typeof globals === 'object') {
      let pushed = 0;
      for (const name of Object.keys(globals)) {
        const fn = globals[name];
        if (typeof fn !== 'function') continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lua.lua_pushjsfunction(L, bridge.makeWrapper(fn as any));
        lua.lua_setglobal(L, toL(name));
        pushed += 1;
      }
      fverbose(`execute: pushed ${pushed} js globals`);
    }

    lua.lua_pushjsfunction(L, bridge.start);
    lua.lua_setglobal(L, toL('__risuStartAsync'));
    lua.lua_pushjsfunction(L, bridge.all);
    lua.lua_setglobal(L, toL('__risuAll'));

    // Risu's luaCodeWrapper starts each async callback in its own coroutine.
    const prelude = `
json = require 'json'

local function __risuCall(callback, ...)
  local value = callback(...)
  while type(value) == 'table' and type(value.await) == 'function' do
    value = value:await()
  end
  return value
end

function async(callback)
  return function(...)
    return __risuStartAsync(function(...) return __risuCall(callback, ...) end, ...)
  end
end

function __risuRunEntry(callback, ...)
  local values = table.pack(callback(...))
  if values.n == 1 then
    return __risuCall(function() return values[1] end)
  end
  return table.unpack(values, 1, values.n)
end

function __risuFinally(self, cb)
  return async(function()
    local ok, value = pcall(function() return self:await() end)
    if type(cb) == 'function' then __risuCall(cb) end
    if not ok then error(value) end
    return value
  end)()
end

Promise = {}
Promise.resolve = function(v)
  if type(v) == 'table' and type(v.await) == 'function' then return v end
  return { await = function(self) return v end, ['finally'] = __risuFinally }
end
Promise.reject = function(err)
  return { await = function(self) error(err) end, ['finally'] = __risuFinally }
end
Promise.all = function(values)
  if type(values) ~= 'table' then error('argument must be an array of promises') end
  local workers = {}
  for i, value in ipairs(values) do
    workers[i] = async(function() return Promise.resolve(value):await() end)()
  end
  return __risuAll(workers)
end

function getChat(id, index)
  return json.decode(getChatMain(id, index))
end

function getFullChat(id)
  return json.decode(getFullChatMain(id))
end

-- Risu scriptings.ts.
function getRecentChats(id, count)
  return json.decode(getRecentChatsMain(id, count))
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

-- Risu scriptings.ts.
function getCharacterImage(id)
  return getCharacterImageMain(id):await()
end

function getPersonaImage(id)
  return getPersonaImageMain(id):await()
end

-- Risu scriptings.ts.
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

-- Risu parity: cards write cbs("...") and get a string. JS-side cbsMain is async because resolveTemplate routes through resolveReadonly IPC.
-- PocketRisu updateDisplay alias to reloadDisplay.
if type(updateDisplay) ~= 'function' and type(reloadDisplay) == 'function' then
  updateDisplay = reloadDisplay
end

function cbs(value)
  return cbsMain(value):await()
end

function getName(id)
  return getNameMain(id):await()
end

function setName(id, value)
  return setNameMain(id, value):await()
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

function getCharacterFirstMessage(id)
  return getCharacterFirstMessageMain(id):await()
end

function setCharacterFirstMessage(id, value)
  return setCharacterFirstMessageMain(id, value):await()
end

local editRequestFuncs = {}
local editDisplayFuncs = {}
local editInputFuncs = {}
local editOutputFuncs = {}

function listenEdit(type, func)
  if type == 'editRequest' then
    editRequestFuncs[#editRequestFuncs + 1] = func
    return
  end
  if type == 'editDisplay' then
    editDisplayFuncs[#editDisplayFuncs + 1] = func
    return
  end
  if type == 'editInput' then
    editInputFuncs[#editInputFuncs + 1] = func
    return
  end
  if type == 'editOutput' then
    editOutputFuncs[#editOutputFuncs + 1] = func
    return
  end
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

function callListenMain(type, id, value, meta)
  local realValue = json.decode(value)
  local realMeta = json.decode(meta)
  if type == 'editRequest' then
    for _, f in ipairs(editRequestFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editDisplay' then
    for _, f in ipairs(editDisplayFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editInput' then
    for _, f in ipairs(editInputFuncs) do realValue = f(id, realValue, realMeta) end
  elseif type == 'editOutput' then
    for _, f in ipairs(editOutputFuncs) do realValue = f(id, realValue, realMeta) end
  end
  return json.encode(realValue)
end
`;
    const wrapped = prelude + '\n' + codeStr;
    const __compile0 = perfEnabled() ? Date.now() : 0;
    const __bcKey = __luaCodeHash(wrapped);
    const __cachedBc = __luaBytecodeCache.get(__bcKey);
    let loadStatus: number;
    if (__cachedBc) {
      loadStatus = lauxlib.luaL_loadbuffer(L, __cachedBc, __cachedBc.length, toL("=card"));
    } else {
      loadStatus = lauxlib.luaL_loadstring(L, toL(wrapped));
      if (loadStatus === lua.LUA_OK) {
        try {
          const __bc: number[] = [];
          lua.lua_dump(L, (_L: unknown, p: Uint8Array, sz: number) => {
            for (let i = 0; i < sz; i++) __bc.push(p[i]!);
            return 0;
          }, null, 0);
          __luaBytecodeCache.set(__bcKey, new Uint8Array(__bc));
          if (__luaBytecodeCache.size > 32) {
            const k = __luaBytecodeCache.keys().next().value;
            if (k !== undefined) __luaBytecodeCache.delete(k);
          }
        } catch { void 0; }
      }
    }
    if (__compile0) perfRecord("lua.compile", Date.now() - __compile0, { codeLen: wrapped.length, cached: __cachedBc ? 1 : 0 });
    if (loadStatus !== lua.LUA_OK) {
      const err = toJS(lua.lua_tostring(L, -1));
      flogErr(`execute: luaL_loadstring failed — ${err}`);
      throw new Error('Lua compile error: ' + err);
    }
    fverbose(`execute: luaL_loadstring OK`);
    const topBefore = lua.lua_gettop(L);
    const __run0 = perfEnabled() ? Date.now() : 0;
    const runStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
    if (__run0) perfRecord("lua.runChunk", Date.now() - __run0);
    if (runStatus !== lua.LUA_OK) {
      const err = toJS(lua.lua_tostring(L, -1));
      flogErr(`execute: main chunk pcall FAILED — ${err}`);
      throw new Error('Lua runtime error: ' + err);
    }
    fverbose(`execute: main chunk pcall OK`);

    if (opts.entry) {
      lua.lua_getglobal(L, toL(String(opts.entry)));
      if (!lua.lua_isfunction(L, -1)) {
        lua.lua_pop(L, 1);
        flog(`execute: no '${opts.entry}' global function defined; skipping entry call (returning undefined) elapsed=${Date.now() - tStart}ms`);
        return undefined;
      }
      lua.lua_pop(L, 1);
      fverbose(`execute: entry '${opts.entry}' exists — starting coroutine`);
      const co = lua.lua_newthread(L);
      lua.lua_getglobal(co, toL('__risuRunEntry'));
      lua.lua_getglobal(co, toL(String(opts.entry)));
      const args = Array.isArray(opts.args) ? opts.args : [];
      for (const a of args) pushJs(co, a);
      await bridge.drive(co, args.length + 1);
      const nret = lua.lua_gettop(co);
      flog(`execute: entry '${opts.entry}' OK nret=${nret} elapsed=${Date.now() - tStart}ms`);
      if (nret === 0) return undefined;
      return luaToJs(co, -1);
    }

    const topAfter = lua.lua_gettop(L);
    const returnCount = topAfter - (topBefore - 1);
    flog(`execute: no entry fn — main-chunk returnCount=${returnCount} elapsed=${Date.now() - tStart}ms`);
    if (returnCount > 0) {
      const res = luaToJs(L, -1);
      lua.lua_pop(L, returnCount);
      return res;
    }
    return undefined;
  } catch (err) {
    flogErr(`execute: THREW — ${(err as Error).message}`);
    throw err;
  } finally {
    bridge.dispose();
    try { lua.lua_close(L); } catch { /* */ }
    if (perfEnabled()) {
      perfRecord("lua.execute", Date.now() - tStart, { codeLen: codeStr.length });
      perfBump(`lua.execute.entry:${String(opts.entry ?? "<none>")}`);
    }
  }
}
