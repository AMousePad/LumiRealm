import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

let source: NonNullable<SpindleFrontendContext['uuid']> | undefined;

export function setupUuid(ctx: Pick<SpindleFrontendContext, 'uuid'>): void {
  if (!ctx.uuid) throw new Error('LumiRealm requires Lumiverse capability: frontend-uuid-v1');
  source = ctx.uuid;
}

export function newUuid(): string {
  if (!source) throw new Error('newUuid called before setupUuid');
  return source.v7();
}
