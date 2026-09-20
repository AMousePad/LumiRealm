import type { LlmMessage } from '../adapters/spindle-extras.js';
import type { RisuBinding } from '../interpreter/runtime.js';

export type FrontendLuaOperation =
  | { readonly kind: 'intercept'; readonly messages: readonly LlmMessage[]; readonly generationType: string }
  | { readonly kind: 'edit'; readonly mode: string; readonly value: unknown; readonly meta?: Record<string, unknown> }
  | { readonly kind: 'binding'; readonly binding: RisuBinding }
  | { readonly kind: 'manual'; readonly name: string }
  | { readonly kind: 'button'; readonly value: string }
  | { readonly kind: 'request'; readonly messages: readonly LlmMessage[] };

export interface FrontendLuaCall {
  readonly type: 'lua_call';
  readonly sessionId: string;
  readonly requestId: string;
  readonly chatId: string;
  readonly characterId: string;
  readonly operation: FrontendLuaOperation;
}

export type FrontendLuaReply = {
  readonly type: 'lua_reply';
  readonly sessionId: string;
  readonly requestId: string;
} & ({ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string });

export class FrontendLuaUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'FrontendLuaUnavailableError'; }
}

export class FrontendLuaExecutionError extends Error {
  constructor(message: string) { super(message); this.name = 'FrontendLuaExecutionError'; }
}
