/**
 * Pin behaviour of the Viewer panel UI:
 *   - Mounts an intro + toolbar + status + surface host.
 *   - Source select populates from cards + modules pushes.
 *   - Selecting a source fires `request_viewer_data` with the right
 *     discriminator.
 *   - Receiving `viewer_data_pushed` for the selected source renders
 *     the surfaces.
 *   - Stale push (different source than selected) is ignored.
 *   - Refresh button re-requests.
 *   - Asset grid renders /api/v1/images/<id> URLs as <img>.
 *   - no CJS subtab: module.cjs never executes, field kept for round-trip.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Window } from 'happy-dom';
import { mountViewerPanel, type ViewerPanelHandle } from '../../src/ui/viewer-tab.js';
import type {
  BackendToFrontend,
  FrontendToBackend,
  ViewerData,
} from '../../src/types/messages.js';

let window: Window;
let originalDocument: Document | undefined;

beforeEach(() => {
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
  // viewer-tab uses requestAnimationFrame + ResizeObserver for asset-grid
  // virtualization. happy-dom omits both. Polyfill so tile rendering fires.
  (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: (id: number) => void })
    .cancelAnimationFrame = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: { width: 1024, height: 768, top: 0, left: 0, bottom: 768, right: 1024, x: 0, y: 0, toJSON() { return {}; } },
        borderBoxSize: [{ inlineSize: 1024, blockSize: 768 }],
        contentBoxSize: [{ inlineSize: 1024, blockSize: 768 }],
        devicePixelContentBoxSize: [{ inlineSize: 1024, blockSize: 768 }],
      } as unknown as ResizeObserverEntry;
      this.cb([entry], this as unknown as ResizeObserver);
    }
    unobserve(): void { /* */ }
    disconnect(): void { /* */ }
  };
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

function build(): {
  root: HTMLElement;
  send: ReturnType<typeof mock>;
  panel: ViewerPanelHandle;
} {
  const root = window.document.createElement('div') as unknown as HTMLElement;
  (window.document.body as unknown as { appendChild(n: unknown): void }).appendChild(root);
  const send = mock((_msg: FrontendToBackend) => {});
  const panel = mountViewerPanel({
    root,
    sendToBackend: send,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {} },
  });
  return { root, send, panel };
}

function emptyViewerForCharacter(characterId: string, name: string): ViewerData {
  return {
    source: { kind: 'character', characterId, name },
    lorebook: [],
    regex: [],
    triggers: [],
    assets: [],
    cjs: null,
    backgroundHtml: null,
    ts: 1,
    defaultVariablesText: "", defaultVariablesUserEdited: false,
    fetchWarnings: [],
  };
}

function emptyViewerForModule(moduleId: string, name: string): ViewerData {
  return {
    source: { kind: 'module', moduleId, name },
    lorebook: [],
    regex: [],
    triggers: [],
    assets: [],
    cjs: null,
    backgroundHtml: null,
    ts: 1,
    defaultVariablesText: "", defaultVariablesUserEdited: false,
    fetchWarnings: [],
  };
}

interface SsOption { readonly value: string; readonly label: string; readonly group?: string }

function ssPanel(triggerId: string): HTMLElement {
  const trigger = window.document.getElementById(triggerId) as unknown as HTMLButtonElement;
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  const panelId = trigger.getAttribute('aria-controls')!;
  return window.document.getElementById(panelId) as unknown as HTMLElement;
}

function ssReadOptions(triggerId: string): SsOption[] {
  const panel = ssPanel(triggerId);
  const out: SsOption[] = [];
  let currentGroup: string | undefined;
  for (const node of Array.from(panel.querySelectorAll('li'))) {
    const el = node as unknown as HTMLLIElement;
    if (el.classList.contains('lr-ss-group')) {
      currentGroup = el.textContent ?? undefined;
    } else if (el.classList.contains('lr-ss-option')) {
      out.push({
        value: el.getAttribute('data-value') ?? '',
        label: el.querySelector('.lr-ss-option-label')?.textContent ?? '',
        ...(currentGroup ? { group: currentGroup } : {}),
      });
    }
  }
  return out;
}

