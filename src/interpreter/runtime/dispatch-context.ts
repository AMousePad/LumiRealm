// Side-channel for non-serialisable dispatch values (Functions) that can't
// ride in compiled triggers' JSON-frozen rtOpts.

import { createAls } from './als-compat.js';

export interface DispatchContext {
  chatId?: string;
  rememberOurWrite?: (chatId: string, msgId: string, content: string) => void;
  binding?: string;
  stateChanged?: () => void;
  /** Aux model routing for Lua's `axLLMMain`. Null = default connection. */
  auxConnectionId?: string | null;
  auxModelOverride?: string | null;
  /** Per-sampler overrides on top of the resolved connection's preset. */
  auxSamplers?: {
    temperature: number | null;
    maxTokens: number | null;
    contextSize: number | null;
    topP: number | null;
    minP: number | null;
    topK: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
    repetitionPenalty: number | null;
  };
  /** Submodel routing for V2 `runLLM(model='submodel')`. */
  submodelConnectionId?: string | null;
  submodelModelOverride?: string | null;
  submodelSamplers?: {
    temperature: number | null;
    maxTokens: number | null;
    contextSize: number | null;
    topP: number | null;
    minP: number | null;
    topK: number | null;
    frequencyPenalty: number | null;
    presencePenalty: number | null;
    repetitionPenalty: number | null;
  };
  /** Fold an assistant-message prefill into a user instruction (per channel). */
  auxPrefillCompat?: boolean;
  submodelPrefillCompat?: boolean;
  auxDebugCapture?: (event: AuxDebugCaptureEvent) => void;
  /** Backs Lua `cbs(value)`. Routes through resolveReadonly. */
  resolveTemplate?: (text: string) => Promise<string>;
  /** Image generation connection profile ID. Null = default connection. */
  imageConnectionId?: string | null;
  imageModelOverride?: string | null;
  naiSettings?: import('../../state/settings-store.js').NaiSettings;
  moduleLorebooks?: readonly unknown[];
}

export interface AuxDebugCaptureEvent {
  readonly kind: 'request' | 'response' | 'error';
  /** `aux` = `axLLMMain`/`axLLM`/`LLMMain`, `submodel` = V2 `runLLM(model='submodel')`. */
  readonly channel: 'aux' | 'submodel';
  /** Connection actually dispatched against. `null` means the user's default. */
  readonly auxConnectionId: string | null;
  /** Model actually dispatched against. `null` means the connection's own model. */
  readonly auxModelOverride: string | null;
  /** Milliseconds since dispatch start. `null` for `kind:'request'`. */
  readonly elapsedMs: number | null;
  /** Kind-specific payload. */
  readonly payload: unknown;
}

// Concurrent dispatches for different users get isolated frames across awaits.
const dispatchAls = createAls<DispatchContext>();

export function withDispatchContext<T>(
  ctx: DispatchContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return dispatchAls.run(ctx, fn) as Promise<T> | T;
}

export function getDispatchContext(): DispatchContext | null {
  return dispatchAls.getStore() ?? null;
}
