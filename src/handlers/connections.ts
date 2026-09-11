import type { Handler } from './types.js';

export interface ConnectionDTO {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly is_default: boolean;
}

export interface ConnectionsHandlerDeps {
  readonly listConnectionsForUser: (userId: string) => Promise<readonly ConnectionDTO[]>;
  readonly listImageConnectionsForUser?: (userId: string) => Promise<readonly ConnectionDTO[]>;
  readonly log: { readonly info: (m: string) => void; readonly debug: (m: string) => void };
}

export function createConnectionsHandlers(deps: ConnectionsHandlerDeps): {
  readonly request_connections_list: Handler<'request_connections_list'>;
  readonly request_image_connections_list: Handler<'request_image_connections_list'>;
} {
  return {
    request_connections_list: async (_msg, ctx) => {
      const connections = await deps.listConnectionsForUser(ctx.userId);
      deps.log.debug(`request_connections_list: returning ${connections.length} connection(s) for user=${ctx.userId}`);
      ctx.send({ type: 'connections_list_pushed', connections }, ctx.userId);
    },
    request_image_connections_list: async (_msg, ctx) => {
      const connections = (await deps.listImageConnectionsForUser?.(ctx.userId)) ?? [];
      deps.log.debug(`request_image_connections_list: returning ${connections.length} connection(s) for user=${ctx.userId}`);
      ctx.send({ type: 'image_connections_list_pushed', connections }, ctx.userId);
    },
  };
}
