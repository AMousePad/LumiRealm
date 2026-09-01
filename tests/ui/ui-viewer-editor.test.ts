/**
 * Pin viewer-tab editor flows for trigger Lua + background HTML.
 *
 * Trigger Lua editing:
 *   - "Edit lua" button on each trigger row swaps to a textarea.
 *   - Save fires `set_trigger_lua` with correct source + index + lua.
 *   - Cancel resets without sending.
 *   - Editor lands on `viewer_data_pushed` (handled implicitly by
 *     commit-* clearing the editor flags before the WS send).
 *
 * Background HTML editing (character-only):
 *   - "Edit bg-html" button swaps to textarea.
 *   - Save fires `set_background_html`.
 *   - Clear (after confirm) sets html=null.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Window } from 'happy-dom';
import { mountViewerPanel } from '../../src/ui/viewer-tab.js';
import type {
  BackendToFrontend,
  FrontendToBackend,
  ViewerData,
} from '../../src/types/messages.js';

let window: Window;
let originalDocument: Document | undefined;
let originalGlobalConfirm: typeof globalThis.confirm | undefined;

beforeEach(() => {
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
  originalGlobalConfirm = (globalThis as unknown as { confirm?: typeof confirm }).confirm;
  (globalThis as unknown as { confirm: () => boolean }).confirm = () => true;
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
  if (originalGlobalConfirm === undefined) {
    delete (globalThis as unknown as { confirm?: typeof confirm }).confirm;
  } else {
    (globalThis as unknown as { confirm: typeof confirm }).confirm = originalGlobalConfirm;
  }
});

function buildAndSeedCharacter(name = 'Reimu'): {
  root: HTMLElement;
  send: ReturnType<typeof mock>;
  panel: ReturnType<typeof mountViewerPanel>;
  pushChar: (data: Partial<ViewerData>) => void;
  /** Click a sub-tab by label prefix; throws if not found. */
  clickTab: (labelPrefix: string) => void;
} {
  const root = window.document.createElement('div') as unknown as HTMLElement;
  (window.document.body as unknown as { appendChild(n: unknown): void }).appendChild(root);
  const send = mock((_msg: FrontendToBackend) => {});
  const panel = mountViewerPanel({
    root,
    sendToBackend: send,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
  });
  panel.handleBackendMessage({
    type: 'cards_updated',
    cards: [
      { character_id: 'c1', character_name: name, translator_version: 'v1', uses_lua: true, stored_at: 1 },
    ],
  } as BackendToFrontend);
  const pushChar = (over: Partial<ViewerData>): void => {
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'character', characterId: 'c1', name },
        lorebook: [], regex: [], triggers: [], assets: [],
        cjs: null, backgroundHtml: null,
        ts: 1, defaultVariablesText: "", defaultVariablesUserEdited: false, fetchWarnings: [],
        ...over,
      },
    } as BackendToFrontend);
  };
  const clickTab = (labelPrefix: string): void => {
    const tab = Array.from(root.querySelectorAll('.lrv-subtab'))
      .find((b) => (b.textContent ?? '').trim().startsWith(labelPrefix)) as HTMLButtonElement | undefined;
    if (!tab) throw new Error(`subtab "${labelPrefix}" not found`);
    tab.click();
  };
  return { root, send, panel, pushChar, clickTab };
}

// ─── Trigger Lua editor ────────────────────────────────────────────────

