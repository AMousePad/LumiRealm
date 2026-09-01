/**
 * Pin behaviour of the Modules sub-panel (`ui/modules-tab.ts`):
 *   - Mounts an intro + library section + characters section.
 *   - Renders module rows from `modules_pushed` with name + sub counts.
 *   - Renders character rows from `cards_updated`; each character
 *     details holds attached-module list + attach selector.
 *   - "Attach module" wires `attach_module` WS message.
 *   - "Detach" wires `detach_module`.
 *   - "Delete" wires `delete_module` after confirm.
 *   - Refresh button sends `request_modules`.
 *   - Initial mount sends `request_modules`.
 *   - error message surfaces in the status area.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Window } from 'happy-dom';
import { mountModulesPanel, type ModulesPanelHandle } from '../../src/ui/modules-tab.js';
import type { BackendToFrontend, FrontendToBackend, ModuleSummary } from '../../src/types/messages.js';

let window: Window;
let originalDocument: Document | undefined;
let originalGlobalConfirm: typeof globalThis.confirm | undefined;

beforeEach(() => {
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
  // happy-dom may not provide a global `confirm`; install a default
  // truthy one so the modules-panel's deletion path can be exercised.
  // The deletion test overrides per-call.
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

function build(): {
  root: HTMLElement;
  send: ReturnType<typeof mock>;
  panel: ModulesPanelHandle;
} {
  const root = window.document.createElement('div') as unknown as HTMLElement;
  (window.document.body as unknown as { appendChild(n: unknown): void }).appendChild(root);
  const send = mock((_msg: FrontendToBackend) => {});
  const panel = mountModulesPanel({
    root,
    sendToBackend: send,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
  });
  return { root, send, panel };
}

const M_REIMU: ModuleSummary = {
  id: 'mod-reimu',
  name: 'Touhou Reimu',
  description: 'Reimu broadcaster',
  filename: 'reimu.risum',
  uploaded_at: 100,
  lorebook_count: 3,
  regex_count: 5,
  trigger_count: 2,
  asset_count: 1,
  low_level_access: false,
  has_cjs: false,
};

const M_MARISA: ModuleSummary = {
  id: 'mod-marisa',
  name: 'Touhou Marisa',
  description: '',
  filename: 'marisa.risum',
  uploaded_at: 200,
  lorebook_count: 0,
  regex_count: 0,
  trigger_count: 0,
  asset_count: 0,
  low_level_access: true,
  has_cjs: true,
};

interface SsOption { readonly value: string; readonly label: string }

function ssPanel(triggerId: string): HTMLElement {
  const trigger = window.document.getElementById(triggerId) as unknown as HTMLButtonElement;
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  const panelId = trigger.getAttribute('aria-controls')!;
  return window.document.getElementById(panelId) as unknown as HTMLElement;
}

function ssReadOptions(triggerId: string): SsOption[] {
  const panel = ssPanel(triggerId);
  return Array.from(panel.querySelectorAll('.lr-ss-option')).map((el) => ({
    value: (el as Element).getAttribute('data-value') ?? '',
    label: (el as Element).querySelector('.lr-ss-option-label')?.textContent ?? '',
  }));
}

function ssPick(triggerId: string, value: string): void {
  const panel = ssPanel(triggerId);
  const opt = panel.querySelector(`.lr-ss-option[data-value="${value}"]`) as unknown as HTMLElement;
  opt.click();
}

describe('mountModulesPanel — initial state', () => {
  test('sends request_modules + get_cards on mount', () => {
    const { send } = build();
    const types = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .map((c) => c[0]!.type);
    expect(types).toContain('request_modules');
    // Bug regression: when the Modules tab is opened AFTER Cards
    // already consumed its `cards_updated` push, the Modules tab's
    // characters section would render "No Risu cards imported yet".
    // Mount-time `get_cards` re-fetches so the freshly-mounted tab
    // sees the character list.
    expect(types).toContain('get_cards');
  });

  test('renders Characters / Modules / Lorebooks / Regex subtabs', () => {
    // The 2026-05-04 UI restructure replaced the flat-section layout with
    // a subtab-per-section layout; the standalone `.lrm-intro` /
    // `.lrm-section` containers are gone. The Import tab exposes a subtab per
    // section as subnav buttons (`.lr-subtab`).
    const { root } = build();
    const subtabs = Array.from(root.querySelectorAll('.lr-subtab'))
      .map((t) => (t as HTMLElement).textContent ?? '');
    expect(subtabs).toEqual(['Characters', 'Modules', 'Lorebooks', 'Regex']);
    const bodies = root.querySelectorAll('.lrm-tab-body');
    expect(bodies.length).toBeGreaterThanOrEqual(2);
  });

  test('module picker advertises legacy RisuM and CharX module files', () => {
    const { root, panel } = build();
    const upload = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Upload .risum / .charx') as HTMLButtonElement;
    expect(upload).toBeDefined();
    expect(upload.title).toContain('.risum');
    expect(upload.title).toContain('CharX');

    upload.click();
    const input = window.document.querySelector('input[type="file"]') as unknown as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe('.risum,.charx');
    input.dispatchEvent(new window.Event('cancel') as unknown as Event);
    panel.destroy();
  });

  test('library shows "Loading…" until modules_pushed arrives', () => {
    const { root } = build();
    const libList = root.querySelector('.lrm-modules-list');
    expect(libList).not.toBeNull();
    const empty = libList!.querySelector('.lrm-empty');
    expect(empty).not.toBeNull();
    expect((empty as HTMLElement).textContent).toBe('Loading…');
  });
});

describe('mountModulesPanel — modules_pushed renders the library', () => {
  test('renders one collapsible row per module with name in summary', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU, M_MARISA],
      attached_by_character: {},
    } as BackendToFrontend);
    const rows = root.querySelectorAll('.lrm-module');
    expect(rows.length).toBe(2);
    const names = Array.from(root.querySelectorAll('.lrm-module-name'))
      .map((n) => (n as HTMLElement).textContent);
    expect(names).toContain('Touhou Reimu');
    expect(names).toContain('Touhou Marisa');
  });

  test('sub line in expanded body aggregates lore / regex / trigger / asset counts', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
    } as BackendToFrontend);
    // Expand to render the body.
    const det = root.querySelector('.lrm-module') as HTMLDetailsElement;
    det.open = true;
    const sub = root.querySelector('.lrm-module-sub') as HTMLElement;
    expect(sub.textContent).toBe('3 lore · 5 regex · 2 trigger · 1 asset');
  });

  test('module with no entries renders "(empty)" sub when expanded', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_MARISA],
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-module') as HTMLDetailsElement;
    det.open = true;
    const sub = root.querySelector('.lrm-module-sub') as HTMLElement;
    expect(sub.textContent).toBe('(empty)');
  });

  test('renders empty placeholder when zero modules', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [],
    } as BackendToFrontend);
    const empty = root.querySelector('.lrm-modules-list .lrm-empty');
    expect(empty).not.toBeNull();
    expect((empty as HTMLElement).textContent).toBe('No modules uploaded yet.');
  });

  test('attached count badge surfaces in module summary (no expand needed)', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C1', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
      attached_by_character: { c1: [{ id: 'mod-reimu', name: 'Touhou Reimu' }] },
    } as BackendToFrontend);
    const badge = root.querySelector('.lrm-module-attached-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('1 attached');
  });
});

describe('mountModulesPanel — character rows + attachment', () => {
  test('renders a character row per imported card', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
        { character_id: 'c2', character_name: 'Marisa', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    const names = Array.from(root.querySelectorAll('.lrm-character-name'))
      .map((n) => (n as HTMLElement).textContent);
    expect(names).toEqual(['Reimu', 'Marisa']);
  });

  test('shows attach selector listing modules NOT yet attached', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU, M_MARISA],
      attached_by_character: { c1: [] },
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-character') as HTMLDetailsElement;
    det.open = true;
    panel.handleBackendMessage({
      type: 'attached_modules_pushed',
      characterId: 'c1',
      attached: [],
    } as BackendToFrontend);
    const trigger = window.document.getElementById('lrm-attach-select-c1');
    expect(trigger).not.toBeNull();
    const opts = ssReadOptions('lrm-attach-select-c1');
    expect(opts.map((o) => o.value)).toContain('mod-reimu');
    expect(opts.map((o) => o.value)).toContain('mod-marisa');
    expect(opts.map((o) => o.label)).toContain('Touhou Reimu');
    expect(opts.map((o) => o.label)).toContain('Touhou Marisa');
  });

  test('attach button sends attach_module after picking a module from the selector', () => {
    const { panel, root, send } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
      attached_by_character: { c1: [] },
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-character') as HTMLDetailsElement;
    det.open = true;
    panel.handleBackendMessage({
      type: 'attached_modules_pushed',
      characterId: 'c1',
      attached: [],
    } as BackendToFrontend);
    ssPick('lrm-attach-select-c1', 'mod-reimu');
    const btn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Attach') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    const sendCalls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const attachCall = sendCalls.find((c) => c[0]!.type === 'attach_module');
    expect(attachCall).toBeDefined();
    expect(attachCall![0]).toEqual({
      type: 'attach_module',
      characterId: 'c1',
      moduleId: 'mod-reimu',
    });
  });

  test('attach selector item value is the module id (matches attach_module payload)', () => {
    const { panel, root, send } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
      attached_by_character: { c1: [] },
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-character') as HTMLDetailsElement;
    det.open = true;
    panel.handleBackendMessage({
      type: 'attached_modules_pushed',
      characterId: 'c1',
      attached: [],
    } as BackendToFrontend);
    const opts = ssReadOptions('lrm-attach-select-c1');
    expect(opts.find((o) => o.value === 'mod-reimu')).toBeDefined();
    ssPick('lrm-attach-select-c1', 'mod-reimu');
    const btn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Attach') as HTMLButtonElement;
    btn.click();
    const sendCalls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const attachCall = sendCalls.find((c) => c[0]!.type === 'attach_module');
    expect(attachCall![0]).toEqual({
      type: 'attach_module',
      characterId: 'c1',
      moduleId: 'mod-reimu',
    });
  });

  test('attach button stays disabled until a module is picked', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
      attached_by_character: { c1: [] },
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-character') as HTMLDetailsElement;
    det.open = true;
    panel.handleBackendMessage({
      type: 'attached_modules_pushed',
      characterId: 'c1',
      attached: [],
    } as BackendToFrontend);
    const btn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Attach') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    ssPick('lrm-attach-select-c1', 'mod-reimu');
    expect(btn.disabled).toBe(false);
  });

  test('detach button sends detach_module', () => {
    const { panel, root, send } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
      attached_by_character: { c1: [{ id: 'mod-reimu', name: 'Touhou Reimu' }] },
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-character') as HTMLDetailsElement;
    det.open = true;
    panel.handleBackendMessage({
      type: 'attached_modules_pushed',
      characterId: 'c1',
      attached: [{ id: 'mod-reimu', name: 'Touhou Reimu' }],
    } as BackendToFrontend);
    const detach = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Detach') as HTMLButtonElement;
    detach.click();
    const sendCalls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const detachCall = sendCalls.find((c) => c[0]!.type === 'detach_module');
    expect(detachCall).toBeDefined();
    expect(detachCall![0]).toEqual({
      type: 'detach_module',
      characterId: 'c1',
      moduleId: 'mod-reimu',
    });
  });

  test('shows "Every available module is already attached" when nothing left', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
      attached_by_character: { c1: [{ id: 'mod-reimu', name: 'Touhou Reimu' }] },
    } as BackendToFrontend);
    const det = root.querySelector('.lrm-character') as HTMLDetailsElement;
    det.open = true;
    panel.handleBackendMessage({
      type: 'attached_modules_pushed',
      characterId: 'c1',
      attached: [{ id: 'mod-reimu', name: 'Touhou Reimu' }],
    } as BackendToFrontend);
    const empties = Array.from(root.querySelectorAll('.lrm-character-empty'))
      .map((e) => (e as HTMLElement).textContent);
    expect(empties).toContain('Every available module is already attached.');
  });
});

describe('mountModulesPanel — delete module', () => {
  test('clicking Delete after confirm sends delete_module', () => {
    const { panel, root, send } = build();
    (globalThis as unknown as { confirm: () => boolean }).confirm = () => true;
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
    } as BackendToFrontend);
    const del = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Delete') as HTMLButtonElement;
    del.click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const delCall = calls.find((c) => c[0]!.type === 'delete_module');
    expect(delCall).toBeDefined();
    expect(delCall![0]).toEqual({ type: 'delete_module', moduleId: 'mod-reimu' });
  });

  test('clicking Delete with confirm=false does NOT send delete_module', () => {
    const { panel, root, send } = build();
    (globalThis as unknown as { confirm: () => boolean }).confirm = () => false;
    (window as unknown as { confirm: () => boolean }).confirm = () => false;
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
    } as BackendToFrontend);
    const del = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Delete') as HTMLButtonElement;
    del.click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const delCall = calls.find((c) => c[0]!.type === 'delete_module');
    expect(delCall).toBeUndefined();
  });
});

describe('mountModulesPanel — refresh button', () => {
  test('clicking Refresh sends another request_modules', () => {
    const { send, root } = build();
    const initialCount = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .filter((c) => c[0]!.type === 'request_modules').length;
    const refresh = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Refresh') as HTMLButtonElement;
    refresh.click();
    const after = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .filter((c) => c[0]!.type === 'request_modules').length;
    expect(after).toBe(initialCount + 1);
  });
});

describe('mountModulesPanel — error surfacing', () => {
  test('error message handler runs without crashing (status panel intentionally removed)', () => {
    const { panel } = build();
    expect(() => {
      panel.handleBackendMessage({ type: 'error', message: 'whoops' } as BackendToFrontend);
    }).not.toThrow();
  });
});

describe('mountModulesPanel — destroy', () => {
  test('clears the host root', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [M_REIMU],
    } as BackendToFrontend);
    expect(root.children.length).toBeGreaterThan(0);
    panel.destroy();
    expect(root.children.length).toBe(0);
  });
});
