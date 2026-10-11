import { describe, expect, test, mock } from 'bun:test';
import type { SpindleAPI } from 'lumiverse-spindle-types';
import { createHostServices } from '../../src/host-services/backend.js';
import { createHostClient, setupHostServices, uploadImageFile } from '../../src/host-services/client.js';
import { readStagedBytes, stageBytes } from '../../src/host-services/files.js';
import { stagedHost } from '../helpers/staged-host.js';

describe('Spindle service transport', () => {
  test('uses authenticated identity and replies only to the requesting browser session', async () => {
    const prepare = mock(async (input: unknown) => input);
    const replies: unknown[][] = [];
    const host = { regex_scripts: { prepareActivationPatterns: prepare }, sendToFrontend: (...args: unknown[]) => replies.push(args) } as unknown as SpindleAPI;
    const receive = createHostServices(host);
    const request = { type: 'host_service', requestId: 'request', operation: 'activation.prepare', input: { patterns: ['{{char}}'], userId: 'forged' } };
    await receive(request, 'owner', 'tab');
    expect(prepare).toHaveBeenCalledWith({ patterns: ['{{char}}'], userId: 'owner' });
    expect(replies[0]?.slice(1)).toEqual(['owner', { frontendSessionId: 'tab' }]);
    await expect(receive(request, 'owner', undefined)).rejects.toThrow('authenticated browser session');
  });

  test('chunks image uploads and deletes staging after success or host rejection', async () => {
    const { host: staged, data } = stagedHost();
    let uploaded: Uint8Array | undefined;
    let reject = false;
    let receive: (message: unknown) => void = () => {};
    const backend = createHostServices({ ...staged,
      images: { upload: async (input: { data: Uint8Array }) => { if (reject) throw new Error('Upload refused'); uploaded = input.data; return { id: 'image' }; } },
      sendToFrontend: receiveReply,
    } as unknown as SpindleAPI);
    function receiveReply(value: unknown) { receive(value); }
    const stop = setupHostServices({
      onBackendMessage(handler) { receive = handler; return () => {}; },
      sendToBackend(message) { void backend(message, 'user', 'tab'); },
    });
    try {
      const bytes = new Uint8Array(1024 * 1024 + 17).fill(123);
      expect(await uploadImageFile(new Blob([bytes]), 'image.png')).toBe('image');
      expect(uploaded).toEqual(bytes);
      expect(data.size).toBe(0);
      reject = true;
      await expect(uploadImageFile(new Blob([bytes]), 'image.png')).rejects.toThrow('Upload refused');
      expect(data.size).toBe(0);
    } finally { stop(); }
  });

  test('disposal rejects pending calls and ignores unmatched replies', async () => {
    let receive: (message: unknown) => void = () => {};
    const client = createHostClient({ sendToBackend() {}, onBackendMessage(handler) { receive = handler; return () => {}; } });
    const pending = client.call('image.upload', { fileId: 'file', name: 'image', mimeType: 'image/png' });
    receive({ type: 'host_service_reply', requestId: 'other', ok: true, value: 'wrong' });
    client.dispose();
    await expect(pending).rejects.toThrow('connection closed');
  });

  test('rejects oversized upload frames before decoding them', async () => {
    const sendToFrontend = mock(() => {});
    const backend = createHostServices({ sendToFrontend } as unknown as SpindleAPI);
    await backend({ type: 'host_service', requestId: 'large', operation: 'file.write', input: { base64: 'A'.repeat(2 * 1024 * 1024) } }, 'user', 'tab');
    expect(sendToFrontend).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'File chunk exceeds 1 MiB' }), 'user', { frontendSessionId: 'tab' });
  });

  test('bounded reads preserve bytes and reject sizes before allocation', async () => {
    const { host } = stagedHost();
    const bytes = new Uint8Array(1024 * 1024 + 3).fill(0xff);
    const file = await stageBytes(host.files, bytes, 'file', 'user');
    expect(await readStagedBytes(host.files, { fileId: file.fileId }, 'user', bytes.length)).toEqual(bytes);
    await expect(readStagedBytes(host.files, { fileId: file.fileId }, 'user', bytes.length - 1)).rejects.toThrow('read limit');
    host.files.readChunk = async () => ({ data: new Uint8Array(), offset: 0, size: 2, eof: false });
    await expect(readStagedBytes(host.files, { fileId: file.fileId }, 'user', 2)).rejects.toThrow('no progress');
  });
});
