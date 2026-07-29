import type { FrontendToBackend } from '../types/messages.js';
import type { ViewerPushDeps } from '../state/viewer-push.js';
import { pushViewerData } from '../state/viewer-push.js';
import type { Handler, HandlerCallCtx } from './types.js';

type AssetMutationMessage =
  | Extract<FrontendToBackend, { type: 'add_assets' }>
  | Extract<FrontendToBackend, { type: 'rename_asset' }>
  | Extract<FrontendToBackend, { type: 'delete_assets' }>;

export interface AssetsHandlerDeps {
  readonly blockedByRepair: (userId: string, messageType: string) => boolean;
  readonly mutateAssetIndex: (msg: AssetMutationMessage, userId: string) => Promise<{ ok: boolean; reason?: string }>;
  readonly viewerPushDeps: ViewerPushDeps;
  readonly charactersAttachedTo: (moduleId: string, userId: string) => Promise<readonly string[]>;
  readonly invalidateActiveForCharacter: (characterId: string, userId: string) => void;
  readonly refreshRisuAssetMap: (characterId: string, userId: string) => Promise<void>;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

async function runAssetMutation(
  msg: AssetMutationMessage,
  ctx: HandlerCallCtx,
  deps: AssetsHandlerDeps,
): Promise<void> {
  if (deps.blockedByRepair(ctx.userId, msg.type)) return;
  const result = await deps.mutateAssetIndex(msg, ctx.userId);
  if (!result.ok) {
    ctx.send({ type: 'error', message: `${msg.type}: ${result.reason ?? 'failed'}` }, ctx.userId);
    return;
  }
  await pushViewerData({ source: msg.source, context: msg.type, userId: ctx.userId }, deps.viewerPushDeps);
  if (msg.source.kind === 'module') {
    const attached = await deps.charactersAttachedTo(msg.source.moduleId, ctx.userId);
    for (const charId of attached) {
      deps.invalidateActiveForCharacter(charId, ctx.userId);
      await deps.refreshRisuAssetMap(charId, ctx.userId).catch((err) => {
        deps.log.warn(`${msg.type}: refreshRisuAssetMap failed char=${charId}: ${deps.errMsg(err)}`);
      });
    }
    if (attached.length > 0) {
      deps.log.info(
        `${msg.type}: invalidated ${attached.length} attached character(s) for module ${msg.source.moduleId}`,
      );
    }
  } else {
    deps.invalidateActiveForCharacter(msg.source.characterId, ctx.userId);
    await deps.refreshRisuAssetMap(msg.source.characterId, ctx.userId).catch((err) => {
      deps.log.warn(`${msg.type}: refreshRisuAssetMap failed char=${msg.source.kind === 'character' ? msg.source.characterId : '?'}: ${deps.errMsg(err)}`);
    });
  }
}

export function createAssetsHandlers(deps: AssetsHandlerDeps): {
  readonly add_assets: Handler<'add_assets'>;
  readonly rename_asset: Handler<'rename_asset'>;
  readonly delete_assets: Handler<'delete_assets'>;
} {
  return {
    add_assets: (msg, ctx) => runAssetMutation(msg, ctx, deps),
    rename_asset: (msg, ctx) => runAssetMutation(msg, ctx, deps),
    delete_assets: (msg, ctx) => runAssetMutation(msg, ctx, deps),
  };
}
