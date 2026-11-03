import { expect, test } from 'bun:test';
import type { ActiveCard } from '../../src/interpreter/dispatch';
import type { BackendToFrontend } from '../../src/types/messages';
import { createCharacterModuleAttach } from '../../src/state/character-module-attach';
import { createVariablesTogglesService } from '../../src/state/variables-toggles';
import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly';
import { VariableStateStore } from '../../src/state/variables-state';
import { ToggleStateStore } from '../../src/state/toggle-state';

test('module invalidation publishes changed lore for the visible owner chat', async () => {
  const globals = globalThis as unknown as { spindle?: unknown };
  const original = globals.spindle;
  globals.spindle = { userStorage: { getJson: async () => ({}) }, chats: { get: async () => ({ metadata: {} }) } };
  const active = (content?: string): ActiveCard => ({
    chatId: 'visible', ownerUserId: 'owner', lumirealm: { user_overrides: {} },
    card: { character_id: 'character', asset_index: {}, emotion_index: {}, risuPayload: {
      triggers: [], lua_scripts: [], at_actions: [], scriptstate_defaults: {},
      extra: { runtime_module_lorebooks: content === undefined ? {} : {
        global: [{ comment: 'library', key: 'library', content, worldBookId: 'module-book' }],
      } },
    } },
  } as unknown as ActiveCard);
  let current = active('original');
  const other = { ...current, ownerUserId: 'other' };
  const cache = new Map([['visible', current], ['hidden', current], ['other-chat', other]]);
  const sent: BackendToFrontend[] = [];
  const reactivations: string[] = [];
  let finished = Promise.withResolvers<void>();
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected module mutation'); };
  const log = { info() {}, warn() {}, debug() {} };
  const variableState = new VariableStateStore(), toggleState = new ToggleStateStore();
  const ensureActiveCardForChat = async (chatId: string) => {
    reactivations.push(chatId); cache.set(chatId, current); return current;
  };
  const variables = createVariablesTogglesService({
    translateLang: 'en', variableState, toggleState,
    readLumirealm: async () => ({ data: current.lumirealm }), readAttachedModuleEnvelopes: async () => [],
    ensureActiveCardForChat, refreshBgHtml: async () => {},
    send: message => { sent.push(message); },
    pushDisplaySnapshot: (value, chatId, userId) => { sent.push({ type: 'display_snapshot', snapshot: { ...assembleRuntimeConfig({
      modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false, getCompiledLibraries: () => [],
    }, value, chatId, userId), togglePreferences: null, presetToggles: {} } }); },
    log, errMsg: String,
  });
  const attach = createCharacterModuleAttach({
    readLumirealm: unexpected, updateLumirealm: unexpected, readModuleEnvelope: unexpected,
    listLumirealmCharacters: unexpected, addWorldBookToCharacter: unexpected, removeWorldBookFromCharacter: unexpected,
    dispatchModuleArtifactInstall: unexpected, refreshRisuAssetMap: unexpected,
    activeCardByChat: cache, compiledByCharacter: new Map(), lastSentBgHtmlByChat: new Map(), variableState, toggleState,
    ensureActiveCardForChat, refreshToggleDefinitions: variables.refreshToggleDefinitions,
    refreshVariables: variables.refreshVariables,
    refreshBgHtml: async () => { finished.resolve(); },
    send: message => { sent.push(message); }, visibleChatForUser: () => 'visible', log, errMsg: String,
  });
  try {
    for (const content of ['edited', undefined, 're-enabled']) {
      current = active(content);
      finished = Promise.withResolvers<void>();
      attach.invalidateActiveForCharacter('character', 'owner');
      await finished.promise;
      const snapshots = sent.filter(message => message.type === 'display_snapshot');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.snapshot.moduleLorebooks).toEqual(content === undefined ? [] : [
        { comment: 'library', key: 'library', content, worldBookId: 'module-book' },
      ]);
      expect(snapshots[0]!.snapshot.chatId).toBe('visible');
      sent.length = 0;
    }
    expect(reactivations).toEqual(['visible', 'visible', 'visible']);
    expect(cache.has('hidden')).toBe(false);
    expect(cache.get('other-chat')).toBe(other);
  } finally {
    if (original === undefined) delete globals.spindle;
    else globals.spindle = original;
  }
});
