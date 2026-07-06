import * as tus from 'tus-js-client';
import type { FrontendToBackend } from '../types/messages.js';

// A single SPINDLE_BACKEND_MSG frame is capped at 4MB (oversize = silent drop),
// so anything past this threshold uploads over HTTP tus instead.
const SINGLE_MAX_BYTES = 1_000_000;
const UPLOAD_ENDPOINT = '/api/v1/spindle-uploads';
const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const EXTENSION_IDENTIFIER = 'lumirealm';

export interface ImportTextArgs {
  readonly kind: 'lorebook' | 'regex';
  readonly text: string;
  readonly filename?: string;
  readonly characterId: string | null;
}

export type TusUploader = (bytes: Uint8Array, fileName: string) => Promise<string>;

function tusUploadBytes(bytes: Uint8Array, fileName: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const upload = new tus.Upload(new Blob([bytes as unknown as BlobPart]), {
      endpoint: UPLOAD_ENDPOINT,
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      metadata: { filename: fileName, extension: EXTENSION_IDENTIFIER },
      onError: reject,
      onSuccess: () => {
        const id = (upload.url ?? '').split('/').filter(Boolean).pop() ?? '';
        if (id) resolve(id);
        else reject(new Error('upload finished but no id was returned'));
      },
    });
    upload.start();
  });
}

/**
 * Send a lorebook / regex JSON import. Small payloads ride a single WS frame,
 * large ones upload via tus and the backend redeems the uploadId.
 */
export async function sendImportText(
  send: (msg: FrontendToBackend) => void,
  args: ImportTextArgs,
  uploadBytes: TusUploader = tusUploadBytes,
): Promise<{ chunked: boolean }> {
  const encoded = new TextEncoder().encode(args.text);

  if (encoded.byteLength <= SINGLE_MAX_BYTES) {
    if (args.kind === 'lorebook') {
      send({ type: 'import_lorebook', characterId: args.characterId, json: args.text, ...(args.filename ? { filename: args.filename } : {}) });
    } else {
      send({ type: 'import_regex', json: args.text, characterId: args.characterId, ...(args.filename ? { filename: args.filename } : {}) });
    }
    return { chunked: false };
  }

  const uploadId = await uploadBytes(encoded, args.filename ?? `${args.kind}.json`);
  send({
    type: 'import_text_from_upload',
    uploadId,
    kind: args.kind,
    characterId: args.characterId,
    ...(args.filename ? { filename: args.filename } : {}),
  });
  return { chunked: true };
}