function ssPick(triggerId: string, value: string): void {
  const panel = ssPanel(triggerId);
  const opt = panel.querySelector(`.lr-ss-option[data-value="${value}"]`) as unknown as HTMLElement;
  opt.click();
}

describe('mountViewerPanel — initial state', () => {
  test('mounts the toolbar + source select + refresh', () => {
    const { root } = build();
    expect(root.querySelector('#lrv-source-select')).not.toBeNull();
    expect(root.querySelector('.lrv-status')).not.toBeNull();
    expect(root.querySelector('.lrv-surfaces')).not.toBeNull();
    const refresh = Array.from(root.querySelectorAll('button')).find(
      (b) => (b as HTMLElement).textContent === 'Refresh',
    );
    expect(refresh).toBeDefined();
  });

  test('sends get_cards + request_modules on mount', () => {
    const { send } = build();
    const types = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls
      .map((c) => c[0]!.type);
    expect(types).toContain('get_cards');
    expect(types).toContain('request_modules');
  });
});

describe('mountViewerPanel — source select', () => {
  test('cards_updated populates options with Characters group', () => {
    const { panel } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    const opts = ssReadOptions('lrv-source-select');
    expect(opts.some((o) => o.label === 'Reimu' && o.group === 'Characters')).toBe(true);
    expect(opts.some((o) => o.value === 'character::c1')).toBe(true);
  });

  test('modules_pushed populates options with Modules group', () => {
    const { panel } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-T', name: 'Touhou', description: '', filename: 't.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 0, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    const opts = ssReadOptions('lrv-source-select');
    expect(opts.some((o) => o.label === 'Touhou' && o.group === 'Modules')).toBe(true);
    expect(opts.some((o) => o.value === 'module::mod-T')).toBe(true);
  });

  test('attached count surfaces in character label', () => {
    const { panel } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [],
      attached_by_character: { c1: [
        { id: 'm1', name: 'm1' },
        { id: 'm2', name: 'm2' },
      ] },
    } as BackendToFrontend);
    const opts = ssReadOptions('lrv-source-select');
    expect(opts.some((o) => o.label.includes('+2 modules'))).toBe(true);
  });

  test('default-selects first option + auto-fires request_viewer_data', () => {
    const { panel, send } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const reqViewerCall = calls.find((c) => c[0]!.type === 'request_viewer_data');
    expect(reqViewerCall).toBeDefined();
    const m = reqViewerCall![0] as Extract<FrontendToBackend, { type: 'request_viewer_data' }>;
    expect(m.source).toEqual({ kind: 'character', characterId: 'c1' });
  });
});

