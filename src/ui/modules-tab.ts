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
import { renderDescription } from '../realm/markdown.js';
import { sendImportText } from './import-text-upload.js';
import * as tus from 'tus-js-client';

// Mounts into a host element provided by ui/sidebar.ts.

const UPLOAD_ENDPOINT = '/api/v1/spindle-uploads';
const UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
const EXTENSION_IDENTIFIER = 'lumirealm';
// Server processing (decode + asset upload + world-book creation) can be slow.
const PROCESSING_TIMEOUT_MS = 120_000;

const ACCEPT_EXTENSIONS = ['.risum', '.charx'];

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
  readonly onUploadProgress?: (sent: number, total: number) => void;
}

export function mountModulesPanel(opts: MountModulesPanelOptions): ModulesPanelHandle {
  const { sendToBackend, log } = opts;
  log.info('modules-panel: mounting');

  const root = opts.root;
  root.classList.add('lr-modules-drawer');

  let modules: readonly ModuleSummary[] | null = null;
  let globalModuleIds: readonly string[] = [];
  let cards: readonly CardSummary[] = [];
  const attachedByCharacter = new Map<string, readonly AttachedModuleSummary[]>();
  let activeTus: tus.Upload | null = null;
  let processingTimer: VizTimer | null = null;
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
  uploadBtn.textContent = 'Upload .risum / .charx';
  uploadBtn.title = 'Pick a legacy .risum or CharX module file.';
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

  const globalBox = document.createElement('div');
  globalBox.className = 'lrm-globalbox';
  libBody.insertBefore(globalBox, libFilterRow);

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

  // Chips + an add dropdown. Mirrors the per-character attach control rather
  // than introducing a second idiom for "pick a module".
  function renderGlobalBox(): void {
    globalBox.replaceChildren();
    if (modules === null) return;

    const head = document.createElement('div');
    head.className = 'lrm-globalbox-head';
    const title = document.createElement('span');
    title.className = 'lrm-globalbox-title';
    title.textContent = 'Global modules';
    head.appendChild(title);
    const hint = document.createElement('span');
    hint.className = 'lrm-globalbox-hint';
    hint.textContent = 'Applied to every character, on top of its own attachments.';
    head.appendChild(hint);
    globalBox.appendChild(head);

    const chips = document.createElement('div');
    chips.className = 'lrm-chips';
    const byId = new Map(modules.map((m) => [m.id, m]));
    if (globalModuleIds.length === 0) {
      const none = document.createElement('span');
      none.className = 'lrm-chips-empty';
      none.textContent = 'None';
      chips.appendChild(none);
    }
    for (const id of globalModuleIds) {
      const m = byId.get(id);
      const chip = document.createElement('span');
      chip.className = 'lrm-chip';
      const label = document.createElement('span');
      label.className = 'lrm-chip-label';
      label.textContent = m ? (pickModuleDisplayName(m) || m.id) : '(missing)';
      if (!m) chip.classList.add('lrm-chip-missing');
      chip.appendChild(label);
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'lrm-chip-x';
      x.textContent = '×';
      x.title = `Remove ${label.textContent} from global modules`;
      x.addEventListener('click', () => {
        sendGlobalModules(globalModuleIds.filter((g) => g !== id));
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    }
    globalBox.appendChild(chips);

    const addable = modules
      .filter((m) => !globalModuleIds.includes(m.id))
      .slice()
      .sort((a, b) => b.uploaded_at - a.uploaded_at);
    if (addable.length === 0) return;

    const addWrap = document.createElement('div');
    addWrap.className = 'lrm-attach-wrap';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'lrm-btn-mini lrm-btn-primary';
    addBtn.textContent = 'Add';
    addBtn.disabled = true;
    const ss = createSearchableSelect({
      id: 'lrm-global-add-select',
      className: 'lrm-attach-trigger',
      placeholder: `Add a global module… (${addable.length})`,
      searchPlaceholder: 'Search modules…',
      emptyMessage: 'No matching modules',
      items: addable.map((m) => {
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
      onChange(selected) { addBtn.disabled = selected === null; },
    });
    attachSelectHandles.push(ss);
    addWrap.appendChild(ss.root);
    addBtn.addEventListener('click', () => {
      const id = ss.getValue();
      if (!id) return;
      sendGlobalModules([...globalModuleIds, id]);
    });
    addWrap.appendChild(addBtn);
    globalBox.appendChild(addWrap);
  }

  function sendGlobalModules(next: readonly string[]): void {
    log.info(`modules-panel: set_global_modules count=${next.length}`);
    globalModuleIds = next;
    renderGlobalBox();
    sendToBackend({ type: 'set_global_modules', moduleIds: next });
  }

  function renderModuleList(): void {
    renderGlobalBox();
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
      const setDesc = (text: string): void => {
        desc.replaceChildren(renderDescription(text));
      };
      setDesc(pickModuleDisplayDescription(m) || m.description);
      body.appendChild(desc);
      if (getTranslateEnabled() && !m.translatedDescription) {
        void translateModuleDescription(m.id, m.description).then((tx) => {
          if (tx && tx !== m.description && desc.isConnected) {
            setDesc(tx);
          }
        });
      }
    }

    const actions = document.createElement('div');
    actions.className = 'lrm-module-actions';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'lrm-btn';
    exportBtn.textContent = 'Export';
    exportBtn.title = `Download "${displayName}" as a .lumirealm.module archive.`;
    exportBtn.addEventListener('click', () => {
      log.info(`modules-panel: export_module id=${m.id}`);
      sendToBackend({ type: 'export_module', moduleId: m.id });
    });
    actions.appendChild(exportBtn);
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

    // Newest upload first. Alphabetical buried the module you just added at
    // whatever letter its name happens to start with.
    const attachable = (modules ?? [])
      .filter((m) => !attachedList.some((a) => a.id === m.id))
      .slice()
      .sort((a, b) => b.uploaded_at - a.uploaded_at);
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

  // Standalone lorebook import. Large files upload via tus (sendImportText)
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
    try {
      const sent = await sendImportText(sendToBackend, { kind: 'lorebook', text, filename: file.name, characterId: null });
      log.info(`modules-panel: import_lorebook standalone file=${file.name} bytes=${text.length} viaUpload=${sent.chunked}`);
    } catch (err) {
      lorebookImportInFlight = false;
      lbUploadBtn.disabled = false;
      setLorebookStatus(`Upload failed: ${errMsg(err)}`, true);
    }
  }

  function setLorebookStatus(msg: string, isError: boolean): void {
    lbStatus.textContent = msg;
    lbStatus.classList.toggle('lrm-lorebook-status-error', isError);
  }

  // Backend parses + translates, the FE POSTs the resulting rows since only the
  // FE carries the session cookie. Large files upload via tus (sendImportText).
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
    try {
      const sent = await sendImportText(sendToBackend, { kind: 'regex', text, filename: file.name, characterId: targetId });
      log.info(`modules-panel: import_regex file=${file.name} target=${targetId ?? 'global'} bytes=${text.length} viaUpload=${sent.chunked}`);
    } catch (err) {
      regexImportInFlight = false;
      rxUploadBtn.disabled = false;
      setRegexStatus(`Upload failed: ${errMsg(err)}`, true);
    }
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
    const fileName = file.name;
    const totalBytes = file.bytes.byteLength;
    setStatus(`Uploading ${fileName}…`);
    uploadBtn.disabled = true;
    log.info(`modules-panel: upload file=${fileName} bytes=${totalBytes}`);

    let cancelled = false;
    opts.onImportStart?.(fileName, () => {
      cancelled = true;
      if (activeTus) { void activeTus.abort(true).catch(() => {}); activeTus = null; }
      clearProcessingTimer();
      uploadBtn.disabled = false;
      log.info('modules-panel: upload cancel requested');
    }, totalBytes);

    const upload = new tus.Upload(new Blob([file.bytes as BlobPart]), {
      endpoint: UPLOAD_ENDPOINT,
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      removeFingerprintOnSuccess: true,
      metadata: { filename: fileName, extension: EXTENSION_IDENTIFIER },
      onError: (err) => {
        activeTus = null;
        if (cancelled) return;
        log.error('modules-panel: tus upload failed', err);
        lastError = `Upload failed: ${errMsg(err)}`;
        setStatus(lastError, true);
        uploadBtn.disabled = false;
      },
      onProgress: (sent, total) => {
        const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
        setStatus(`Uploading ${fileName}… (${pct}%)`);
        opts.onUploadProgress?.(sent, total);
      },
      onSuccess: () => {
        activeTus = null;
        const uploadId = (upload.url ?? '').split('/').filter(Boolean).pop() ?? '';
        if (!uploadId) {
          lastError = 'Upload finished but no id was returned';
          setStatus(lastError, true);
          uploadBtn.disabled = false;
          return;
        }
        log.info(`modules-panel: upload complete uploadId=${uploadId} — requesting processing`);
        setStatus('Processing on server…');
        sendToBackend({ type: 'process_module_from_upload', uploadId, fileName });
        // Backend signals done via modules_pushed and failure via an `error` frame.
        armProcessingTimer();
      },
    });
    activeTus = upload;

    try {
      const prev = await upload.findPreviousUploads();
      if (cancelled) return;
      if (prev[0]) upload.resumeFromPreviousUpload(prev[0]);
    } catch { /* no resumable state, start fresh */ }
    if (!cancelled) upload.start();
  }

  function clearProcessingTimer(): void {
    if (processingTimer) { vizClearTimeout(processingTimer); processingTimer = null; }
  }

  function armProcessingTimer(): void {
    clearProcessingTimer();
    processingTimer = vizSetTimeout(PROCESSING_TIMEOUT_MS, () => {
      processingTimer = null;
      lastError = 'Server did not respond after upload. The module may still be processing.';
      setStatus(lastError, true);
      uploadBtn.disabled = false;
    });
  }

  // A module upload finished server-side: modules_pushed lands on success.
  function finishModuleUpload(): void {
    if (!processingTimer) return;
    clearProcessingTimer();
    uploadBtn.disabled = false;
    setStatus(null);
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
        globalModuleIds = msg.global_module_ids ?? [];
        for (const m of modules) {
          setModuleScopeLang(m.id, dominantScriptLang([m.name, m.description]));
        }
        if (msg.attached_by_character) {
          for (const [charId, list] of Object.entries(msg.attached_by_character)) {
            attachedByCharacter.set(charId, list);
          }
        }
        finishModuleUpload();
        render();
        break;
      case 'attached_modules_pushed':
        attachedByCharacter.set(msg.characterId, msg.attached);
        render();
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
      case 'import_progress':
        if (processingTimer) {
          if (msg.phase === 'done') {
            finishModuleUpload();
          } else if (msg.phase === 'error') {
            clearProcessingTimer();
            uploadBtn.disabled = false;
            lastError = msg.error ?? msg.message;
            setStatus(lastError, true);
          } else {
            // Server is alive (asset uploads emit these), push the deadline out.
            armProcessingTimer();
          }
        }
        break;
      case 'error':
        if (processingTimer) {
          clearProcessingTimer();
          uploadBtn.disabled = false;
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