describe('Viewer editor — trigger Lua', () => {
  test('"Edit lua" button renders for each trigger', () => {
    const { root, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({
      triggers: [
        { id: 't0', name: 'btn', bindingType: 'manual', lua: 'print("hi")', effectCount: 1, effects: [] },
        { id: 't1', name: 'auto', bindingType: 'start', lua: null, effectCount: 1, effects: [] },
      ],
    });
    // Open the Triggers section (it's collapsed by default).
    clickTab('Triggers');
    const triggersDet = root.querySelector('.lrv-section') as HTMLDetailsElement;
    if (triggersDet) triggersDet.open = true;
    // Open per-trigger lua details too — they're collapsed by default.
    for (const luaDet of Array.from(root.querySelectorAll('.lrv-trigger-lua'))) {
      (luaDet as HTMLDetailsElement).open = true;
    }
    const btns = Array.from(root.querySelectorAll('button'))
      .filter((b) => (b as HTMLElement).textContent === 'Edit lua' || (b as HTMLElement).textContent === 'Add lua');
    expect(btns.length).toBe(2);
  });

  test('clicking Edit lua swaps to textarea with current lua content', () => {
    const { root, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({
      triggers: [
        { id: 't0', name: 'btn', bindingType: 'manual', lua: 'print("hi")', effectCount: 1, effects: [] },
      ],
    });
    clickTab('Triggers');
    const triggersDet = root.querySelector('.lrv-section') as HTMLDetailsElement;
    if (triggersDet) triggersDet.open = true;
    const luaDet = root.querySelector('.lrv-trigger-lua') as HTMLDetailsElement;
    luaDet.open = true;
    const editBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Edit lua') as HTMLButtonElement;
    editBtn.click();
    const ta = root.querySelector('.lrv-trigger-textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe('print("hi")');
  });

  test('Save fires set_trigger_lua with character source + correct index', () => {
    const { root, send, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({
      triggers: [
        { id: 't0', name: 'A', bindingType: 'manual', lua: 'old-A', effectCount: 1, effects: [] },
        { id: 't1', name: 'B', bindingType: 'manual', lua: 'old-B', effectCount: 1, effects: [] },
      ],
    });
    clickTab('Triggers');
    const triggersDet = root.querySelector('.lrv-section') as HTMLDetailsElement;
    if (triggersDet) triggersDet.open = true;
    const luaDets = Array.from(root.querySelectorAll('.lrv-trigger-lua'));
    for (const d of luaDets) (d as HTMLDetailsElement).open = true;
    // Click Edit on the SECOND trigger.
    const editBtns = Array.from(root.querySelectorAll('button'))
      .filter((b) => (b as HTMLElement).textContent === 'Edit lua') as HTMLButtonElement[];
    editBtns[1]!.click();
    const ta = root.querySelector('.lrv-trigger-textarea') as HTMLTextAreaElement;
    ta.value = 'new-B';
    (ta as unknown as { dispatchEvent(e: unknown): boolean })
      .dispatchEvent(new window.Event('input'));
    const saveBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const setCall = calls.find((c) => c[0]!.type === 'set_trigger_lua');
    expect(setCall).toBeDefined();
    expect(setCall![0]).toEqual({
      type: 'set_trigger_lua',
      source: { kind: 'character', characterId: 'c1' },
      triggerIndex: 1,
      lua: 'new-B',
    });
  });

  test('Cancel does NOT send + closes editor', () => {
    const { root, send, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({
      triggers: [
        { id: 't0', name: 'A', bindingType: 'manual', lua: 'x', effectCount: 1, effects: [] },
      ],
    });
    clickTab('Triggers');
    const triggersDet = root.querySelector('.lrv-section') as HTMLDetailsElement;
    if (triggersDet) triggersDet.open = true;
    const luaDet = root.querySelector('.lrv-trigger-lua') as HTMLDetailsElement;
    luaDet.open = true;
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Edit lua') as HTMLButtonElement).click();
    expect(root.querySelector('.lrv-trigger-textarea')).not.toBeNull();
    const cancelBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Cancel') as HTMLButtonElement;
    cancelBtn.click();
    expect(root.querySelector('.lrv-trigger-textarea')).toBeNull();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    expect(calls.find((c) => c[0]!.type === 'set_trigger_lua')).toBeUndefined();
  });

  test('"Add lua" surfaces when trigger has no lua initially', () => {
    const { root, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({
      triggers: [
        { id: 't0', name: 'noLua', bindingType: 'manual', lua: null, effectCount: 1, effects: [] },
      ],
    });
    clickTab('Triggers');
    const triggersDet = root.querySelector('.lrv-section') as HTMLDetailsElement;
    if (triggersDet) triggersDet.open = true;
    const luaDet = root.querySelector('.lrv-trigger-lua') as HTMLDetailsElement;
    luaDet.open = true;
    const addBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Add lua') as HTMLButtonElement;
    expect(addBtn).toBeDefined();
  });

  test('module source routes set_trigger_lua with module discriminator', () => {
    const root = window.document.createElement('div') as unknown as HTMLElement;
    (window.document.body as unknown as { appendChild(n: unknown): void }).appendChild(root);
    const send = mock((_msg: FrontendToBackend) => {});
    const panel = mountViewerPanel({
      root,
      sendToBackend: send,
      log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
    });
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-A', name: 'M', description: '', filename: 'a.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 1,
        asset_count: 0, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'module', moduleId: 'mod-A', name: 'M' },
        lorebook: [], regex: [],
        triggers: [{ id: 'mt0', name: 't', bindingType: 'manual', lua: 'x', effectCount: 1, effects: [] }],
        assets: [], cjs: null, backgroundHtml: null,
        ts: 1, defaultVariablesText: "", defaultVariablesUserEdited: false, fetchWarnings: [],
      },
    } as BackendToFrontend);
    (Array.from(root.querySelectorAll('.lrv-subtab'))
      .find((b) => (b.textContent ?? '').startsWith('Triggers')) as HTMLButtonElement).click();
    const triggersDet = root.querySelector('.lrv-section') as HTMLDetailsElement;
    if (triggersDet) triggersDet.open = true;
    const luaDet = root.querySelector('.lrv-trigger-lua') as HTMLDetailsElement;
    luaDet.open = true;
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Edit lua') as HTMLButtonElement).click();
    const ta = root.querySelector('.lrv-trigger-textarea') as HTMLTextAreaElement;
    ta.value = 'edited';
    (ta as unknown as { dispatchEvent(e: unknown): boolean })
      .dispatchEvent(new window.Event('input'));
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Save') as HTMLButtonElement).click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const c = calls.find((c) => c[0]!.type === 'set_trigger_lua')!;
    expect((c[0] as { source: unknown }).source).toEqual({ kind: 'module', moduleId: 'mod-A' });
  });
});

// ─── Background HTML editor (character-only) ───────────────────────────

describe('Viewer editor — background HTML', () => {
  test('textarea surfaces seeded with current bg-html', () => {
    const { root, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({ backgroundHtml: '<style>body{color:red}</style>' });
    clickTab('HTML');
    const ta = root.querySelector('.lrv-defaults-textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ta.value).toBe('<style>body{color:red}</style>');
  });

  test('Save fires set_background_html with characterId + non-null html', () => {
    const { root, send, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({ backgroundHtml: '<old/>' });
    clickTab('HTML');
    const ta = root.querySelector('.lrv-defaults-textarea') as HTMLTextAreaElement;
    ta.value = '<new/>';
    (ta as unknown as { dispatchEvent(e: unknown): boolean })
      .dispatchEvent(new window.Event('input'));
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Save') as HTMLButtonElement).click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const c = calls.find((c) => c[0]!.type === 'set_background_html')!;
    expect(c[0]).toEqual({
      type: 'set_background_html',
      characterId: 'c1',
      html: '<new/>',
    });
  });

  test('Reset to card defaults (after confirm) fires set_background_html with html=null', () => {
    const { root, send, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({ backgroundHtml: '<old/>' });
    clickTab('HTML');
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Reset to card defaults') as HTMLButtonElement).click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const c = calls.find((c) => c[0]!.type === 'set_background_html')!;
    expect(c[0]).toEqual({
      type: 'set_background_html',
      characterId: 'c1',
      html: null,
    });
  });

  test('Revert discards unsaved edits without sending', () => {
    const { root, send, pushChar, clickTab } = buildAndSeedCharacter();
    pushChar({ backgroundHtml: '<old/>' });
    clickTab('HTML');
    const ta = root.querySelector('.lrv-defaults-textarea') as HTMLTextAreaElement;
    ta.value = '<unsaved/>';
    (ta as unknown as { dispatchEvent(e: unknown): boolean })
      .dispatchEvent(new window.Event('input'));
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Revert') as HTMLButtonElement).click();
    const ta2 = root.querySelector('.lrv-defaults-textarea') as HTMLTextAreaElement;
    expect(ta2.value).toBe('<old/>');
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    expect(calls.find((c) => c[0]!.type === 'set_background_html')).toBeUndefined();
  });
});
