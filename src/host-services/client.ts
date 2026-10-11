import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { v4 } from 'uuid';
import { HostServiceError, type HostOperations, type HostReply, type HostRequest } from './protocol.js';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type Transport = Pick<SpindleFrontendContext, 'sendToBackend' | 'onBackendMessage'>;

export function createHostClient(ctx: Transport) {
  const pending = new Map<string, Pending>();
  let disposed = false;
  const unsubscribe = ctx.onBackendMessage(raw => {
    if (!raw || (raw as { type?: string }).type !== 'host_service_reply') return;
    const reply = raw as HostReply;
    const call = pending.get(reply.requestId);
    if (!call) return;
    pending.delete(reply.requestId);
    clearTimeout(call.timer);
    if (reply.ok) call.resolve(reply.value);
    else call.reject(new HostServiceError(reply.error));
  });
  return {
    call<K extends keyof HostOperations>(operation: K, input: HostOperations[K]['input']): Promise<HostOperations[K]['output']> {
      if (disposed) return Promise.reject(new HostServiceError('Host service connection closed'));
      return new Promise((resolve, reject) => {
        const requestId = v4();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new HostServiceError(`Host operation timed out: ${operation}`));
        }, 120_000);
        pending.set(requestId, { resolve: value => resolve(value as HostOperations[K]['output']), reject, timer });
        try { ctx.sendToBackend({ type: 'host_service', requestId, operation, input } as HostRequest); }
        catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
      });
    },
    dispose(): void {
      disposed = true;
      unsubscribe();
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new HostServiceError('Host service connection closed')); }
      pending.clear();
    },
  };
}

let active: ReturnType<typeof createHostClient> | undefined;
export function setupHostServices(ctx: Transport): () => void {
  active?.dispose();
  const client = createHostClient(ctx);
  active = client;
  return () => { client.dispose(); if (active === client) active = undefined; };
}
export function hostCall<K extends keyof HostOperations>(operation: K, input: HostOperations[K]['input']): Promise<HostOperations[K]['output']> {
  if (!active) return Promise.reject(new HostServiceError('Host services are not connected'));
  return active.call(operation, input);
}

export async function uploadImageFile(file: Blob, name: string): Promise<string> {
  const staged = await hostCall('file.create', { name, size: file.size, mimeType: file.type });
  try {
    let offset = 0;
    while (offset < file.size) {
      const bytes = new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const next = await hostCall('file.write', { id: staged.fileId, offset, base64: btoa(binary) });
      if (next !== offset + bytes.length) throw new HostServiceError('Invalid host upload offset');
      offset = next;
    }
    await hostCall('file.finish', { id: staged.fileId });
    return await hostCall('image.upload', { fileId: staged.fileId, name, mimeType: file.type });
  } finally { await hostCall('file.delete', { id: staged.fileId }); }
}