describe('mountViewerPanel — viewer_data_pushed rendering', () => {
  test('CHARACTER push renders subtabs Assets + Triggers + Lorebook (Lumi-redirect, not inline)', () => {
    // Lorebook subtab now renders entries inline (sorted by Risu source array
    // position) instead of redirecting to Lumiverse's native UI.
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: emptyViewerForCharacter('c1', 'Reimu'),
    } as BackendToFrontend);
    const tabs = Array.from(root.querySelectorAll('.lrv-subtab'))
      .map((s) => (s as HTMLElement).textContent ?? '');
    expect(tabs.some((s) => s.startsWith('Assets'))).toBe(true);
    expect(tabs.some((s) => s.startsWith('Triggers'))).toBe(true);
    expect(tabs.some((s) => s.startsWith('Lore'))).toBe(true);
    // Default vars no longer a Viewer subtab post-Phase B.
    expect(tabs.some((s) => s.startsWith('Default vars'))).toBe(false);
    // No CJS tab for characters.
    expect(tabs.some((s) => s === 'CJS')).toBe(false);
    // No Background HTML tab when bg-html is null.
    expect(tabs.some((s) => s.startsWith('Background'))).toBe(false);
  });

  test('MODULE push exposes Lorebook + Regex as inline subtabs (no Lumi UI to defer to)', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-A', name: 'M', description: '', filename: 'a.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 0, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: emptyViewerForModule('mod-A', 'M'),
    } as BackendToFrontend);
    const tabs = Array.from(root.querySelectorAll('.lrv-subtab'))
      .map((s) => (s as HTMLElement).textContent ?? '');
    // Module exposes both Regex and Lorebook as their own tabs.
    expect(tabs.some((s) => s.startsWith('Lore'))).toBe(true);
    expect(tabs.some((s) => s.startsWith('Regex'))).toBe(true);
    // No "Default vars" tab for modules.
    expect(tabs.some((s) => s.startsWith('Default vars'))).toBe(false);
  });

  test('Background HTML subtab is exposed when bg-html present; activating it shows the pre', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        ...emptyViewerForCharacter('c1', 'C'),
        backgroundHtml: '<style>body{background:red}</style><div>panel</div>',
      },
    } as BackendToFrontend);
    const tabs = Array.from(root.querySelectorAll('.lrv-subtab'));
    const bgTab = tabs.find((s) => (s.textContent ?? '').trim().startsWith('HTML')) as HTMLButtonElement | undefined;
    expect(bgTab).toBeTruthy();
    bgTab!.click();
    const ta = root.querySelector('.lrv-defaults-textarea') as HTMLTextAreaElement;
    expect(ta.value).toContain('background:red');
  });

  test('Background HTML subtab is OMITTED when null', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: emptyViewerForCharacter('c1', 'C'),
    } as BackendToFrontend);
    const tabs = Array.from(root.querySelectorAll('.lrv-subtab'))
      .map((s) => (s as HTMLElement).textContent ?? '');
    expect(tabs.some((s) => s.startsWith('Background'))).toBe(false);
  });

  test('asset rendering uses /api/v1/images/<id> URL on <img>', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-A', name: 'M', description: '', filename: 'a.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 1, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'module', moduleId: 'mod-A', name: 'M' },
        lorebook: [],
        regex: [],
        triggers: [],
        assets: [
          { name: 'reimu', url: '/api/v1/images/img-r', multi: false, ext: 'png' },
        ],
        cjs: null,
        backgroundHtml: null,
        ts: 1,
        defaultVariablesText: "", defaultVariablesUserEdited: false,
        fetchWarnings: [],
      },
    } as BackendToFrontend);
    const imgs = Array.from(root.querySelectorAll('img.lrv-asset-media'));
    expect(imgs.length).toBe(1);
    expect((imgs[0] as HTMLImageElement).src).toContain('/api/v1/images/img-r');
  });

  test('mp4 asset renders <video> instead of <img>', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-A', name: 'M', description: '', filename: 'a.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 1, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'module', moduleId: 'mod-A', name: 'M' },
        lorebook: [],
        regex: [],
        triggers: [],
        assets: [
          { name: 'clip', url: '/api/v1/images/img-c', multi: false, ext: 'mp4' },
        ],
        cjs: null,
        backgroundHtml: null,
        ts: 1,
        defaultVariablesText: "", defaultVariablesUserEdited: false,
        fetchWarnings: [],
      },
    } as BackendToFrontend);
    const vids = Array.from(root.querySelectorAll('video.lrv-asset-media'));
    expect(vids.length).toBe(1);
    expect(root.querySelectorAll('img.lrv-asset-media').length).toBe(0);
  });

  test('no CJS subtab even when cjs is non-null (module.cjs never executes)', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-A', name: 'M', description: '', filename: 'a.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 0, low_level_access: false, has_cjs: true,
      }],
    } as BackendToFrontend);
    const data: ViewerData = {
      source: { kind: 'module', moduleId: 'mod-A', name: 'M' },
      lorebook: [], regex: [], triggers: [], assets: [],
      cjs: 'module.exports = {}',
      backgroundHtml: null,
      ts: 1, defaultVariablesText: "", defaultVariablesUserEdited: false, fetchWarnings: [],
    };
    panel.handleBackendMessage({ type: 'viewer_data_pushed', data } as BackendToFrontend);
    const tabs = Array.from(root.querySelectorAll('.lrv-subtab'));
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.some((s) => (s.textContent ?? '').startsWith('CJS'))).toBe(false);
  });

  test('stale push for a non-selected source is ignored', () => {
    const { panel, root } = build();
    // Select c1.
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
        { character_id: 'c2', character_name: 'Marisa', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    // Render c1 first.
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: emptyViewerForCharacter('c1', 'Reimu'),
    } as BackendToFrontend);
    // Push for c2 (NOT selected — c1 was the default).
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: emptyViewerForCharacter('c2', 'Marisa'),
    } as BackendToFrontend);
    // Surfaces should still reflect c1 — i.e. no Marisa in the status bar.
    const status = root.querySelector('.lrv-status') as HTMLElement;
    expect(status.textContent ?? '').not.toContain('Marisa');
  });

  test('fetchWarnings render in a warning banner', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'character', characterId: 'c1', name: 'Reimu' },
        lorebook: [], regex: [], triggers: [], assets: [],
        cjs: null, backgroundHtml: null, ts: 1,
        defaultVariablesText: "", defaultVariablesUserEdited: false,
        fetchWarnings: ['hello-warning'],
      },
    } as BackendToFrontend);
    const w = root.querySelector('.lrv-warning') as HTMLElement;
    expect(w).not.toBeNull();
    expect(w.textContent).toContain('hello-warning');
  });
});

