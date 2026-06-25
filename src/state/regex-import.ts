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

function toPendingMsg(row: LumiRegexScript): PendingRegexScriptMsg {
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
    metadata: row.metadata,
  };
}

export function createRegexImporter(deps: RegexImporterDeps): RegexImporter {
  async function handle(msg: ImportRegexMsg, userId: string): Promise<void> {
    const t0 = Date.now();
    const folder = (msg.filename ?? 'regex').replace(/\.[^.]+$/, '').trim() || 'regex';

    const parsed = deps.parseDirectRegex(msg.json);
    if (parsed.format === 'unknown') {
      deps.send({
        type: 'standalone_regex_install',
        ok: false,
        scripts: [],
        parsed: 0,
        dropped: parsed.dropped,
        folder,
        reason: 'unrecognized regex format (expected Risu regex export `{type:"regex",data:[…]}`)',
      }, userId);
      return;
    }
    if (parsed.scripts.length === 0) {
      deps.send({
        type: 'standalone_regex_install',
        ok: false,
        scripts: [],
        parsed: 0,
        dropped: parsed.dropped,
        folder,
        reason: 'no regex scripts found in file',
      }, userId);
      return;
    }

    let result: ReturnType<typeof deps.mapRegex>;
    try {
      result = deps.mapRegex(parsed.scripts, {
        characterId: '',
        userId,
        scope: 'global',
        scopeId: null,
        folder,
        catalog: deps.loadCatalog(),
      });
    } catch (err) {
      deps.send({
        type: 'standalone_regex_install',
        ok: false,
        scripts: [],
        parsed: parsed.scripts.length,
        dropped: parsed.dropped,
        folder,
        reason: `regex translation failed: ${deps.errMsg(err)}`,
      }, userId);
      return;
    }

    // @@emo / @@repeat_back need card runtime context and can't run as global
    // standalone rules, so they're surfaced as dropped.
    const dropped = parsed.dropped + result.skipped.length;
    const scripts = result.rows.map(toPendingMsg);

    deps.log.info(
      `import_regex: format=${parsed.format} scripts=${parsed.scripts.length} rows=${scripts.length} ` +
        `skipped=${result.skipped.length} issues=${result.issues.length} dropped=${dropped} ` +
        `elapsed=${Date.now() - t0}ms file=${msg.filename ?? '<unnamed>'} folder="${folder}"`,
    );

    deps.send({
      type: 'standalone_regex_install',
      ok: scripts.length > 0,
      scripts,
      parsed: parsed.scripts.length,
      dropped,
      folder,
      ...(scripts.length === 0 ? { reason: 'all regex rules were runtime-only or invalid' } : {}),
    }, userId);
  }

  return { handle };
}
