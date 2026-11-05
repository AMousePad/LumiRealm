import type { StateRevision } from './ordered-state.js';
import type { HostApi, HostMessage, HostCharacter, HostPersona, HostWorldInfoEntry } from '../interpreter/host.js';
import type { DisplaySnapshot } from '../display/snapshot.js';
import type { RisuCompatSettings } from '../state/settings-store.js';
import { hostMessageTime } from '../util/message-time.js';
import { hostLuaMessageData } from '../util/lua-message-data.js';

export interface RuntimeMessageDto {
  id: string; content: string; role?: string; is_user?: boolean; name?: string;
  index_in_chat: number; created_at?: number; send_date?: number;
  ownMetadata?: unknown;
  ownContentMetadata?: unknown;
  extra?: { greeting_index?: number; spindle_role?: string; spindle_metadata?: Record<string, unknown>; spindle_content_metadata?: Record<string, unknown> };
}
export interface RuntimeStateDto {
  revision: StateRevision;
  chat: { id: string; metadata: Record<string, unknown> };
  character: Record<string, unknown> & { id: string };
  persona: (Record<string, unknown> & { id: string }) | null;
  messages: RuntimeMessageDto[];
  lore: (Record<string, unknown> & { id: string })[];
  globalVariables: Record<string, string | null>;
}
export interface RuntimeStatePatch {
  chat?: RuntimeStateDto['chat']; character?: RuntimeStateDto['character']; persona?: RuntimeStateDto['persona'];
  message?: RuntimeMessageDto; deletedMessageId?: string;
  loreEntry?: RuntimeStateDto['lore'][number]; deletedLoreId?: string;
}
export interface RuntimeStateWrite { revision: StateRevision; value: unknown; patch: RuntimeStatePatch }
export type RuntimeStateCommand =
  | { kind: 'lore.upsertLocal'; entry: import('../core/schemas/lorebook.js').LoreBook }
  | { kind: 'lore.replaceLocal'; entries: readonly import('../core/schemas/lorebook.js').LoreBook[] }
  | { kind: 'chat.metadata'; key: string; value: unknown }
  | { kind: 'chat.variables'; values: Record<string, string | null> }
  | { kind: 'message.edit'; id: string; content?: string; role?: string; ownMetadata?: unknown; ownContentMetadata?: unknown }
  | { kind: 'message.delete'; id: string }
  | { kind: 'message.create'; id: string; content: string; role: string; beforeId?: string; ownMetadata?: unknown; ownContentMetadata?: unknown }
  | { kind: 'character.update'; id: string; patch: { name?: string; description?: string; first_mes?: string } }
  | { kind: 'persona.update'; id: string; patch: { name?: string; description?: string } }
  | { kind: 'lore.create'; bookId: string; patch: Record<string, unknown> }
  | { kind: 'lore.update'; id: string; patch: Record<string, unknown> }
  | { kind: 'lore.delete'; id: string };

// Time is the one mutation field a host can lack without losing the write: reads then use send_date instead of Risu's stored time.
export function dropUnsupportedMessageTime(command: RuntimeStateCommand, contracts: { runtimeMessageMutations?: unknown } | undefined): RuntimeStateCommand {
  if (contracts?.runtimeMessageMutations || (command.kind !== 'message.create' && command.kind !== 'message.edit')) return command;
  const { ownMetadata: _time, ...rest } = command;
  return rest;
}

export type RuntimeSettings = Pick<RisuCompatSettings, 'auxConnectionId' | 'auxModelOverride' | 'auxSamplers' | 'auxPrefillCompat'
  | 'submodelConnectionId' | 'submodelModelOverride' | 'submodelSamplers' | 'submodelPrefillCompat' | 'auxDebugCaptureRequest' | 'auxDebugCaptureResponse'
  | 'imageConnectionId' | 'imageModelOverride' | 'naiSettings'>;
export type RuntimeConfig = Pick<DisplaySnapshot, 'configVersion' | 'chatId' | 'characterId' | 'scriptstateDefaults'
  | 'screenWidth' | 'screenHeight' | 'legacyMediaFindings' | 'modulesByNamespace' | 'compiledLibraries'
  | 'hasEditDisplayLua' | 'hasEditAtActions' | 'luaTriggers' | 'atActions'> & {
    readonly togglePreferences: Record<string, string> | null;
    readonly presetToggles: Readonly<Record<string, string>>;
    readonly moduleLorebooks: readonly unknown[];
    readonly attachedModuleWorldBookIds: readonly string[];
    readonly character: Pick<DisplaySnapshot['character'], 'jailbreakPrompt' | 'globalNote' | 'authorsNote' | 'additionalAssets' | 'emotionImages'>;
  };
export interface RuntimeBootstrap { state: RuntimeStateDto; snapshot: RuntimeConfig; settings: RuntimeSettings; hostSupport: NonNullable<HostApi['hostSupport']> }
export type RuntimeService =
  | { kind: 'lore.resolve'; reserveTokens?: number }
  | { kind: 'lore.createCharacter'; entry: Record<string, unknown> }
  | { kind: 'bootstrap' }
  | { kind: 'state.read' }
  | { kind: 'state.write'; command: RuntimeStateCommand; mutationId: string }
  | { kind: 'llm.generate'; request: Parameters<NonNullable<HostApi['llm']>['generate']>[0] }
  | { kind: 'connections.list' }
  | { kind: 'tokens.count'; text: string }
  | { kind: 'image.generate'; prompt: string; options?: Parameters<NonNullable<HostApi['imageGen']>['generate']>[1] }
  | { kind: 'image.upload'; dataUrl: string; name?: string }
  | { kind: 'request'; url: string }
  | { kind: 'chat.inject'; id: string; content: string; options?: Parameters<HostApi['chat']['inject']>[2] };

export function runtimeMessage(message: RuntimeMessageDto): HostMessage {
  const luaData = hostLuaMessageData(message);
  return { id: message.id, content: message.content, ...(luaData ? { luaData } : {}),
    role: message.role ?? (message.is_user ? 'user' : message.extra?.spindle_role === 'system' ? 'system' : 'assistant'),
    createdAt: hostMessageTime(message),
    ...(message.name ? { speaker: message.name } : {}),
    ...(typeof message.extra?.greeting_index === 'number' ? { greetingIndex: message.extra.greeting_index } : {}) };
}
export function runtimeCharacter(value: RuntimeStateDto['character']): HostCharacter {
  return { ...value, name: String(value.name ?? ''), description: String(value.description ?? ''),
    firstMessage: String(value.first_mes ?? ''), worldBookIds: value.world_book_ids as string[] ?? [], imageId: value.image_id as string | null ?? null };
}
export function runtimePersona(value: RuntimeStateDto['persona']): HostPersona | null {
  return value ? { ...value, name: String(value.name ?? ''), description: String(value.description ?? ''), imageId: value.image_id as string | null ?? null } : null;
}
export function runtimeLore(value: RuntimeStateDto['lore'][number]): HostWorldInfoEntry {
  return { ...value, worldBookId: String(value.world_book_id ?? ''), orderValue: Number(value.order_value ?? 0) };
}
