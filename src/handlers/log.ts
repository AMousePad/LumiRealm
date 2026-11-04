import type { Handler, HandlerCallCtx } from './types.js';
import type { LogState, LogStateSnapshot, LogEvent } from '../log/store.js';
import type { LogEventWire } from '../types/messages.js';
import type { UserStorageLike } from '../payload/installer.js';
import type { HostBuildReport } from '../util/version-check.js';

export interface LogHandlerDeps {
  readonly extensionVersion: string;
  readonly readHostBuild: () => Promise<HostBuildReport>;
  readonly logStore: {
    readonly setState: (next: Partial<LogState>, userId: string) => void;
    readonly clear: (userId: string) => void;
    readonly snapshot: (userId: string) => { readonly events: readonly LogEvent[] | readonly LogEventWire[] };
    readonly getState: (userId: string) => LogStateSnapshot;
  };
  readonly isLogThreshold: (level: unknown) => level is LogState['level'];
  readonly ensureLogStateLoaded: (userId: string) => Promise<void>;
  readonly persistLogState: (storage: UserStorageLike, userId: string) => Promise<void>;
  readonly userStorage: () => UserStorageLike;
  readonly lastActiveChatByUser: Map<string, string>;
}

function sendLogState(deps: LogHandlerDeps, ctx: HandlerCallCtx): void {
  const s = deps.logStore.getState(ctx.userId);
  ctx.send({
    type: 'log_state_pushed',
    enabled: s.enabled,
    includeChatData: s.includeChatData,
    level: s.level,
    eventCount: s.eventCount,
    bufferBytes: s.bufferBytes,
  }, ctx.userId);
}

export function createLogHandlers(deps: LogHandlerDeps): {
  readonly log_request_state: Handler<'log_request_state'>;
  readonly log_set_state: Handler<'log_set_state'>;
  readonly log_request_export: Handler<'log_request_export'>;
  readonly log_clear: Handler<'log_clear'>;
} {
  return {
    log_request_state: async (_msg, ctx) => {
      if (ctx.userId) await deps.ensureLogStateLoaded(ctx.userId);
      sendLogState(deps, ctx);
    },
    log_set_state: async (msg, ctx) => {
      const next: Partial<LogState> = {
        enabled: !!msg.enabled,
        includeChatData: !!msg.includeChatData,
      };
      if (deps.isLogThreshold(msg.level)) next.level = msg.level;
      deps.logStore.setState(next, ctx.userId);
      await deps.persistLogState(deps.userStorage(), ctx.userId);
      sendLogState(deps, ctx);
    },
    log_request_export: async (_msg, ctx) => {
      const lumiverse = await deps.readHostBuild();
      const snap = deps.logStore.snapshot(ctx.userId);
      ctx.send({
        type: 'log_export_pushed',
        events: snap.events as readonly LogEventWire[],
        session: {
          extensionVersion: deps.extensionVersion,
          lumiverse,
          userId: ctx.userId,
          activeChatId: deps.lastActiveChatByUser.get(ctx.userId) ?? null,
          activeCharacterId: null,
        },
      }, ctx.userId);
    },
    log_clear: async (_msg, ctx) => {
      deps.logStore.clear(ctx.userId);
      sendLogState(deps, ctx);
    },
  };
}
