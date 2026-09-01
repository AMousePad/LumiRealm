// Optional card library for data-driven tests. Empty by default: populate
// tests/local_library/ with .charx cards (nested folders allowed) to enable
// corpus sweeps. Tests must no-op when the library is empty.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_LIBRARY_DIR = join(import.meta.dir, "..", "local_library");

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function listLibraryFiles(): string[] {
  if (!existsSync(LOCAL_LIBRARY_DIR)) return [];
  return walk(LOCAL_LIBRARY_DIR, []);
}

export function listLibraryCards(): string[] {
  return listLibraryFiles().filter((f) => f.endsWith(".charx") && !f.endsWith(".module.charx"));
}

export function findLibraryFile(baseName: string): string | null {
  const lower = baseName.toLowerCase();
  for (const f of listLibraryFiles()) {
    const base = f.replace(/\\/g, "/").split("/").pop() ?? "";
    if (base.toLowerCase() === lower) return f;
  }
  return null;
}
