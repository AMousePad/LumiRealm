/**
 * Extracts `module.risum` from every .charx in `tests/local_library/` into
 * `tests/local_library/derived/risum/<card-basename>.risum`.
 *
 * Run once manually before the slow suite. Output is never committed;
 * tests skip when fixtures are missing so they work on any machine.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { unzipSync } from "fflate";
import { listLibraryCards } from "../../helpers/local-library.js";

const DST = join(import.meta.dir, "..", "..", "local_library", "derived", "risum");

function stripPolyglot(buf: Uint8Array): Uint8Array {
  // CharX may be JPEG+ZIP polyglot. Find ZIP local-file header magic (PK\x03\x04).
  // If ZIP magic is at offset 0, return as-is.
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return buf;
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      return buf.subarray(i);
    }
  }
  throw new Error("no ZIP header found in charx");
}

function extractOne(charxPath: string): void {
  const name = basename(charxPath, extname(charxPath));
  const outPath = join(DST, `${name}.risum`);
  if (existsSync(outPath)) {
    console.log(`[skip] ${name} (already extracted)`);
    return;
  }
  const raw = readFileSync(charxPath);
  const zipBytes = stripPolyglot(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (e) {
    console.error(`[fail] ${name}: unzip error`, e);
    return;
  }
  const entry = files["module.risum"];
  if (!entry) {
    console.error(`[fail] ${name}: no module.risum inside`);
    return;
  }
  writeFileSync(outPath, entry);
  console.log(`[ok]   ${name} (${entry.byteLength} bytes)`);
}

function main(): void {
  const charxs = listLibraryCards();
  if (charxs.length === 0) {
    console.error("no charx files in tests/local_library");
    process.exit(1);
  }
  mkdirSync(DST, { recursive: true });
  for (const p of charxs) extractOne(p);
}

main();
