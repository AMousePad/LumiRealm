import { expect, mock, test } from 'bun:test';
import { createImportHandlers, type ImportHandlerDeps } from '../../src/handlers/import.js';
import { convertToCharx } from '../../src/realm/import-formats/index.js';
import type { BackendToFrontend } from '../../src/types/messages.js';

test('malformed card upload reports terminal import progress and removes the upload', async () => {
  const send = mock((_msg: BackendToFrontend, _userId: string) => {});
  const log = { info() {}, warn() {}, error() {} };
  const deleteUpload = mock(async () => true);
  const errMsg = (error: unknown) => String(error);
  const handlers = createImportHandlers({
    getUpload: async () => ({ fileName: 'invalid.png', data: Uint8Array.of(0), size: 1 }),
    importAnyFormat: async (bytes: Uint8Array, fileName: string) => { convertToCharx(bytes, fileName); },
    deleteUpload, log, errMsg,
  } as unknown as ImportHandlerDeps);
  await handlers.import_card_from_upload({ type: 'import_card_from_upload', uploadId: 'upload', fileName: 'invalid.png' }, { userId: 'user', send, log, errMsg });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'import_progress', phase: 'error', error: expect.any(String) }), 'user');
  expect(deleteUpload).toHaveBeenCalledWith('upload', 'user');
});
