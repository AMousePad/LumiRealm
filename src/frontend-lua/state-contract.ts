import type { StateRevision } from './ordered-state.js';
import type { HostApi, HostMessage, HostCharacter, HostPersona, HostWorldInfoEntry } from '../interpreter/host.js';
import type { DisplaySnapshot } from '../display/snapshot.js';
import type { RisuCompatSettings } from '../state/settings-store.js';
import { hostMessageTime } from '../util/message-time.js';

export interface RuntimeMessageDto {
  id: string; content: string; role?: string; is_user?: boolean; name?: string;
  index_in_chat: number; created_at?: number; send_date?: number;
  extra?: { greeting_index?: number; spindle_role?: string };
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
  | { kind: 'chat.metadata'; key: string; value: unknown }
  | { kind: 'chat.variables'; values: Record<string, string | null> }
  | { kind: 'message.edit'; id: string; content: string }
  | { kind: 'message.delete'; id: string }
  | { kind: 'message.create'; id: string; content: string; role: string }
  | { kind: 'character.update'; id: string; patch: { name?: string; description?: string; first_mes?: string } }
  | { kind: 'persona.update'; id: string; patch: { name?: string; description?: string } }
  | { kind: 'lore.create'; bookId: string; patch: Record<string, unknown> }
  | { kind: 'lore.update'; id: string; patch: Record<string, unknown> }
  | { kind: 'lore.delete'; id: string };

export type RuntimeSettings = Pick<RisuCompatSettings, 'auxConnectionId' | 'auxModelOverride' | 'auxSamplers' | 'auxPrefillCompat'
  | 'submodelConnectionId' | 'submodelModelOverride' | 'submodelSamplers' | 'submodelPrefillCompat' | 'auxDebugCaptureRequest' | 'auxDebugCaptureResponse'>;
export interface RuntimeBootstrap { state: RuntimeStateDto; snapshot: DisplaySnapshot; settings: RuntimeSettings }
export type RuntimeService =
  | { kind: 'bootstrap' }
  | { kind: 'state.read' }
  | { kind: 'state.write'; command: RuntimeStateCommand; mutationId: string }
  | { kind: 'llm.generate'; request: Parameters<NonNullable<HostApi['llm']>['generate']>[0] }
  | { kind: 'connections.list' }
  | { kind: 'tokens.count'; text: string }
  | { kind: 'chat.inject'; id: string; content: string; options?: Parameters<HostApi['chat']['inject']>[2] };

export function runtimeMessage(message: RuntimeMessageDto): HostMessage {
  return { id: message.id, content: message.content,
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
