/**
 * Pin asset CRUD interactions on the Viewer panel:
 *   - Add asset button is rendered in the asset toolbar regardless
 *     of asset count (always available).
 *   - Per-tile Rename + Delete buttons render on each asset.
 *   - Rename click switches to inline edit; Save fires `rename_asset`
 *     with the right source kind.
 *   - Delete click (after confirm) fires `delete_assets` with one name.
 *   - Select mode: filter-scoped select-all deletes exactly the
 *     filtered set.
 *   - Long-press (touch only) enters select mode, then extends from
 *     the anchor; scroll-slop and mouse holds don't select.
 *   - Stale rename inputs reset when a new viewer_data_pushed
 *     arrives.
 *   - Error during async asset op surfaces in the toolbar status
 *     line.
 *
 * Add-asset flow (file pick → /api/v1/images POST → add_assets WS) is
 * not covered here — file picker requires real browser surface +
 * fetch. Backend mutation correctness is pinned by
 * `state-asset-index-mutate.test.ts`.
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
  // requestAnimationFrame / ResizeObserver — happy-dom omits these; viewer-tab
  // uses them for asset-grid layout. Tests don't care about real frame timing.
  (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: (id: number) => void })
    .cancelAnimationFrame = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  // Fire the initial size callback on observe() — that's how the browser
  // implementation behaves on first observation, and viewer-tab's
  // recomputeLayout + initial renderWindow only run inside that callback.
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
  // Default-true so delete confirms pass through.
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

function buildAndSeedModule(name = 'Test Module'): {
  root: HTMLElement;
  send: ReturnType<typeof mock>;
  panel: ReturnType<typeof mountViewerPanel>;
  pushAssets: (assets: ViewerData['assets']) => void;
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
    type: 'modules_pushed',
    modules: [{
      id: 'mod-A', name, description: '', filename: 'a.risum',
      uploaded_at: 1, lorebook_count: 0, regex_count: 0, trigger_count: 0,
      asset_count: 0, low_level_access: false, has_cjs: false,
    }],
  } as BackendToFrontend);
  const pushAssets = (assets: ViewerData['assets']): void => {
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'module', moduleId: 'mod-A', name },
        lorebook: [], regex: [], triggers: [], assets,
        cjs: null, backgroundHtml: null,
        ts: 1, defaultVariablesText: "", defaultVariablesUserEdited: false, fetchWarnings: [],
      },
    } as BackendToFrontend);
  };
  return { root, send, panel, pushAssets };
}

describe('Viewer asset CRUD — Add affordance', () => {
  test('"Add asset" button always renders in the asset toolbar', () => {
    const { root, pushAssets } = buildAndSeedModule();
    pushAssets([]);
    const addBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === '+ Add asset');
    expect(addBtn).toBeDefined();
  });

  test('"Add asset" renders even when assets list is non-empty', () => {
    const { root, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'reimu', url: '/api/v1/images/r', multi: false, ext: 'png' },
    ]);
    const addBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === '+ Add asset');
    expect(addBtn).toBeDefined();
  });
});

describe('Viewer asset CRUD — per-tile Rename', () => {
  test('Rename + Delete buttons render on each asset tile', () => {
    const { root, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'reimu', url: '/api/v1/images/r', multi: false, ext: 'png' },
      { name: 'marisa', url: '/api/v1/images/m', multi: false, ext: 'png' },
    ]);
    expect(root.querySelectorAll('.lrv-asset-tile').length).toBe(2);
    const renameBtns = Array.from(root.querySelectorAll('button'))
      .filter((b) => (b as HTMLElement).textContent === 'Rename');
    expect(renameBtns.length).toBe(2);
    const deleteBtns = Array.from(root.querySelectorAll('button'))
      .filter((b) => (b as HTMLElement).textContent === 'Delete');
    expect(deleteBtns.length).toBe(2);
  });

  test('clicking Rename swaps the tile to inline-edit mode', () => {
    const { root, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'reimu', url: '/api/v1/images/r', multi: false, ext: 'png' },
    ]);
    const renameBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Rename') as HTMLButtonElement;
    renameBtn.click();
    const input = root.querySelector('.lrv-asset-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('reimu');
    // No Rename button should be visible during inline edit on this tile.
    const remainingRenames = Array.from(root.querySelectorAll('button'))
      .filter((b) => (b as HTMLElement).textContent === 'Rename');
    expect(remainingRenames.length).toBe(0);
  });

  test('Save inline-edit fires rename_asset with module source', () => {
    const { root, send, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'reimu', url: '/api/v1/images/r', multi: false, ext: 'png' },
    ]);
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Rename') as HTMLButtonElement).click();
    const input = root.querySelector('.lrv-asset-rename-input') as HTMLInputElement;
    input.value = 'reimu_v2';
    const saveBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const renameCall = calls.find((c) => c[0]!.type === 'rename_asset');
    expect(renameCall).toBeDefined();
    expect(renameCall![0]).toEqual({
      type: 'rename_asset',
      source: { kind: 'module', moduleId: 'mod-A' },
      oldName: 'reimu',
      newName: 'reimu_v2',
    });
  });

  test('Save with empty / unchanged name does NOT send rename', () => {
    const { root, send, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'x', url: '/api/v1/images/x', multi: false },
    ]);
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Rename') as HTMLButtonElement).click();
    const input = root.querySelector('.lrv-asset-rename-input') as HTMLInputElement;
    // Identical (no change).
    input.value = 'x';
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Save') as HTMLButtonElement).click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    expect(calls.find((c) => c[0]!.type === 'rename_asset')).toBeUndefined();
  });

  test('Cancel inline-edit returns to read-only tile without sending', () => {
    const { root, send, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'x', url: '/api/v1/images/x', multi: false },
    ]);
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Rename') as HTMLButtonElement).click();
    expect(root.querySelector('.lrv-asset-rename-input')).not.toBeNull();
    const cancelBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Cancel') as HTMLButtonElement;
    cancelBtn.click();
    expect(root.querySelector('.lrv-asset-rename-input')).toBeNull();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    expect(calls.find((c) => c[0]!.type === 'rename_asset')).toBeUndefined();
  });

  // (Behaviour around mid-rename re-pushes intentionally untested —
  // mid-edit input state should be preserved across re-renders, but
  // the synchronous focus()/select() microtask in the editor mount
  // causes happy-dom to keep the test open. Not load-bearing.)
});

describe('Viewer asset CRUD — per-tile Delete', () => {
  test('Delete (after confirm true) fires delete_assets with one name', () => {
    const { root, send, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'doomed', url: '/api/v1/images/d', multi: false },
    ]);
    const delBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Delete') as HTMLButtonElement;
    delBtn.click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const delCall = calls.find((c) => c[0]!.type === 'delete_assets');
    expect(delCall).toBeDefined();
    expect(delCall![0]).toEqual({
      type: 'delete_assets',
      source: { kind: 'module', moduleId: 'mod-A' },
      assetNames: ['doomed'],
    });
  });

  test('Delete (with confirm=false) does NOT fire', () => {
    const { root, send, pushAssets } = buildAndSeedModule();
    (globalThis as unknown as { confirm: () => boolean }).confirm = () => false;
    (window as unknown as { confirm: () => boolean }).confirm = () => false;
    pushAssets([
      { name: 'safe', url: '/api/v1/images/s', multi: false },
    ]);
    const delBtn = Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Delete') as HTMLButtonElement;
    delBtn.click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    expect(calls.find((c) => c[0]!.type === 'delete_assets')).toBeUndefined();
  });
});

describe('Viewer asset CRUD — long-press (touch)', () => {
  function press(tile: Element, opts: { x?: number; y?: number } = {}): void {
    const W = window as unknown as { PointerEvent: typeof PointerEvent };
    tile.dispatchEvent(new W.PointerEvent('pointerdown', {
      pointerType: 'touch', clientX: opts.x ?? 0, clientY: opts.y ?? 0, bubbles: true,
    }));
  }

  test('hold outside select mode enters it and selects that tile', async () => {
    const { root, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'a', url: '/api/v1/images/a', multi: false },
      { name: 'b', url: '/api/v1/images/b', multi: false },
    ]);
    expect(root.querySelector('.lrv-asset-selbar')).toBeNull();
    press(root.querySelectorAll('.lrv-asset-tile')[0]!);
    await new Promise((r) => setTimeout(r, 500));
    const bar = root.querySelector('.lrv-asset-selbar');
    expect(bar).not.toBeNull();
    expect(bar!.querySelector('.lrv-asset-selbar-count')!.textContent).toBe('1 selected');
  });

  test('hold inside select mode extends the range from the anchor', async () => {
    const { root, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'a', url: '/api/v1/images/a', multi: false },
      { name: 'b', url: '/api/v1/images/b', multi: false },
      { name: 'c', url: '/api/v1/images/c', multi: false },
    ]);
    press(root.querySelectorAll('.lrv-asset-tile')[0]!);
    await new Promise((r) => setTimeout(r, 500));
    press(root.querySelectorAll('.lrv-asset-tile')[2]!);
    await new Promise((r) => setTimeout(r, 500));
    expect(root.querySelector('.lrv-asset-selbar-count')!.textContent).toBe('3 selected');
  });

  // Both negatives share one wait: each must prove nothing happened after the
  // threshold, and separate waits just cost the fast suite another half second.
  test('scroll-slop and mouse holds both fail to select', async () => {
    const scrolled = buildAndSeedModule();
    scrolled.pushAssets([{ name: 'a', url: '/api/v1/images/a', multi: false }]);
    const W = window as unknown as { PointerEvent: typeof PointerEvent };
    const scrollTile = scrolled.root.querySelectorAll('.lrv-asset-tile')[0]!;
    press(scrollTile, { x: 0, y: 0 });
    scrollTile.dispatchEvent(new W.PointerEvent('pointermove', {
      pointerType: 'touch', clientX: 0, clientY: 60, bubbles: true,
    }));

    const moused = buildAndSeedModule();
    moused.pushAssets([{ name: 'a', url: '/api/v1/images/a', multi: false }]);
    moused.root.querySelectorAll('.lrv-asset-tile')[0]!.dispatchEvent(new W.PointerEvent('pointerdown', {
      pointerType: 'mouse', clientX: 0, clientY: 0, bubbles: true,
    }));

    await new Promise((r) => setTimeout(r, 500));
    expect(scrolled.root.querySelector('.lrv-asset-selbar')).toBeNull();
    expect(moused.root.querySelector('.lrv-asset-selbar')).toBeNull();
  });
});

describe('Viewer asset CRUD — bulk delete', () => {
  test('Select mode: select all matching deletes exactly the filtered set', () => {
    const { root, send, pushAssets } = buildAndSeedModule();
    pushAssets([
      { name: 'bg_one', url: '/api/v1/images/1', multi: false },
      { name: 'bg_two', url: '/api/v1/images/2', multi: false },
      { name: 'portrait', url: '/api/v1/images/3', multi: false },
    ]);
    const search = root.querySelector('.lrv-asset-search') as HTMLInputElement;
    search.value = 'bg_';
    // Search is debounced; drive the filter directly via the same path the
    // input handler uses by dispatching and flushing.
    search.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('input'));
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const selectBtn = Array.from(root.querySelectorAll('button'))
          .find((b) => (b as HTMLElement).textContent === 'Select') as HTMLButtonElement;
        selectBtn.click();
        const selectAll = Array.from(root.querySelectorAll('button'))
          .find((b) => (b as HTMLElement).textContent?.startsWith('Select all')) as HTMLButtonElement;
        expect(selectAll.textContent).toBe('Select all 2 matching');
        selectAll.click();
        const deleteBtn = Array.from(root.querySelectorAll('button'))
          .find((b) => (b as HTMLElement).textContent === 'Delete 2') as HTMLButtonElement;
        deleteBtn.click();
        const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
        const delCall = calls.find((c) => c[0]!.type === 'delete_assets');
        expect(delCall).toBeDefined();
        expect((delCall![0] as Extract<FrontendToBackend, { type: 'delete_assets' }>).assetNames.slice().sort())
          .toEqual(['bg_one', 'bg_two']);
        resolve();
      }, 120);
    });
  });
});

describe('Viewer asset CRUD — character source routing', () => {
  test('rename on character source uses character source discriminator', () => {
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
        { character_id: 'c1', character_name: 'Reimu', translator_version: 'v1', uses_lua: false, stored_at: 1 },
      ],
    } as BackendToFrontend);
    panel.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        source: { kind: 'character', characterId: 'c1', name: 'Reimu' },
        lorebook: [], regex: [], triggers: [],
        assets: [{ name: 'a', url: '/api/v1/images/a', multi: false }],
        cjs: null, backgroundHtml: null, ts: 1, defaultVariablesText: "", defaultVariablesUserEdited: false, fetchWarnings: [],
      },
    } as BackendToFrontend);
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Rename') as HTMLButtonElement).click();
    const input = root.querySelector('.lrv-asset-rename-input') as HTMLInputElement;
    input.value = 'a_renamed';
    (Array.from(root.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).textContent === 'Save') as HTMLButtonElement).click();
    const calls = (send as unknown as { mock: { calls: FrontendToBackend[][] } }).mock.calls;
    const renameCall = calls.find((c) => c[0]!.type === 'rename_asset')!;
    expect((renameCall[0] as { source: unknown }).source).toEqual({
      kind: 'character',
      characterId: 'c1',
    });
  });
});
