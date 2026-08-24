import type { LorebookEntry, Message } from '../core/cbs/index.js';
import type { AssetIndexEntry } from '../payload/types.js';
import type { HostMessage, HostWorldInfoEntry } from '../interpreter/host.js';
import type { RuntimeAtAtAction } from '../interpreter/at-actions-runtime.js';
import type { CompiledTriggerEntry } from '../interpreter/dispatcher.js';
import type { TriggerScript } from '../core/schemas/triggerscript.js';

export interface DisplayLuaTrigger {
  readonly source: TriggerScript;
  readonly luaCode: string;
}

export interface DisplaySnapshotCharacter {
  readonly description: string;
  readonly personality: string;
  readonly scenario: string;
  readonly exampleDialogue: string;
  readonly mainPrompt: string;
  readonly postHistoryInstructions: string;
  readonly creatorNotes: string;
  readonly jailbreakPrompt: string;
  readonly globalNote: string;
  readonly authorsNote: string;
  readonly firstMessage: string;
  readonly alternateGreetings: readonly string[];
  readonly selectedAlternateGreetingIndex: number;
  readonly selectedGreeting?: string;
  readonly additionalAssets: Readonly<Record<string, AssetIndexEntry>>;
  readonly emotionImages: Readonly<Record<string, AssetIndexEntry>>;
  readonly image: string;
  readonly imageId: string | null;
}

export interface DisplayChatAuthorsNote {
  readonly content: string;
  readonly depth?: number;
  readonly role?: string;
  readonly position?: number;
}

export interface DisplaySnapshot {
  readonly chatId: string;
  readonly characterId: string;
  readonly userName: string;
  readonly charName: string;
  readonly personaText: string;
  readonly personaImage: string;
  readonly personaImageId: string | null;
  readonly chatAuthorsNote: DisplayChatAuthorsNote | null;
  readonly character: DisplaySnapshotCharacter;
  readonly chat: {
    readonly messageCount: number;
    readonly lastMessage: string;
    readonly lastUserMessage: string;
    readonly lastCharMessage: string;
    readonly lastMessageId: number;
    readonly messages: readonly Message[];
  };
  readonly vars: {
    readonly local: Record<string, string>;
    readonly global: Record<string, string>;
    readonly chat: Record<string, string>;
  };
  readonly scriptstateDefaults: Record<string, string>;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly legacyMediaFindings: boolean;
  readonly modulesByNamespace: Readonly<Record<string, readonly string[]>>;
  readonly lorebook: readonly LorebookEntry[];
  /** Card uses editDisplay Lua hooks; FE defers body-resolve to the backend until P4. */
  readonly hasEditDisplayLua: boolean;
  /** Card uses @@emo/@@repeat_back editdisplay actions; FE defers until P4/P5. */
  readonly hasEditAtActions: boolean;
  readonly luaTriggers: readonly DisplayLuaTrigger[];
  readonly messagesHost: readonly HostMessage[];
  readonly lorebookHost: readonly HostWorldInfoEntry[];
  readonly atActions: readonly RuntimeAtAtAction[];
  readonly compiledLibraries: readonly CompiledTriggerEntry[];
}

export type DisplayResolutionMode = 'off' | 'shadow' | 'on';

const snapshots = new Map<string, DisplaySnapshot>();
let mode: DisplayResolutionMode = 'on';
const snapshotWaiters = new Map<string, Array<(ok: boolean) => void>>();

export function setDisplaySnapshot(snapshot: DisplaySnapshot): void {
  snapshots.set(snapshot.chatId, snapshot);
  const waiters = snapshotWaiters.get(snapshot.chatId);
  if (waiters) {
    snapshotWaiters.delete(snapshot.chatId);
    for (const w of waiters) w(true);
  }
}

export function waitForSnapshot(chatId: string, timeoutMs: number): Promise<boolean> {
  if (snapshots.has(chatId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const list = snapshotWaiters.get(chatId) ?? [];
    list.push(done);
    snapshotWaiters.set(chatId, list);
    setTimeout(() => done(false), timeoutMs);
  });
}

export function getDisplaySnapshot(chatId: string): DisplaySnapshot | undefined {
  return snapshots.get(chatId);
}

export function applyVarDelta(
  chatId: string,
  scope: 'local' | 'global' | 'chat',
  values: Record<string, string>,
): void {
  const prev = snapshots.get(chatId);
  if (!prev) return;
  snapshots.set(chatId, {
    ...prev,
    vars: { ...prev.vars, [scope]: { ...prev.vars[scope], ...values } },
  });
}

// Whole-scope replace: deletions in `values` must actually delete (Risu
// getVar falls back to "null" for missing keys — merged ghosts break that).
export function replaceVarScope(
  chatId: string,
  scope: 'local' | 'global' | 'chat',
  values: Record<string, string>,
): void {
  const prev = snapshots.get(chatId);
  if (!prev) return;
  snapshots.set(chatId, {
    ...prev,
    vars: { ...prev.vars, [scope]: { ...values } },
  });
}

export function clearDisplaySnapshot(chatId: string): void {
  snapshots.delete(chatId);
}

export function diffSnapshotVars(prev: DisplaySnapshot, next: DisplaySnapshot): string[] {
  const changed: string[] = [];
  for (const scope of ['local', 'global', 'chat'] as const) {
    const a = prev.vars[scope];
    const b = next.vars[scope];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (a[k] !== b[k]) changed.push(`${scope}:${k}`);
    }
  }
  // Card-side scriptstate_defaults feed local/chat-scope misses (evaluator
  // context shadows env lookups with these). A defaults-only edit must
  // invalidate entries that read through the fallback, which the recorder
  // logged as local:<k> + chat:<k>.
  const pa = prev.scriptstateDefaults ?? {};
  const pb = next.scriptstateDefaults ?? {};
  const dkeys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  for (const k of dkeys) {
    if (pa[k] !== pb[k]) {
      changed.push(`local:${k}`);
      changed.push(`chat:${k}`);
    }
  }
  return changed;
}

export function isDisplayResolutionReady(chatId: string): boolean {
  // Host decides ownership per-character from character.extensions.lumirealm.display_owner.
  // ready() means a snapshot landed so we can resolve, else the host shows raw until invalidate.
  return mode !== 'off' && snapshots.has(chatId);
}

export function getDisplayResolutionMode(): DisplayResolutionMode {
  return mode;
}

export function setDisplayResolutionMode(next: DisplayResolutionMode): void {
  mode = next;
}
