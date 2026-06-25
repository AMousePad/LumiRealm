import type {
  AttachedModuleSummary,
  BackendToFrontend,
  CardSummary,
  FrontendToBackend,
  ModuleSummary,
} from '../types/messages.js';
import type { FrontendLog } from './drawer.js';
import { errMsg } from '../util/coerce.js';
import { getTranslateEnabled, subscribeTranslateEnabled } from './translate-toggle.js';
import { translateModuleName, translateModuleDescription, translateCharacterName, setModuleScopeLang, setCharacterScopeLang } from './translate-orchestrator.js';
import { dominantScriptLang } from './browser-translator.js';
import { createSearchableSelect, type SearchableSelectHandle } from './searchable-select.js';
import { sendImportText } from './import-text-upload.js';

// Mounts into a host element provided by ui/sidebar.ts.

const CHUNK_BYTES = 2500 * 1024;
const CHUNK_WIRE_WARN_BYTES = 3_800_000;
const INIT_ACK_TIMEOUT_MS = 15_000;
const CHUNK_ACK_TIMEOUT_MS = 20_000;
const COMMIT_FIRST_PROGRESS_TIMEOUT_MS = 60_000;
const UPLOAD_WINDOW_SIZE = 30;

const ACCEPT_EXTENSIONS = ['.risum'];

// Browsers (Chrome especially) throttle background-tab timers heavily, so a
// plain setTimeout fires the abort even though the BE is responding fine.
// Track elapsed only while visible, pause + resume on visibility change.
interface VizTimer {
  remainingMs: number;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  onFire: () => void;
  cancelled: boolean;
}
const liveVizTimers = new Set<VizTimer>();
function vizStartTimer(t: VizTimer): void {
  t.startedAt = Date.now();
  t.timer = setTimeout(() => {
    t.timer = null;
    if (t.cancelled) return;
    liveVizTimers.delete(t);
    t.onFire();
  }, t.remainingMs);
}
function vizSetTimeout(ms: number, onFire: () => void): VizTimer {
  const t: VizTimer = { remainingMs: ms, startedAt: 0, timer: null, onFire, cancelled: false };
  liveVizTimers.add(t);
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    vizStartTimer(t);
  }
  return t;
}
function vizClearTimeout(t: VizTimer): void {
  t.cancelled = true;
  if (t.timer !== null) {
    clearTimeout(t.timer);
    t.timer = null;
  }
  liveVizTimers.delete(t);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    for (const t of liveVizTimers) {
      if (t.cancelled) continue;
      if (visible && t.timer === null) {
        vizStartTimer(t);
      } else if (!visible && t.timer !== null) {
        const elapsed = Date.now() - t.startedAt;
        t.remainingMs = Math.max(0, t.remainingMs - elapsed);
        clearTimeout(t.timer);
        t.timer = null;
      }
    }
  });
}

interface PendingAck {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: VizTimer;
}

interface ChunkTiming {
  seq: number;
  encodeMs: number;
  sentAt: number;
  ackedAt: number | null;
}

interface UploadSession {
  readonly sessionId: string;
  lastAckSeq: number;
  receivedBytesOnBackend: number;
  pendingAcks: Map<number, PendingAck>;
  aborted: boolean;
  startedAt: number;
  lastAckAt: number;
  timings: ChunkTiming[];
}

export interface ModulesPanelHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export interface MountModulesPanelOptions {
  readonly root: HTMLElement;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
  /** Optional slot mounted at the top of the Characters section.
   *  Used by the Import tab to inject the cards-panel (Upload card button +
   *  status/progress) inside the Characters dropdown. */
  readonly mountCharactersHeader?: (root: HTMLElement) => {
    readonly handleBackendMessage: (msg: BackendToFrontend) => void;
    readonly destroy: () => void;
  };
  readonly onImportStart?: (label: string, onCancel?: () => void, totalBytes?: number) => void;
}

