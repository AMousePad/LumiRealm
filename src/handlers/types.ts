import type { FrontendToBackend, BackendToFrontend } from '../types/messages.js';

/** Types handled by the realm-domain dispatcher BEFORE the registry runs.
 *  Excluded from HandlerRegistry to keep exhaustiveness scoped to FE-tab messages. */
export type RealmHandledType = 'realm_search' | 'realm_info' | 'realm_download';
export type RegistryFeType = Exclude<FrontendToBackend['type'], RealmHandledType>;

export type FeMessage<T extends RegistryFeType> = Extract<FrontendToBackend, { type: T }>;

export type Handler<T extends RegistryFeType> = (
  msg: FeMessage<T>,
  ctx: HandlerCallCtx,
) => Promise<void>;

export type HandlerRegistry = {
  readonly [K in RegistryFeType]: Handler<K>;
};

/** Per-call context passed alongside the typed msg. Backend builds this once
 *  per onFrontendMessage tick from the userId + module-scope helpers. */
export interface HandlerCallCtx {
  readonly frontendSessionId?: string;
  readonly userId: string;
  readonly send: (msg: BackendToFrontend, userId: string) => void;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}
