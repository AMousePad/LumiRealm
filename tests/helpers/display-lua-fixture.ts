import type { DisplaySnapshot } from '../../src/display/snapshot.js';

export const chatId = 'lua-display-parity';
export const context = {
  chatId, characterId: 'character', messageId: 'user-message',
  messageIndex: 1, isUser: true, depth: 0,
};

export function snapshot(code: string): DisplaySnapshot {
  return {
    chatId, characterId: 'character', userName: 'User', charName: 'Character',
    personaText: '', personaImage: '', personaImageId: null, chatAuthorsNote: null,
    character: {
      description: 'Description', personality: '', scenario: '', exampleDialogue: '',
      mainPrompt: '', postHistoryInstructions: '', creatorNotes: '', jailbreakPrompt: '',
      globalNote: '', authorsNote: '', firstMessage: 'Greeting', alternateGreetings: [],
      selectedAlternateGreetingIndex: -1, additionalAssets: {}, emotionImages: {},
      image: '', imageId: null,
    },
    chat: {
      messageCount: 2, lastMessage: 'Hello', lastUserMessage: 'Hello',
      lastCharMessage: 'Greeting', lastMessageId: 1,
      messages: [{ role: 'user', content: 'Hello', createdAt: 1700000000000 }],
    },
    vars: { local: { nested: '{{char}}', x: '2' }, global: {}, chat: {} },
    scriptstateDefaults: {}, screenWidth: 1280, screenHeight: 720,
    legacyMediaFindings: false, modulesByNamespace: {}, lorebook: [],
    hasEditDisplayLua: true, hasEditAtActions: false,
    luaTriggers: [{
      source: { type: 'manual', comment: '', conditions: [], effect: [{ type: 'triggerlua' }] },
      luaCode: code,
    }],
    messagesHost: [
      { id: 'greeting', role: 'assistant', content: 'Greeting' },
      { id: 'user-message', role: 'user', content: 'Hello', createdAt: 1700000000000 },
    ],
    lorebookHost: [], atActions: [], compiledLibraries: [],
  };
}
