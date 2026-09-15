import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { makeRisuTriggerRuntime, makeRisuRegexRuntime } from '../../src/interpreter/runtime.js';
import { execute as luaExecute } from '../../src/interpreter/lua-bridge.js';
import {
  resetRequestRateLimit,
  setRequestClock,
} from '../../src/interpreter/runtime/request.js';
import type { HostApi, HostCorsFetch, ScriptNS } from '../../src/interpreter/host.js';

// Risu parity: scriptings.ts declareAPI('request', ...). https-only GET through
// the host CORS proxy; every failure path resolves JSON instead of rejecting,
// so a bad URL can no longer kill the trigger ("Lua await error" / red console).

function scriptNs(): ScriptNS {
  return {
    require: async (name: string) => {
      if (name === 'risu-compat') return { makeRisuTriggerRuntime, makeRisuRegexRuntime };
      if (name === 'risu-compat-lua') return { execute: luaExecute };
      throw new Error(name);
    },
  } as unknown as ScriptNS;
}

interface CorsCall {
  url: string;
  method: string | undefined;
}

function makeCorsHarness(opts: {
  status?: number;
  body?: string;
  error?: Error;
  responseLike?: boolean;
} = {}): { calls: CorsCall[]; corsFetch: HostCorsFetch } {
  const calls: CorsCall[] = [];
  const corsFetch: HostCorsFetch = async (url, init) => {
    calls.push({ url, method: init?.method });
    if (opts.error) throw opts.error;
    if (opts.responseLike) {
      return { status: opts.status ?? 200, text: async () => opts.body ?? 'hello' };
    }
    return { status: opts.status ?? 200, body: opts.body ?? 'hello' };
  };
  return { calls, corsFetch };
}

function baseApi(overrides: Partial<HostApi> = {}): HostApi {
  return {
    chat: {
      getMessages: async () => [],
      sendMessage: async () => ({ id: '1' }),
      editMessage: async () => {},
      deleteMessage: async () => {},
      getMetadata: async () => undefined,
      setMetadata: async () => {},
      inject: async () => {},
    },
    characters: {
      get: async (id: string) => ({ id }),
      update: async () => {},
    },
    ...overrides,
  } as unknown as HostApi;
}

/** Runs `local res = request(triggerId, url):await()` plus a liveness marker. */
function requestLua(url: string): string {
  return `
    function onRun(triggerId)
      local res = request(triggerId, ${JSON.stringify(url)}):await()
      setChatVar(triggerId, "res", res)
      setChatVar(triggerId, "after", "alive")
    end
  `;
}

async function runRequest(
  api: HostApi,
  url: string,
  opts: { lowLevelAccess?: boolean } = {},
): Promise<{ res: string; after: string }> {
  const runtime = await makeRisuTriggerRuntime(api, { characterId: 'c' }, scriptNs(), {
    lowLevelAccess: opts.lowLevelAccess ?? true,
  });
  await runtime.runLua(requestLua(url));
  return { res: runtime.getVar('res'), after: runtime.getVar('after') };
}

beforeEach(() => {
  resetRequestRateLimit();
  setRequestClock(null);
});

afterEach(() => {
  resetRequestRateLimit();
  setRequestClock(null);
});

describe('Lua request() — https GET through the host CORS proxy', () => {
  test('resolves {"status":200,"data":"..."} via a GET and keeps the trigger alive', async () => {
    const { calls, corsFetch } = makeCorsHarness({ status: 200, body: '{"ok":true}' });
    const out = await runRequest(baseApi({ corsFetch }), 'https://example.com/data.json');

    expect(JSON.parse(out.res)).toEqual({ status: 200, data: '{"ok":true}' });
    expect(out.after).toBe('alive');
    expect(calls).toEqual([{ url: 'https://example.com/data.json', method: 'GET' }]);
  });

  test('passes through the host HTTP status (non-2xx is still a resolved fetch)', async () => {
    const { corsFetch } = makeCorsHarness({ status: 503, body: 'unavailable' });
    const out = await runRequest(baseApi({ corsFetch }), 'https://example.com/down');
    expect(JSON.parse(out.res)).toEqual({ status: 503, data: 'unavailable' });
  });

  test('reads status and text() from a Response-like host result', async () => {
    const { corsFetch } = makeCorsHarness({ status: 204, body: 'no-content', responseLike: true });
    const out = await runRequest(baseApi({ corsFetch }), 'https://example.com/empty');
    expect(JSON.parse(out.res)).toEqual({ status: 204, data: 'no-content' });
  });

  test('http:// resolves status 400 "Only https requests are allowed" without any fetch', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const out = await runRequest(baseApi({ corsFetch }), 'http://example.com/x');
    expect(JSON.parse(out.res)).toEqual({ status: 400, data: 'Only https requests are allowed' });
    expect(out.after).toBe('alive');
    expect(calls).toEqual([]);
  });

  test('URL longer than 120 characters resolves status 413 without any fetch', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const longUrl = 'https://example.com/' + 'a'.repeat(120);
    expect(longUrl.length).toBeGreaterThan(120);
    const out = await runRequest(baseApi({ corsFetch }), longUrl);
    expect(JSON.parse(out.res)).toEqual({ status: 413, data: 'URL to large. max is 120 characters' });
    expect(calls).toEqual([]);
  });

  test('a 120-character URL still passes the length guard', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const exactUrl = 'https://example.com/' + 'a'.repeat(120 - 'https://example.com/'.length);
    expect(exactUrl.length).toBe(120);
    const out = await runRequest(baseApi({ corsFetch }), exactUrl);
    expect(JSON.parse(out.res)).toEqual({ status: 200, data: 'hello' });
    expect(calls.length).toBe(1);
  });

  test('banned risuai host resolves status 400 "request to <url> is not allowed" without any fetch', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const url = 'https://risuai.net/api/v1/secret';
    const out = await runRequest(baseApi({ corsFetch }), url);
    expect(JSON.parse(out.res)).toEqual({ status: 400, data: `request to ${url} is not allowed` });
    expect(calls).toEqual([]);
  });

  test('every banned upstream prefix is rejected', async () => {
    for (const url of ['https://realm.risuai.net/x', 'https://risuai.net', 'https://risuai.xyz/x']) {
      const { calls, corsFetch } = makeCorsHarness();
      resetRequestRateLimit();
      const out = await runRequest(baseApi({ corsFetch }), url);
      expect(JSON.parse(out.res)).toEqual({ status: 400, data: `request to ${url} is not allowed` });
      expect(calls).toEqual([]);
    }
  });
});

