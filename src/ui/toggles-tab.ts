import type {
  AttributionWire,
  BackendToFrontend,
  FrontendToBackend,
  SidebarToggleWire,
  VariableScopes,
} from '../types/messages.js';
import type { FrontendLog } from './drawer.js';
import { getTranslateEnabled, subscribeTranslateEnabled } from './translate-toggle.js';
import {
  translateModuleName,
  translateModuleToggleText,
  setModuleScopeLang,
} from './translate-orchestrator.js';
import { dominantScriptLang } from './browser-translator.js';

// Renders customModuleToggle DSL for the active chat.
// Risu citations: util.ts, modules.ts, Toggles.svelte:86,95,100,118-119
// Checkbox stores "1"/"0"; select stores option index as string; text/textarea store raw input.

interface ToggleDefinitionsSnapshot {
  readonly chatId: string;
  readonly seq: number;
  readonly toggles: readonly SidebarToggleWire[];
  readonly attribution: Readonly<Record<string, AttributionWire>>;
}

interface ValuesSnapshot {
  readonly chatId: string;
  readonly seq: number;
  readonly scopes: VariableScopes;
}

export interface TogglesTabHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  setActiveChatId(chatId: string | null): void;
  destroy(): void;
}

export interface MountTogglesPanelOptions {
  readonly root: HTMLElement;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
}

