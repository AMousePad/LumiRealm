import { TranslationError } from "../errors.js";
import { decodeRisum, type RisumEnvelope } from "../risum/codec.js";
import {
  LUMIREALM_SIDECAR_ENTRY,
  isLumirealmSidecar,
  type LumirealmArchiveSidecar,
} from "../export/archive-types.js";
import { stripPolyglot, isZipArchive, findJpegZipBoundary } from "./polyglot.js";
import { readZip } from "./zip.js";

export interface CharxBundle {
  readonly card: unknown | null;
  readonly cardJsonText: string | null;
  readonly moduleBytes: Uint8Array | null;
  readonly moduleEnvelope: RisumEnvelope | null;
  /** Present only for archives we wrote. Authoritative over card.json when set. */
  readonly sidecar: LumirealmArchiveSidecar | null;
  readonly assets: ReadonlyMap<string, Uint8Array>;
  readonly xMeta: ReadonlyMap<string, unknown>;
  readonly oversizedEntries: readonly { path: string; bytes: number }[];
  readonly unsafeEntries: readonly string[];
  readonly issues: readonly { path: string; message: string }[];
  readonly isPolyglot: boolean;
  readonly jpegPreview: Uint8Array | null;
}

export interface ReadCharxOptions {
  readonly maxAssetBytes?: number;
  readonly maxTotalBytes?: number;
  readonly decodeModule?: boolean;
  readonly maxEntryCount?: number;
}

const DEFAULT_MAX_ASSET_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_COUNT = 100_000;

export function isUnsafePath(path: string): boolean {
  if (path.length === 0) return true;
  // Absolute paths (Unix / or Windows C:).
  if (path[0] === "/" || path[0] === "\\") return true;
  if (path.length >= 2 && path[1] === ":") return true;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    // NUL byte, never valid in a zip path.
    if (c === 0) return true;
  }
  // Split on both / and \ in case a tool packed Windows-style paths.
  const segments: string[] = [];
  let start = 0;
  for (let i = 0; i <= path.length; i++) {
    if (i === path.length || path[i] === "/" || path[i] === "\\") {
      segments.push(path.slice(start, i));
      start = i + 1;
    }
  }
  for (const seg of segments) {
    if (seg === "..") return true;
  }
  return false;
}

/** Is this an x_meta/*.json path (Risu per-asset PNG chunk metadata)? */
export function isXMetaPath(path: string): boolean {
  if (!path.startsWith("x_meta/")) return false;
  if (!path.endsWith(".json")) return false;
  return true;
}

/** Is this the top-level card.json entry? */
export function isCardJsonPath(path: string): boolean {
  return path === "card.json";
}

/** Is this the module.risum entry? */
export function isModuleRisumPath(path: string): boolean {
  return path === "module.risum";
}

/** Is this our sidecar entry? Risu and pre-sidecar LumiRealm both skip it. */
export function isLumirealmSidecarPath(path: string): boolean {
  return path === LUMIREALM_SIDECAR_ENTRY;
}

/**
 * Parse a `.charx` bundle. Handles both pure-ZIP and JPEG+ZIP polyglot forms.
 */
