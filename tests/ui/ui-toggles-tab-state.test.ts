/**
 * Pin the drawer-local UI state of the State > Toggles tab across the backend
 * refresh that follows a toggle write.
 *
 * A toggle write round-trips: the panel sends `set_toggle`, the backend
 * persists the preference and answers with a forced `set_variables` push. That
 * push carries values only, so the rendered rows must be updated in place: a
 * rebuild resets every `<details>` to open, detaches the focused control, and
 * lets the browser clamp the drawer scroll offset.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { mountTogglesPanel, type TogglesTabHandle } from '../../src/ui/toggles-tab.js';
import type {
  BackendToFrontend,
  FrontendToBackend,
  SidebarToggleWire,
} from '../../src/types/messages.js';

let window: Window;
let originalDocument: Document | undefined;

beforeEach(() => {
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

const NOOP_LOG = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
};

// Two module groups. The first one is collapsed by the user; the second one
// holds the controls the user then interacts with.
const DEFINITIONS: readonly SidebarToggleWire[] = [
  { type: 'group', key: 'visuals', value: 'Visuals', moduleId: 'module_visuals' },
  { type: 'checkbox', key: 'sprites', value: 'Sprites', moduleId: 'module_visuals' },
  { type: 'select', key: 'quality', value: 'Quality', options: ['Low', 'High'], moduleId: 'module_visuals' },
  { type: 'groupEnd', moduleId: 'module_visuals' },
  { type: 'group', key: 'audio', value: 'Audio', moduleId: 'module_audio' },
  { type: 'checkbox', key: 'bgm', value: 'Background music', moduleId: 'module_audio' },
  { type: 'select', key: 'mix', value: 'Mix', options: ['Dry', 'Wet'], moduleId: 'module_audio' },
  { type: 'groupEnd', moduleId: 'module_audio' },
];

const CHAT_ID = 'chat-a';

const BASE_VALUES: Readonly<Record<string, string>> = {
  toggle_sprites: '0',
  toggle_quality: '0',
  toggle_bgm: '0',
  toggle_mix: '0',
};

interface Harness {
  readonly scroller: HTMLElement;
  readonly sent: FrontendToBackend[];
  readonly groups: () => HTMLDetailsElement[];
  readonly checkbox: (key: string) => HTMLInputElement;
  readonly select: (key: string) => HTMLSelectElement;
  readonly pushValues: (seq: number, global: Record<string, string>) => void;
}

// The host drawer scrolls the panel, so the panel is mounted inside a scroller.
function mountPanel(): Harness {
  const scroller = document.createElement('div');
  const root = document.createElement('div');
  scroller.appendChild(root);
  document.body.appendChild(scroller);

  const sent: FrontendToBackend[] = [];
  const panel: TogglesTabHandle = mountTogglesPanel({
    root,
    sendToBackend: (msg) => { sent.push(msg); },
    log: NOOP_LOG,
  });
  panel.setActiveChatId(CHAT_ID);
  panel.handleBackendMessage({
    type: 'set_toggle_definitions',
    chatId: CHAT_ID,
    seq: 1,
    ts: 1,
    toggles: [...DEFINITIONS],
    attribution: {},
  } as BackendToFrontend);

  const row = (key: string): Element => {
    const el = root.querySelector(`.lr-toggle-row[data-key="${key}"]`);
    if (!el) throw new Error(`toggle row missing: ${key}`);
    return el;
  };

  return {
    scroller,
    sent,
    groups: () => Array.from(root.querySelectorAll<HTMLDetailsElement>('details.lr-toggle-group')),
    checkbox: (key) => row(key).querySelector<HTMLInputElement>('input.lr-toggle-checkbox')!,
    select: (key) => row(key).querySelector<HTMLSelectElement>('select.lr-toggle-select')!,
    pushValues: (seq, global) => {
      panel.handleBackendMessage({
        type: 'set_variables',
        chatId: CHAT_ID,
        seq,
        ts: seq,
        defaults: {},
        scopes: { local: {}, chat: {}, global },
      } as BackendToFrontend);
    },
  };
}

// User state that must survive the write round-trip: first group collapsed,
// drawer scrolled down, checkbox focused.
function arrangeUserState(h: Harness): { focused: HTMLInputElement; groups: HTMLDetailsElement[] } {
  h.pushValues(2, BASE_VALUES);
  const groups = h.groups();
  expect(h.scroller.scrollTop).toBe(0);
  h.scroller.scrollTop = 420;
  groups[0]!.querySelector('summary')!.click();
  expect(groups[0]!.open).toBe(false);
  const focused = h.checkbox('bgm');
  focused.focus();
  return { focused, groups };
}

// happy-dom has no layout, so the browser clamp is applied explicitly: while a
// scrolled list is torn down the container has no content to scroll, Chromium
// clamps the offset to 0, and the value stays clamped after the rebuild.
function browserScrollClampOnListTeardown(
  scroller: HTMLElement,
  before: readonly Element[],
  after: readonly Element[],
): void {
  if (before.length > 0 && after[0] !== before[0]) scroller.scrollTop = 0;
}

test('keeps group expansion across the refresh that follows a checkbox write', () => {
  const h = mountPanel();
  const { focused, groups } = arrangeUserState(h);
  expect(groups[1]!.open).toBe(true);

  focused.click();
  expect(h.sent.at(-1)).toEqual({ type: 'set_toggle', chatId: CHAT_ID, key: 'bgm', value: '1' });
  h.pushValues(3, { ...BASE_VALUES, toggle_bgm: '1' });

  const after = h.groups();
  expect(after.length).toBe(2);
  expect(after[0]!.open).toBe(false);
  expect(after[1]!.open).toBe(true);
  expect(after[0] === groups[0]).toBe(true);
  expect(after[1] === groups[1]).toBe(true);
  expect(document.activeElement === focused).toBe(true);
  expect(focused.checked).toBe(true);
});

test('keeps the drawer scroll offset across the refresh that follows a checkbox write', () => {
  const h = mountPanel();
  const { focused, groups } = arrangeUserState(h);

  focused.click();
  h.pushValues(3, { ...BASE_VALUES, toggle_bgm: '1' });
  browserScrollClampOnListTeardown(h.scroller, groups, h.groups());

  expect(h.scroller.scrollTop).toBe(420);
});

test('keeps group expansion, focus, and the scroll offset across the refresh that follows a dropdown write', () => {
  const h = mountPanel();
  const { groups } = arrangeUserState(h);

  h.scroller.scrollTop = 420;
  const mix = h.select('mix');
  mix.focus();
  mix.value = '1';
  mix.dispatchEvent(new window.Event('change') as unknown as Event);
  expect(h.sent.at(-1)).toEqual({ type: 'set_toggle', chatId: CHAT_ID, key: 'mix', value: '1' });

  h.pushValues(3, { ...BASE_VALUES, toggle_mix: '1' });
  browserScrollClampOnListTeardown(h.scroller, groups, h.groups());

  const after = h.groups();
  expect(after[0]!.open).toBe(false);
  expect(after[1]!.open).toBe(true);
  expect(after[0] === groups[0]).toBe(true);
  expect(after[1] === groups[1]).toBe(true);
  expect(h.scroller.scrollTop).toBe(420);
  expect(document.activeElement === mix).toBe(true);
  expect(mix.value).toBe('1');
});

test('still applies pushed values to the rendered controls', () => {
  const h = mountPanel();
  h.pushValues(2, BASE_VALUES);
  expect(h.checkbox('sprites').checked).toBe(false);
  expect(h.select('mix').value).toBe('0');

  h.pushValues(3, { ...BASE_VALUES, toggle_sprites: '1', toggle_mix: '1' });
  expect(h.checkbox('sprites').checked).toBe(true);
  expect(h.select('mix').value).toBe('1');

  h.pushValues(4, { ...BASE_VALUES, toggle_sprites: '0', toggle_mix: '0' });
  expect(h.checkbox('sprites').checked).toBe(false);
  expect(h.select('mix').value).toBe('0');
});
