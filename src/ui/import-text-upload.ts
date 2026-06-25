import type { FrontendToBackend } from '../types/messages.js';

// A single SPINDLE_BACKEND_MSG frame is capped at 4MB (oversize = silent drop),
// so anything past this threshold goes through the chunked transport.
const SINGLE_MAX_BYTES = 1_000_000;
// Worst-case JSON escaping is ~6x per char, 600k chars stays well under 4MB.
const CHUNK_CHARS = 600_000;

export interface ImportTextArgs {
  readonly kind: 'lorebook' | 'regex';
  readonly text: string;
  readonly filename?: string;
  readonly characterId: string | null;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `up-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Send a lorebook / regex JSON import, chunking automatically when the payload
 * is too large for a single WS frame. Large files reassemble on the backend via
 * import_text_*.
 */
export function sendImportText(
  send: (msg: FrontendToBackend) => void,
  args: ImportTextArgs,
): { chunked: boolean; chunks: number } {
  const bytes = new TextEncoder().encode(args.text).length;

  if (bytes <= SINGLE_MAX_BYTES) {
    if (args.kind === 'lorebook') {
      send({ type: 'import_lorebook', characterId: args.characterId, json: args.text, ...(args.filename ? { filename: args.filename } : {}) });
    } else {
      send({ type: 'import_regex', json: args.text, characterId: args.characterId, ...(args.filename ? { filename: args.filename } : {}) });
    }
    return { chunked: false, chunks: 1 };
  }

  const uploadId = uuid();
  const parts: string[] = [];
  for (let i = 0; i < args.text.length; i += CHUNK_CHARS) {
    parts.push(args.text.slice(i, i + CHUNK_CHARS));
  }
  send({
    type: 'import_text_init',
    uploadId,
    kind: args.kind,
    characterId: args.characterId,
    totalChunks: parts.length,
    totalBytes: bytes,
    ...(args.filename ? { filename: args.filename } : {}),
  });
  for (let seq = 0; seq < parts.length; seq++) {
    send({ type: 'import_text_chunk', uploadId, seq, data: parts[seq]! });
  }
  send({ type: 'import_text_commit', uploadId });
  return { chunked: true, chunks: parts.length };
}
