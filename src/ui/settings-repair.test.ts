import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { FrontendToBackend, RepairScanSummary } from '../types/messages.js';
import { mountSettingsPanel, type SettingsTabHandle } from './settings-tab.js';

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window | null = null;
let panel: SettingsTabHandle | null = null;

beforeEach(() => {
  const win = new Window({ url: 'https://example.test/' });
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    localStorage: win.localStorage,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    confirm: () => true,
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

function largeSummary(): RepairScanSummary {
  const cardTargets = Array.from({ length: 120 }, (_, index) => ({
    characterId: `char-${index}`,
    characterName: `Card ${index}`,
    canRetranslate: true,
    attachedModuleCount: 1,
  }));
  const moduleTargets = Array.from({ length: 120 }, (_, index) => ({
    moduleId: `module-${index}`,
    moduleName: `Module ${index}`,
    missing: false,
    attachmentCount: 1,
  }));
  return {
    staleModuleRegex: 0,
    staleCharRegex: 0,
    deadJournals: 0,
    charactersToRetranslate: cardTargets.length,
    modulesToReattach: moduleTargets.length,
    danglingModuleRefs: 0,
    cardTargets,
    moduleTargets,
    elapsedMs: 12,
  };
}

describe('Repair extension state target picker', () => {
  test('keeps large card/module libraries compact and sends only selected IDs', () => {
    const sent: FrontendToBackend[] = [];
    const root = document.createElement('div');
    document.body.appendChild(root);
    panel = mountSettingsPanel({
      root,
      sendToBackend: (message) => sent.push(message),
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        trace: () => undefined,
      },
    });
    panel.handleBackendMessage({ type: 'repair_scan_result', summary: largeSummary() });

    const cardPicker = root.querySelector<HTMLElement>('.rs-repair-card-picker')!;
    const modulePicker = root.querySelector<HTMLElement>('.rs-repair-module-picker')!;
    expect(cardPicker.querySelectorAll('.lr-chip-select-chip')).toHaveLength(6);
    expect(modulePicker.querySelectorAll('.lr-chip-select-chip')).toHaveLength(6);
    expect(cardPicker.querySelector('.lr-chip-select-more')?.textContent).toBe('+114 more');
    expect(modulePicker.querySelector('.lr-chip-select-more')?.textContent).toBe('+114 more');
    expect([...cardPicker.querySelectorAll('.lr-chip-select-action')].map((button) => button.textContent))
      .toEqual(['Select all', 'Clear']);

    (cardPicker.querySelector('[data-value="char-0"] .lr-chip-select-chip-x') as HTMLButtonElement).click();
    (modulePicker.querySelector('[data-value="module-0"] .lr-chip-select-chip-x') as HTMLButtonElement).click();

    const targetRow = [...root.querySelectorAll<HTMLElement>('.rs-repair-row')]
      .find((row) => row.textContent?.includes('Force re-translate'))!;
    (targetRow.querySelector('input') as HTMLInputElement).click();
    (root.querySelector('.rs-repair-result > .lrm-btn-danger') as HTMLButtonElement).click();

    const apply = sent.filter((message) => message.type === 'apply_repair').at(-1);
    expect(apply?.type).toBe('apply_repair');
    if (!apply || apply.type !== 'apply_repair') throw new Error('apply_repair was not sent');
    expect(apply.options.characterIds).toHaveLength(119);
    expect(apply.options.moduleIds).toHaveLength(119);
    expect(apply.options.characterIds).not.toContain('char-0');
    expect(apply.options.moduleIds).not.toContain('module-0');
  });
});
