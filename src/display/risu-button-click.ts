import type { FrontendToBackend } from '../types/messages.js';

export interface RisuButtonClickDeps {
  readonly getChatId: () => string | null | undefined;
  readonly send: (message: Extract<FrontendToBackend, { type: 'manual_trigger' | 'manual_button_click' }>) => void;
  readonly log: { readonly info: (message: string) => void; readonly warn: (message: string) => void };
}

// Capture phase to beat Lumi handlers. Never preventDefault: like Risu, cards pair these attributes with
// native activation such as label[for] radios and checkboxes, which a cancelled click silently undoes.
export function createRisuButtonClickHandler(deps: RisuButtonClickDeps): (event: Event) => void {
  return (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const target = (path[0] as HTMLElement | undefined) ?? (event.target as HTMLElement | null);
    if (!target || typeof target.closest !== 'function') return;
    const element = target.closest('[risu-trigger], [risu-btn]');
    if (!element) return;
    const triggerName = element.getAttribute('risu-trigger');
    const btn = triggerName ? null : element.getAttribute('risu-btn');
    if (!triggerName && !btn) return;
    const idAttr = element.getAttribute('risu-id') ?? undefined;
    const chatId = deps.getChatId();
    if (!chatId) {
      deps.log.warn(`manual click: active chat isn't a lumirealm chat, ignoring ${triggerName ?? `btn=${btn}`}`);
      return;
    }
    event.stopPropagation();
    if (triggerName) {
      deps.log.info(`manual-trigger click: triggerName=${triggerName} triggerId=${idAttr ?? '<none>'} chatId=${chatId}`);
      deps.send({ type: 'manual_trigger', triggerName, ...(idAttr !== undefined ? { triggerId: idAttr } : {}), chatId });
    } else if (btn) {
      deps.log.info(`manual-button click: btn=${btn} btnId=${idAttr ?? '<none>'} chatId=${chatId}`);
      deps.send({ type: 'manual_button_click', btn, ...(idAttr !== undefined ? { btnId: idAttr } : {}), chatId });
    }
  };
}