export function readCharx(bytes: Uint8Array, opts: ReadCharxOptions = {}): CharxBundle {
  const maxAssetBytes = opts.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxEntryCount = opts.maxEntryCount ?? DEFAULT_MAX_ENTRY_COUNT;
  const decodeModule = opts.decodeModule ?? true;

  let jpegPreview: Uint8Array | null = null;
  let isPolyglot = false;
  if (!isZipArchive(bytes)) {
    const off = findJpegZipBoundary(bytes);
    if (off < 0) {
      throw new TranslationError(
        "charx/not_zip",
        `input is not a ZIP or JPEG+ZIP polyglot (first bytes: ${Array.from(bytes.subarray(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" ")})`,
      );
    }
    jpegPreview = bytes.subarray(0, off);
    isPolyglot = true;
  }

  let files: Record<string, Uint8Array>;
  let zipOversized: readonly { name: string; uncompressedSize: number }[];
  try {
    const result = readZip(bytes, {
      maxEntryBytes: maxAssetBytes,
      maxTotalBytes,
      maxEntryCount,
    });
    files = {};
    for (const e of result.entries) files[e.name] = e.data;
    zipOversized = result.oversized;
  } catch (cause) {
    throw new TranslationError("charx/bad_zip", `unzip failed: ${String(cause)}`, { cause });
  }

  let card: unknown | null = null;
  let cardJsonText: string | null = null;
  let moduleBytes: Uint8Array | null = null;
  let sidecar: LumirealmArchiveSidecar | null = null;
  const assets = new Map<string, Uint8Array>();
  const xMeta = new Map<string, unknown>();
  const oversizedEntries: { path: string; bytes: number }[] = zipOversized.map(
    (o) => ({ path: o.name, bytes: o.uncompressedSize }),
  );
  const unsafeEntries: string[] = [];
  const issues: { path: string; message: string }[] = [];
  let totalBytes = 0;

  for (const [path, data] of Object.entries(files)) {
    if (isUnsafePath(path)) {
      unsafeEntries.push(path);
      continue;
    }
    if (path.endsWith("/") && data.byteLength === 0) continue;

    if (isCardJsonPath(path)) {
      try {
        cardJsonText = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch (cause) {
        issues.push({ path, message: `card.json is not valid UTF-8: ${String(cause)}` });
        continue;
      }
      try {
        card = JSON.parse(cardJsonText);
      } catch (cause) {
        issues.push({ path, message: `card.json is not valid JSON: ${String(cause)}` });
        card = null;
      }
      totalBytes += data.byteLength;
      continue;
    }

    if (isModuleRisumPath(path)) {
      moduleBytes = data;
      totalBytes += data.byteLength;
      continue;
    }

    if (isLumirealmSidecarPath(path)) {
      totalBytes += data.byteLength;
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
      } catch (cause) {
        issues.push({ path, message: `lumirealm sidecar parse failed: ${String(cause)}` });
        continue;
      }
      if (!isLumirealmSidecar(parsed)) {
        const version = (parsed as { schema_version?: unknown })?.schema_version;
        issues.push({
          path,
          message: `lumirealm sidecar is not a supported shape (schema_version=${String(version)})`,
        });
        continue;
      }
      sidecar = parsed;
      continue;
    }

    if (isXMetaPath(path)) {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch (cause) {
        issues.push({ path, message: `x_meta JSON is not valid UTF-8: ${String(cause)}` });
        continue;
      }
      try {
        xMeta.set(path, JSON.parse(text));
      } catch (cause) {
        issues.push({ path, message: `x_meta JSON parse failed: ${String(cause)}` });
      }
      totalBytes += data.byteLength;
      continue;
    }

    // Risu ignores other .json files (processzip.ts).
    if (path.endsWith(".json")) {
      issues.push({ path, message: "unrecognized .json file (Risu also ignores)" });
      continue;
    }

    assets.set(path, data);
    totalBytes += data.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new TranslationError(
        "charx/total_size_exceeded",
        `aggregate asset size exceeds limit ${maxTotalBytes} bytes`,
      );
    }
  }

  let moduleEnvelope: RisumEnvelope | null = null;
  if (moduleBytes && decodeModule) {
    try {
      moduleEnvelope = decodeRisum(moduleBytes);
    } catch (cause) {
      issues.push({
        path: "module.risum",
        message: `decode failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }

  return {
    card,
    cardJsonText,
    moduleBytes,
    moduleEnvelope,
    sidecar,
    assets,
    xMeta,
    oversizedEntries,
    unsafeEntries,
    issues,
    isPolyglot,
    jpegPreview,
  };
}

export { stripPolyglot, isZipArchive, findJpegZipBoundary } from "./polyglot.js";
