import type { BackendToFrontend, FrontendToBackend, PendingRegexScriptMsg } from '../types/messages.js';
import type { parseDirectRegex } from '../payload/regex-direct-import.js';
import type { mapRegex } from '../core/mappers/regex.js';
import type { CatalogIndex } from '../core/cbs/catalog/loader.js';
import type { LumiRegexScript } from '../core/lumiverse/types.js';

export type ImportRegexMsg = Extract<FrontendToBackend, { type: 'import_regex' }>;

export interface RegexImporterDeps {
  readonly send: (msg: BackendToFrontend, userId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (err: unknown) => string;
  readonly parseDirectRegex: typeof parseDirectRegex;
  readonly mapRegex: typeof mapRegex;
  readonly loadCatalog: () => CatalogIndex;
}

export interface RegexImporter {
  handle(msg: ImportRegexMsg, userId: string): Promise<void>;
}

// Marks rows as user-imported so the card-install pre-clean (which wipes
// character-scoped rows on re-translate / migration) leaves them alone.
function toPendingMsg(row: LumiRegexScript): PendingRegexScriptMsg {
  const risu = (row.metadata?.['_risu'] ?? {}) as Record<string, unknown>;
  return {
    name: row.name,
    script_id: row.script_id,
    find_regex: row.find_regex,
    replace_string: row.replace_string,
    flags: row.flags,
    placement: row.placement,
    scope: row.scope,
    scope_id: row.scope_id,
    target: row.target,
    min_depth: row.min_depth,
    max_depth: row.max_depth,
    trim_strings: row.trim_strings,
    run_on_edit: row.run_on_edit,
    substitute_macros: row.substitute_macros,
    disabled: row.disabled,
    sort_order: row.sort_order,
    description: row.description,
    folder: row.folder,
    metadata: { ...row.metadata, _risu: { ...risu, imported_regex: true } },
  };
}

export function createRegexImporter(deps: RegexImporterDeps): RegexImporter {
  async function handle(msg: ImportRegexMsg, userId: string): Promise<void> {
    const t0 = Date.now();
    const characterId = msg.characterId ?? null;
    const folder = (msg.filename ?? 'regex').replace(/\.[^.]+$/, '').trim() || 'regex';

    const fail = (parsed: number, dropped: number, reason: string): void => {
      deps.send({
        type: 'standalone_regex_install',
        ok: false, scripts: [], parsed, dropped, folder, characterId, reason,
      }, userId);
    };

    const parsed = deps.parseDirectRegex(msg.json);
    if (parsed.format === 'unknown') {
      fail(0, parsed.dropped, 'unrecognized regex format (expected Risu regex export `{type:"regex",data:[…]}`)');
      return;
    }
    if (parsed.scripts.length === 0) {
      fail(0, parsed.dropped, 'no regex scripts found in file');
      return;
    }

    let result: ReturnType<typeof deps.mapRegex>;
    try {
      result = deps.mapRegex(parsed.scripts, {
        characterId: characterId ?? '',
        userId,
        scope: characterId ? 'character' : 'global',
        scopeId: characterId,
        folder,
        catalog: deps.loadCatalog(),
      });
    } catch (err) {
      fail(parsed.scripts.length, parsed.dropped, `regex translation failed: ${deps.errMsg(err)}`);
      return;
    }

    // @@emo / @@repeat_back need card runtime context and can't run as plain
    // regex rows, so they're surfaced as dropped.
    const dropped = parsed.dropped + result.skipped.length;
    const scripts = result.rows.map(toPendingMsg);

    deps.log.info(
      `import_regex: scope=${characterId ? `character(${characterId})` : 'global'} format=${parsed.format} ` +
        `scripts=${parsed.scripts.length} rows=${scripts.length} skipped=${result.skipped.length} ` +
        `issues=${result.issues.length} dropped=${dropped} elapsed=${Date.now() - t0}ms ` +
        `file=${msg.filename ?? '<unnamed>'} folder="${folder}"`,
    );

    if (scripts.length === 0) {
      fail(parsed.scripts.length, dropped, 'all regex rules were runtime-only or invalid');
      return;
    }

    deps.send({
      type: 'standalone_regex_install',
      ok: true, scripts, parsed: parsed.scripts.length, dropped, folder, characterId,
    }, userId);
  }

  return { handle };
}