export function mountTogglesPanel(opts: MountTogglesPanelOptions): TogglesTabHandle {
  const { sendToBackend, log } = opts;
  log.info('toggles-panel: mounting');

  const root = opts.root;
  root.classList.add('lr-toggles-drawer');

  const intro = document.createElement('p');
  intro.className = 'lr-toggles-intro';
  intro.textContent = 'Module-defined toggles for the active chat.';
  root.appendChild(intro);

  const status = document.createElement('div');
  status.className = 'lr-toggles-status';
  root.appendChild(status);

  const listHost = document.createElement('div');
  listHost.className = 'lr-toggles-list';
  root.appendChild(listHost);

  let activeChatId: string | null = null;
  let defs: ToggleDefinitionsSnapshot | null = null;
  let values: ValuesSnapshot | null = null;
  // Per-key buffer preserves in-progress text across backend-pushed re-renders.
  const textEditBuffers = new Map<string, string>();

  function renderStatus(): void {
    if (!activeChatId) {
      status.textContent = 'Open a Risu chat to see toggles.';
      return;
    }
    if (!defs || defs.chatId !== activeChatId) {
      status.textContent = 'Loading toggles…';
      return;
    }
    const interactiveCount = defs.toggles.filter(
      (t) => t.type === 'select' || t.type === 'text' || t.type === 'textarea' || t.type === 'checkbox',
    ).length;
    if (interactiveCount === 0) {
      status.textContent = 'No toggle-bearing modules attached.';
      return;
    }
    status.textContent = `${interactiveCount} toggle${interactiveCount === 1 ? '' : 's'} from attached modules.`;
  }

  function renderList(): void {
    listHost.innerHTML = '';
    if (!activeChatId || !defs || defs.chatId !== activeChatId) {
      return;
    }
    if (defs.toggles.length === 0) {
      return;
    }
    // Risu Toggles.svelte:54-71
    const tree = groupFlat(defs.toggles);
    for (const node of tree) {
      const el = renderNode(node as GroupedNode);
      if (el) listHost.appendChild(el);
    }
  }

  function renderNode(t: GroupedNode): HTMLElement | null {
    if (t.type === 'group') {
      const det = document.createElement('details');
      det.className = 'lr-toggle-group';
      det.open = true;
      const sum = document.createElement('summary');
      sum.className = 'lr-toggle-group-summary';
      sum.textContent = pickDisplayValue(t) ?? 'Group';
      kickValueTranslate(t, sum);
      det.appendChild(sum);
      const children = t.children ?? [];
      const groupAttr = pickGroupAttribution(children);
      if (groupAttr) {
        const attr = document.createElement('div');
        attr.className = 'lr-toggle-attribution';
        const display = pickAttributionDisplay(groupAttr);
        attr.textContent = display;
        attr.title = `From module: ${display}`;
        kickAttributionTranslate(groupAttr, attr);
        det.appendChild(attr);
      }
      const body = document.createElement('div');
      body.className = 'lr-toggle-group-body';
      for (const child of children) {
        const cel = renderNode(child as GroupedNode);
        if (cel) body.appendChild(cel);
      }
      det.appendChild(body);
      return det;
    }
    if (t.type === 'caption') {
      const cap = document.createElement('div');
      cap.className = 'lr-toggle-caption';
      cap.textContent = pickDisplayValue(t) ?? t.value;
      kickValueTranslate(t, cap);
      return cap;
    }
    if (t.type === 'divider') {
      const div = document.createElement('div');
      div.className = 'lr-toggle-divider';
      if (t.value) {
        const lbl = document.createElement('span');
        lbl.className = 'lr-toggle-divider-label';
        lbl.textContent = pickDisplayValue(t) ?? t.value;
        kickValueTranslate(t, lbl);
        div.appendChild(lbl);
      }
      const hr = document.createElement('hr');
      div.appendChild(hr);
      return div;
    }
    if (t.type === 'groupEnd') return null;
    return renderInteractive(t);
  }

  function pickDisplayValue(t: SidebarToggleWire): string | undefined {
    if (!getTranslateEnabled()) return t.value;
    return t.translatedValue ?? t.value;
  }

  function kickValueTranslate(t: SidebarToggleWire, el: HTMLElement): void {
    if (!getTranslateEnabled()) return;
    if (t.translatedValue) return;
    if (!t.moduleId) return;
    const original = t.value;
    if (!original || original.length === 0) return;
    void translateModuleToggleText(t.moduleId, original).then((tx) => {
      if (tx && tx !== original && el.isConnected && getTranslateEnabled()) {
        el.textContent = tx;
      }
    });
  }

  function renderInteractive(t: SidebarToggleWire): HTMLElement {
    const row = document.createElement('div');
    row.className = 'lr-toggle-row';
    row.dataset['key'] = (t as { key?: string }).key ?? '';
    row.dataset['kind'] = t.type;

    const label = document.createElement('label');
    label.className = 'lr-toggle-label';
    const labelText = document.createElement('span');
    labelText.className = 'lr-toggle-label-text';
    labelText.textContent = pickDisplayValue(t) ?? (t as { value: string }).value;
    kickValueTranslate(t, labelText);
    label.appendChild(labelText);

    const key = (t as { key: string }).key;

    if (t.type === 'checkbox') {
      const stored = readToggle(key);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'lr-toggle-checkbox';
      cb.checked = stored === '1';
      cb.addEventListener('change', () => {
        const next = cb.checked ? '1' : '0';
        sendSet(key, next);
      });
      row.appendChild(cb);
      row.appendChild(label);
    } else if (t.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'lr-toggle-select';
      const stored = readToggle(key);
      const options = t.options ?? [];
      const txMap = t.translatedOptionsByOriginal ?? {};
      const translateOn = getTranslateEnabled();
      for (let i = 0; i < options.length; i++) {
        const original = options[i] ?? '';
        const opt = document.createElement('option');
        opt.value = String(i);
        const cached = translateOn ? txMap[original] : undefined;
        opt.textContent = cached ?? original;
        if (stored === String(i)) opt.selected = true;
        sel.appendChild(opt);
        if (translateOn && !cached && t.moduleId && original.length > 0) {
          const capturedOpt = opt;
          const capturedOriginal = original;
          void translateModuleToggleText(t.moduleId, capturedOriginal).then((tx) => {
            if (
              tx && tx !== capturedOriginal &&
              capturedOpt.isConnected && getTranslateEnabled()
            ) {
              capturedOpt.textContent = tx;
            }
          });
        }
      }
      if (!stored && options.length > 0) {
        sel.selectedIndex = 0;
      }
      sel.addEventListener('change', () => {
        sendSet(key, sel.value);
      });
      row.appendChild(label);
      row.appendChild(sel);
    } else if (t.type === 'text') {
      const stored = readToggle(key);
      const buffered = textEditBuffers.get(key);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'lr-toggle-text';
      input.value = buffered ?? stored;
      input.addEventListener('input', () => {
        textEditBuffers.set(key, input.value);
      });
      const commitText = (): void => {
        const next = input.value;
        textEditBuffers.delete(key);
        if (next !== stored) sendSet(key, next);
      };
      input.addEventListener('change', commitText);
      input.addEventListener('blur', commitText);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitText(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); input.value = stored; textEditBuffers.delete(key); input.blur(); }
      });
      row.appendChild(label);
      row.appendChild(input);
    } else if (t.type === 'textarea') {
      const stored = readToggle(key);
      const buffered = textEditBuffers.get(key);
      const ta = document.createElement('textarea');
      ta.className = 'lr-toggle-textarea';
      ta.rows = 3;
      ta.value = buffered ?? stored;
      ta.addEventListener('input', () => {
        textEditBuffers.set(key, ta.value);
      });
      const commitTextarea = (): void => {
        const next = ta.value;
        textEditBuffers.delete(key);
        if (next !== stored) sendSet(key, next);
      };
      ta.addEventListener('change', commitTextarea);
      ta.addEventListener('blur', commitTextarea);
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commitTextarea(); ta.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); ta.value = stored; textEditBuffers.delete(key); ta.blur(); }
      });
      row.classList.add('lr-toggle-row-stacked');
      row.appendChild(label);
      row.appendChild(ta);
    }

    return row;
  }

  function pickGroupAttribution(children: readonly SidebarToggleWire[]): AttributionWire | null {
    if (!defs) return null;
    for (const c of children) {
      const k = (c as { key?: string }).key;
      if (!k) continue;
      const a = defs.attribution[k];
      if (a) return a;
    }
    return null;
  }

  function pickAttributionDisplay(a: AttributionWire): string {
    if (!getTranslateEnabled()) return a.name;
    return a.translatedName ?? a.name;
  }

  function kickAttributionTranslate(a: AttributionWire, el: HTMLElement): void {
    if (!getTranslateEnabled()) return;
    if (a.translatedName) return;
    if (!a.name || a.name.length === 0) return;
    const moduleId = a.moduleId;
    const original = a.name;
    void translateModuleName(moduleId, original).then((tx) => {
      if (tx && tx !== original && el.isConnected && getTranslateEnabled()) {
        el.textContent = tx;
        el.title = `From module: ${tx}`;
      }
    });
  }

  function readToggle(key: string): string {
    if (!values) return '';
    const stored = values.scopes.global['toggle_' + key];
    return typeof stored === 'string' ? stored : '';
  }

  function sendSet(key: string, value: string): void {
    if (!activeChatId) return;
    log.info(`toggles-tab: set chatId=${activeChatId} key=${key} value=${value.length > 50 ? `<${value.length} chars>` : JSON.stringify(value)}`);
    sendToBackend({
      type: 'set_toggle',
      chatId: activeChatId,
      key,
      value,
    });
  }

  function render(): void {
    renderStatus();
    renderList();
  }

  function seedScopeLangs(toggles: readonly SidebarToggleWire[]): void {
    const corpusByModule = new Map<string, string[]>();
    for (const t of toggles) {
      if (!t.moduleId) continue;
      let bucket = corpusByModule.get(t.moduleId);
      if (!bucket) {
        bucket = [];
        corpusByModule.set(t.moduleId, bucket);
      }
      if (typeof t.value === 'string' && t.value.length > 0) bucket.push(t.value);
      if (t.type === 'select') {
        for (const o of t.options) {
          if (typeof o === 'string' && o.length > 0) bucket.push(o);
        }
      }
    }
    for (const [moduleId, corpus] of corpusByModule.entries()) {
      setModuleScopeLang(moduleId, dominantScriptLang(corpus));
    }
  }

  const unsubTranslate = subscribeTranslateEnabled(() => render());

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (msg.type === 'set_toggle_definitions') {
      // One slot: a background chat's push would blank the panel until the
      // next switch. CHAT_SWITCHED force-pushes, so dropping loses nothing.
      if (activeChatId !== null && msg.chatId !== activeChatId) return;
      if (defs && defs.chatId === msg.chatId && defs.seq > msg.seq) return;
      defs = {
        chatId: msg.chatId,
        seq: msg.seq,
        toggles: msg.toggles,
        attribution: msg.attribution,
      };
      seedScopeLangs(msg.toggles);
      log.info(`toggles-tab.set_toggle_definitions: chat=${msg.chatId} seq=${msg.seq} count=${msg.toggles.length}`);
      render();
      return;
    }
    if (msg.type === 'set_variables') {
      if (values && values.chatId === msg.chatId && values.seq > msg.seq) return;
      values = {
        chatId: msg.chatId,
        seq: msg.seq,
        scopes: msg.scopes,
      };
      if (defs && defs.chatId === activeChatId) {
        render();
      }
      return;
    }
  }

  function setActiveChatId(chatId: string | null): void {
    if (activeChatId === chatId) return;
    log.info(`toggles-tab.setActiveChatId: ${activeChatId ?? 'null'} -> ${chatId ?? 'null'}`);
    activeChatId = chatId;
    textEditBuffers.clear();
    if (chatId) {
      if (defs && defs.chatId !== chatId) defs = null;
      if (values && values.chatId !== chatId) values = null;
      sendToBackend({ type: 'request_toggle_definitions', chatId });
      sendToBackend({ type: 'request_variables_snapshot', chatId });
    } else {
      defs = null;
      values = null;
    }
    render();
  }

  render();
  log.info('toggles-panel: ready');

  return {
    handleBackendMessage,
    setActiveChatId,
    destroy(): void {
      log.info('toggles-panel: destroy');
      try { unsubTranslate(); } catch { /* ignore */ }
      try { root.replaceChildren(); } catch { /* ignore */ }
    },
  };
}


type GroupedNode = SidebarToggleWire & { children?: SidebarToggleWire[] };

function groupFlat(flat: readonly SidebarToggleWire[]): readonly GroupedNode[] {
  const out: GroupedNode[] = [];
  let openGroup: (GroupedNode & { children: SidebarToggleWire[] }) | null = null;
  for (const t of flat) {
    if (t.type === 'group') {
      const fresh: GroupedNode & { children: SidebarToggleWire[] } = {
        ...t,
        children: [],
      };
      out.push(fresh);
      openGroup = fresh;
      continue;
    }
    if (t.type === 'groupEnd') {
      openGroup = null;
      continue;
    }
    if (openGroup) {
      openGroup.children.push(t);
    } else {
      out.push(t);
    }
  }
  return out;
}
