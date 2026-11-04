import type { FrontendToBackend } from '../types/messages.js';
import type { DisplayLuaTrigger } from './snapshot.js';

type RisuButtonMessage = Extract<FrontendToBackend, { type: 'manual_trigger' | 'manual_button_click' }>;

export function manualActionWillRun(triggers: readonly DisplayLuaTrigger[], message: RisuButtonMessage): boolean {
  return message.type === 'manual_trigger' ? triggers.length > 0 : triggers.some(trigger => trigger.source.effect[0]?.type === 'triggerlua');
}

export interface RisuButtonClickDeps {
  readonly getChatId: () => string | null | undefined;
  readonly willRun: (message: RisuButtonMessage) => boolean;
  // Resolves true when a trigger ran, the condition under which Risu reloads the message.
  readonly run: (message: RisuButtonMessage) => Promise<boolean>;
  readonly invalidateMessage: (messageId: string) => void;
  readonly log: {
    readonly info: (message: string) => void;
    readonly warn: (message: string) => void;
    readonly error: (message: string, error: unknown) => void;
  };
}

export const messageReloadDepKey = (messageId: string): string => `__risu_message_reload__:${messageId}`;

// The host keeps the source attributes private, and `open` also holds live state, so a toggled details default is only readable before the toggle.
const detailsDefaults = new WeakMap<Element, boolean>();

function rememberDetailsDefault(target: Element): void {
  const details = target.closest('summary')?.parentElement;
  if (details?.localName === 'details' && !detailsDefaults.has(details)) detailsDefaults.set(details, (details as HTMLDetailsElement).open);
}

// A fresh element is required because a control the user touched stops following its `checked` attribute, which would also ignore later host patches.
function replaceWithPristineControl(control: Element): void {
  const fresh = control.ownerDocument.createElement(control.localName);
  for (const { name, value } of Array.from(control.attributes)) fresh.setAttribute(name, value);
  for (const child of Array.from(control.childNodes)) fresh.appendChild(child.cloneNode(true));
  control.replaceWith(fresh);
}

export function resetNativeControls(root: ParentNode): void {
  for (const control of Array.from(root.querySelectorAll('input, textarea, select'))) replaceWithPristineControl(control);
  for (const details of Array.from(root.querySelectorAll('details'))) {
    const open = detailsDefaults.get(details);
    if (open !== undefined) details.open = open;
    detailsDefaults.delete(details);
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (element.scrollTop) element.scrollTop = 0;
    if (element.scrollLeft) element.scrollLeft = 0;
  }
  for (const island of Array.from(root.querySelectorAll('[data-lumiverse-html-island]'))) {
    if (island.shadowRoot) resetNativeControls(island.shadowRoot);
  }
}

const MESSAGE_CONTENT_SELECTOR = '[data-message-id] [data-component="MessageContent"]';

// Coalesced because a card can request reloads in a loop, and each reset walks the whole row.
export function createNativeResetScheduler(root: ParentNode, resetBackground: () => void): (messageId?: string) => void {
  let all = false;
  const ids = new Set<string>();
  const flush = (): void => {
    const everything = all;
    const targets = new Set(ids);
    all = false;
    ids.clear();
    for (const content of Array.from(root.querySelectorAll(MESSAGE_CONTENT_SELECTOR))) {
      const id = content.closest<HTMLElement>('[data-message-id]')?.dataset['messageId'];
      if (everything || (id && targets.has(id))) resetNativeControls(content);
    }
    if (everything) resetBackground();
  };
  return (messageId) => {
    if (!all && ids.size === 0) queueMicrotask(flush);
    if (messageId === undefined) all = true;
    else ids.add(messageId);
  };
}

function findInPath(path: readonly EventTarget[], selector: string): HTMLElement | null {
  for (const node of path) {
    if (typeof (node as Element).matches === 'function' && (node as Element).matches(selector)) return node as HTMLElement;
  }
  return null;
}

// Capture phase to beat Lumi handlers.
export function createRisuButtonClickHandler(deps: RisuButtonClickDeps): (event: Event) => void {
  return (event) => {
    const path = event.composedPath() as EventTarget[];
    const target = path[0] as Element | undefined;
    if (!target || typeof target.closest !== 'function') return;
    rememberDetailsDefault(target);
    const element = target.closest('[risu-trigger], [risu-btn]');
    if (!element) return;
    const triggerName = element.getAttribute('risu-trigger');
    const btn = triggerName ? null : element.getAttribute('risu-btn');
    if (!triggerName && !btn) return;
    // Risu binds this per chat row, so buttons in background HTML stay inert.
    const messageId = findInPath(path, '[data-message-id]')?.dataset['messageId'];
    const content = findInPath(path, '[data-component="MessageContent"]');
    if (!messageId || !content) return;
    const idAttr = element.getAttribute('risu-id') ?? undefined;
    const chatId = deps.getChatId();
    if (!chatId) {
      deps.log.warn(`manual click: active chat isn't a lumirealm chat, ignoring ${triggerName ?? `btn=${btn}`}`);
      return;
    }
    event.stopPropagation();
    let message: RisuButtonMessage;
    if (triggerName) {
      deps.log.info(`manual-trigger click: triggerName=${triggerName} triggerId=${idAttr ?? '<none>'} chatId=${chatId}`);
      message = { type: 'manual_trigger', triggerName, ...(idAttr !== undefined ? { triggerId: idAttr } : {}), chatId };
    } else {
      deps.log.info(`manual-button click: btn=${btn} btnId=${idAttr ?? '<none>'} chatId=${chatId}`);
      message = { type: 'manual_button_click', btn: btn!, ...(idAttr !== undefined ? { btnId: idAttr } : {}), chatId };
    }
    const willRun = deps.willRun(message);
    // Risu's reload detaches the row before the browser activates the click, so a run has no label follow-up click or navigation. With no run, activation stands.
    if (willRun) event.preventDefault();
    void deps.run(message).catch((error: unknown) => {
      deps.log.error('Frontend Lua action failed', error);
      // Activation was already cancelled, so without a reload the click would do nothing.
      return willRun;
    }).then((reload) => {
      if (!reload) return;
      resetNativeControls(content);
      deps.invalidateMessage(messageId);
    }).catch((error: unknown) => deps.log.error('Risu message reload failed', error));
  };
}
