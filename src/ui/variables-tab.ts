import type {
  BackendToFrontend,
  FrontendToBackend,
  VariableScopes,
} from '../types/messages.js';
import type { FrontendLog } from './drawer.js';

// Two subtabs (Local + Lumi). Default-vars editor lives in Viewer → Defaults.

interface Snapshot {
  readonly chatId: string;
  readonly seq: number;
  readonly scopes: VariableScopes;
  readonly defaults: Readonly<Record<string, string>>;
  readonly defaultsCardSide: Readonly<Record<string, string>>;
  readonly characterId: string | null;
  readonly ts: number;
}

type SubTabId = 'local' | 'lumi';

const SUB_TABS: ReadonlyArray<{ id: SubTabId; label: string; title: string }> = [
  { id: 'local', label: 'Local', title: 'Chat-scoped variables. setvar / setChatVar / Lua setState write here.' },
  { id: 'lumi',  label: 'Lumi',  title: 'Lumi-native global + chat scopes. Read-only, Risu cards do not use these.' },
];

export interface VariablesTabHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  setActiveChatId(chatId: string | null): void;
  destroy(): void;
}

export interface MountVariablesPanelOptions {
  readonly root: HTMLElement;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
}

export function mountVariablesPanel(
  opts: MountVariablesPanelOptions,
): VariablesTabHandle {
  const { sendToBackend, log } = opts;
  log.info('variables-panel: mounting');

  const root = opts.root;
  root.classList.add('risu-vars-drawer');

  const intro = document.createElement('p');
  intro.className = 'rv-intro';
  intro.textContent = 'Live macro variables for the active chat.';
  root.appendChild(intro);

  const toolbar = document.createElement('div');
  toolbar.className = 'rv-toolbar';

  const filterInput = document.createElement('input');
  filterInput.type = 'text';
  filterInput.className = 'rv-filter';
  filterInput.placeholder = 'Filter by key or value…';
  filterInput.spellcheck = false;
  toolbar.appendChild(filterInput);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'lrm-btn';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Re-fetch the snapshot.';
  toolbar.appendChild(refreshBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'lrm-btn';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.title = 'Copy snapshot to clipboard.';
  toolbar.appendChild(copyBtn);

  root.appendChild(toolbar);

  const status = document.createElement('div');
  status.className = 'rv-status';
  root.appendChild(status);

  // Inner subtab bar (Default / Local / Lumi).
  const subnav = document.createElement('div');
  subnav.className = 'lr-subtabs';
  subnav.setAttribute('role', 'tablist');
  root.appendChild(subnav);

  const subnavBtns = new Map<SubTabId, HTMLButtonElement>();
  for (const def of SUB_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lr-subtab';
    btn.textContent = def.label;
    btn.title = def.title;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.addEventListener('click', () => activateSubTab(def.id));
    subnav.appendChild(btn);
    subnavBtns.set(def.id, btn);
  }

  const body = document.createElement('div');
  body.className = 'lr-vars-body';
  root.appendChild(body);

  let activeChatId: string | null = null;
  let snapshot: Snapshot | null = null;
  let filterTerm = '';
  let activeSubTab: SubTabId = 'local';
  const editBuffers = new Map<string, string>();
  const addRow: Record<SubTabId, { open: boolean; name: string; value: string }> = {
    local: { open: false, name: '', value: '' },
    lumi:  { open: false, name: '', value: '' },
  };

  function activateSubTab(id: SubTabId): void {
    if (activeSubTab === id) return;
    activeSubTab = id;
    log.info(`variables-tab: subtab → ${id}`);
    render();
  }

  function renderSubnav(): void {
    for (const [id, btn] of subnavBtns) {
      const sel = id === activeSubTab;
      btn.classList.toggle('lr-subtab-active', sel);
      btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
  }

  function renderStatus(): void {
    if (!activeChatId) {
      status.textContent = 'Open a Risu chat to see variables.';
      status.classList.remove('rv-status-error');
      return;
    }
    if (!snapshot || snapshot.chatId !== activeChatId) {
      status.textContent = `Loading variables for chat ${shortId(activeChatId)}…`;
      status.classList.remove('rv-status-error');
      return;
    }
    const t = countTotals(snapshot);
    const ts = formatTime(snapshot.ts);
    status.textContent =
      `chat ${shortId(snapshot.chatId)} · seq ${snapshot.seq} · ` +
      `local=${t.local} lumi=${t.global + t.chat} · ` +
      `updated ${ts}`;
    status.classList.remove('rv-status-error');
  }

  function renderBody(): void {
    body.replaceChildren();
    if (!activeChatId || !snapshot || snapshot.chatId !== activeChatId) {
      const empty = document.createElement('div');
      empty.className = 'rv-empty';
      empty.textContent = activeChatId ? 'Waiting for backend…' : 'No active Risu chat.';
      body.appendChild(empty);
      return;
    }
    switch (activeSubTab) {
      case 'local': body.appendChild(renderLocalPanel()); break;
      case 'lumi':  body.appendChild(renderLumiPanel());  break;
    }
  }

  // ---------- Local subtab ---------------------------------------------------

  function renderLocalPanel(): HTMLElement {
    const wrap = document.createElement('section');
    wrap.className = 'lr-var-section';

    const note = document.createElement('p');
    note.className = 'lr-var-note';
    note.textContent =
      'Chat-scoped variables. Risu setvar / setChatVar / Lua setState write here. ' +
      'Lua state keys (__name) are JSON-encoded.';
    wrap.appendChild(note);

    const term = filterTerm.toLowerCase();
    const local = snapshot!.scopes.local;
    const rows = sortedKeys(local).filter((name) => {
      if (!term) return true;
      const v = local[name] ?? '';
      return name.toLowerCase().includes(term) || v.toLowerCase().includes(term);
    });

    const list = document.createElement('div');
    list.className = 'lr-var-list';
    if (rows.length === 0 && !addRow.local.open) {
      const empty = document.createElement('div');
      empty.className = 'rv-empty';
      empty.textContent = term ? `No matches for "${filterTerm}".` : '(empty)';
      list.appendChild(empty);
    } else {
      for (const name of rows) {
        const value = local[name] ?? '';
        list.appendChild(renderEditableRow({
          subtab: 'local',
          name,
          value,
          isLuaState: name.startsWith('__'),
          onCommit: (next) => sendSetLocal(name, next),
          onReset: null,
          allowDelete: true,
          onDelete: () => sendDeleteLocal(name),
        }));
      }
    }

    if (addRow.local.open) list.appendChild(renderAddRow('local'));
    wrap.appendChild(list);

    if (!addRow.local.open) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'lrm-btn lr-var-add-btn';
      addBtn.textContent = '+ Add variable';
      addBtn.addEventListener('click', () => {
        addRow.local = { open: true, name: '', value: '' };
        render();
      });
      wrap.appendChild(addBtn);
    }
    return wrap;
  }

  // ---------- Lumi subtab (read-only) ---------------------------------------

  function renderLumiPanel(): HTMLElement {
    const wrap = document.createElement('section');
    wrap.className = 'lr-var-section';

    const note = document.createElement('p');
    note.className = 'lr-var-note';
    note.textContent =
      'Lumi-native scopes (read-only). Most Risu cards don\'t touch these; ' +
      'surfaced for diagnostics and Lumi-native card interop.';
    wrap.appendChild(note);

    const term = filterTerm.toLowerCase();
    let any = false;
    for (const [label, rec] of [
      ['Global', snapshot!.scopes.global] as const,
      ['Chat',   snapshot!.scopes.chat]   as const,
    ]) {
      const keys = sortedKeys(rec).filter((name) => {
        if (!term) return true;
        const v = rec[name] ?? '';
        return name.toLowerCase().includes(term) || v.toLowerCase().includes(term);
      });
      const sec = document.createElement('div');
      sec.className = 'lr-var-subsection';
      const head = document.createElement('h4');
      head.className = 'lr-var-subsection-title';
      head.textContent = `${label} · ${keys.length}${term ? ` of ${Object.keys(rec).length}` : ''}`;
      sec.appendChild(head);
      const list = document.createElement('div');
      list.className = 'lr-var-list';
      if (keys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'rv-empty';
        empty.textContent = term ? '(no matches)' : '(empty)';
        list.appendChild(empty);
      } else {
        any = true;
        for (const name of keys) {
          list.appendChild(renderReadonlyRow(name, rec[name] ?? ''));
        }
      }
      sec.appendChild(list);
      wrap.appendChild(sec);
    }
    if (!any && !term) {
      const note2 = document.createElement('div');
      note2.className = 'rv-empty';
      note2.textContent = 'Both Lumi-native scopes are empty for this chat.';
      wrap.appendChild(note2);
    }
    return wrap;
  }

  // ---------- Row components -------------------------------------------------

  interface EditableRowOpts {
    readonly subtab: SubTabId;
    readonly name: string;
    readonly value: string;
    readonly isOverride?: boolean;
    readonly isLuaState?: boolean;
    readonly originalValue?: string | undefined;
    readonly onCommit: (next: string) => void;
    readonly onReset: (() => void) | null;
    readonly allowDelete: boolean;
    readonly onDelete?: () => void;
  }

  function renderEditableRow(o: EditableRowOpts): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lr-var-row';
    if (o.isOverride) row.classList.add('lr-var-row-overridden');

    const head = document.createElement('div');
    head.className = 'lr-var-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'lr-var-name';
    nameEl.textContent = o.name;
    nameEl.title = o.name;
    head.appendChild(nameEl);
    if (o.isOverride) {
      const flag = document.createElement('span');
      flag.className = 'lr-var-flag';
      flag.textContent = 'override';
      flag.title = o.originalValue !== undefined ? `Card default: ${o.originalValue}` : 'No card default — override-only.';
      head.appendChild(flag);
    }
    if (o.isLuaState) {
      const flag = document.createElement('span');
      flag.className = 'lr-var-flag lr-var-flag-lua';
      flag.textContent = 'lua';
      flag.title = 'Lua state. Value is JSON-encoded.';
      head.appendChild(flag);
    }
    row.appendChild(head);

    const bufKey = `${o.subtab}:${o.name}`;
    const buffered = editBuffers.get(bufKey);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lr-var-input';
    input.value = buffered ?? o.value;
    input.spellcheck = false;
    input.addEventListener('input', () => {
      editBuffers.set(bufKey, input.value);
    });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = o.value;
        editBuffers.delete(bufKey);
        input.blur();
      }
    });
    row.appendChild(input);

    const actions = document.createElement('span');
    actions.className = 'lr-var-actions';
    if (o.onReset) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'lr-var-action';
      reset.textContent = 'Reset';
      reset.title = o.originalValue !== undefined ? `Restore card default: "${o.originalValue}"` : 'Remove this override.';
      reset.addEventListener('click', (e) => {
        e.stopPropagation();
        editBuffers.delete(bufKey);
        o.onReset?.();
      });
      actions.appendChild(reset);
    }
    if (o.allowDelete && o.onDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'lr-var-action lr-var-action-danger';
      del.textContent = '×';
      del.title = `Delete "${o.name}"`;
      del.setAttribute('aria-label', `Delete ${o.name}`);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete variable "${o.name}"?\n\nIf the character has a default for this key, getChatVar will fall back to it. Otherwise reads return the literal string "null".`)) return;
        editBuffers.delete(bufKey);
        o.onDelete?.();
      });
      actions.appendChild(del);
    }
    row.appendChild(actions);

    return row;

    function commit(): void {
      const next = input.value;
      editBuffers.delete(bufKey);
      if (next !== o.value) o.onCommit(next);
    }
  }

  function renderReadonlyRow(name: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lr-var-row lr-var-row-readonly';
    const head = document.createElement('div');
    head.className = 'lr-var-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'lr-var-name';
    nameEl.textContent = name;
    nameEl.title = name;
    head.appendChild(nameEl);
    row.appendChild(head);
    const valEl = document.createElement('div');
    valEl.className = 'lr-var-value-readonly';
    const isLong = value.length > 200 || value.includes('\n');
    if (!isLong) {
      valEl.textContent = value;
      valEl.title = value;
    } else {
      valEl.textContent = value.slice(0, 200) + '…';
      valEl.title = 'Click to expand';
      valEl.classList.add('lr-var-value-long');
      valEl.addEventListener('click', () => {
        if (valEl.classList.contains('lr-var-value-expanded')) {
          valEl.textContent = value.slice(0, 200) + '…';
          valEl.classList.remove('lr-var-value-expanded');
        } else {
          valEl.textContent = value;
          valEl.classList.add('lr-var-value-expanded');
        }
      });
    }
    row.appendChild(valEl);
    return row;
  }

  function renderAddRow(subtab: SubTabId): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'lr-var-row lr-var-row-add';
    const buf = addRow[subtab];

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'lr-var-name-input';
    nameInput.placeholder = 'name';
    nameInput.value = buf.name;
    nameInput.spellcheck = false;
    nameInput.addEventListener('input', () => { buf.name = nameInput.value; });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); valueInput.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'lr-var-input';
    valueInput.placeholder = 'value';
    valueInput.value = buf.value;
    valueInput.spellcheck = false;
    valueInput.addEventListener('input', () => { buf.value = valueInput.value; });
    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    const actions = document.createElement('span');
    actions.className = 'lr-var-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'lr-var-action lr-var-action-primary';
    saveBtn.textContent = 'Add';
    saveBtn.addEventListener('click', commit);
    actions.appendChild(saveBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'lr-var-action';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', cancel);
    actions.appendChild(cancelBtn);

    wrap.appendChild(nameInput);
    wrap.appendChild(valueInput);
    wrap.appendChild(actions);

    queueMicrotask(() => nameInput.focus());

    return wrap;

    function commit(): void {
      const name = buf.name.trim();
      if (name.length === 0) { nameInput.focus(); return; }
      if (subtab === 'local') sendSetLocal(name, buf.value);
      addRow[subtab] = { open: false, name: '', value: '' };
      render();
    }
    function cancel(): void {
      addRow[subtab] = { open: false, name: '', value: '' };
      render();
    }
  }

  // ---------- Backend sends --------------------------------------------------

  function sendSetLocal(key: string, value: string): void {
    if (!activeChatId) return;
    log.info(`variables-tab: set_variable chat=${activeChatId} key=${key} len=${value.length}`);
    sendToBackend({
      type: 'set_variable',
      chatId: activeChatId,
      scope: 'local',
      key,
      value,
    });
  }
  function sendDeleteLocal(key: string): void {
    if (!activeChatId) return;
    log.info(`variables-tab: delete_variable chat=${activeChatId} key=${key}`);
    sendToBackend({
      type: 'delete_variable',
      chatId: activeChatId,
      scope: 'local',
      key,
    });
  }

  // ---------- Wiring ---------------------------------------------------------

  function render(): void {
    renderSubnav();
    renderStatus();
    renderBody();
  }

  let filterTimer: number | undefined;
  filterInput.addEventListener('input', () => {
    if (filterTimer !== undefined) window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filterTerm = filterInput.value.trim();
      renderBody();
    }, 60);
  });

  refreshBtn.addEventListener('click', () => {
    if (!activeChatId) {
      log.info('variables-tab: refresh clicked but no active chat');
      return;
    }
    log.info(`variables-tab: refresh chat=${activeChatId}`);
    sendToBackend({ type: 'request_variables_snapshot', chatId: activeChatId });
  });

  copyBtn.addEventListener('click', () => {
    if (!snapshot) return;
    const payload = JSON.stringify(snapshot, null, 2);
    void navigator.clipboard?.writeText(payload).then(
      () => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        window.setTimeout(() => { copyBtn.textContent = original; }, 1200);
      },
      (err) => log.warn('variables-tab: copy failed', err),
    );
  });

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (msg.type !== 'set_variables') return;
    log.info(`variables-tab.set_variables: chatId=${msg.chatId} seq=${msg.seq} ts=${msg.ts}`);
    // One slot: a background chat's push would blank the panel until the next
    // switch. CHAT_SWITCHED force-pushes, so dropping loses nothing.
    if (activeChatId !== null && msg.chatId !== activeChatId) return;
    if (snapshot && snapshot.chatId === msg.chatId && snapshot.seq > msg.seq) {
      log.info(`variables-tab: ignoring older snapshot seq=${msg.seq} (have=${snapshot.seq})`);
      return;
    }
    snapshot = {
      chatId: msg.chatId,
      seq: msg.seq,
      scopes: msg.scopes,
      defaults: msg.defaults,
      defaultsCardSide: msg.defaultsCardSide ?? msg.defaults,
      characterId: msg.characterId ?? null,
      ts: msg.ts,
    };
    render();
  }

  function setActiveChatId(chatId: string | null): void {
    if (activeChatId === chatId) return;
    log.info(`variables-tab.setActiveChatId: ${activeChatId ?? 'null'} -> ${chatId ?? 'null'}`);
    activeChatId = chatId;
    editBuffers.clear();
    addRow.local = { open: false, name: '', value: '' };
    if (chatId) {
      if (snapshot && snapshot.chatId !== chatId) snapshot = null;
      sendToBackend({ type: 'request_variables_snapshot', chatId });
    } else {
      snapshot = null;
    }
    render();
  }

  render();
  log.info('variables-panel: ready');

  return {
    handleBackendMessage,
    setActiveChatId,
    destroy(): void {
      log.info('variables-panel: destroy');
      try { root.replaceChildren(); } catch { /* ignore */ }
    },
  };
}

function sortedKeys(rec: Readonly<Record<string, string>>): string[] {
  return Object.keys(rec).sort((a, b) => a.localeCompare(b));
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + '…' : id;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function countTotals(snap: Snapshot): { local: number; global: number; chat: number } {
  return {
    local: Object.keys(snap.scopes.local).length,
    global: Object.keys(snap.scopes.global).length,
    chat: Object.keys(snap.scopes.chat).length,
  };
}
