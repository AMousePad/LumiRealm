/**
 * Pin behaviour of the unified Lumirealm sidebar:
 *   - Registers exactly ONE drawer tab via ctx.ui.registerDrawerTab
 *   - Renders nav buttons for each sub-tab
 *   - Lazy-mounts non-cards panels on first activation
 *   - Cards panel is pre-mounted (its get_cards round-trip seeds the
 *     cards list that other panels also need)
 *   - Broadcasts handleBackendMessage to every mounted panel
 *   - setActiveChatId fans out to panels exposing setActiveChatId
 *   - destroy() tears down every panel + the drawer tab
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Window } from 'happy-dom';
import { createSidebar, type SidebarHandle, type SidebarTabId } from '../../src/ui/sidebar.js';
import type { BackendToFrontend, FrontendToBackend } from '../../src/types/messages.js';

let window: Window;
let originalDocument: Document | undefined;

beforeEach(() => {
  // Build a fresh happy-dom window per test so DOM state doesn't bleed.
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  // The UI modules touch document/window directly. Wire happy-dom's
  // window into the global so document.createElement etc. work.
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

interface FakeTab {
  id: string;
  root: HTMLElement;
  destroyed: boolean;
}

interface FakeCtx {
  registeredTabs: FakeTab[];
  ui: {
    registerDrawerTab(input: { id: string; title: string }): {
      root: HTMLElement;
      destroy(): void;
    };
  };
  uploads?: { pickFile(): Promise<unknown> };
  dom?: { addStyle(): () => void };
  // The sidebar uses the wider SpindleFrontendContext shape; we cast to
  // unknown to satisfy the signature without pulling the real types.
}

function buildFakeCtx(): FakeCtx {
  const registeredTabs: FakeTab[] = [];
  return {
    registeredTabs,
    ui: {
      registerDrawerTab(input) {
        const root = window.document.createElement('div');
        const tab: FakeTab = { id: input.id, root: root as unknown as HTMLElement, destroyed: false };
        registeredTabs.push(tab);
        // Attach the host so descendants can walk parent etc.
        window.document.body.appendChild(root);
        return {
          root: root as unknown as HTMLElement,
          destroy() { tab.destroyed = true; },
        };
      },
    },
    uploads: { pickFile: () => Promise.resolve(null) },
    dom: { addStyle: () => () => {} },
  };
}

function buildLog(): {
  info: ReturnType<typeof mock>;
  warn: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
  debug: ReturnType<typeof mock>;
  trace: ReturnType<typeof mock>;
} {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    trace: mock(() => {}),
  };
}

function build(): {
  ctx: FakeCtx;
  send: ReturnType<typeof mock>;
  log: ReturnType<typeof buildLog>;
  sidebar: SidebarHandle;
  tab: FakeTab;
} {
  const ctx = buildFakeCtx();
  const send = mock((_msg: FrontendToBackend) => {});
  const log = buildLog();
  const sidebar = createSidebar({
    ctx: ctx as unknown as Parameters<typeof createSidebar>[0]['ctx'],
    sendToBackend: send,
    log,
  });
  return { ctx, send, log, sidebar, tab: ctx.registeredTabs[0]! };
}

describe('createSidebar — drawer tab registration', () => {
  test('registers exactly one drawer tab with id="lumirealm"', () => {
    const { ctx } = build();
    expect(ctx.registeredTabs.length).toBe(1);
    expect(ctx.registeredTabs[0]!.id).toBe('lumirealm');
  });

  test('initial sub-tab is "cards" (default)', () => {
    const { sidebar } = build();
    expect(sidebar.getActiveSubTab()).toBe('import');
  });

  test('initialTab override is honored', () => {
    const ctx = buildFakeCtx();
    const sidebar = createSidebar({
      ctx: ctx as unknown as Parameters<typeof createSidebar>[0]['ctx'],
      sendToBackend: mock(() => {}),
      log: buildLog(),
      initialTab: 'settings',
    });
    expect(sidebar.getActiveSubTab()).toBe('settings');
  });
});

describe('createSidebar — sub-tab nav rendering', () => {
  test('renders nav buttons for every sub-tab in order', () => {
    const { tab } = build();
    const buttons = tab.root.querySelectorAll('.lr-sidebar-nav-btn');
    const labels = Array.from(buttons).map((b) => (b as HTMLElement).textContent);
    expect(labels).toEqual(['Import', 'Viewer', 'State', 'Settings']);
  });

  test('initial nav state marks "Import" as active', () => {
    const { tab } = build();
    const btns = Array.from(tab.root.querySelectorAll('.lr-sidebar-nav-btn'));
    const importBtn = btns.find((b) => (b as HTMLElement).textContent === 'Import') as HTMLElement;
    const settings = btns.find((b) => (b as HTMLElement).textContent === 'Settings') as HTMLElement;
    expect(importBtn.classList.contains('lr-sidebar-nav-btn-active')).toBe(true);
    expect(settings.classList.contains('lr-sidebar-nav-btn-active')).toBe(false);
    expect(importBtn.getAttribute('aria-selected')).toBe('true');
    expect(settings.getAttribute('aria-selected')).toBe('false');
  });

  test('clicking a nav button activates that sub-tab + un-marks the previous', () => {
    const { sidebar, tab } = build();
    const btns = Array.from(tab.root.querySelectorAll('.lr-sidebar-nav-btn'));
    const settings = btns.find((b) => (b as HTMLElement).textContent === 'Settings') as HTMLElement;
    settings.click();
    expect(sidebar.getActiveSubTab()).toBe('settings');
    const importBtn = btns.find((b) => (b as HTMLElement).textContent === 'Import') as HTMLElement;
    expect(importBtn.classList.contains('lr-sidebar-nav-btn-active')).toBe(false);
    expect(settings.classList.contains('lr-sidebar-nav-btn-active')).toBe(true);
  });

  test('setActiveSubTab() programmatically activates', () => {
    const { sidebar, tab } = build();
    sidebar.setActiveSubTab('state');
    expect(sidebar.getActiveSubTab()).toBe('state');
    const stateBtn = Array.from(tab.root.querySelectorAll('.lr-sidebar-nav-btn'))
      .find((b) => (b as HTMLElement).textContent === 'State') as HTMLElement;
    expect(stateBtn.classList.contains('lr-sidebar-nav-btn-active')).toBe(true);
  });
});

describe('createSidebar — panel host visibility', () => {
  test('only the active panel host is visible (others have hidden)', () => {
    const { sidebar, tab } = build();
    const hosts = Array.from(tab.root.querySelectorAll('.lr-sidebar-panel'));
    const get = (id: SidebarTabId): HTMLElement =>
      hosts.find((h) => (h as HTMLElement).dataset['subtab'] === id) as HTMLElement;
    expect(get('import').hidden).toBe(false);
    expect(get('settings').hidden).toBe(true);
    expect(get('state').hidden).toBe(true);
    sidebar.setActiveSubTab('state');
    expect(get('import').hidden).toBe(true);
    expect(get('state').hidden).toBe(false);
  });
});

describe('createSidebar — lazy panel mount', () => {
  test('import panel is pre-mounted at sidebar creation (its host has rendered content)', () => {
    const { tab } = build();
    // The Import panel mounts the modules-tab (Characters dropdown +
    // Module library), and injects the cards-panel (Upload card button +
    // status/progress) into a slot inside the Characters dropdown.
    const importHost = Array.from(tab.root.querySelectorAll('.lr-sidebar-panel'))
      .find((h) => (h as HTMLElement).dataset['subtab'] === 'import') as HTMLElement;
    expect(importHost.classList.contains('lr-modules-drawer')).toBe(true);
    expect(importHost.querySelector('.lrm-character-header-slot')).not.toBeNull();
    expect(importHost.querySelector('.lrm-btn-primary')).not.toBeNull();
  });

  test('non-import panels mount only after first activation', () => {
    const { sidebar, send, tab } = build();
    // Settings panel sends `request_settings` + `request_connections_list`
    // on mount. Before activation, neither has been sent.
    const initialCalls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .map((c) => c[0]!.type);
    expect(initialCalls).not.toContain('request_settings');
    // Settings host should be empty before mount.
    const settingsHost = Array.from(tab.root.querySelectorAll('.lr-sidebar-panel'))
      .find((h) => (h as HTMLElement).dataset['subtab'] === 'settings') as HTMLElement;
    expect(settingsHost.children.length).toBe(0);
    sidebar.setActiveSubTab('settings');
    const afterCalls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .map((c) => c[0]!.type);
    expect(afterCalls).toContain('request_settings');
    // Settings host now has content.
    expect(settingsHost.children.length).toBeGreaterThan(0);
  });

  test('re-activating a previously-mounted panel does NOT re-mount', () => {
    const { sidebar, send } = build();
    sidebar.setActiveSubTab('settings');
    const mid = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls.length;
    sidebar.setActiveSubTab('import');
    sidebar.setActiveSubTab('settings');
    const after = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls.length;
    // No new request_settings — the panel was kept alive in the background.
    const newRequestSettings = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .slice(mid)
      .filter((c) => c[0]!.type === 'request_settings');
    expect(newRequestSettings.length).toBe(0);
    expect(after).toBeGreaterThanOrEqual(mid);
  });
});

describe('createSidebar — backend message broadcast', () => {
  test('messages are broadcast to all mounted panels (not just the active one)', () => {
    const { sidebar, tab } = build();
    // Vars panel filters by activeChatId — so set the chat first so its
    // snapshot-render path actually runs against the incoming push.
    sidebar.setActiveSubTab('state');
    sidebar.setActiveChatId('chat-X');
    // Switch back to cards so vars is hidden but mounted.
    sidebar.setActiveSubTab('import');
    // Now push a set_variables message for chat-X.
    sidebar.handleBackendMessage({
      type: 'set_variables',
      chatId: 'chat-X',
      seq: 1,
      scopes: { local: { broadcastedKey: 'bar' }, global: {}, chat: {} },
      defaults: {},
      ts: 1,
    } as BackendToFrontend);
    // Vars panel should have processed the message even though its host is
    // hidden. Post-Phase-B Variables tab nests Default/Local/Lumi sub-sub-
    // tabs; the active sub-sub-tab is Default, so the key NAME is in the
    // Local pane's DOM but not currently visible. The status line's scope
    // counts (`local=N`) reflect the broadcast received unconditionally —
    // assert via the count rather than the rendered key text.
    const varsHost = Array.from(tab.root.querySelectorAll('.lr-sidebar-panel'))
      .find((h) => (h as HTMLElement).dataset['subtab'] === 'state') as HTMLElement;
    expect(varsHost.textContent).toContain('local=1');
  });
});

describe('createSidebar — setActiveChatId fan-out', () => {
  test('forwards to vars panel when mounted (vars sends request_variables_snapshot)', () => {
    const { sidebar, send } = build();
    sidebar.setActiveSubTab('state');
    const beforeLen = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls.length;
    sidebar.setActiveChatId('chat-9');
    const afterCalls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls.slice(beforeLen);
    const types = afterCalls.map((c) => c[0]!.type);
    expect(types).toContain('request_variables_snapshot');
  });

  test('caches active chat id so vars panel mounted later receives it', () => {
    const { sidebar, send } = build();
    // Sidebar starts on cards; vars not mounted yet.
    sidebar.setActiveChatId('chat-cached');
    // Mount vars — it should receive the cached chat id at mount time
    // and immediately request the snapshot.
    sidebar.setActiveSubTab('state');
    const types = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .map((c) => c[0]!.type);
    expect(types).toContain('request_variables_snapshot');
  });

  test('null clears (no throw)', () => {
    const { sidebar } = build();
    sidebar.setActiveSubTab('state');
    expect(() => sidebar.setActiveChatId(null)).not.toThrow();
  });
});

describe('createSidebar — destroy', () => {
  test('destroys the registered drawer tab', () => {
    const { sidebar, ctx } = build();
    sidebar.destroy();
    expect(ctx.registeredTabs[0]!.destroyed).toBe(true);
  });

  test('panels are torn down (their host roots cleared)', () => {
    const { sidebar, tab } = build();
    // Pre-mount a couple of panels so their destroy gets exercised.
    sidebar.setActiveSubTab('state');
    sidebar.setActiveSubTab('settings');
    sidebar.setActiveSubTab('import');
    sidebar.destroy();
    // After destroy, calling handleBackendMessage should be safe + no
    // panel re-renders the message (panels reference destroyed roots).
    // Sanity-check: panel hosts should be empty.
    for (const host of Array.from(tab.root.querySelectorAll('.lr-sidebar-panel'))) {
      expect((host as HTMLElement).children.length).toBe(0);
    }
  });
});
