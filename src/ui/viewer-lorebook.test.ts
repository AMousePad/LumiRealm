import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { BackendToFrontend, FrontendToBackend, ViewerData } from '../types/messages.js';
import { mountViewerPanel, type ViewerPanelHandle } from './viewer-tab.js';

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window | null = null;
let panel: ViewerPanelHandle | null = null;

beforeEach(() => {
  const win = new Window({ url: 'https://example.test/' });
  class TestResizeObserver {
    observe(): void { /* layout is not exercised in these tests */ }
    unobserve(): void { /* */ }
    disconnect(): void { /* */ }
  }
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  };
  for (const [name, value] of Object.entries(globals)) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  browser = win;
});

afterEach(() => {
  panel?.destroy();
  panel = null;
  browser?.close();
  browser = null;
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
});

function loreViewerData(): ViewerData {
  return {
    source: { kind: 'character', characterId: 'char-1', name: 'Card' },
    lorebook: [{
      groupName: 'Card Lore',
      groupId: 'book-1',
      entries: [
        { id: 'constant', key: [], content: 'Always', constant: true, disabled: false },
        { id: 'enabled', key: ['key'], content: 'Keyed', constant: false, disabled: false },
        { id: 'disabled', key: [], content: 'Off', constant: true, disabled: true },
      ],
    }],
    regex: [],
    triggers: [],
    assets: [],
    cjs: null,
    backgroundHtml: null,
    defaultVariablesText: '',
    defaultVariablesUserEdited: false,
    ts: 1,
    fetchWarnings: [],
  };
}

function mountLoreViewer(): {
  root: HTMLElement;
  sent: FrontendToBackend[];
  opened: Array<{ worldBookId: string; entryId?: string }>;
} {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sent: FrontendToBackend[] = [];
  const opened: Array<{ worldBookId: string; entryId?: string }> = [];
  panel = mountViewerPanel({
    root,
    sendToBackend: (message) => sent.push(message),
    openWorldBookEditor: async (worldBookId, entryId) => {
      opened.push({ worldBookId, ...(entryId ? { entryId } : {}) });
    },
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    },
  });
  panel.handleBackendMessage({
    type: 'cards_updated',
    cards: [{
      character_id: 'char-1',
      character_name: 'Card',
      translator_version: 'v1',
      uses_lua: false,
      stored_at: 1,
    }],
  });
  panel.handleBackendMessage({ type: 'viewer_data_pushed', data: loreViewerData() });
  const loreTab = [...root.querySelectorAll<HTMLButtonElement>('.lrv-subtab')]
    .find((button) => button.textContent === 'Lore');
  if (!loreTab) throw new Error('Lore tab was not rendered');
  loreTab.click();
  return { root, sent, opened };
}

describe('Viewer Lore UI', () => {
  test('shows the legend and uses disabled > constant > enabled dot precedence', () => {
    const { root } = mountLoreViewer();

    expect(root.querySelector('.lrv-lb-legend')?.textContent).toContain('Constant');
    expect(root.querySelector('.lrv-lb-legend')?.textContent).toContain('Enabled');
    expect(root.querySelector('.lrv-lb-legend')?.textContent).toContain('Disabled');
    expect(root.querySelector('[data-entry-id="constant"] .lrv-lb-status-constant')).not.toBeNull();
    expect(root.querySelector('[data-entry-id="enabled"] .lrv-lb-status-enabled')).not.toBeNull();
    expect(root.querySelector('[data-entry-id="disabled"] .lrv-lb-status-disabled')).not.toBeNull();
  });

  test('enables an expanded entry and keeps it expanded after the result', () => {
    const { root, sent } = mountLoreViewer();
    let row = root.querySelector<HTMLDetailsElement>('[data-entry-id="disabled"]')!;
    row.open = true;
    row.dispatchEvent(new browser!.Event('toggle') as unknown as Event);
    row.querySelector<HTMLButtonElement>('.lrv-lb-toggle-entry')!.click();

    expect(sent.at(-1)).toEqual({
      type: 'set_viewer_lorebook_entry_disabled',
      source: { kind: 'character', characterId: 'char-1' },
      worldBookId: 'book-1',
      entryId: 'disabled',
      disabled: false,
    });

    // The host change event can refresh the live row before the direct reply.
    // Keep the pending label tied to the requested transition, not the refreshed value.
    const refreshed = loreViewerData();
    panel!.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        ...refreshed,
        lorebook: refreshed.lorebook.map((group) => ({
          ...group,
          entries: group.entries.map((entry) => entry.id === 'disabled'
            ? { ...entry, disabled: false }
            : entry),
        })),
      },
    });
    row = root.querySelector<HTMLDetailsElement>('[data-entry-id="disabled"]')!;
    expect(row.querySelector<HTMLButtonElement>('.lrv-lb-toggle-entry')?.textContent).toBe('Enabling…');

    panel!.handleBackendMessage({
      type: 'viewer_lorebook_entry_disabled_result',
      source: { kind: 'character', characterId: 'char-1' },
      worldBookId: 'book-1',
      entryId: 'disabled',
      disabled: false,
      ok: true,
    } as BackendToFrontend);

    row = root.querySelector<HTMLDetailsElement>('[data-entry-id="disabled"]')!;
    expect(row.open).toBe(true);
    expect(row.querySelector('.lrv-lb-status-constant')).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>('.lrv-lb-toggle-entry')?.textContent).toBe('Disable entry');
  });

  test('opens the exact live book and entry in Lumiverse from the expanded row', async () => {
    const { root, opened } = mountLoreViewer();
    const row = root.querySelector<HTMLDetailsElement>('[data-entry-id="enabled"]')!;
    row.open = true;
    row.dispatchEvent(new browser!.Event('toggle') as unknown as Event);
    row.querySelector<HTMLButtonElement>('.lrv-lb-open-entry')!.click();
    await Promise.resolve();
    expect(opened).toEqual([{ worldBookId: 'book-1', entryId: 'enabled' }]);
  });

  test('keeps the outside button as a book-only Lumiverse jump', async () => {
    const { root, opened } = mountLoreViewer();
    const current = loreViewerData();
    panel!.handleBackendMessage({
      type: 'viewer_data_pushed',
      data: {
        ...current,
        lorebook: [{
          groupName: 'Attached Module Lore',
          groupId: 'module-book',
          moduleId: 'module-1',
          entries: [{ id: 'module-entry', key: [], content: 'Module lore' }],
        }, ...current.lorebook],
      },
    });
    root.querySelector<HTMLButtonElement>('.lrv-lb-open-book')!.click();
    await Promise.resolve();
    // The character's own book wins even when an attached module book is
    // returned first. No entry ID means the editor opens at book level.
    expect(opened).toEqual([{ worldBookId: 'book-1' }]);
  });

  test('delegates the main extension scroll range to the Lumiverse drawer', async () => {
    const css = await Bun.file(new URL('./styles.css', import.meta.url)).text();
    const sidebarRule = css.match(/\.lr-sidebar\s*\{([^}]*)\}/)?.[1] ?? '';
    const panelsRule = css.match(/\.lr-sidebar-panels\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(sidebarRule).toContain('min-height: 100%');
    expect(sidebarRule).not.toMatch(/(^|\s)height:\s*100%/);
    expect(panelsRule).toContain('overflow: visible');
  });
});