describe('mountViewerPanel — refresh + source switch', () => {
  test('Refresh button re-fires request_viewer_data for current selection', () => {
    const { panel, send, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    const initialCount = (send as unknown as { mock: { calls: FrontendToBackend[][] } })
      .mock.calls.filter((c) => c[0]!.type === 'request_viewer_data').length;
    const refreshBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Refresh') as HTMLButtonElement;
    refreshBtn.click();
    const after = (send as unknown as { mock: { calls: FrontendToBackend[][] } })
      .mock.calls.filter((c) => c[0]!.type === 'request_viewer_data').length;
    expect(after).toBe(initialCount + 1);
  });

  test('switching source via dropdown selection fires another request', () => {
    const { panel, send } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C1', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-X', name: 'Xmod', description: '', filename: 'x.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 0, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    ssPick('lrv-source-select', 'module::mod-X');
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const last = [...calls].reverse().find((c) => c[0]!.type === 'request_viewer_data');
    expect(last).toBeDefined();
    const m = last![0] as Extract<FrontendToBackend, { type: 'request_viewer_data' }>;
    expect(m.source).toEqual({ kind: 'module', moduleId: 'mod-X' });
  });
});

describe('mountViewerPanel — error path', () => {
  test('error message is surfaced in status bar (red) when in loading state', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'cards_updated',
      cards: [
        { character_id: 'c1', character_name: 'C', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    // We're in loading state from the auto-fired request after default-select.
    panel.handleBackendMessage({
      type: 'error',
      message: 'something broke',
    } as BackendToFrontend);
    const status = root.querySelector('.lrv-status') as HTMLElement;
    expect(status.textContent).toBe('something broke');
    expect(status.classList.contains('lrv-status-error')).toBe(true);
  });
});

describe('mountViewerPanel — destroy', () => {
  test('clears the host root', () => {
    const { panel, root } = build();
    panel.handleBackendMessage({
      type: 'modules_pushed',
      modules: [{
        id: 'mod-A', name: 'M', description: '', filename: 'a.risum',
        uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
        asset_count: 0, low_level_access: false, has_cjs: false,
      }],
    } as BackendToFrontend);
    expect(root.children.length).toBeGreaterThan(0);
    panel.destroy();
    expect(root.children.length).toBe(0);
  });
});
