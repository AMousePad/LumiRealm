import type { SpindleBackendProcessContext } from 'lumiverse-spindle-types';
import type { RegexCoreScript } from './display/regex-core.js';
import type { PrebuiltPipelineInput } from './interceptors/prompt-regex-apply.js';
import { applyPromptRegexToArray } from './interceptors/prompt-regex-apply.js';
import type { LlmMessage } from './adapters/spindle-extras.js';

export interface RegexRunnerRequest {
  readonly requestId: string;
  readonly prebuilt: PrebuiltPipelineInput;
  readonly scripts: readonly RegexCoreScript[];
  readonly messages: LlmMessage[];
  readonly timeRules?: boolean;
}

export type RegexRunnerReply =
  | { readonly requestId: string; readonly ok: true; readonly changed: boolean; readonly messages: LlmMessage[]; readonly ruleMs?: readonly number[] }
  | { readonly requestId: string; readonly ok: false; readonly error: string };

function isRequest(payload: unknown): payload is RegexRunnerRequest {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<RegexRunnerRequest>;
  return (
    typeof p.requestId === 'string' &&
    Array.isArray(p.messages) &&
    Array.isArray(p.scripts) &&
    p.prebuilt !== null &&
    typeof p.prebuilt === 'object'
  );
}

export async function runRegexRequest(req: RegexRunnerRequest): Promise<RegexRunnerReply> {
  try {
    const messages = req.messages.slice();
    if (!req.timeRules) {
      const { changed } = await applyPromptRegexToArray(messages, req.prebuilt, req.scripts);
      return { requestId: req.requestId, ok: true, changed, messages };
    }
    const totals = new Map<RegexCoreScript, number>();
    const { changed } = await applyPromptRegexToArray(messages, req.prebuilt, req.scripts, (script, ms) => {
      totals.set(script, (totals.get(script) ?? 0) + ms);
    });
    return { requestId: req.requestId, ok: true, changed, messages, ruleMs: req.scripts.map((script) => totals.get(script) ?? 0) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { requestId: req.requestId, ok: false, error: message };
  }
}

const HEARTBEAT_INTERVAL_MS = 2_000;

export default function regexRunner(ctx: SpindleBackendProcessContext): () => void {
  const timer = setInterval(() => {
    ctx.heartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }

  ctx.onMessage((payload) => {
    if (!isRequest(payload)) {
      ctx.fail('regex-runner received a malformed request payload');
      return;
    }
    const req = payload;
    void runRegexRequest(req).then((reply) => {
      ctx.send(reply);
    });
  });

  ctx.onStop(() => {
    clearInterval(timer);
    ctx.complete();
  });

  ctx.ready();

  return () => {
    clearInterval(timer);
  };
}
