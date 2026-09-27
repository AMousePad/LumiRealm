import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { createFrontendLuaUi } from '../../src/frontend-lua/ui';
import { FrontendLuaUnavailableError } from '../../src/frontend-lua/protocol';

async function withUi(run: (ui: ReturnType<typeof createFrontendLuaUi>, roots: HTMLElement[]) => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  const roots: HTMLElement[] = [];
  const ctx = { ui: { showModal() {
    if (roots.filter(root => root.isConnected).length === 2) throw new Error('Modal limit exceeded');
    const root = document.createElement('div');
    document.body.append(root);
    roots.push(root);
    const listeners: (() => void)[] = [];
    return { root, setTitle(title: string) { root.dataset.title = title; },
      onDismiss(listener: () => void) { listeners.push(listener); },
      dismiss() { if (!root.isConnected) return; root.remove(); for (const listener of listeners) listener(); },
    };
  } } } as unknown as SpindleFrontendContext;
  const ui = createFrontendLuaUi(ctx);
  try { await run(ui, roots); }
  finally {
    ui.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
    await window.happyDOM.close();
  }
}

test('notices replace each other before a picker without exceeding the host limit', () => withUi(async (ui, roots) => {
  const notices = ['First', 'Second', 'Third'].map(text => ui.api().alert!(text).catch(error => error));
  const selected = ui.api().pick!('Choose', ['A', 'B']).catch(error => error);
  expect(roots).toHaveLength(1);
  expect(roots[0]!.textContent).toBe('AB');
  expect(roots[0]!.dataset.title).toBe('Choose');
  expect(roots[0]!.classList.contains('lr-pick-modal')).toBe(true);
  expect(roots[0]!.classList.contains('lr-alert-modal')).toBe(false);
  roots[0]!.querySelectorAll('button')[1]!.click();
  expect(await selected).toBe('1');
  expect(await Promise.all(notices)).toEqual([undefined, undefined, undefined]);
}));

test('replaced inputs wait for the current dialog and receive its final value', () => withUi(async (ui, roots) => {
  let settled = false;
  const first = ui.api().prompt!('First', 'old').then(value => { settled = true; return value; });
  const staleButton = roots[0]!.querySelector('button')!;
  const second = ui.api().prompt!('Second', 'new');
  await Promise.resolve();
  expect(settled).toBe(false);
  staleButton.click();
  await Promise.resolve();
  expect(settled).toBe(false);
  const root = roots.at(-1)!;
  expect(root.querySelector('input')!.value).toBe('new');
  root.querySelector('input')!.value = 'final';
  root.querySelector('button')!.click();
  expect(await Promise.all([first, second])).toEqual(['final', 'final']);
}));

for (const kind of ['alert', 'pick', 'confirm'] as const) {
  test(`an input replaced by ${kind} receives the shared alert result`, () => withUi(async (ui, roots) => {
    const input = ui.api().prompt!('First');
    const last = kind === 'alert' ? ui.api().alert!('Done') : kind === 'pick'
      ? ui.api().pick!('Pick', ['A', 'B']) : ui.api().confirm!('Continue?');
    const root = roots.at(-1)!;
    root.querySelectorAll('button')[kind === 'pick' ? 1 : 0]!.click();
    expect(await last).toBe(kind === 'alert' ? undefined : kind === 'pick' ? '1' : true);
    expect(await input).toBe(kind === 'alert' ? '' : kind === 'pick' ? '1' : 'yes');
  }));
}

test('aborting a replaced call leaves the current dialog usable', () => withUi(async (ui, roots) => {
  const controller = new AbortController(), reason = new Error('Cancelled');
  const first = ui.api(controller.signal).prompt!('First').catch(error => error);
  const second = ui.api().prompt!('Second', 'kept');
  controller.abort(reason);
  expect(await first).toBe(reason);
  expect(roots).toHaveLength(1);
  expect(roots[0]!.isConnected).toBe(true);
  roots[0]!.querySelector('button')!.click();
  expect(await second).toBe('kept');
}));

test('aborting the current dialog settles replaced calls and closes it', () => withUi(async (ui, roots) => {
  const controller = new AbortController(), reason = new Error('Cancelled');
  const first = ui.api().prompt!('First');
  const second = ui.api(controller.signal).prompt!('Second').catch(error => error);
  controller.abort(reason);
  expect(await second).toBe(reason);
  expect(await first).toBeNull();
  expect(roots.every(root => !root.isConnected)).toBe(true);
}));

test('runtime disposal rejects every pending dialog without leaving a modal', () => withUi(async (ui, roots) => {
  const calls = [ui.api().prompt!('First'), ui.api().pick!('Pick', ['A'])].map(call => call.catch(error => error));
  ui.dispose();
  for (const result of await Promise.all(calls)) expect(result).toBeInstanceOf(FrontendLuaUnavailableError);
  expect(roots.every(root => !root.isConnected)).toBe(true);
}));

test('dismissal followed by immediate replacement keeps earlier callers waiting', () => withUi(async (ui, roots) => {
  const first = ui.api().prompt!('First', 'first');
  roots[0]!.querySelector('button')!.click();
  let settled = false;
  void first.then(() => { settled = true; });
  const second = ui.api().prompt!('Second', 'second');
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(settled).toBe(false);
  roots.at(-1)!.querySelector('button')!.click();
  expect(await Promise.all([first, second])).toEqual(['second', 'second']);
}));
