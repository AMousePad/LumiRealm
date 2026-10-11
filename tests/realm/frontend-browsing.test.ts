import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { setupRealmModal } from '../../src/realm/frontend.js';
import type { RealmCard, RealmFrontendToBackend } from '../../src/realm/messages.js';

const card: RealmCard = { id: 'one', name: 'Example', desc: 'Description', img: '', tags: ['tag'], download: 1, hot: 0, hasLore: false, hasEmotion: false, hasAsset: false, type: 'character', viewScreen: 'none', license: '' };
let win: Window;
let realm: ReturnType<typeof setupRealmModal>;
let root: HTMLElement;
let sent: RealmFrontendToBackend[];
let savedView: unknown;
let viewRead: ReturnType<typeof Promise.withResolvers<unknown>>;
let viewSaveError: Error | null;
const globals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  win = new Window({ url: 'https://example.test' });
  for (const [key, value] of Object.entries({ window: win, document: win.document })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  root = document.createElement('div');
  document.body.appendChild(root);
  sent = [];
  savedView = undefined;
  viewRead = Promise.withResolvers<unknown>();
  viewSaveError = null;
  let dismiss = () => {};
  realm = setupRealmModal({
    ctx: { settings: { get: () => viewRead.promise, set: async (_key: string, value: unknown) => { if (viewSaveError) throw viewSaveError; savedView = value; } }, dom: { addStyle: () => () => {} }, ui: { showModal: () => ({ root, dismiss: () => dismiss(), onDismiss: (fn: () => void) => { dismiss = fn; } }) } } as unknown as SpindleFrontendContext,
    mountTarget: document.body, sendToBackend: msg => sent.push(msg), log: { info() {}, warn() {}, error() {} },
  });
  realm.open();
  reply([card]);
});

afterEach(() => {
  realm.destroy();
  win.happyDOM.cancelAsync();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  globals.clear();
});

function reply(cards: RealmCard[], requestId = sent.at(-1)!.requestId, error?: string): void {
  realm.handleBackendMessage({ type: 'realm_search_result', requestId, ok: !error, cards, ...(error ? { error } : {}) });
}
function button(label: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll('button')).find(el => el.textContent === label || el.title === label)!;
}

test('keeps existing cards and scroll during requests and unrelated renders', () => {
  const previous = root.querySelector('.lr-realm-card');
  const body = root.querySelector('.lr-realm-body')!;
  body.scrollTop = 300;
  button('Recent').click();
  expect(root.querySelector('.lr-realm-card')).toBe(previous);
  expect(body.scrollTop).toBe(300);
  expect(root.querySelector('.lr-realm-grid')!.classList.contains('lr-realm-loading')).toBe(true);
  expect(button('Next page').disabled).toBe(true);
  reply([{ ...card, id: 'two', name: 'Replacement' }]);
  expect(body.scrollTop).toBe(300);
  expect(root.querySelector('.lr-realm-card')!.textContent).toContain('Replacement');
  expect(root.querySelector('.lr-realm-grid')!.getAttribute('aria-busy')).toBe('false');
  expect(button('Next page').disabled).toBe(false);
  const replacement = root.querySelector('.lr-realm-card')!;
  (replacement as HTMLButtonElement).click();
  expect(root.querySelector('.lr-realm-card')).toBe(replacement);
});

test('ignores stale results even after the latest search has completed', () => {
  button('Recent').click();
  const stale = sent.at(-1)!.requestId;
  button('Trending').click();
  reply([{ ...card, name: 'Newest' }]);
  reply([{ ...card, name: 'Stale' }], stale);
  expect(root.querySelector('.lr-realm-card')!.textContent).toContain('Newest');
});

test('failed requests preserve results and empty pages retain previous-page navigation', () => {
  button('Recent').click();
  const previous = root.querySelector('.lr-realm-card');
  reply([], undefined, 'Connection failed');
  expect(root.querySelector('.lr-realm-card')).toBe(previous);
  expect(root.querySelector('.lr-realm-feedback')!.textContent).toContain('Connection failed');
  button('Next page').click();
  reply([]);
  expect(button('Previous page').disabled).toBe(false);
  expect(button('Next page').disabled).toBe(true);
  button('Previous page').click();
  expect(sent.at(-1)).toMatchObject({ type: 'realm_search', page: 0 });
});

test('changing filters cancels an earlier search debounce', async () => {
  const search = root.querySelector('input[type="search"]') as HTMLInputElement;
  search.value = 'query';
  search.dispatchEvent(new win.Event('input') as unknown as Event);
  button('Trending').click();
  const count = sent.length;
  await Bun.sleep(400);
  expect(sent).toHaveLength(count);
  expect(sent.at(-1)).toMatchObject({ search: 'query', sort: 'trending' });
});

test('pagination waits for a typed query to start on its first page', async () => {
  button('Recent').click();
  reply([card]);
  button('Next page').click();
  reply([card]);
  const search = root.querySelector('input[type="search"]') as HTMLInputElement;
  search.value = 'new query';
  search.dispatchEvent(new win.Event('input') as unknown as Event);
  expect(button('Previous page').disabled).toBe(true);
  expect(button('Next page').disabled).toBe(true);
  button('Next page').click();
  button('Previous page').click();
  await Bun.sleep(400);
  expect(sent.at(-1)).toMatchObject({ search: 'new query', page: 0 });
});

test('grid preference keeps cards mounted, saves the choice, and survives reopening', async () => {
  const previous = root.querySelector('.lr-realm-card');
  const select = root.querySelector('.lr-realm-view') as HTMLSelectElement;
  expect(select.value).toBe('default');
  select.value = 'grid';
  select.dispatchEvent(new win.Event('change') as unknown as Event);
  await Bun.sleep(0);
  expect(root.querySelector('.lr-realm-grid')!.getAttribute('data-view')).toBe('grid');
  expect(root.querySelector('.lr-realm-card')).toBe(previous);
  expect(savedView).toBe('grid');
  realm.close();
  root.replaceChildren();
  realm.open();
  expect((root.querySelector('.lr-realm-view') as HTMLSelectElement).value).toBe('grid');
});

test('loads the saved view without sending another search', async () => {
  const count = sent.length;
  viewRead.resolve('grid');
  await Bun.sleep(0);
  expect((root.querySelector('.lr-realm-view') as HTMLSelectElement).value).toBe('grid');
  expect(sent).toHaveLength(count);
});

test('a late preference read cannot override a newer choice', async () => {
  const select = root.querySelector('.lr-realm-view') as HTMLSelectElement;
  select.value = 'grid';
  select.dispatchEvent(new win.Event('change') as unknown as Event);
  viewRead.resolve('default');
  await Bun.sleep(0);
  expect(select.value).toBe('grid');
});

test('preference save failure is visible and leaves the view selector usable', async () => {
  viewSaveError = new Error('Unavailable');
  const select = root.querySelector('.lr-realm-view') as HTMLSelectElement;
  select.value = 'grid';
  select.dispatchEvent(new win.Event('change') as unknown as Event);
  await Bun.sleep(0);
  expect(select.disabled).toBe(false);
  expect(root.querySelector('.lr-realm-feedback')!.textContent).toContain('Could not save');
});
