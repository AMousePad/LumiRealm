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

test('keeps existing cards and scroll until successful results arrive', () => {
  const previous = root.querySelector('.lr-realm-card');
  const body = root.querySelector('.lr-realm-body')!;
  body.scrollTop = 300;
  button('Recent').click();
  expect(root.querySelector('.lr-realm-card')).toBe(previous);
  expect(body.scrollTop).toBe(300);
  expect(root.querySelector('.lr-realm-grid')!.classList.contains('lr-realm-loading')).toBe(true);
  expect(button('Next page').disabled).toBe(false);
  reply([{ ...card, id: 'two', name: 'Replacement' }]);
  expect(body.scrollTop).toBe(0);
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
  const toggle = root.querySelector('.lr-realm-view') as HTMLButtonElement;
  expect(toggle.getAttribute('aria-label')).toBe('Switch to grid view');
  toggle.click();
  await Bun.sleep(0);
  expect(root.querySelector('.lr-realm-grid')!.getAttribute('data-view')).toBe('grid');
  expect(root.querySelector('.lr-realm-card')).toBe(previous);
  expect(savedView).toBe('grid');
  realm.close();
  root.replaceChildren();
  realm.open();
  expect(button('Switch to default view')).toBeDefined();
});

test('loads the saved view without sending another search', async () => {
  const count = sent.length;
  viewRead.resolve('grid');
  await Bun.sleep(0);
  expect(button('Switch to default view')).toBeDefined();
  expect(sent).toHaveLength(count);
});

test('a late preference read cannot override a newer choice', async () => {
  const toggle = root.querySelector('.lr-realm-view') as HTMLButtonElement;
  toggle.click();
  viewRead.resolve('default');
  await Bun.sleep(0);
  expect(toggle.getAttribute('aria-label')).toBe('Switch to default view');
});

test('preference save failure is visible and leaves the view selector usable', async () => {
  viewSaveError = new Error('Unavailable');
  const toggle = root.querySelector('.lr-realm-view') as HTMLButtonElement;
  toggle.click();
  await Bun.sleep(0);
  expect(toggle.disabled).toBe(false);
  expect(root.querySelector('.lr-realm-feedback')!.textContent).toContain('Could not save');
});

test('manual page entry uses one-based numbering and resets scroll on success', () => {
  button('Recent').click();
  reply([card]);
  const input = root.querySelector('.lr-realm-pager-page') as HTMLInputElement;
  const body = root.querySelector('.lr-realm-body')!;
  body.scrollTop = 200;
  input.value = '7';
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }) as unknown as Event);
  expect(sent.at(-1)).toMatchObject({ page: 6 });
  expect(input.disabled).toBe(false);
  expect(body.scrollTop).toBe(200);
  reply([card]);
  expect(input.value).toBe('7');
  expect(body.scrollTop).toBe(0);
  const count = sent.length;
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }) as unknown as Event);
  expect(sent).toHaveLength(count);
});

test.each(['', '0', '-1', '1.5', '9007199254740992'])('rejects invalid page input %s', value => {
  button('Recent').click();
  reply([card]);
  const input = root.querySelector('.lr-realm-pager-page') as HTMLInputElement;
  input.value = value;
  const count = sent.length;
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }) as unknown as Event);
  expect(sent).toHaveLength(count);
  expect(input.validationMessage).not.toBe('');
});


test('toolbar and pager sit outside the results scroller', () => {
  const body = root.querySelector('.lr-realm-body')!;
  expect(body.contains(root.querySelector('.lr-realm-toolbar'))).toBe(false);
  expect(body.contains(root.querySelector('.lr-realm-pager'))).toBe(false);
  expect(body.contains(root.querySelector('.lr-realm-grid'))).toBe(true);
});

test('rapid paging accepts only the latest response and resets scroll only on success', () => {
  button('Recent').click();
  reply([card]);
  const body = root.querySelector('.lr-realm-body')!;
  body.scrollTop = 300;
  button('Next page').click();
  const stale = sent.at(-1)!.requestId;
  button('Next page').click();
  expect(sent.at(-1)).toMatchObject({ page: 2 });
  reply([{ ...card, name: 'Stale' }], stale);
  expect(body.scrollTop).toBe(300);
  expect(root.querySelector('.lr-realm-card')!.textContent).toContain('Example');
  reply([], undefined, 'Connection failed');
  expect(body.scrollTop).toBe(300);
  button('Previous page').click();
  reply([{ ...card, name: 'Latest' }]);
  expect(body.scrollTop).toBe(0);
  body.scrollTop = 150;
  reply([card], stale);
  expect(body.scrollTop).toBe(150);
});


test('view button cycles both ways with matching icons and accessible labels', async () => {
  const toggle = button('Switch to grid view');
  const gridIcon = toggle.innerHTML;
  toggle.click();
  expect(toggle.disabled).toBe(true);
  await Bun.sleep(0);
  expect(toggle.title).toBe('Switch to default view');
  expect(toggle.getAttribute('aria-label')).toBe(toggle.title);
  expect(toggle.innerHTML).not.toBe(gridIcon);
  toggle.click();
  await Bun.sleep(0);
  expect(toggle.title).toBe('Switch to grid view');
  expect(toggle.getAttribute('aria-label')).toBe(toggle.title);
  expect(toggle.innerHTML).toBe(gridIcon);
  expect(savedView).toBe('default');
  expect(root.querySelector('.lr-realm-grid')!.getAttribute('data-view')).toBe('default');
});
