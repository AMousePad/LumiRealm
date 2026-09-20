import type { LuaEngine, LuaFactory } from 'wasmoon';
import { v4 } from 'uuid';
import wrapper from './lua-wrapper.lua' with { type: 'text' };

// lua-wrapper.lua is verbatim luaCodeWrapper from RisuAI e565563a (GPL-3.0).
// Engine lifetime, access IDs, and error boundaries follow runScripted.

export class LuaChunkError extends Error {
  constructor(cause: unknown) {
    super(`Lua chunk failed: ${String(cause)}`, { cause });
    this.name = 'LuaChunkError';
  }
}

export class LuaCallbackError extends Error {
  constructor(cause: unknown) {
    super(`Lua callback failed: ${String(cause)}`, { cause });
    this.name = 'LuaCallbackError';
  }
}

export class LuaInitializationError extends Error {
  constructor(cause: unknown) {
    super(`Lua engine initialization failed: ${String(cause)}`, { cause });
    this.name = 'LuaInitializationError';
  }
}

export interface ExecuteOpts {
  readonly signal?: AbortSignal;
  readonly entry?: string;
  readonly args?: readonly unknown[];
  readonly mode?: string;
  readonly scope?: string;
  readonly lowLevelAccess?: boolean;
  readonly enforceAccess?: boolean;
  readonly data?: unknown;
  readonly synchronizeState?: (refresh?: boolean) => Promise<void>;
}

interface EngineState {
  engine?: LuaEngine;
  code?: string;
  tail: Promise<unknown>;
  globals: Record<string, unknown>;
  signal?: AbortSignal | undefined;
  synchronize?: ((refresh?: boolean) => Promise<void>) | undefined;
}

// Guards copied from Risu's runScripted declarations; asynchronous denials remain promises.
const safeApis = new Set([
  'stopChat', 'alertError', 'alertNormal', 'alertInput', 'alertSelect', 'alertConfirm',
  'setChat', 'setChatRole', 'cutChat', 'removeChat', 'addChat', 'insertChat',
  'getTokens', 'sleep', 'setFullChatMain', 'reloadDisplay', 'reloadChat', 'setName',
  'getDescription', 'setDescription', 'setCharacterFirstMessage',
  'getBackgroundEmbedding', 'setBackgroundEmbedding', 'upsertLocalLoreBook',
]);
const lowApis = new Set(['similarity', 'request', 'generateImage', 'LLMMain', 'simpleLLM', 'loadLoreBooksMain', 'axLLMMain']);
const asyncApis = new Set([...lowApis, 'getTokens']);

export function createLuaExecutor(getFactory: () => Promise<LuaFactory>) {
  const scopes = new Map<string, {
    engines: Map<string, EngineState>;
    safeIds: Set<unknown>;
    displayIds: Set<unknown>;
    lowIds: Set<unknown>;
  }>();

  async function execute(code: string, globals: Record<string, unknown>, opts: ExecuteOpts = {}): Promise<unknown> {
    const scopeKey = opts.scope ?? '';
    let scope = scopes.get(scopeKey);
    if (!scope) {
      scope = { engines: new Map(), safeIds: new Set(), displayIds: new Set(), lowIds: new Set() };
      scopes.set(scopeKey, scope);
    }
    const mode = opts.mode ?? opts.entry ?? 'manual';
    let state = scope.engines.get(mode);
    if (!state) {
      state = { tail: Promise.resolve(), globals };
      scope.engines.set(mode, state);
    }
    const current = state;
    const access = scope;
    const run = current.tail.then(async () => {
      opts.signal?.throwIfAborted();
      current.globals = globals;
      current.signal = opts.signal;
      current.synchronize = opts.synchronizeState;
      await current.synchronize?.();
      if (code !== current.code) {
        current.engine?.global.close();
        try { current.engine = await (await getFactory()).createEngine({ injectObjects: true }); }
        catch (cause) { delete current.code; delete current.engine; throw new LuaInitializationError(cause); }
        // Risu records the source before doString, including a failed initialization.
        current.code = code;
        for (const [name, value] of Object.entries(globals)) {
          if (typeof value !== 'function') {
            current.engine.global.set(name, value);
            continue;
          }
          const invoke = (...args: unknown[]) => {
            current.signal?.throwIfAborted();
            if (opts.enforceAccess) {
              if (name === 'LLMMain' || name === 'axLLMMain') JSON.parse(args[1] as string);
              if (safeApis.has(name) && !access.safeIds.has(args[0])) return;
              if (lowApis.has(name) && !access.lowIds.has(args[0])) return;
              if ((name === 'setChatVar' || name === 'setChatVarChanged')
                && !access.safeIds.has(args[0]) && !access.displayIds.has(args[0])) return;
              // runScripted checks the source-loading invocation's data here, not desc.
              if (name === 'setDescription' && typeof (opts.data ?? '') !== 'string') throw new Error('Invalid data type');
            }
            // Risu's stopChat captures the invocation that installed this source.
            if (name === 'stopChat') return value(...args);
            const result = (current.globals[name] as (...values: unknown[]) => unknown)(...args);
            if (!(result instanceof Promise) || (!current.synchronize && !current.signal)) return result;
            return result.then(async value => { current.signal?.throwIfAborted(); await current.synchronize?.(true); return value; }, async error => {
              current.signal?.throwIfAborted(); await current.synchronize?.(true); throw error;
            });
          };
          current.engine.global.set(name, asyncApis.has(name) ? async (...args: unknown[]) => invoke(...args) : invoke);
        }
        try {
          await current.engine.doString(wrapper + code + '\n');
        } catch (cause) { opts.signal?.throwIfAborted(); throw new LuaChunkError(cause); }
      }
      const args = [...(opts.args ?? [])];
      const accessKey = opts.enforceAccess ? v4() : undefined;
      if (accessKey) {
        args[opts.entry === 'callListenMain' ? 1 : 0] = accessKey;
        if (mode === 'editDisplay') access.displayIds.add(accessKey);
        else {
          access.safeIds.add(accessKey);
          if (opts.lowLevelAccess) access.lowIds.add(accessKey);
        }
      }
      try {
        if (!opts.entry) return;
        const func = current.engine!.global.get(opts.entry);
        if (func) return await func(...args);
      } catch (cause) {
        opts.signal?.throwIfAborted();
        throw new LuaCallbackError(cause);
      } finally {
        if (accessKey) {
          access.safeIds.delete(accessKey);
          access.lowIds.delete(accessKey);
        }
      }
    });
    current.tail = run.catch(() => undefined);
    return run;
  }

  async function clear(scopeKey = '', mode?: string): Promise<void> {
    const scope = scopes.get(scopeKey);
    if (!scope) return;
    const entries = mode === undefined ? [...scope.engines.entries()] : [...scope.engines.entries()].filter(([key]) => key === mode);
    if (mode === undefined) scopes.delete(scopeKey);
    for (const [key] of entries) scope.engines.delete(key);
    for (const [, state] of entries) {
      await state.tail;
      state.engine?.global.close();
    }
  }

  return { execute, clear };
}
