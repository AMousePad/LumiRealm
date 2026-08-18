import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { createChipMultiSelect, type ChipMultiSelectHandle } from './chip-multi-select.js';

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window | null = null;
let picker: ChipMultiSelectHandle | null = null;

beforeEach(() => {
  const win = new Window({ url: 'https://example.test/' });
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
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
  picker?.destroy();
  picker = null;
  browser?.close();
  browser = null;
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
});

describe('chip multi-select', () => {
  test('keeps a 500-item selection compact and supports select all and clear', () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      value: `card-${index}`,
      label: `Card ${index}`,
    }));
    const changes: string[][] = [];
    picker = createChipMultiSelect({
      items,
      selectedValues: items.map((item) => item.value),
      collapsedChipLimit: 8,
      onChange: (values) => changes.push([...values]),
    });
    document.body.appendChild(picker.root);

    expect(picker.root.querySelectorAll('.lr-chip-select-chip')).toHaveLength(8);
    expect(picker.root.querySelector('.lr-chip-select-more')?.textContent).toBe('+492 more');
    expect(picker.root.querySelector('.lr-chip-select-count')?.textContent).toBe('500 selected');

    const buttons = [...picker.root.querySelectorAll<HTMLButtonElement>('.lr-chip-select-action')];
    buttons.find((button) => button.textContent === 'Clear')!.click();
    expect(picker.getSelectedValues()).toEqual([]);
    buttons.find((button) => button.textContent === 'Select all')!.click();
    expect(picker.getSelectedValues()).toHaveLength(500);
    expect(changes.map((values) => values.length)).toEqual([0, 500]);
  });

  test('search can toggle an already-selected item off', () => {
    picker = createChipMultiSelect({
      items: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
      selectedValues: ['alpha'],
      onChange: () => undefined,
    });
    document.body.appendChild(picker.root);

    (picker.root.querySelector('.lr-chip-select-trigger') as HTMLButtonElement).click();
    const search = document.querySelector<HTMLInputElement>('.lr-ss-search')!;
    search.value = 'Alpha';
    search.dispatchEvent(new browser!.Event('input') as unknown as Event);
    (document.querySelector('.lr-ss-option') as HTMLElement).click();

    expect(picker.getSelectedValues()).toEqual([]);
  });
});
