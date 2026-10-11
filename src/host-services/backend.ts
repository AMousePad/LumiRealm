import type { SpindleAPI } from 'lumiverse-spindle-types';
import { HostServiceError, type HostRequest, type HostReply } from './protocol.js';
import { readStagedBytes } from './files.js';

export function createHostServices(host: SpindleAPI) {
  async function execute(request: HostRequest, userId: string): Promise<unknown> {
    switch (request.operation) {
      case 'activation.prepare': return host.regex_scripts.prepareActivationPatterns({ ...request.input, userId });
      case 'regex.list': return host.regex_scripts.list({ ...request.input, userId });
      case 'regex.delete': {
        let count = 0;
        for (const id of new Set(request.input.ids)) if (await host.regex_scripts.delete(id, userId)) count++;
        return count;
      }
      case 'worldbook.delete': return host.world_books.delete(request.input.id, userId);
      case 'character.get': return host.characters.get(request.input.id, userId);
      case 'character.linkBooks': {
        await host.characters.update(request.input.id, { world_book_ids: request.input.worldBookIds }, userId);
        return;
      }
      case 'translation': {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx'
          + `&sl=${encodeURIComponent(request.input.source)}&tl=en&dt=t&q=${encodeURIComponent(request.input.text)}`;
        const response = await host.cors(url) as { status: number; body: string };
        if (typeof response.status !== 'number' || typeof response.body !== 'string') throw new HostServiceError('Invalid translation response');
        return { status: response.status, body: response.body };
      }
      case 'file.create': return host.files.create({ fileName: request.input.name, size: request.input.size, mimeType: request.input.mimeType, userId });
      case 'file.write': {
        if (typeof request.input.base64 !== 'string' || request.input.base64.length > 4 * Math.ceil(1024 * 1024 / 3)) throw new HostServiceError('File chunk exceeds 1 MiB');
        return host.files.writeChunk(request.input.id, request.input.offset, new Uint8Array(Buffer.from(request.input.base64, 'base64')), userId);
      }
      case 'file.finish': return host.files.finish(request.input.id, userId);
      case 'file.delete': return host.files.delete(request.input.id, userId);
      case 'image.upload': {
        const data = await readStagedBytes(host.files, { fileId: request.input.fileId }, userId, 50 * 1024 * 1024);
        return (await host.images.upload({ data, filename: request.input.name, mime_type: request.input.mimeType }, userId)).id;
      }
      default: throw new HostServiceError('Unknown host operation');
    }
  }
  return async (raw: unknown, userId: string, frontendSessionId: string | undefined): Promise<boolean> => {
    if (!raw || (raw as { type?: string }).type !== 'host_service') return false;
    if (!frontendSessionId) throw new HostServiceError('Host services require an authenticated browser session');
    const request = raw as HostRequest;
    let reply: HostReply;
    try { reply = { type: 'host_service_reply', requestId: request.requestId, ok: true, value: await execute(request, userId) }; }
    catch (error) { reply = { type: 'host_service_reply', requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) }; }
    host.sendToFrontend(reply, userId, { frontendSessionId });
    return true;
  };
}
