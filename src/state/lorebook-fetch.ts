declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import type { WorldBookEntryDTO } from "lumiverse-spindle-types";
import type { LorebookEntry } from "../core/cbs/runtime/context.js";
import type { StoredRisuCard } from '../payload/types.js';
import type { HostWorldInfoEntry } from '../interpreter/host.js';
import { sortLorebookEntriesBySourceOrder, withModuleLorebooks } from '../interpreter/runtime/lorebook.js';

export function moduleLorebooksForCard(card: StoredRisuCard): readonly unknown[] {
  return Object.values((card.risuPayload.extra?.runtime_module_lorebooks as Record<string, readonly unknown[]> | undefined) ?? {}).flat();
}

type LoreEntryFields = Partial<Pick<WorldBookEntryDTO, 'content' | 'comment' | 'constant' | 'selective'>> & {
  key?: string | readonly string[];
  keysecondary?: string | readonly string[];
  secondkey?: string;
  secondKey?: string;
  order_value?: number;
  orderValue?: number;
  insertorder?: number;
  alwaysActive?: boolean;
  mode?: string;
};

const joinKeys = (value: string | readonly string[] | undefined): string => typeof value === 'string' ? value : (value ?? []).join(',');

// Risu's loreBook shape (storage/database.svelte.ts): key/secondkey are single
// comma-joined strings, not arrays. {{lorebook}} JSON.stringifies each entry and
// cards read lore.key as a string, so join here at the boundary.
//
// Flat shape only (no nested objects). {{lorebook}} entries get injected into
// other macros' args via {{element::{{slot::lore}}::key}}; the CBS scanner
// detects macro close on any `}}`, so a nested object whose JSON ends in `}}`
// (e.g. Lumi's extensions blob) truncates the {{element::...}} macro and the
// whole {{#each}} collapses. Risu's loreBook serialization for these entries is
// flat too; the Lumi extensions blob is internal and not part of {{lorebook}}.
export function lumiEntryToRisuLore(e: LoreEntryFields): LorebookEntry {
  const keyStr = joinKeys(e.key);
  const secondStr = joinKeys(e.keysecondary ?? e.secondkey ?? e.secondKey);
  const alwaysActive = e.constant ?? e.alwaysActive ?? false;
  return {
    key: keyStr,
    secondkey: secondStr,
    secondKey: secondStr,
    content: e.content ?? "",
    comment: e.comment ?? "",
    insertorder: e.orderValue ?? e.order_value ?? e.insertorder ?? 0,
    alwaysActive,
    selective: e.selective === true,
    mode: e.mode ?? (alwaysActive ? "constant" : "normal"),
  };
}

// Mirrors {{lorebook}} = characterLore.concat(chatLore, moduleLore): the raw
// entry list with no disabled/activation filtering (Risu cbs.ts).
export async function fetchLorebookForCharacter(
  worldBookIds: readonly string[],
  userId: string,
  moduleLorebooks: readonly unknown[] = [],
): Promise<readonly LorebookEntry[]> {
  const out: HostWorldInfoEntry[] = [];
  for (const bid of worldBookIds) {
    let offset = 0;
    for (;;) {
      const page = await spindle.world_books.entries.list(bid, { limit: 200, offset, userId });
      const rows = page?.data ?? [];
      for (const row of rows) out.push({ ...row, worldBookId: bid, orderValue: row.order_value });
      if (rows.length < 200) break;
      offset += rows.length;
    }
  }
  return withModuleLorebooks(sortLorebookEntriesBySourceOrder(out), moduleLorebooks, worldBookIds).map(lumiEntryToRisuLore);
}
