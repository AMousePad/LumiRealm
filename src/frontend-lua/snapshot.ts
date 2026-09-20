import type { DisplaySnapshot } from '../display/snapshot.js';
import type { FrontendRuntimeState } from './state.js';
import { buildDisplayChatState } from '../state/display-snapshot-assembly.js';
import { buildRisuChatView } from '../interpreter/risu-chat-view.js';
import { toRisuFirstMessageIndex } from '../interpreter/greeting-index.js';
import { imageUrlFromId } from '../interpreter/image-cache.js';
import { lumiEntryToRisuLore } from '../state/lorebook-fetch.js';
import type { WorldBookEntryDTO } from 'lumiverse-spindle-types';

export function runtimeDisplaySnapshot(config: DisplaySnapshot, state: FrontendRuntimeState): DisplaySnapshot {
  const character = state.character();
  const persona = state.persona();
  const messagesHost = state.hostMessages();
  const view = buildRisuChatView({ messages: messagesHost });
  const note = state.metadata('authors_note');
  const { selectedGreeting: _greeting, ...configCharacter } = config.character;
  const lorebookHost = state.lore();
  return {
    ...config, charName: character.name ?? '', userName: persona?.name ?? '', personaText: persona?.description ?? '',
    personaImageId: persona?.imageId ?? null, personaImage: imageUrlFromId(persona?.imageId) ?? '',
    chatAuthorsNote: note && typeof note === 'object' ? note as DisplaySnapshot['chatAuthorsNote'] : null,
    character: {
      ...configCharacter, description: character.description ?? '', firstMessage: character.firstMessage ?? '',
      personality: String(character.personality ?? ''), scenario: String(character.scenario ?? ''),
      exampleDialogue: String(character.mes_example ?? ''), mainPrompt: String(character.system_prompt ?? ''),
      postHistoryInstructions: String(character.post_history_instructions ?? ''), creatorNotes: String(character.creator_notes ?? ''),
      alternateGreetings: character.alternate_greetings as string[] ?? [],
      imageId: character.imageId ?? null, image: imageUrlFromId(character.imageId) ?? '',
      selectedAlternateGreetingIndex: toRisuFirstMessageIndex(state.metadata('activeGreetingIndex') as number | undefined ?? view.greetingIndex),
      ...(view.greeting !== undefined ? { selectedGreeting: view.greeting } : {}),
    },
    messagesHost, chat: buildDisplayChatState(messagesHost),
    vars: { local: state.variables(), global: state.globalVariables(), chat: {} },
    lorebookHost, lorebook: lorebookHost.map(entry => lumiEntryToRisuLore(entry as unknown as WorldBookEntryDTO)),
  };
}
