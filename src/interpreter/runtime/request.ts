// Risu parity: scriptings.ts `declareAPI('request', ...)`.
//
// https-only GET through the host's permission-gated CORS proxy
// (`spindle.cors`, declared as `cors_proxy` in spindle.json). Every outcome —
// guardrail, transport failure, or success — resolves a JSON string. Nothing
// here rejects, so a bad URL can never kill the trigger.

import { toStr } from '../../util/coerce.js';
import { makeSafeLogger } from '../../util/safe-log.js';
import type { HostCorsFetch, HostCorsResponse } from '../host.js';

const _logRequest = makeSafeLogger('runtime.lua.request');

/** Upstream: "only get request in 120 char is allowed". */
export const REQUEST_URL_MAX_LENGTH = 120;
/** Upstream message: "you can request 5 times per minute". */
export const REQUEST_RATE_LIMIT = 5;
export const REQUEST_RATE_WINDOW_MS = 60_000;
/** Upstream `bannedURL` — Risu's own infrastructure hosts. */
export const REQUEST_BANNED_PREFIXES: readonly string[] = [
  'https://realm.risuai.net',
  'https://risuai.net',
  'https://risuai.xyz',
];

// Module-scoped counter and window, mirroring Risu's module-level
// lastRequestsCount / lastRequestResetTime: the budget is per process, shared
// by every trigger, and the window restarts on the first request after 60s.
let _requestsInWindow = 0;
let _windowStartMs = 0;
let _clock: () => number = Date.now;

/** Test seam: clear the rolling window. */
export function resetRequestRateLimit(): void {
  _requestsInWindow = 0;
  _windowStartMs = 0;
}

/** Test seam: override the clock (`null` restores `Date.now`). */
export function setRequestClock(fn: (() => number) | null): void {
  _clock = fn ?? Date.now;
}

function payload(status: number, data: string): string {
  return JSON.stringify({ status, data });
}

export interface LuaRequestDeps {
  /** Host CORS proxy (`spindle.cors`). Absent on hosts without a proxy
   *  (browser display snapshot); that is reported as a transport failure. */
  readonly corsFetch?: HostCorsFetch | undefined;
}

/**
 * Builds the body of the Lua `request(url)` global. Upstream order is
 * preserved: rate limit first (guardrail rejections still consume quota), then
 * the length / scheme / banned-host checks, then the GET.
 */
export function makeLuaRequest(deps: LuaRequestDeps): (url: unknown) => Promise<string> {
  let warnedNoTransport = false;
  return async function luaRequest(urlVal: unknown): Promise<string> {
    // Upstream: `if(lastRequestResetTime + 60000 < Date.now())` restarts the window.
    const nowMs = _clock();
    if (_windowStartMs + REQUEST_RATE_WINDOW_MS < nowMs) {
      _requestsInWindow = 0;
      _windowStartMs = nowMs;
    }
    if (_requestsInWindow >= REQUEST_RATE_LIMIT) {
      return payload(429, 'Too many requests. you can request 5 times per minute');
    }
    _requestsInWindow += 1;

    const url = toStr(urlVal);
    if (url.length > REQUEST_URL_MAX_LENGTH) {
      return payload(413, 'URL to large. max is 120 characters');
    }
    if (!url.startsWith('https://')) {
      return payload(400, 'Only https requests are allowed');
    }
    for (const banned of REQUEST_BANNED_PREFIXES) {
      if (url.startsWith(banned)) {
        return payload(400, 'request to ' + url + ' is not allowed');
      }
    }

    const corsFetch = deps.corsFetch;
    if (!corsFetch) {
      if (!warnedNoTransport) {
        warnedNoTransport = true;
        _logRequest.warn('corsFetch missing on HostApi — lua.request resolves {"status":400,"data":"internal error"}');
      }
      return payload(400, 'internal error');
    }

    try {
      // Upstream: fetchNative(url, { method: 'GET' }) — no headers, no body.
      const res: HostCorsResponse | null | undefined = await corsFetch(url, { method: 'GET' });
      const status = typeof res?.status === 'number' ? res.status : 200;
      const text = res && typeof res.text === 'function'
        ? await res.text()
        : typeof res?.body === 'string' ? res.body : toStr(res?.body);
      _logRequest.info(`GET ${url.slice(0, 120)} -> ${status} len=${text.length}`);
      return payload(status, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _logRequest.warn(`GET ${url.slice(0, 120)} failed: ${msg}`);
      return payload(400, 'internal error');
    }
  };
}
