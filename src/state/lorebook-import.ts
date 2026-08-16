import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import type { LumirealmFetchResult } from './lumirealm-character.js';
import type { parseDirectLorebook } from '../payload/lorebook-direct-import.js';
import type { mapLoreBook } from '../core/mappers/lorebook.js';

export type ImportLorebookMsg = Extract<FrontendToBackend, { type: 'import_lorebook' }>;

export interface LorebookImporterDeps {
  readonly readLumirealm: (
    characterId: string,
    userId: string,
  ) => Promise<LumirealmFetchResult | null>;
  readonly createWorldBook: (
    input: { name: string },
    userId: string,
  ) => Promise<{ id: string }>;
  readonly updateCharacterWorldBookIds: (
    characterId: string,
    ids: readonly string[],
    userId: string,
  ) => Promise<void>;
  readonly createWorldBookEntry: (
    bookId: string,
    input: Record<string, unknown>,
    userId: string,
  ) => Promise<unknown>;
  readonly send: (msg: BackendToFrontend, userId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (err: unknown) => string;
  readonly parseDirectLorebook: typeof parseDirectLorebook;
  readonly mapLoreBook: typeof mapLoreBook;
}

export interface LorebookImporter {
  handle(msg: ImportLorebookMsg, userId: string): Promise<void>;
}

export function createLorebookImporter(deps: LorebookImporterDeps): LorebookImporter {
  async function handle(msg: ImportLorebookMsg, userId: string): Promise<void> {
    const t0 = Date.now();
    const standalone = msg.characterId === null;

    const parsed = deps.parseDirectLorebook(msg.json);
    if (parsed.format === 'unknown') {
      deps.send({
        type: 'lorebook_import_result',
        characterId: msg.characterId,
        ok: false,
        written: 0,
        dropped: parsed.dropped,
        reason: 'unrecognized lorebook format (expected Risu native or CCSv3)',
      }, userId);
      return;
    }
    if (parsed.entries.length === 0) {
      deps.send({
        type: 'lorebook_import_result',
        characterId: msg.characterId,
        ok: false,
        written: 0,
        dropped: parsed.dropped,
        reason: 'no entries found in lorebook file',
      }, userId);
      return;
    }

    let targetBookId: string | null = null;
    let targetBookName: string;
    if (standalone) {
      const stem = (msg.filename ?? 'lorebook').replace(/\.[^.]+$/, '').trim() || 'lorebook';
      targetBookName = stem;
      try {
        const wb = await deps.createWorldBook({ name: targetBookName }, userId);
        targetBookId = wb.id;
        deps.log.info(`import_lorebook: standalone created world_book ${wb.id} name="${targetBookName}"`);
      } catch (err) {
        deps.send({
          type: 'lorebook_import_result',
          characterId: null,
          ok: false,
          written: 0,
          dropped: parsed.dropped,
          reason: `world_book create failed: ${deps.errMsg(err)}`,
        }, userId);
        return;
      }
    } else {
      const characterId = msg.characterId!;
      const fetched = await deps.readLumirealm(characterId, userId);
      if (!fetched || !fetched.data) {
        deps.send({
          type: 'lorebook_import_result',
          characterId,
          ok: false,
          written: 0,
          dropped: 0,
          reason: 'not a lumirealm character',
        }, userId);
        return;
      }
      const existing = fetched.character.world_book_ids ?? [];
      if (existing.length > 0) {
        targetBookId = existing[0] ?? null;
      }
      targetBookName = `${fetched.character.name ?? 'character'}  - lore`;
      if (!targetBookId) {
        try {
          const wbName = `${fetched.character.name ?? 'character'}  - lore (imported)`;
          const wb = await deps.createWorldBook({ name: wbName }, userId);
          targetBookId = wb.id;
          targetBookName = wbName;
          await deps.updateCharacterWorldBookIds(characterId, [...existing, wb.id], userId);
          deps.log.info(`import_lorebook: created world_book ${wb.id} for char=${characterId}`);
        } catch (err) {
          deps.send({
            type: 'lorebook_import_result',
            characterId,
            ok: false,
            written: 0,
            dropped: parsed.dropped,
            reason: `world_book create failed: ${deps.errMsg(err)}`,
          }, userId);
          return;
        }
      }
    }

    const lumiEntries = deps.mapLoreBook(parsed.entries, { worldBookId: targetBookId! });

    let written = 0;
    let entryWriteFailures = 0;
    for (const entry of lumiEntries) {
      try {
        const entryInput: Record<string, unknown> = {
          key: entry.key,
          keysecondary: entry.keysecondary,
          content: entry.content,
          comment: entry.comment,
          position: entry.position,
          depth: entry.depth,
          order_value: entry.order_value,
          selective: entry.selective,
          constant: entry.constant,
          disabled: entry.disabled,
          group_name: entry.group_name,
          group_override: entry.group_override,
          group_weight: entry.group_weight,
          probability: entry.probability,
          exclude_greeting: entry.exclude_greeting,
          case_sensitive: entry.case_sensitive,
          match_whole_words: entry.match_whole_words,
          use_regex: entry.use_regex,
          prevent_recursion: entry.prevent_recursion,
          exclude_recursion: entry.exclude_recursion,
          delay_until_recursion: entry.delay_until_recursion,
          priority: entry.priority,
          sticky: entry.sticky,
          cooldown: entry.cooldown,
          delay: entry.delay,
          selective_logic: entry.selective_logic,
          use_probability: entry.use_probability,
          ...(entry.role !== null ? { role: entry.role } : {}),
          ...(entry.scan_depth !== null ? { scan_depth: entry.scan_depth } : {}),
          ...(entry.automation_id !== null ? { automation_id: entry.automation_id } : {}),
          ...(entry.extensions ? { extensions: entry.extensions } : {}),
        };
        await deps.createWorldBookEntry(targetBookId!, entryInput, userId);
        written += 1;
      } catch (err) {
        entryWriteFailures += 1;
        deps.log.warn(`import_lorebook: entry "${entry.comment}" failed: ${deps.errMsg(err)}`);
      }
    }

    deps.log.info(
      `import_lorebook: ${standalone ? 'standalone' : `char=${msg.characterId}`} format=${parsed.format} ` +
        `written=${written}/${parsed.entries.length} drops=${parsed.dropped} ` +
        `entry_write_failures=${entryWriteFailures} elapsed=${Date.now() - t0}ms ` +
        `file=${msg.filename ?? '<unnamed>'} book=${targetBookId}`,
    );

    deps.send({
      type: 'lorebook_import_result',
      characterId: msg.characterId,
      ok: written > 0,
      written,
      dropped: parsed.dropped + entryWriteFailures,
      ...(targetBookId ? { worldBookId: targetBookId, worldBookName: targetBookName } : {}),
      ...(written === 0 && entryWriteFailures > 0
        ? { reason: 'all entry writes failed; see log for details' }
        : {}),
    }, userId);
  }

  return { handle };
}