describe('Lua request() — failure paths never reject', () => {
  test('transport throw resolves {"status":400,"data":"internal error"} and the trigger survives', async () => {
    const { calls, corsFetch } = makeCorsHarness({ error: new Error('ECONNREFUSED') });
    const out = await runRequest(baseApi({ corsFetch }), 'https://example.com/boom');

    expect(JSON.parse(out.res)).toEqual({ status: 400, data: 'internal error' });
    // The awaited call resolved, so the rest of the trigger body still ran.
    expect(out.after).toBe('alive');
    expect(calls.length).toBe(1);
  });

  test('a host without corsFetch resolves the internal-error payload instead of rejecting', async () => {
    const out = await runRequest(baseApi(), 'https://example.com/no-host');
    expect(JSON.parse(out.res)).toEqual({ status: 400, data: 'internal error' });
    expect(out.after).toBe('alive');
  });
});

describe('Lua request() — rate limit and lowLevelAccess gate', () => {
  test('allows 5 requests per minute; the 6th resolves 429 and no fetch is attempted', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const api = baseApi({ corsFetch });
    const results: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      const out = await runRequest(api, `https://example.com/r${i}`);
      results.push(JSON.parse(out.res));
      expect(out.after).toBe('alive');
    }

    expect(results.slice(0, 5)).toEqual(
      [0, 1, 2, 3, 4].map((i) => ({ status: 200, data: 'hello' })),
    );
    expect(results[5]).toEqual({
      status: 429,
      data: 'Too many requests. you can request 5 times per minute',
    });
    expect(calls.length).toBe(5);
  });

  test('guardrail rejections consume quota before the 429 (upstream order)', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const api = baseApi({ corsFetch });
    for (let i = 0; i < 5; i++) {
      const out = await runRequest(api, 'http://example.com/not-https');
      expect(JSON.parse(out.res)).toEqual({ status: 400, data: 'Only https requests are allowed' });
    }
    const sixth = await runRequest(api, 'https://example.com/now');
    expect(JSON.parse(sixth.res)).toEqual({
      status: 429,
      data: 'Too many requests. you can request 5 times per minute',
    });
    expect(calls).toEqual([]);
  });

  test('the window restarts on the first request after 60s (rolling window)', async () => {
    let nowMs = 1_000_000;
    setRequestClock(() => nowMs);
    const { corsFetch } = makeCorsHarness();
    const api = baseApi({ corsFetch });

    for (let i = 0; i < 5; i++) await runRequest(api, `https://example.com/w${i}`);
    const blocked = await runRequest(api, 'https://example.com/blocked');
    expect(JSON.parse(blocked.res)).toEqual({
      status: 429,
      data: 'Too many requests. you can request 5 times per minute',
    });

    nowMs += 61_000;
    const afterWindow = await runRequest(api, 'https://example.com/open');
    expect(JSON.parse(afterWindow.res)).toEqual({ status: 200, data: 'hello' });
  });

  test('lowLevelAccess false: no network call is attempted and the result is upstream nil', async () => {
    const { calls, corsFetch } = makeCorsHarness();
    const runtime = await makeRisuTriggerRuntime(
      baseApi({ corsFetch }),
      { characterId: 'c' },
      scriptNs(),
      { lowLevelAccess: false },
    );
    await runtime.runLua(`
      function onRun(triggerId)
        local res = request(triggerId, "https://example.com/gated"):await()
        setChatVar(triggerId, "res", tostring(res))
        setChatVar(triggerId, "after", "alive")
      end
    `);

    expect(calls).toEqual([]);
    expect(runtime.getVar('res')).toBe('nil');
    expect(runtime.getVar('after')).toBe('alive');
  });
});
