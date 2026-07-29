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
  promise: Promise<unknown>;
  done: boolean;
  value?: unknown;
  error?: unknown;
  errorMsg?: string;
}

const pendingPromises = new Map<number, PendingPromise>();
let nextPromiseToken = 1;

function luaAwaitMethod(L: LuaState): number {
  lua.lua_getfield(L, 1, toL('__token'));
  const token = lua.lua_tointeger(L, -1);
  lua.lua_pop(L, 1);
  const entry = pendingPromises.get(token);
  if (entry && entry.done) {
    if (entry.error !== undefined) {
      lauxlib.luaL_error(L, toL('await error: ' + String(entry.errorMsg ?? entry.error)));
      return 0;
    }
    pushJs(L, entry.value);
    return 1;
  }
  lua.lua_pushinteger(L, token);
  return lua.lua_yield(L, 1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeWrapper(fn: (...args: any[]) => unknown) {
  return function (L: LuaState): number {
    const nargs = lua.lua_gettop(L);
    const args: unknown[] = [];
    for (let i = 1; i <= nargs; i++) args.push(luaToJs(L, i));
    let result: unknown;
    try {
      result = fn.apply(null, args);
    } catch (e) {
      lauxlib.luaL_error(L, toL('JS error: ' + (e instanceof Error ? e.message : String(e))));
      return 0;
    }
    if (result && typeof (result as { then?: unknown }).then === 'function') {
      const token = nextPromiseToken++;
      pendingPromises.set(token, { promise: result as Promise<unknown>, done: false });
      lua.lua_createtable(L, 0, 2);
      lua.lua_pushinteger(L, token);
      lua.lua_setfield(L, -2, toL('__token'));
      lua.lua_pushjsfunction(L, luaAwaitMethod);
      lua.lua_setfield(L, -2, toL('await'));
      return 1;
    }
    if (result === undefined) return 0;
    pushJs(L, result);
    return 1;
  };
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
        lua.lua_pushjsfunction(L, makeWrapper(fn as any));
        lua.lua_setglobal(L, toL(name));
        pushed += 1;
      }
      fverbose(`execute: pushed ${pushed} js globals`);
    }

    // Risu scriptings.ts luaCodeWrapper. Defines JSON helpers,
    // state accessors, listenEdit hooks, async/Promise shim, and LLM wrappers.
    // async() runs its callback via pcall so :await() on JS Promise-returning
    // globals works through the fengari yield driver. Risu uses wasmoon's
    // Promise.create; we provide a compatible shim.
    const prelude = `
json = require 'json'

local function __risuAwait(self)
  if self.__risu_failed then error(self.__risu_err) end
  return table.unpack(self.__risu_results, 1, self.__risu_n)
end

local function __risuFinally(self, cb)
  if type(cb) == 'function' then pcall(cb) end
  return self
end

function async(callback)
  return function(...)
    local n = select('#', ...)
    local args = {...}
    local ok, r1, r2, r3, r4, r5, r6, r7, r8 = pcall(callback, table.unpack(args, 1, n))
    local thenable = { await = __risuAwait, ['finally'] = __risuFinally }
    if ok then
      thenable.__risu_failed = false
      thenable.__risu_n = 8
      thenable.__risu_results = { r1, r2, r3, r4, r5, r6, r7, r8 }
    else
      thenable.__risu_failed = true
      thenable.__risu_err = r1
    end
    return thenable
  end
end

Promise = {}
Promise.resolve = function(v)
  return { await = function(self) return v end, ['finally'] = __risuFinally }
end
Promise.reject = function(err)
  return { await = function(self) error(err) end, ['finally'] = __risuFinally }
end

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
      lua.lua_getglobal(co, toL(String(opts.entry)));
      const args = Array.isArray(opts.args) ? opts.args : [];
      for (const a of args) pushJs(co, a);
      const nresultsRef: { ref: number } = { ref: 0 };
      let status = lua.lua_resume(co, L, args.length, nresultsRef);
      let iters = 0;
      while (status === lua.LUA_YIELD) {
        iters += 1;
        const tokenArg = lua.lua_tointeger(co, -1);
        lua.lua_pop(co, nresultsRef.ref || 1);
        const rec = pendingPromises.get(tokenArg);
        if (!rec) {
          fverbose(`execute: yield iter=${iters} token=${tokenArg} — no pending record, pushing nil`);
          lua.lua_pushnil(co);
          status = lua.lua_resume(co, L, 1, nresultsRef);
          continue;
        }
        try {
          rec.value = await rec.promise;
          rec.done = true;
          fverbose(`execute: yield iter=${iters} token=${tokenArg} resolved OK`);
          pushJs(co, rec.value);
          status = lua.lua_resume(co, L, 1, nresultsRef);
        } catch (awaitErr) {
          rec.done = true;
          rec.error = awaitErr;
          rec.errorMsg = awaitErr instanceof Error ? awaitErr.message : String(awaitErr);
          flogErr(`execute: yield iter=${iters} token=${tokenArg} REJECTED — ${rec.errorMsg}`);
          throw new Error('Lua await error: ' + rec.errorMsg);
        }
      }
      if (status !== lua.LUA_OK) {
        const err = toJS(lua.lua_tostring(co, -1));
        flogErr(`execute: entry '${opts.entry}' FAILED after ${iters} yields — ${err}`);
        throw new Error("Lua entry '" + opts.entry + "' error: " + err);
      }
      const nret = lua.lua_gettop(co);
      flog(`execute: entry '${opts.entry}' OK after ${iters} yields nret=${nret} elapsed=${Date.now() - tStart}ms`);
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
    try { lua.lua_close(L); } catch { /* */ }
    if (perfEnabled()) {
      perfRecord("lua.execute", Date.now() - tStart, { codeLen: codeStr.length });
      perfBump(`lua.execute.entry:${String(opts.entry ?? "<none>")}`);
    }
  }
}