export function mountModulesPanel(opts: MountModulesPanelOptions): ModulesPanelHandle {
  const { sendToBackend, log } = opts;
  log.info('modules-panel: mounting');

  const root = opts.root;
  root.classList.add('lr-modules-drawer');

  let modules: readonly ModuleSummary[] | null = null;
  let cards: readonly CardSummary[] = [];
  const attachedByCharacter = new Map<string, readonly AttachedModuleSummary[]>();
  let activeUpload: UploadSession | null = null;
  const expandedCharacters = new Set<string>();
  const expandedModules = new Set<string>();
  let lastError: string | null = null;

  // Subtab nav (Characters / Modules / Lorebooks). Each subtab is a flat
  // body , no outer `<details>` chrome since the tab itself isolates content.
  type ImportSubTabId = 'characters' | 'modules' | 'lorebooks' | 'regex';
  const SUB_TABS: ReadonlyArray<{ id: ImportSubTabId; label: string; title: string }> = [
    { id: 'characters', label: 'Characters', title: 'Imported Risu cards. Click any row to manage attached modules.' },
    { id: 'modules',    label: 'Modules',    title: 'Module library. Click any row for details / delete.' },
    { id: 'lorebooks',  label: 'Lorebooks',  title: 'Standalone lorebook import. Creates an unattached world_book; attach via Lumiverse.' },
    { id: 'regex',      label: 'Regex',      title: 'Standalone Risu regex import. Installs global regex rules grouped under a folder.' },
  ];
  const subnav = document.createElement('div');
  subnav.className = 'lr-subtabs';
  subnav.setAttribute('role', 'tablist');
  root.appendChild(subnav);
  const subnavBtns = new Map<ImportSubTabId, HTMLButtonElement>();
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
  let activeSubTab: ImportSubTabId = 'characters';

  // ---- Characters subtab ---------------------------------------------------
  const charBody = document.createElement('section');
  charBody.className = 'lrm-section-body lrm-tab-body';

  const charDesc = document.createElement('div');
  charDesc.className = 'lrm-section-desc';
  charDesc.textContent =
    'Upload Risu character cards (.charx, .png, .json, .jpg/.jpeg). Click any row to manage attached modules. Delete characters through Lumiverse.';
  charBody.appendChild(charDesc);

  const charHeaderSlot = document.createElement('div');
  charHeaderSlot.className = 'lrm-character-header-slot';
  charBody.appendChild(charHeaderSlot);
  const charHeaderHandle = opts.mountCharactersHeader
    ? opts.mountCharactersHeader(charHeaderSlot)
    : null;

  let charSearchTerm = '';
  const charFilterRow = document.createElement('div');
  charFilterRow.className = 'lrm-list-filter';
  const charSearch = document.createElement('input');
  charSearch.type = 'search';
  charSearch.className = 'lrm-list-search';
  charSearch.placeholder = 'Search characters…';
  charSearch.spellcheck = false;
  charFilterRow.appendChild(charSearch);
  const charFilterCount = document.createElement('span');
  charFilterCount.className = 'lrm-list-filter-count';
  charFilterRow.appendChild(charFilterCount);
  charBody.appendChild(charFilterRow);

  const charList = document.createElement('div');
  charList.className = 'lrm-characters-list';
  charBody.appendChild(charList);

  // ---- Modules subtab ------------------------------------------------------
  const libBody = document.createElement('section');
  libBody.className = 'lrm-section-body lrm-tab-body';

  const libToolbar = document.createElement('div');
  libToolbar.className = 'lrm-toolbar';
  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'lrm-btn lrm-btn-primary';
  uploadBtn.textContent = 'Upload .risum';
  uploadBtn.title = 'Pick a .risum module file.';
  libToolbar.appendChild(uploadBtn);
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'lrm-btn';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Re-fetch the module list.';
  libToolbar.appendChild(refreshBtn);
  libBody.appendChild(libToolbar);

  let moduleSearchTerm = '';
  const libFilterRow = document.createElement('div');
  libFilterRow.className = 'lrm-list-filter';
  const moduleSearch = document.createElement('input');
  moduleSearch.type = 'search';
  moduleSearch.className = 'lrm-list-search';
  moduleSearch.placeholder = 'Search modules…';
  moduleSearch.spellcheck = false;
  libFilterRow.appendChild(moduleSearch);
  const libFilterCount = document.createElement('span');
  libFilterCount.className = 'lrm-list-filter-count';
  libFilterRow.appendChild(libFilterCount);
  libBody.appendChild(libFilterRow);

  const libList = document.createElement('div');
  libList.className = 'lrm-modules-list';
  libBody.appendChild(libList);

  // ---- Lorebooks subtab ----------------------------------------------------
  const lorebooksBody = document.createElement('section');
  lorebooksBody.className = 'lrm-section-body lrm-tab-body';

  const lbToolbar = document.createElement('div');
  lbToolbar.className = 'lrm-toolbar';
  const lbUploadBtn = document.createElement('button');
  lbUploadBtn.type = 'button';
  lbUploadBtn.className = 'lrm-btn lrm-btn-primary';
  lbUploadBtn.textContent = 'Upload lorebook…';
  lbUploadBtn.title = 'Pick a Risu native or CCSv3 lorebook JSON file.';
  lbToolbar.appendChild(lbUploadBtn);
  lorebooksBody.appendChild(lbToolbar);

  const lbStatus = document.createElement('div');
  lbStatus.className = 'lrm-lorebook-status';
  lorebooksBody.appendChild(lbStatus);

  // ---- Regex subtab --------------------------------------------------------
  const regexBody = document.createElement('section');
  regexBody.className = 'lrm-section-body lrm-tab-body';

  const rxDesc = document.createElement('div');
  rxDesc.className = 'lrm-section-desc';
  rxDesc.textContent =
    'Upload a Risu regex export (.json). Choose Global (applies to every chat) or a character. Rules group under a folder named after the file.';
  regexBody.appendChild(rxDesc);

  const rxToolbar = document.createElement('div');
  rxToolbar.className = 'lrm-toolbar';
  const regexTargetSelect = createSearchableSelect({
    className: 'lrm-regex-target',
    placeholder: 'Global (all chats)',
    searchPlaceholder: 'Search characters…',
    emptyMessage: 'No characters',
    items: [{ value: '', label: 'Global (all chats)' }],
    value: '',
    onChange: () => { /* read on upload */ },
  });
  rxToolbar.appendChild(regexTargetSelect.root);
  const rxUploadBtn = document.createElement('button');
  rxUploadBtn.type = 'button';
  rxUploadBtn.className = 'lrm-btn lrm-btn-primary';
  rxUploadBtn.textContent = 'Upload regex…';
  rxUploadBtn.title = 'Pick a Risu regex export JSON file.';
  rxToolbar.appendChild(rxUploadBtn);
  regexBody.appendChild(rxToolbar);

  const rxStatus = document.createElement('div');
  rxStatus.className = 'lrm-lorebook-status';
  regexBody.appendChild(rxStatus);

  // ---- Subtab activation ---------------------------------------------------
  const panelsHost = document.createElement('div');
  panelsHost.className = 'lr-subtab-panels';
  panelsHost.appendChild(charBody);
  panelsHost.appendChild(libBody);
  panelsHost.appendChild(lorebooksBody);
  panelsHost.appendChild(regexBody);
  root.appendChild(panelsHost);

  function activateSubTab(id: ImportSubTabId): void {
    activeSubTab = id;
    for (const [k, btn] of subnavBtns) {
      const sel = k === id;
      btn.classList.toggle('lr-subtab-active', sel);
      btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
    charBody.hidden = id !== 'characters';
    libBody.hidden = id !== 'modules';
    lorebooksBody.hidden = id !== 'lorebooks';
    regexBody.hidden = id !== 'regex';
  }
  activateSubTab(activeSubTab);

  function setStatus(_msg: string | null, _isError = false): void { /* no-op */ }

  function renderModuleList(): void {
    libList.replaceChildren();
    if (modules === null) {
      libFilterCount.textContent = '';
      const loading = document.createElement('div');
      loading.className = 'lrm-empty';
      loading.textContent = 'Loading…';
      libList.appendChild(loading);
      return;
    }
    if (modules.length === 0) {
      libFilterCount.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'lrm-empty';
      empty.textContent = 'No modules uploaded yet.';
      libList.appendChild(empty);
      return;
    }
    const filtered = moduleSearchTerm.trim().length === 0
      ? modules.slice()
      : modules.filter((m) => matchesSearch(moduleSearchTerm, m.name, m.translatedName, m.id, m.filename));
    libFilterCount.textContent = moduleSearchTerm.trim().length > 0
      ? `${filtered.length} of ${modules.length}`
      : '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrm-empty';
      empty.textContent = `No matches for "${moduleSearchTerm}".`;
      libList.appendChild(empty);
      return;
    }
    for (const m of filtered) {
      libList.appendChild(renderModuleRow(m));
    }
  }

  function pickModuleDisplayName(m: ModuleSummary): string {
    if (getTranslateEnabled() && m.translatedName) return m.translatedName;
    return m.name;
  }
  function pickModuleDisplayDescription(m: ModuleSummary): string {
    if (getTranslateEnabled() && m.translatedDescription) return m.translatedDescription;
    return m.description;
  }
  function pickAttachedDisplayName(a: AttachedModuleSummary): string {
    if (getTranslateEnabled() && a.translatedName) return a.translatedName;
    return a.name;
  }

  function renderModuleRow(m: ModuleSummary): HTMLDetailsElement {
    const det = document.createElement('details');
    det.className = 'lrm-module';
    det.open = expandedModules.has(m.id);
    det.addEventListener('toggle', () => {
      if (det.open) expandedModules.add(m.id);
      else expandedModules.delete(m.id);
    });

    const sum = document.createElement('summary');
    sum.className = 'lrm-module-summary';
    const nameEl = document.createElement('span');
    nameEl.className = 'lrm-module-name';
    const displayName = pickModuleDisplayName(m);
    nameEl.textContent = displayName || '(unnamed)';
    nameEl.title = `${m.name}\nid: ${m.id}\nfilename: ${m.filename}`;
    sum.appendChild(nameEl);
    if (getTranslateEnabled() && !m.translatedName && m.name) {
      void translateModuleName(m.id, m.name).then((tx) => {
        if (tx && tx !== m.name && nameEl.isConnected) {
          nameEl.textContent = tx;
        }
      });
    }
    const attachedTo = countAttachments(m.id);
    if (attachedTo > 0) {
      const badge = document.createElement('span');
      badge.className = 'lrm-module-attached-badge';
      badge.textContent = `${attachedTo} attached`;
      sum.appendChild(badge);
    }
    det.appendChild(sum);

    const body = document.createElement('div');
    body.className = 'lrm-module-body';

    const sub = document.createElement('div');
    sub.className = 'lrm-module-sub';
    const parts: string[] = [];
    if (m.lorebook_count > 0) parts.push(`${m.lorebook_count} lore`);
    if (m.regex_count > 0) parts.push(`${m.regex_count} regex`);
    if (m.trigger_count > 0) parts.push(`${m.trigger_count} trigger`);
    if (m.asset_count > 0) parts.push(`${m.asset_count} asset`);
    sub.textContent = parts.join(' · ') || '(empty)';
    body.appendChild(sub);

    if (m.description) {
      const desc = document.createElement('div');
      desc.className = 'lrm-module-desc';
      const displayDesc = pickModuleDisplayDescription(m);
      desc.textContent = displayDesc || m.description;
      body.appendChild(desc);
      if (getTranslateEnabled() && !m.translatedDescription) {
        void translateModuleDescription(m.id, m.description).then((tx) => {
          if (tx && tx !== m.description && desc.isConnected) {
            desc.textContent = tx;
          }
        });
      }
    }

    const actions = document.createElement('div');
    actions.className = 'lrm-module-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'lrm-btn lrm-btn-danger';
    del.textContent = 'Delete';
    del.title = `Remove "${displayName}" and detach from all characters.`;
    del.addEventListener('click', () => {
      if (!window.confirm(`Delete module "${displayName}"?`)) return;
      log.info(`modules-panel: delete_module id=${m.id}`);
      sendToBackend({ type: 'delete_module', moduleId: m.id });
    });
    actions.appendChild(del);
    body.appendChild(actions);
    det.appendChild(body);

    return det;
  }

  function countAttachments(moduleId: string): number {
    let n = 0;
    for (const list of attachedByCharacter.values()) {
      if (list.some((a) => a.id === moduleId)) n += 1;
    }
    return n;
  }

  const attachSelectHandles: SearchableSelectHandle[] = [];
  function destroyAttachSelects(): void {
    for (const h of attachSelectHandles) h.destroy();
    attachSelectHandles.length = 0;
  }

  function matchesSearch(term: string, ...parts: ReadonlyArray<string | undefined | null>): boolean {
    const q = term.trim().toLocaleLowerCase();
    if (q.length === 0) return true;
    for (const p of parts) {
      if (p && p.toLocaleLowerCase().includes(q)) return true;
    }
    return false;
  }

  function renderCharacterList(): void {
    destroyAttachSelects();
    charList.replaceChildren();
    if (cards.length === 0) {
      charFilterCount.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'lrm-empty';
      empty.textContent = 'No Risu cards imported yet.';
      charList.appendChild(empty);
      return;
    }
    const filtered = charSearchTerm.trim().length === 0
      ? cards.slice()
      : cards.filter((c) => matchesSearch(charSearchTerm, c.character_name, c.translated_character_name, c.character_id));
    charFilterCount.textContent = charSearchTerm.trim().length > 0
      ? `${filtered.length} of ${cards.length}`
      : '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrm-empty';
      empty.textContent = `No matches for "${charSearchTerm}".`;
      charList.appendChild(empty);
      return;
    }
    for (const c of filtered) {
      charList.appendChild(renderCharacterRow(c));
    }
  }

  function renderCharacterRow(card: CardSummary): HTMLDetailsElement {
    const det = document.createElement('details');
    det.className = 'lrm-character';
    det.open = expandedCharacters.has(card.character_id);
    det.addEventListener('toggle', () => {
      if (det.open) expandedCharacters.add(card.character_id);
      else expandedCharacters.delete(card.character_id);
    });

    const summary = document.createElement('summary');
    summary.className = 'lrm-character-summary';
    const summaryName = document.createElement('span');
    summaryName.className = 'lrm-character-name';
    const original = card.character_name ?? '(character missing)';
    const useTranslated = getTranslateEnabled() && card.translated_character_name;
    summaryName.textContent = useTranslated ? card.translated_character_name! : original;
    if (useTranslated) summaryName.title = original;
    summary.appendChild(summaryName);
    if (getTranslateEnabled() && !card.translated_character_name && card.character_name) {
      setCharacterScopeLang(card.character_id, dominantScriptLang([card.character_name]));
      void translateCharacterName(card.character_id, card.character_name).then((tx) => {
        if (tx && tx !== card.character_name && summaryName.isConnected) {
          summaryName.textContent = tx;
          summaryName.title = card.character_name ?? '';
        }
      });
    }
    const attachedList = attachedByCharacter.get(card.character_id) ?? [];
    const summaryCount = document.createElement('span');
    summaryCount.className = 'lrm-character-count';
    summaryCount.textContent =
      attachedList.length === 0
        ? 'manage modules'
        : `manage modules · ${attachedList.length} attached`;
    summaryCount.title = 'Open to attach or detach modules for this character.';
    summary.appendChild(summaryCount);
    det.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'lrm-character-body';

    if (attachedList.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrm-character-empty';
      empty.textContent = 'No modules attached to this character.';
      body.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'lrm-attached-list';
      for (const a of attachedList) {
        const li = document.createElement('li');
        li.className = 'lrm-attached-row';
        const label = document.createElement('span');
        label.className = 'lrm-attached-name';
        const displayAttached = pickAttachedDisplayName(a);
        label.textContent = displayAttached || a.id;
        li.appendChild(label);
        if (getTranslateEnabled() && !a.translatedName && a.name) {
          void translateModuleName(a.id, a.name).then((tx) => {
            if (tx && tx !== a.name && label.isConnected) {
              label.textContent = tx;
            }
          });
        }
        const detach = document.createElement('button');
        detach.type = 'button';
        detach.className = 'lrm-btn-mini lrm-btn-danger';
        detach.textContent = 'Detach';
        detach.title = `Detach "${displayAttached || a.name}" from this character.`;
        detach.addEventListener('click', () => {
          log.info(`modules-panel: detach_module char=${card.character_id} module=${a.id}`);
          sendToBackend({
            type: 'detach_module',
            characterId: card.character_id,
            moduleId: a.id,
          });
        });
        li.appendChild(detach);
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    const attachable = (modules ?? [])
      .filter((m) => !attachedList.some((a) => a.id === m.id))
      .slice()
      .sort((a, b) => {
        const an = (pickModuleDisplayName(a) || a.id).toLocaleLowerCase();
        const bn = (pickModuleDisplayName(b) || b.id).toLocaleLowerCase();
        return an.localeCompare(bn);
      });
    if (attachable.length > 0) {
      const attachWrap = document.createElement('div');
      attachWrap.className = 'lrm-attach-wrap';
      const label = document.createElement('label');
      label.className = 'lrm-attach-label';
      label.textContent = 'Attach module:';
      const selectId = `lrm-attach-select-${card.character_id}`;
      label.htmlFor = selectId;
      attachWrap.appendChild(label);

      for (const m of attachable) {
        if (getTranslateEnabled() && !m.translatedName && m.name) {
          void translateModuleName(m.id, m.name);
        }
      }

      const attachBtn = document.createElement('button');
      attachBtn.type = 'button';
      attachBtn.className = 'lrm-btn-mini lrm-btn-primary';
      attachBtn.textContent = 'Attach';
      attachBtn.title = 'Attach the selected module.';
      attachBtn.disabled = true;

      const ss = createSearchableSelect({
        id: selectId,
        className: 'lrm-attach-trigger',
        placeholder: `Select a module… (${attachable.length})`,
        searchPlaceholder: 'Search modules…',
        emptyMessage: 'No matching modules',
        items: attachable.map((m) => {
          const display = pickModuleDisplayName(m) || m.id;
          const aliases: string[] = [];
          if (m.name && m.name !== display) aliases.push(m.name);
          if (m.translatedName && m.translatedName !== display) aliases.push(m.translatedName);
          return {
            value: m.id,
            label: display,
            ...(m.translatedName && m.name && m.translatedName !== m.name
              ? { secondary: m.name }
              : {}),
            ...(aliases.length > 0 ? { searchTerms: aliases } : {}),
          };
        }),
        onChange(selected) {
          attachBtn.disabled = selected === null;
        },
      });
      attachSelectHandles.push(ss);
      attachWrap.appendChild(ss.root);

      attachBtn.addEventListener('click', () => {
        const moduleId = ss.getValue();
        if (!moduleId) return;
        log.info(`modules-panel: attach_module char=${card.character_id} module=${moduleId}`);
        sendToBackend({
          type: 'attach_module',
          characterId: card.character_id,
          moduleId,
        });
        ss.setValue(null);
        attachBtn.disabled = true;
      });
      attachWrap.appendChild(attachBtn);
      body.appendChild(attachWrap);
    } else if ((modules ?? []).length > 0) {
      const all = document.createElement('div');
      all.className = 'lrm-character-empty';
      all.textContent = 'Every available module is already attached.';
      body.appendChild(all);
    }

    det.appendChild(body);
    return det;
  }

  function render(): void {
    populateRegexTarget();
    renderModuleList();
    renderCharacterList();
    if (lastError) setStatus(lastError, true);
  }

  const unsubTranslate = subscribeTranslateEnabled(() => render());

  let charSearchTimer: number | undefined;
  charSearch.addEventListener('input', () => {
    if (charSearchTimer !== undefined) window.clearTimeout(charSearchTimer);
    charSearchTimer = window.setTimeout(() => {
      charSearchTerm = charSearch.value;
      renderCharacterList();
    }, 80);
  });

  let moduleSearchTimer: number | undefined;
  moduleSearch.addEventListener('input', () => {
    if (moduleSearchTimer !== undefined) window.clearTimeout(moduleSearchTimer);
    moduleSearchTimer = window.setTimeout(() => {
      moduleSearchTerm = moduleSearch.value;
      renderModuleList();
    }, 80);
  });

  uploadBtn.addEventListener('click', () => { void onUploadClicked(); });
  refreshBtn.addEventListener('click', () => {
    log.info('modules-panel: refresh clicked');
    sendToBackend({ type: 'request_modules' });
  });

  // Standalone lorebook import. Large files chunk automatically (sendImportText)
  // so they survive the 4MB single-frame WS cap.
  let lorebookImportInFlight = false;
  lbUploadBtn.addEventListener('click', () => { void onLorebookUploadClicked(); });

  async function onLorebookUploadClicked(): Promise<void> {
    if (lorebookImportInFlight) return;
    let file: File | null;
    try {
      file = await pickLorebookFile();
    } catch (err) {
      setLorebookStatus(`File pick failed: ${errMsg(err)}`, true);
      return;
    }
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setLorebookStatus(`Read failed: ${errMsg(err)}`, true);
      return;
    }
    lorebookImportInFlight = true;
    lbUploadBtn.disabled = true;
    setLorebookStatus(`Importing "${file.name}" (${(text.length / 1024).toFixed(1)} KB)…`, false);
    const sent = sendImportText(sendToBackend, { kind: 'lorebook', text, filename: file.name, characterId: null });
    log.info(`modules-panel: import_lorebook standalone file=${file.name} bytes=${text.length} chunked=${sent.chunked} chunks=${sent.chunks}`);
  }

  function setLorebookStatus(msg: string, isError: boolean): void {
    lbStatus.textContent = msg;
    lbStatus.classList.toggle('lrm-lorebook-status-error', isError);
  }

  // Backend parses + translates, the FE POSTs the resulting rows since only the
  // FE carries the session cookie. Large files chunk via sendImportText.
  let regexImportInFlight = false;
  rxUploadBtn.addEventListener('click', () => { void onRegexUploadClicked(); });

  // Rebuilds the target dropdown (Global + each character). setItems keeps the
  // prior value if still present, else falls back to Global.
  function populateRegexTarget(): void {
    regexTargetSelect.setItems([
      { value: '', label: 'Global (all chats)' },
      ...cards.map((c) => ({ value: c.character_id, label: c.character_name ?? c.character_id })),
    ]);
    if (regexTargetSelect.getValue() === null) regexTargetSelect.setValue('');
  }

  async function onRegexUploadClicked(): Promise<void> {
    if (regexImportInFlight) return;
    let file: File | null;
    try {
      file = await pickLorebookFile();
    } catch (err) {
      setRegexStatus(`File pick failed: ${errMsg(err)}`, true);
      return;
    }
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setRegexStatus(`Read failed: ${errMsg(err)}`, true);
      return;
    }
    const targetId = regexTargetSelect.getValue() || null;
    regexImportInFlight = true;
    rxUploadBtn.disabled = true;
    setRegexStatus(`Importing "${file.name}" (${(text.length / 1024).toFixed(1)} KB)…`, false);
    const sent = sendImportText(sendToBackend, { kind: 'regex', text, filename: file.name, characterId: targetId });
    log.info(`modules-panel: import_regex file=${file.name} target=${targetId ?? 'global'} bytes=${text.length} chunked=${sent.chunked} chunks=${sent.chunks}`);
  }

  function setRegexStatus(msg: string, isError: boolean): void {
    rxStatus.textContent = msg;
    rxStatus.classList.toggle('lrm-lorebook-status-error', isError);
  }

  async function onStandaloneRegexInstall(
    msg: Extract<BackendToFrontend, { type: 'standalone_regex_install' }>,
  ): Promise<void> {
    if (!msg.ok || msg.scripts.length === 0) {
      regexImportInFlight = false;
      rxUploadBtn.disabled = false;
      setRegexStatus(msg.reason ?? 'Import failed.', true);
      return;
    }
    setRegexStatus(`Installing ${msg.scripts.length} rule(s)…`, false);
    try {
      const resp = await fetch('/api/v1/regex-scripts/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scripts: msg.scripts, folder: msg.folder }),
        credentials: 'include',
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = ' — ' + (await resp.text()).slice(0, 200); } catch { /* */ }
        throw new Error(`HTTP ${resp.status}${detail}`);
      }
      const body = (await resp.json()) as { imported?: number; skipped?: number; errors?: string[] };
      const imported = body?.imported ?? 0;
      const skipped = body?.skipped ?? 0;
      const dropSuffix = msg.dropped > 0 ? `, ${msg.dropped} runtime-only rule(s) dropped` : '';
      const skipSuffix = skipped > 0 ? `, ${skipped} rejected by Lumiverse` : '';
      const where = msg.characterId
        ? `for "${cards.find((c) => c.character_id === msg.characterId)?.character_name ?? msg.characterId}"`
        : 'global';
      log.info(
        `modules-panel: regex import imported=${imported} skipped=${skipped} ` +
          `errors=${(body?.errors ?? []).length} expected=${msg.scripts.length} target=${msg.characterId ?? 'global'}`,
      );
      setRegexStatus(
        `Installed ${imported} ${where} rule(s) under folder "${msg.folder}"${dropSuffix}${skipSuffix}.`,
        imported === 0,
      );
    } catch (err) {
      log.error('modules-panel: regex import POST failed', err);
      setRegexStatus(`Install failed: ${errMsg(err)}`, true);
    } finally {
      regexImportInFlight = false;
      rxUploadBtn.disabled = false;
    }
  }

  async function onUploadClicked(): Promise<void> {
    if (uploadBtn.disabled) return;
    log.info('modules-panel: upload clicked');
    let file: { name: string; bytes: Uint8Array } | null = null;
    try {
      file = await pickViaInput();
    } catch (err) {
      log.error('modules-panel: file pick failed', err);
      lastError = `File pick failed: ${errMsg(err)}`;
      render();
      return;
    }
    if (!file) {
      log.info('modules-panel: pick dismissed');
      return;
    }

    lastError = null;
    setStatus(`Uploading ${file.name}…`);
    uploadBtn.disabled = true;

    const sessionId = generateSessionId();
    const totalBytes = file.bytes.byteLength;
    const totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK_BYTES));
    log.info(`modules-panel: upload session=${sessionId} file=${file.name} bytes=${totalBytes} chunks=${totalChunks}`);

    activeUpload = {
      sessionId,
      lastAckSeq: -999,
      receivedBytesOnBackend: 0,
      pendingAcks: new Map(),
      aborted: false,
      startedAt: performance.now(),
      lastAckAt: performance.now(),
      timings: [],
    };
    const session = activeUpload;
    opts.onImportStart?.(file.name, () => {
      if (!session.aborted) {
        session.aborted = true;
        log.info(`modules-panel: cancel requested session=${sessionId}`);
        rejectAllPending(session, new Error('upload cancelled'));
      }
    }, totalBytes);

    try {
      sendToBackend({
        type: 'upload_module_init',
        sessionId,
        fileName: file.name,
        totalBytes,
        totalChunks,
      });
      await trackAck(session, -1, INIT_ACK_TIMEOUT_MS, 'init');

      let completed = 0;
      let nextSeq = 0;
      const errors: Error[] = [];

      const sendOne = async (): Promise<void> => {
        while (true) {
          if (session.aborted || errors.length > 0) return;
          const seq = nextSeq++;
          if (seq >= totalChunks) return;
          const start = seq * CHUNK_BYTES;
          const end = Math.min(start + CHUNK_BYTES, totalBytes);
          const slice = file.bytes.subarray(start, end);
          const tEncodeStart = performance.now();
          const b64 = bytesToBase64(slice);
          const chunkMsg: FrontendToBackend = {
            type: 'upload_module_chunk',
            sessionId,
            seq,
            bytesB64Chunk: b64,
          };
          const wireSize = JSON.stringify(chunkMsg).length;
          const encodeMs = performance.now() - tEncodeStart;
          session.timings.push({ seq, encodeMs, sentAt: performance.now(), ackedAt: null });
          if (session.timings.length > 60) session.timings.shift();
          if (wireSize > CHUNK_WIRE_WARN_BYTES) {
            log.warn(
              `modules-panel: chunk wire size ${wireSize}B approaches Lumi's 64KB inbound guard ` +
                `(seq=${seq} of ${totalChunks}, raw_chunk=${slice.byteLength}B, b64=${b64.length}B).`,
            );
          }
          const ack = trackAck(session, seq, CHUNK_ACK_TIMEOUT_MS, `chunk ${seq}`);
          sendToBackend(chunkMsg);
          try {
            await ack;
          } catch (err) {
            errors.push(err as Error);
            return;
          }
          completed += 1;
          setStatus(`Uploading ${file.name}… (${completed}/${totalChunks})`);
        }
      };

      const workers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(UPLOAD_WINDOW_SIZE, totalChunks); w++) {
        workers.push(sendOne());
      }
      await Promise.all(workers);
      if (errors.length > 0) throw errors[0];
      if (session.aborted) throw new Error('upload aborted');

      setStatus('Processing on server…');
      sendToBackend({ type: 'upload_module_commit', sessionId });
      await trackAck(session, -2, COMMIT_FIRST_PROGRESS_TIMEOUT_MS, 'commit');
      setStatus(null);
    } catch (err) {
      log.error('modules-panel: upload failed', err);
      dumpUploadDiagnostics(session, err);
      try {
        sendToBackend({ type: 'upload_module_abort', sessionId, reason: errMsg(err) });
      } catch { /* ignore */ }
      lastError = `Upload failed: ${errMsg(err)}`;
      setStatus(lastError, true);
    } finally {
      rejectAllPending(session, new Error('session ended'));
      if (activeUpload?.sessionId === sessionId) activeUpload = null;
      uploadBtn.disabled = false;
    }
  }

  function dumpUploadDiagnostics(session: UploadSession, err: unknown): void {
    try {
      const now = performance.now();
      const wallMs = Math.round(now - session.startedAt);
      const sinceAckMs = Math.round(now - session.lastAckAt);
      const acked = session.timings.filter(t => t.ackedAt !== null);
      const unacked = session.timings.filter(t => t.ackedAt === null).map(t => t.seq);
      const encodes = session.timings.map(t => t.encodeMs);
      const rtts = acked.map(t => (t.ackedAt as number) - t.sentAt);
      const stats = (xs: number[]) => xs.length === 0 ? 'n/a' :
        `min=${Math.round(Math.min(...xs))}ms p50=${Math.round(percentile(xs, 50))}ms p95=${Math.round(percentile(xs, 95))}ms max=${Math.round(Math.max(...xs))}ms`;
      log.warn(
        `modules-panel: upload diagnostics session=${session.sessionId} wall=${wallMs}ms ` +
          `lastAckSeq=${session.lastAckSeq} sinceLastAck=${sinceAckMs}ms ` +
          `pendingAcks=${session.pendingAcks.size} unackedSeqs=[${unacked.slice(0, 10).join(',')}${unacked.length > 10 ? ',…' : ''}] ` +
          `encode(${session.timings.length} samples): ${stats(encodes)} ` +
          `rtt(${rtts.length} samples): ${stats(rtts)} ` +
          `err=${errMsg(err)}`,
      );
    } catch (diagErr) {
      log.warn('modules-panel: diagnostics dump threw', diagErr);
    }
  }

  function percentile(xs: number[], p: number): number {
    const sorted = [...xs].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx] ?? 0;
  }

  function trackAck(
    session: UploadSession,
    seq: number,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    if (session.lastAckSeq === seq) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = vizSetTimeout(timeoutMs, () => {
        if (session.pendingAcks.delete(seq)) {
          session.aborted = true;
          reject(new Error(`timeout waiting for ${label} ack after ${timeoutMs}ms (visible time)`));
        }
      });
      session.pendingAcks.set(seq, { resolve, reject, timer });
    });
  }

  function rejectAllPending(session: UploadSession, err: Error): void {
    for (const [seq, p] of session.pendingAcks) {
      vizClearTimeout(p.timer);
      p.reject(err);
      session.pendingAcks.delete(seq);
    }
  }

  function onUploadAck(sessionId: string, seq: number, receivedBytes: number): void {
    const session = activeUpload;
    if (!session || session.sessionId !== sessionId) return;
    session.lastAckSeq = seq;
    session.receivedBytesOnBackend = receivedBytes;
    session.lastAckAt = performance.now();
    const t = session.timings.find(t => t.seq === seq);
    if (t) t.ackedAt = session.lastAckAt;
    const p = session.pendingAcks.get(seq);
    if (p) {
      session.pendingAcks.delete(seq);
      vizClearTimeout(p.timer);
      p.resolve();
    }
  }

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (charHeaderHandle) {
      try { charHeaderHandle.handleBackendMessage(msg); } catch (err) { log.warn('characters header handler threw:', err); }
    }
    switch (msg.type) {
      case 'cards_updated':
        cards = msg.cards;
        render();
        break;
      case 'modules_pushed':
        modules = msg.modules;
        for (const m of modules) {
          setModuleScopeLang(m.id, dominantScriptLang([m.name, m.description]));
        }
        if (msg.attached_by_character) {
          for (const [charId, list] of Object.entries(msg.attached_by_character)) {
            attachedByCharacter.set(charId, list);
          }
        }
        render();
        break;
      case 'attached_modules_pushed':
        attachedByCharacter.set(msg.characterId, msg.attached);
        render();
        break;
      case 'module_upload_ack':
        onUploadAck(msg.sessionId, msg.seq, msg.receivedBytes);
        break;
      case 'lorebook_import_result':
        // Only consume standalone results , per-character imports are still
        // handled by the viewer's redirect-section button (Phase F removes that).
        if (msg.characterId === null) {
          lorebookImportInFlight = false;
          lbUploadBtn.disabled = false;
          if (msg.ok) {
            const nameSuffix = msg.worldBookName ? ` as "${msg.worldBookName}"` : '';
            const dropSuffix = msg.dropped > 0 ? ` (${msg.dropped} dropped)` : '';
            setLorebookStatus(
              `Imported ${msg.written} entr${msg.written === 1 ? 'y' : 'ies'}${nameSuffix}${dropSuffix}. Attach via Lumiverse to use.`,
              false,
            );
          } else {
            setLorebookStatus(msg.reason ?? 'Import failed.', true);
          }
        }
        break;
      case 'standalone_regex_install':
        void onStandaloneRegexInstall(msg);
        break;
      case 'error':
        if (activeUpload && msg.sessionId === activeUpload.sessionId) {
          rejectAllPending(activeUpload, new Error(msg.message));
        }
        if (lastError === null) {
          lastError = msg.message;
          setStatus(lastError, true);
        }
        break;
    }
  }

  function destroy(): void {
    log.info('modules-panel: destroy');
    destroyAttachSelects();
    try { regexTargetSelect.destroy(); } catch { void 0; }
    if (charHeaderHandle) {
      try { charHeaderHandle.destroy(); } catch { void 0; }
    }
    try { unsubTranslate(); } catch { void 0; }
    try { root.replaceChildren(); } catch { /* ignore */ }
  }

  sendToBackend({ type: 'get_cards' });
  sendToBackend({ type: 'request_modules' });

  render();
  log.info('modules-panel: ready');

  return { handleBackendMessage, destroy };
}


function pickViaInput(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT_EXTENSIONS.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (result: { name: string; bytes: Uint8Array } | null, err?: Error): void => {
      if (settled) return;
      settled = true;
      try { document.body.removeChild(input); } catch { /* */ }
      if (err) reject(err);
      else resolve(result);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      file.arrayBuffer().then(
        (ab) => done({ name: file.name, bytes: new Uint8Array(ab) }),
        (err) => done(null, err as Error),
      );
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

function pickLorebookFile(): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.lorebook,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (f: File | null, err?: Error): void => {
      if (settled) return;
      settled = true;
      try { document.body.removeChild(input); } catch { /* */ }
      if (err) reject(err);
      else resolve(f);
    };
    input.addEventListener('change', () => {
      const list = input.files;
      done(list && list.length > 0 ? list.item(0) : null);
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes as BlobPart], { type: mimeType });
}

function generateSessionId(): string {
  const c = typeof globalThis !== 'undefined'
    ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `mod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
