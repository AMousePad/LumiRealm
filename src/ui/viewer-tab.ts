import type {
  AttachedModuleSummary,
  BackendToFrontend,
  CardSummary,
  FrontendToBackend,
  ModuleSummary,
  ViewerAssetEntry,
  ViewerData,
  ViewerLorebookEntry,
  ViewerLorebookGroup,
  ViewerRegexEntry,
  ViewerSourceRef,
  ViewerTriggerEntry,
} from '../types/messages.js';
import type { FrontendLog } from './drawer.js';
import { createVirtualGrid } from './virtual-grid.js';
import { getTranslateEnabled, subscribeTranslateEnabled } from './translate-toggle.js';
import {
  translateModuleName,
  translateCharacterName,
  translateLorebookComment,
  setModuleScopeLang,
  setCharacterScopeLang,
} from './translate-orchestrator.js';
import { dominantScriptLang } from './browser-translator.js';
import { createSearchableSelect, type SearchableSelectItem } from './searchable-select.js';
import { renderDescription } from '../realm/markdown.js';

// Viewer for both characters and standalone .risum modules.
// Mounts into a host element provided by ui/sidebar.ts.

// Matches Lumi /api/v1/images route cap and Risu's MAX_ASSET_SIZE_BYTES.
const MAX_ASSET_MB = 50;
const MAX_ASSET_BYTES = MAX_ASSET_MB * 1024 * 1024;

export interface ViewerPanelHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export interface MountViewerPanelOptions {
  readonly root: HTMLElement;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
  readonly openWorldBookEditor?: (worldBookId: string, entryId?: string) => Promise<void>;
}

interface SourceOption {
  readonly kind: 'character' | 'module';
  readonly id: string;
  readonly label: string;
}

export function mountViewerPanel(opts: MountViewerPanelOptions): ViewerPanelHandle {
  const { sendToBackend, log, openWorldBookEditor } = opts;
  log.info('viewer-panel: mounting');

  const root = opts.root;
  root.classList.add('lr-viewer-drawer');

  let cards: readonly CardSummary[] = [];
  let modules: readonly ModuleSummary[] = [];
  let selectedSourceKey: string | null = null;
  let viewerData: ViewerData | null = null;
  let loading = false;
  let lastError: string | null = null;
  let destroyed = false;
  // Active sub-tab inside the viewer panel. Persists across re-renders within
  // a session; switching the source resets to 'assets'. Default vars moved
  // to State → Variables → Default in Phase B; lorebook import moved to
  // Import → Lorebooks in Phase E. The 'defaults' subtab no longer renders
  // here , `_risu_decorators` lookups still go through the viewer-data API
  // for character introspection, but the editor is gone.
  type ViewerSubTab = 'notes' | 'assets' | 'triggers' | 'lorebook' | 'regex' | 'background' | 'cjs' | 'defaults';
  let activeSubTab: ViewerSubTab = 'notes';
  // Mirrors `set_active_chat.characterId`. Drives the Current button + auto-switch.
  let activeCharacterId: string | null = null;
  // True when set_active_chat fired with a characterId not yet in `cards`.
  // The next cards_updated retries the switch, then clears the flag.
  let pendingAutoSwitch = false;
  // Asset virtualization , only the visible window of tiles is mounted at any
  // time. Module-heavy cards can ship 1500+ assets, which used to require
  // pagination. Now scrolling reveals tiles on demand without DOM blowup.
  // Tile dimensions are fixed so absolute positioning works.
  const ASSET_TILE_MIN_W = 140;
  const ASSET_TILE_H = 220;
  const ASSET_OVERSCAN_ROWS = 2;
  // Search persists across re-renders (asset rename/delete/upload).
  let assetSearchTerm = '';
  // Pagination is dead , kept the variable name elsewhere for now to minimise
  // diff churn; ignored in the new windowed renderer.
  let assetPagesShown = 1; void assetPagesShown;
  const attachedByCharacter = new Map<string, readonly AttachedModuleSummary[]>();
  // Cleared on the next viewer_data_pushed (backend re-push = success signal).
  let assetUploadStatus: { kind: 'info' | 'error'; message: string } | null = null;
  let renamingAssetName: string | null = null;
  // Selection lives outside the DOM: the grid is virtualized, so tiles unmount
  // on scroll and anything stored on them is lost.
  let assetSelectMode = false;
  const assetSelected = new Set<string>();
  // Anchor for shift-click range select, an index into the filtered list.
  let assetLastClickedIndex: number | null = null;
  let editingTriggerIndex: number | null = null;
  let editingTriggerLua = '';
  // null = no unsaved changes (textarea derives from snapshot)
  let defaultsTextBuffer: string | null = null;
  let bgHtmlTextBuffer: string | null = null;
  // Lore details survive viewer re-renders (including enable/disable replies),
  // while source changes intentionally reset the expansion state.
  const closedLorebookGroups = new Set<string>();
  const openLorebookFolders = new Set<string>();
  const openLorebookEntries = new Set<string>();
  const lorebookMutationPending = new Map<string, boolean>();
  const lorebookNavigationPending = new Set<string>();
  let lorebookActionError: string | null = null;

  const intro = document.createElement('p');
  intro.className = 'lrv-intro';
  intro.textContent = 'Inspect, HTML, triggers, and assets for a character or module.';
  root.appendChild(intro);

  const toolbar = document.createElement('div');
  toolbar.className = 'lrv-toolbar';

  const sourceLabel = document.createElement('label');
  sourceLabel.className = 'lrv-source-label';
  sourceLabel.textContent = 'Source:';
  toolbar.appendChild(sourceLabel);

  sourceLabel.htmlFor = 'lrv-source-select';
  const sourceSelect = createSearchableSelect({
    id: 'lrv-source-select',
    className: 'lrv-source-trigger',
    placeholder: '(no characters or modules)',
    searchPlaceholder: 'Search characters and modules…',
    emptyMessage: 'No matches',
    items: [],
    onChange(next) {
      if (next === null) return;
      selectedSourceKey = next;
      const o = parseSourceKey(next);
      if (o) requestForSelection(o);
    },
  });
  toolbar.appendChild(sourceSelect.root);

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'lrm-btn';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Re-fetch the selected source.';
  toolbar.appendChild(refreshBtn);

  const currentBtn = document.createElement('button');
  currentBtn.type = 'button';
  currentBtn.className = 'lrv-current-btn';
  currentBtn.textContent = 'Current';
  currentBtn.title = 'Switch to the character of the open chat.';
  currentBtn.addEventListener('click', () => {
    if (!activeCharacterId) return;
    selectToCharacter(activeCharacterId, 'click');
  });
  toolbar.appendChild(currentBtn);

  function updateCurrentBtn(): void {
    const inLibrary = !!activeCharacterId && cards.some((c) => c.character_id === activeCharacterId);
    currentBtn.disabled = !inLibrary;
    currentBtn.style.display = activeCharacterId ? '' : 'none';
  }

  function selectToCharacter(characterId: string, reason: string): boolean {
    if (!cards.some((c) => c.character_id === characterId)) return false;
    const key = `character::${characterId}`;
    if (selectedSourceKey === key) return true;
    log.info(`viewer-panel: select character=${characterId} reason=${reason}`);
    selectedSourceKey = key;
    sourceSelect.setValue(key);
    const o = parseSourceKey(key);
    if (o) requestForSelection(o);
    return true;
  }

  root.appendChild(toolbar);

  const status = document.createElement('div');
  status.className = 'lrv-status';
  root.appendChild(status);

  const surfaceHost = document.createElement('div');
  surfaceHost.className = 'lrv-surfaces';
  root.appendChild(surfaceHost);

  function rebuildSourceSelect(): void {
    const prev = selectedSourceKey;
    const options: SourceOption[] = [];
    const items: SearchableSelectItem[] = [];
    const translate = getTranslateEnabled();
    for (const c of cards) {
      const attached = attachedByCharacter.get(c.character_id) ?? [];
      const suffix = attached.length > 0 ? ` (+${attached.length} module${attached.length === 1 ? '' : 's'})` : '';
      const display = translate && c.translated_character_name ? c.translated_character_name : (c.character_name ?? '(missing)');
      const o: SourceOption = {
        kind: 'character',
        id: c.character_id,
        label: `${display}${suffix}`,
      };
      options.push(o);
      const charAliases: string[] = [];
      if (c.character_name && c.character_name !== display) charAliases.push(c.character_name);
      if (c.translated_character_name && c.translated_character_name !== display) charAliases.push(c.translated_character_name);
      items.push({
        value: sourceKey(o),
        label: `${display}${suffix}`,
        group: 'Characters',
        ...(translate && c.translated_character_name && c.character_name && c.translated_character_name !== c.character_name
          ? { secondary: c.character_name }
          : {}),
        ...(charAliases.length > 0 ? { searchTerms: charAliases } : {}),
      });
      if (translate && !c.translated_character_name && c.character_name) {
        setCharacterScopeLang(c.character_id, dominantScriptLang([c.character_name]));
        void translateCharacterName(c.character_id, c.character_name);
      }
    }
    for (const m of modules) {
      const display = translate && m.translatedName ? m.translatedName : m.name;
      const o: SourceOption = {
        kind: 'module',
        id: m.id,
        label: display || '(unnamed)',
      };
      options.push(o);
      const modAliases: string[] = [];
      if (m.name && m.name !== display) modAliases.push(m.name);
      if (m.translatedName && m.translatedName !== display) modAliases.push(m.translatedName);
      items.push({
        value: sourceKey(o),
        label: display || '(unnamed)',
        group: 'Modules',
        ...(translate && m.translatedName && m.name && m.translatedName !== m.name
          ? { secondary: m.name }
          : {}),
        ...(modAliases.length > 0 ? { searchTerms: modAliases } : {}),
      });
      if (translate && !m.translatedName && m.name) {
        void translateModuleName(m.id, m.name);
      }
    }
    sourceSelect.setItems(items);
    if (options.length === 0) {
      sourceSelect.setDisabled(true);
      sourceSelect.setValue(null);
      return;
    }
    sourceSelect.setDisabled(false);
    if (prev && options.some((o) => sourceKey(o) === prev)) {
      sourceSelect.setValue(prev);
    } else {
      const first = options[0]!;
      selectedSourceKey = sourceKey(first);
      sourceSelect.setValue(selectedSourceKey);
      requestForSelection(first);
    }
  }

  function sourceKey(o: SourceOption): string {
    return `${o.kind}::${o.id}`;
  }

  function viewerSourceKey(source: ViewerSourceRef): string {
    return source.kind === 'character'
      ? `character::${source.characterId}`
      : `module::${source.moduleId}`;
  }

  function currentViewerSourceRef(): ViewerSourceRef | null {
    const source = viewerData?.source;
    if (!source) return null;
    return source.kind === 'character'
      ? { kind: 'character', characterId: source.characterId }
      : { kind: 'module', moduleId: source.moduleId };
  }

  function resetLorebookUiState(): void {
    closedLorebookGroups.clear();
    openLorebookFolders.clear();
    openLorebookEntries.clear();
    lorebookMutationPending.clear();
    lorebookNavigationPending.clear();
    lorebookActionError = null;
  }

  function lorebookNavigationKey(worldBookId: string, entryId?: string): string {
    return `${selectedSourceKey ?? ''}::${worldBookId}::${entryId ?? ''}`;
  }

  function beginOpenWorldBookEditor(worldBookId: string, entryId?: string): void {
    const navigationKey = lorebookNavigationKey(worldBookId, entryId);
    if (lorebookNavigationPending.has(navigationKey)) return;
    if (!openWorldBookEditor) {
      lorebookActionError = 'This Lumiverse build does not expose the World Book Editor action.';
      renderSurfaces();
      return;
    }
    lorebookNavigationPending.add(navigationKey);
    if (entryId) openLorebookEntries.add(`${worldBookId}::${entryId}`);
    lorebookActionError = null;
    renderSurfaces();
    void openWorldBookEditor(worldBookId, entryId).then(() => {
      lorebookNavigationPending.delete(navigationKey);
      if (!destroyed) renderSurfaces();
    }).catch((err: unknown) => {
      lorebookNavigationPending.delete(navigationKey);
      if (destroyed) return;
      lorebookActionError = `Could not open ${entryId ? 'this entry' : 'this lorebook'} in Lumiverse: ${
        err instanceof Error ? err.message : String(err)
      }`;
      renderSurfaces();
    });
  }

  function parseSourceKey(key: string): SourceOption | null {
    const idx = key.indexOf('::');
    if (idx < 0) return null;
    const kind = key.slice(0, idx);
    const id = key.slice(idx + 2);
    if (kind !== 'character' && kind !== 'module') return null;
    if (id.length === 0) return null;
    // Find the label from current state.
    if (kind === 'character') {
      const c = cards.find((x) => x.character_id === id);
      if (!c) return { kind, id, label: id };
      const display = getTranslateEnabled() && c.translated_character_name ? c.translated_character_name : (c.character_name ?? id);
      return { kind, id, label: display };
    }
    const m = modules.find((x) => x.id === id);
    return m ? { kind, id, label: m.name } : { kind, id, label: id };
  }

  function requestForSelection(o: SourceOption): void {
    loading = true;
    viewerData = null;
    lastError = null;
    // Drop unsaved per-source editor state so a chat-switch auto-follow or
    // manual dropdown change doesn't keep stale buffers around.
    editingTriggerIndex = null;
    editingTriggerLua = '';
    defaultsTextBuffer = null;
    bgHtmlTextBuffer = null;
    renamingAssetName = null;
    assetSearchTerm = '';
    assetSelectMode = false;
    assetSelected.clear();
    assetLastClickedIndex = null;
    resetLorebookUiState();
    // Modules have no creator notes, jump straight to Assets.
    activeSubTab = o.kind === 'character' ? 'notes' : 'assets';
    assetPagesShown = 1;
    renderStatus();
    renderSurfaces();
    log.info(`viewer-panel: request data kind=${o.kind} id=${o.id}`);
    sendToBackend({
      type: 'request_viewer_data',
      source: o.kind === 'character'
        ? { kind: 'character', characterId: o.id }
        : { kind: 'module', moduleId: o.id },
    });
  }

  // Re-fetches without resetting subtab / pagination, used when an external
  // event (module attach/detach/delete) changes the currently-viewed data.
  function softRefetchCurrentSelection(): void {
    if (selectedSourceKey === null) return;
    const o = parseSourceKey(selectedSourceKey);
    if (!o) return;
    log.info(`viewer-panel: soft refetch kind=${o.kind} id=${o.id}`);
    sendToBackend({
      type: 'request_viewer_data',
      source: o.kind === 'character'
        ? { kind: 'character', characterId: o.id }
        : { kind: 'module', moduleId: o.id },
    });
  }

  function renderStatus(): void {
    if (lastError) {
      status.style.display = '';
      status.textContent = lastError;
      status.classList.add('lrv-status-error');
      return;
    }
    status.classList.remove('lrv-status-error');
    if (loading) {
      status.style.display = '';
      status.textContent = 'Loading…';
      return;
    }
    if (!viewerData) {
      status.style.display = '';
      status.textContent = cards.length + modules.length === 0
        ? 'Import a character or upload a .risum module first.'
        : 'Pick a source above.';
      return;
    }
    status.style.display = 'none';
    status.textContent = '';
  }

  interface SubTabSpec {
    readonly id: ViewerSubTab;
    readonly label: string;
    readonly render: () => HTMLElement;
  }

  function buildSubTabs(d: import('../types/messages.js').ViewerData): readonly SubTabSpec[] {
    const isCharacter = d.source.kind === 'character';
    const tabs: SubTabSpec[] = [];
    const notes = d.creatorNotes ?? '';
    if (isCharacter && notes.trim().length > 0) {
      tabs.push({
        id: 'notes',
        label: 'Notes',
        render: () => renderNotesSection(notes),
      });
    }
    tabs.push({
      id: 'assets',
      label: 'Assets',
      render: () => renderAssetsSection(d.assets),
    });
    if (isCharacter) {
      tabs.push({
        id: 'lorebook',
        label: 'Lore',
        render: () => d.lorebookNeedsReimport
          ? renderLorebookLegacyNotice()
          : renderLorebookSection(d.lorebook),
      });
    } else {
      tabs.push({
        id: 'regex',
        label: 'Regex',
        render: () => renderRegexSection(d.regex),
      });
      tabs.push({
        id: 'lorebook',
        label: 'Lore',
        render: () => renderLorebookSection(d.lorebook),
      });
    }
    if (isCharacter) {
      tabs.push({
        id: 'defaults',
        label: 'Defaults',
        render: () => renderDefaultsSection(d),
      });
    }
    tabs.push({
      id: 'triggers',
      label: 'Triggers',
      render: () => renderTriggersSection(d.triggers),
    });
    tabs.push({
      id: 'background',
      label: ' HTML',
      render: () => renderBackgroundHtmlSection(d.backgroundHtml ?? ''),
    });
    // CJS tab intentionally omitted: neither Risu nor LumiRealm executes
    // module.cjs. Field is preserved in storage for round-trip; re-add the
    // tab if a runtime is ever wired up.
    return tabs;
  }

  function renderSubTabBar(tabs: readonly SubTabSpec[]): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'lrv-subtab-bar';
    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lrv-subtab';
      if (t.id === activeSubTab) btn.classList.add('lrv-subtab-active');
      btn.textContent = t.label;
      btn.addEventListener('click', () => {
        if (activeSubTab === t.id) return;
        activeSubTab = t.id;
        if (t.id !== 'assets') {
          assetPagesShown = 1; // reset pagination on tab leave
          assetSelectMode = false;
          assetSelected.clear();
          assetLastClickedIndex = null;
        }
        render();
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  function renderSurfaces(): void {
    surfaceHost.replaceChildren();
    if (loading) return;
    if (!viewerData) return;
    const d = viewerData;

    if (d.fetchWarnings.length > 0) {
      const wb = document.createElement('div');
      wb.className = 'lrv-warning';
      wb.textContent = d.fetchWarnings.join(' ');
      surfaceHost.appendChild(wb);
    }

    const tabs = buildSubTabs(d);
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.id === activeSubTab)) {
      activeSubTab = tabs[0]!.id;
    }
    surfaceHost.appendChild(renderSubTabBar(tabs));

    const active = tabs.find((t) => t.id === activeSubTab) ?? tabs[0]!;
    surfaceHost.appendChild(active.render());
  }

  function renderNotesSection(notes: string): HTMLElement {
    const det = document.createElement('section');
    det.className = 'lrv-notes';
    const body = document.createElement('div');
    body.className = 'lrv-notes-body';
    body.appendChild(renderDescription(notes));
    det.appendChild(body);
    return det;
  }

  function renderBackgroundHtmlSection(html: string): HTMLElement {
    const det = document.createElement('section');
    det.className = 'lrv-section lrv-defaults-section';

    if (!viewerData) return det;
    const src = viewerData.source;
    if (src.kind !== 'character' && src.kind !== 'module') {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = 'No background HTML.';
      det.appendChild(empty);
      return det;
    }
    const isModule = src.kind === 'module';

    const snapshotText = html;
    const value = bgHtmlTextBuffer ?? snapshotText;
    const dirty = bgHtmlTextBuffer !== null && bgHtmlTextBuffer !== snapshotText;

    const ta = document.createElement('textarea');
    ta.className = 'lrv-defaults-textarea';
    ta.spellcheck = false;
    ta.value = value;
    ta.rows = Math.max(12, Math.min(30, value.split('\n').length + 2));
    ta.placeholder = '<style>\n  /* background CSS */\n</style>\n<div class="bg">…</div>';
    ta.addEventListener('input', () => {
      bgHtmlTextBuffer = ta.value;
      const lines = ta.value.split('\n').length;
      ta.rows = Math.max(12, Math.min(30, lines + 2));
      paintStatus();
      saveBtn.disabled = !dirtyNow();
      revertBtn.disabled = !dirtyNow();
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        commitSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        revert();
      }
    });
    det.appendChild(ta);

    const actions = document.createElement('div');
    actions.className = 'lrv-defaults-actions';

    const statusEl = document.createElement('span');
    statusEl.className = 'lrv-defaults-status';
    actions.appendChild(statusEl);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'lrv-asset-action lrv-asset-action-primary';
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Persist background HTML (Ctrl+Enter).';
    saveBtn.disabled = !dirty;
    saveBtn.addEventListener('click', commitSave);
    actions.appendChild(saveBtn);

    const revertBtn = document.createElement('button');
    revertBtn.type = 'button';
    revertBtn.className = 'lrv-asset-action';
    revertBtn.textContent = 'Revert';
    revertBtn.title = 'Discard unsaved edits (Esc).';
    revertBtn.disabled = !dirty;
    revertBtn.addEventListener('click', revert);
    actions.appendChild(revertBtn);

    // Reset is character-only: modules have no card-side baseline to fall back to.
    if (!isModule) {
      const characterId = src.characterId;
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'lrv-asset-action lrv-asset-action-danger';
      resetBtn.textContent = 'Reset to card defaults';
      resetBtn.title = 'Discard user edits, fall back to the card-side baseline.';
      resetBtn.addEventListener('click', () => {
        if (!window.confirm('Reset background HTML to the card-side baseline? Your edits are discarded.')) return;
        log.info(`viewer-panel: set_background_html charId=${characterId} reset`);
        sendToBackend({ type: 'set_background_html', characterId, html: null });
        bgHtmlTextBuffer = null;
      });
      actions.appendChild(resetBtn);
    }

    det.appendChild(actions);
    paintStatus();
    return det;

    function dirtyNow(): boolean {
      return bgHtmlTextBuffer !== null && bgHtmlTextBuffer !== snapshotText;
    }
    function paintStatus(): void {
      if (dirtyNow()) {
        statusEl.textContent = 'Unsaved changes';
        statusEl.classList.add('lrv-defaults-status-dirty');
      } else {
        statusEl.textContent = snapshotText.length > 0 ? 'Saved' : 'Empty';
        statusEl.classList.remove('lrv-defaults-status-dirty');
      }
    }
    function commitSave(): void {
      const text = bgHtmlTextBuffer ?? '';
      const out = text.length > 0 ? text : null;
      if (isModule) {
        const moduleId = (src as { moduleId: string }).moduleId;
        log.info(`viewer-panel: set_module_background_embedding moduleId=${moduleId} len=${text.length}`);
        sendToBackend({ type: 'set_module_background_embedding', moduleId, html: out });
      } else {
        const characterId = (src as { characterId: string }).characterId;
        log.info(`viewer-panel: set_background_html charId=${characterId} len=${text.length}`);
        sendToBackend({ type: 'set_background_html', characterId, html: out });
      }
      bgHtmlTextBuffer = null;
    }
    function revert(): void {
      bgHtmlTextBuffer = null;
      render();
    }
  }


  function renderDefaultsSection(d: ViewerData): HTMLElement {
    const det = document.createElement('section');
    det.className = 'lrv-section lrv-defaults-section';

    if (d.source.kind !== 'character') {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = 'Modules do not carry default variables.';
      det.appendChild(empty);
      return det;
    }
    const characterId = d.source.characterId;
    const snapshotText = d.defaultVariablesText;
    const value = defaultsTextBuffer ?? snapshotText;
    const dirty = defaultsTextBuffer !== null && defaultsTextBuffer !== snapshotText;

    const ta = document.createElement('textarea');
    ta.className = 'lrv-defaults-textarea';
    ta.spellcheck = false;
    ta.value = value;
    ta.rows = Math.max(8, Math.min(30, value.split('\n').length + 2));
    ta.placeholder = 'mood=happy\naffection=0';
    ta.addEventListener('input', () => {
      defaultsTextBuffer = ta.value;
      const lines = ta.value.split('\n').length;
      ta.rows = Math.max(8, Math.min(30, lines + 2));
      paintStatus();
      saveBtn.disabled = !dirtyNow();
      revertBtn.disabled = !dirtyNow();
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        commitSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        revert();
      }
    });
    det.appendChild(ta);

    const actions = document.createElement('div');
    actions.className = 'lrv-defaults-actions';

    const statusEl = document.createElement('span');
    statusEl.className = 'lrv-defaults-status';
    actions.appendChild(statusEl);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'lrv-asset-action lrv-asset-action-primary';
    saveBtn.textContent = 'Save';
    saveBtn.title = 'Persist as the master defaults string (Ctrl+Enter).';
    saveBtn.disabled = !dirty;
    saveBtn.addEventListener('click', commitSave);
    actions.appendChild(saveBtn);

    const revertBtn = document.createElement('button');
    revertBtn.type = 'button';
    revertBtn.className = 'lrv-asset-action';
    revertBtn.textContent = 'Revert';
    revertBtn.title = 'Discard unsaved edits (Esc).';
    revertBtn.disabled = !dirty;
    revertBtn.addEventListener('click', revert);
    actions.appendChild(revertBtn);

    if (d.defaultVariablesUserEdited) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'lrv-asset-action lrv-asset-action-danger';
      resetBtn.textContent = 'Reset to card defaults';
      resetBtn.title = 'Discard all your edits, restore the card-side defaults.';
      resetBtn.addEventListener('click', () => {
        if (!window.confirm('Reset default variables to the card-side baseline? This discards every edit you have saved.')) return;
        log.info(`viewer-panel: set_default_variables_text char=${characterId} reset`);
        sendToBackend({ type: 'set_default_variables_text', characterId, text: null });
        defaultsTextBuffer = null;
      });
      actions.appendChild(resetBtn);
    }

    det.appendChild(actions);
    paintStatus();
    queueMicrotask(() => {
      const focused = document.activeElement === ta;
      if (!focused && defaultsTextBuffer !== null) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
    return det;

    function dirtyNow(): boolean {
      return defaultsTextBuffer !== null && defaultsTextBuffer !== snapshotText;
    }
    function paintStatus(): void {
      if (dirtyNow()) {
        statusEl.textContent = 'Unsaved changes';
        statusEl.classList.add('lrv-defaults-status-dirty');
      } else if (d.defaultVariablesUserEdited) {
        statusEl.textContent = 'Saved (user edit)';
        statusEl.classList.remove('lrv-defaults-status-dirty');
      } else {
        statusEl.textContent = 'Card defaults';
        statusEl.classList.remove('lrv-defaults-status-dirty');
      }
    }
    function commitSave(): void {
      const text = defaultsTextBuffer ?? '';
      log.info(`viewer-panel: set_default_variables_text char=${characterId} len=${text.length}`);
      sendToBackend({ type: 'set_default_variables_text', characterId, text });
      defaultsTextBuffer = null;
    }
    function revert(): void {
      defaultsTextBuffer = null;
      render();
    }
  }

  function renderAssetsSection(assets: readonly ViewerAssetEntry[]): HTMLElement {
    const det = document.createElement('section');

    // Filter (case-insensitive substring match on asset name).
    const term = assetSearchTerm.trim().toLowerCase();
    const filtered = term
      ? assets.filter((a) => a.name.toLowerCase().includes(term))
      : assets;

    const filteredIndexByName = new Map(filtered.map((a, i) => [a.name, i] as const));

    // Drop selections for assets that no longer exist (delete, rename, source switch).
    if (assetSelected.size > 0) {
      const live = new Set(assets.map((a) => a.name));
      for (const name of [...assetSelected]) if (!live.has(name)) assetSelected.delete(name);
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'lrv-asset-toolbar';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'lrv-btn lrv-btn-primary';
    addBtn.textContent = '+ Add asset';
    addBtn.addEventListener('click', () => { void onAddAssetClicked(); });
    toolbar.appendChild(addBtn);

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'lrv-btn';
    if (assetSelectMode) selectBtn.classList.add('lrv-btn-active');
    selectBtn.textContent = assetSelectMode ? 'Done' : 'Select';
    selectBtn.title = assetSelectMode
      ? 'Leave selection mode.'
      : 'Select multiple assets to delete them in one pass.';
    selectBtn.addEventListener('click', () => { setAssetSelectMode(!assetSelectMode); });
    toolbar.appendChild(selectBtn);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'lrv-asset-search';
    search.placeholder = `Search ${assets.length} asset${assets.length === 1 ? '' : 's'}…`;
    search.value = assetSearchTerm;
    search.spellcheck = false;
    toolbar.appendChild(search);
    const filterCount = document.createElement('span');
    filterCount.className = 'lrv-asset-filter-count';
    filterCount.textContent = term ? `${filtered.length} of ${assets.length}` : '';
    toolbar.appendChild(filterCount);

    // Filter-scoped bulk delete, the common case (`bg_` -> delete all matching)
    // without stepping through selection mode.
    if (!assetSelectMode && term && filtered.length > 0) {
      const deleteMatchingBtn = document.createElement('button');
      deleteMatchingBtn.type = 'button';
      deleteMatchingBtn.className = 'lrv-btn lrv-btn-danger';
      deleteMatchingBtn.textContent = `Delete all ${filtered.length} matching`;
      deleteMatchingBtn.title = `Delete every asset matching "${assetSearchTerm}".`;
      deleteMatchingBtn.addEventListener('click', () => {
        confirmAndDeleteAssets(filtered.map((a) => a.name), `matching "${assetSearchTerm}"`);
      });
      toolbar.appendChild(deleteMatchingBtn);
    }

    if (assetUploadStatus !== null) {
      const status = document.createElement('span');
      status.className = 'lrv-asset-upload-status';
      if (assetUploadStatus.kind === 'error') {
        status.classList.add('lrv-asset-upload-status-error');
      }
      status.textContent = assetUploadStatus.message;
      toolbar.appendChild(status);
    }
    det.appendChild(toolbar);

    if (assetSelectMode) {
      det.appendChild(renderSelectionBar(assets, filtered, term));
    }

    if (assets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = 'No assets.';
      det.appendChild(empty);
      return det;
    }
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = `No matches for "${assetSearchTerm}".`;
      det.appendChild(empty);
      // Search input still wired below.
    }

    const grid = createVirtualGrid<ViewerAssetEntry>({
      hostClassName: 'lrv-asset-virt-host',
      innerClassName: 'lrv-asset-virt-inner',
      rowHeight: ASSET_TILE_H,
      minTileWidth: ASSET_TILE_MIN_W,
      overscanRows: ASSET_OVERSCAN_ROWS,
      getItems: () => filtered,
      renderItem: (a) => renderAssetTile(a, filteredIndexByName.get(a.name) ?? -1),
      pinnedIndices: () => {
        if (renamingAssetName === null) return [];
        const idx = filtered.findIndex((a) => a.name === renamingAssetName);
        return idx >= 0 ? [idx] : [];
      },
    });
    if (filtered.length > 0) det.appendChild(grid.host);

    // Search wiring , debounce + full re-render of the subtab so the new
    // filter is consumed by the re-mounted virtualized grid. The re-render
    // destroys this input element, so restore focus + caret on the replacement.
    let searchTimer: number | undefined;
    search.addEventListener('input', () => {
      if (searchTimer !== undefined) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        const caret = search.selectionStart;
        assetSearchTerm = search.value;
        render();
        const fresh = root.querySelector<HTMLInputElement>('.lrv-asset-search');
        if (fresh) {
          fresh.focus();
          if (caret !== null) {
            try { fresh.setSelectionRange(caret, caret); } catch { /* */ }
          }
        }
      }, 80);
    });

    return det;
  }

  function isCoarsePointer(): boolean {
    try {
      return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    } catch {
      return false;
    }
  }

  function setAssetSelectMode(on: boolean): void {
    assetSelectMode = on;
    if (!on) {
      assetSelected.clear();
      assetLastClickedIndex = null;
    } else {
      renamingAssetName = null;
    }
    render();
  }

  function renderSelectionBar(
    assets: readonly ViewerAssetEntry[],
    filtered: readonly ViewerAssetEntry[],
    term: string,
  ): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'lrv-asset-selbar';

    const count = document.createElement('span');
    count.className = 'lrv-asset-selbar-count';
    count.textContent = `${assetSelected.size} selected`;
    bar.appendChild(count);

    // Scope is always spelled out. "Select all" over a filtered grid silently
    // meaning "all 1500" is how people delete the wrong thing.
    const selectAllBtn = document.createElement('button');
    selectAllBtn.type = 'button';
    selectAllBtn.className = 'lrv-asset-action';
    selectAllBtn.textContent = term
      ? `Select all ${filtered.length} matching`
      : `Select all ${assets.length}`;
    selectAllBtn.addEventListener('click', () => {
      for (const a of filtered) assetSelected.add(a.name);
      render();
    });
    bar.appendChild(selectAllBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'lrv-asset-action';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = assetSelected.size === 0;
    clearBtn.addEventListener('click', () => {
      assetSelected.clear();
      assetLastClickedIndex = null;
      render();
    });
    bar.appendChild(clearBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'lrv-asset-action lrv-asset-action-danger';
    deleteBtn.textContent = `Delete ${assetSelected.size}`;
    deleteBtn.disabled = assetSelected.size === 0;
    deleteBtn.addEventListener('click', () => {
      confirmAndDeleteAssets([...assetSelected], 'selected');
    });
    bar.appendChild(deleteBtn);

    const hint = document.createElement('span');
    hint.className = 'lrv-asset-selbar-hint';
    // Shift-click and Esc are keyboard-only. On touch the bulk path is
    // search + Select all matching, so advertise that instead.
    hint.textContent = isCoarsePointer()
      ? 'Tap to select · hold to extend from the last one'
      : 'Shift-click for a range · Esc to exit';
    bar.appendChild(hint);

    return bar;
  }

  function confirmAndDeleteAssets(names: readonly string[], scopeLabel: string): void {
    if (names.length === 0) return;
    const n = names.length;
    const preview = names.slice(0, 5).map((s) => `  ${s}`).join('\n');
    const more = n > 5 ? `\n  …and ${n - 5} more` : '';
    if (!confirm(
      `Delete ${n} ${scopeLabel} asset${n === 1 ? '' : 's'}?\n\n${preview}${more}\n\n` +
        `Their image files are deleted too, unless something else still uses them. ` +
        `This cannot be undone.`,
    )) return;
    log.info(`viewer-panel: delete_assets count=${n} scope=${scopeLabel}`);
    sendCurrentSourceMutation({ type: 'delete_assets', assetNames: names });
    assetSelected.clear();
    assetLastClickedIndex = null;
    assetSelectMode = false;
  }

  function toggleAssetSelection(name: string, index: number, extend: boolean): void {
    if (extend && assetLastClickedIndex !== null) {
      selectAssetRange(assetLastClickedIndex, index);
    } else if (assetSelected.has(name)) {
      assetSelected.delete(name);
    } else {
      assetSelected.add(name);
    }
    assetLastClickedIndex = index;
    render();
  }

  function selectAssetRange(from: number, to: number): void {
    const list = currentFilteredAssets();
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    // Range select always adds, matching file managers: extending never deselects.
    for (let i = lo; i <= hi; i++) {
      const entry = list[i];
      if (entry) assetSelected.add(entry.name);
    }
  }

  // Touch has no shift key. Long-press covers both mobile idioms: outside
  // select mode it enters selection (Photos / Files behaviour), inside it
  // extends from the anchor, which is what shift-click does on desktop.
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_SLOP_PX = 10;
  // A fired long-press must not also register as a tap, or it would toggle back off.
  let suppressNextTileClick = false;

  function attachLongPress(tile: HTMLElement, name: string, filteredIndex: number): void {
    let timer: number | undefined;
    let startX = 0;
    let startY = 0;

    const cancel = (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    tile.addEventListener('pointerdown', (e) => {
      // Cleared per gesture, not after use: a long-press that enters select mode
      // re-renders the grid, so its trailing click may land on a detached tile
      // and never reach the handler that would have consumed the flag.
      suppressNextTileClick = false;
      // Desktop keeps shift-click; a held mouse button shouldn't select.
      if (e.pointerType !== 'touch') return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest('video, audio, a, input, button')) return;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = window.setTimeout(() => {
        timer = undefined;
        suppressNextTileClick = true;
        try { (navigator as { vibrate?: (p: number) => boolean }).vibrate?.(15); } catch { /* not supported */ }
        if (!assetSelectMode) {
          assetSelectMode = true;
          renamingAssetName = null;
          assetSelected.add(name);
          assetLastClickedIndex = filteredIndex;
          render();
          return;
        }
        if (assetLastClickedIndex !== null) selectAssetRange(assetLastClickedIndex, filteredIndex);
        else assetSelected.add(name);
        assetLastClickedIndex = filteredIndex;
        render();
      }, LONG_PRESS_MS);
    });

    // Movement past the slop means a scroll, not a press.
    tile.addEventListener('pointermove', (e) => {
      if (timer === undefined) return;
      if (Math.abs(e.clientX - startX) > LONG_PRESS_SLOP_PX
        || Math.abs(e.clientY - startY) > LONG_PRESS_SLOP_PX) cancel();
    });
    tile.addEventListener('pointerup', cancel);
    tile.addEventListener('pointercancel', cancel);
    tile.addEventListener('pointerleave', cancel);
  }

  function currentFilteredAssets(): readonly ViewerAssetEntry[] {
    const all = viewerData?.assets ?? [];
    const term = assetSearchTerm.trim().toLowerCase();
    return term ? all.filter((a) => a.name.toLowerCase().includes(term)) : all;
  }

  // Preview-only. Risu's narrower video set still drives `{{asset::}}`
  // image-vs-video branching, so widening here can't change card output.
  const VIEWER_VIDEO_EXTS = new Set([
    'mp4', 'webm', 'mov', 'm4v', 'm4p', 'ogv', 'mkv', 'avi',
    '3gp', 'mpeg', 'mpg', 'ts', 'flv',
  ]);
  const VIEWER_AUDIO_EXTS = new Set([
    'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba',
  ]);

  function assetMediaKind(ext: string | undefined): 'video' | 'audio' | 'image' {
    if (!ext) return 'image';
    const e = ext.toLowerCase();
    if (VIEWER_VIDEO_EXTS.has(e)) return 'video';
    if (VIEWER_AUDIO_EXTS.has(e)) return 'audio';
    return 'image';
  }

  function renderAssetTile(a: ViewerAssetEntry, filteredIndex: number): HTMLDivElement {
    const tile = document.createElement('div');
    tile.className = 'lrv-asset-tile';
    // Armed even outside select mode: on touch that's how you get into it.
    attachLongPress(tile, a.name, filteredIndex);
    // Long-press otherwise raises the OS callout over the tile.
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    if (assetSelectMode) {
      tile.classList.add('lrv-asset-tile-selectable');
      const selected = assetSelected.has(a.name);
      if (selected) tile.classList.add('lrv-asset-tile-selected');

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'lrv-asset-tile-check';
      box.checked = selected;
      box.setAttribute('aria-label', `Select ${a.name}`);
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        if (suppressNextTileClick) { suppressNextTileClick = false; return; }
        toggleAssetSelection(a.name, filteredIndex, (e as MouseEvent).shiftKey);
      });
      tile.appendChild(box);

      // Whole-tile click toggles, but media controls and links keep working:
      // scrubbing a video shouldn't flip a selection.
      tile.addEventListener('click', (e) => {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('video, audio, a, input, button')) return;
        e.preventDefault();
        if (suppressNextTileClick) { suppressNextTileClick = false; return; }
        toggleAssetSelection(a.name, filteredIndex, e.shiftKey);
      });
    }
    const kind = assetMediaKind(a.ext);
    if (kind === 'video') {
      const vid = document.createElement('video');
      vid.src = a.url;
      vid.controls = true;
      vid.preload = 'metadata';
      vid.playsInline = true;
      vid.className = 'lrv-asset-media lrv-asset-media-video';
      tile.appendChild(vid);
    } else if (kind === 'audio') {
      const aud = document.createElement('audio');
      aud.src = a.url;
      aud.controls = true;
      aud.preload = 'metadata';
      aud.className = 'lrv-asset-media lrv-asset-media-audio';
      tile.appendChild(aud);
    } else {
      const img = document.createElement('img');
      img.src = a.url;
      img.alt = a.name;
      img.loading = 'lazy';
      img.className = 'lrv-asset-media';
      tile.appendChild(img);
    }

    const cap = document.createElement('div');
    cap.className = 'lrv-asset-caption';

    if (renamingAssetName === a.name) {
      // Inline editor.
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'lrv-asset-rename-input';
      input.value = a.name;
      input.spellcheck = false;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(a.name, input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); renamingAssetName = null; render(); }
      });
      cap.appendChild(input);
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'lrv-asset-action lrv-asset-action-primary';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => commitRename(a.name, input.value));
      cap.appendChild(saveBtn);
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'lrv-asset-action';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => { renamingAssetName = null; render(); });
      cap.appendChild(cancelBtn);
      queueMicrotask(() => { input.focus(); input.select(); });
    } else {
      const nameEl = document.createElement('span');
      nameEl.className = 'lrv-asset-name';
      nameEl.textContent = a.name;
      nameEl.title = a.name;
      cap.appendChild(nameEl);
      const meta = document.createElement('span');
      meta.className = 'lrv-asset-meta';
      const parts: string[] = [];
      if (a.ext) parts.push(a.ext);
      if (a.multi) parts.push('multi');
      meta.textContent = parts.join(' · ');
      cap.appendChild(meta);
      const actions = document.createElement('div');
      actions.className = 'lrv-asset-actions';
      const openBtn = document.createElement('a');
      openBtn.className = 'lrv-asset-action lrv-asset-action-open';
      openBtn.textContent = 'Open';
      openBtn.title = `Open "${a.name}" in a new tab (full size playback for video / audio).`;
      openBtn.href = a.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      actions.appendChild(openBtn);
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'lrv-asset-action';
      renameBtn.textContent = 'Rename';
      renameBtn.title = `Rename "${a.name}"`;
      renameBtn.addEventListener('click', () => {
        renamingAssetName = a.name;
        render();
      });
      actions.appendChild(renameBtn);
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'lrv-asset-action lrv-asset-action-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.title = `Remove "${a.name}" from the asset list.`;
      deleteBtn.addEventListener('click', () => {
        confirmAndDeleteAssets([a.name], 'this');
      });
      actions.appendChild(deleteBtn);
      cap.appendChild(actions);
    }

    tile.appendChild(cap);
    return tile;
  }

  function commitRename(oldName: string, newNameRaw: string): void {
    const newName = newNameRaw.trim();
    if (newName.length === 0 || newName === oldName) {
      renamingAssetName = null;
      render();
      return;
    }
    sendCurrentSourceMutation({
      type: 'rename_asset',
      oldName,
      newName,
    });
    renamingAssetName = null;
  }

  function sendCurrentSourceMutation(
    partial:
      | {
          type: 'add_assets';
          entries: ReadonlyArray<{ assetName: string; imageId: string; ext?: string }>;
        }
      | { type: 'rename_asset'; oldName: string; newName: string }
      | { type: 'delete_assets'; assetNames: readonly string[] },
  ): void {
    if (!viewerData) return;
    const source = viewerData.source.kind === 'character'
      ? { kind: 'character' as const, characterId: viewerData.source.characterId }
      : { kind: 'module' as const, moduleId: viewerData.source.moduleId };
    log.info(`viewer-panel: ${partial.type} via current source kind=${source.kind}`);
    sendToBackend({ ...partial, source } as FrontendToBackend);
  }

  async function onAddAssetClicked(): Promise<void> {
    if (!viewerData) return;
    let files: File[];
    try {
      files = await pickFiles();
    } catch (err) {
      log.error('viewer-panel: file pick threw', err);
      assetUploadStatus = { kind: 'error', message: `File pick failed: ${errMsg(err)}` };
      render();
      return;
    }
    if (files.length === 0) return;
    await uploadAssetsBatch(files);
  }

  // Mirrors payload/import.ts asset uploader: 6-worker pool, count-based progress.
  // Single backend mutation at the end → one envelope write + one viewer re-push.
  async function uploadAssetsBatch(files: readonly File[]): Promise<void> {
    if (!viewerData) return;
    // Snapshot the source at upload-start so a mid-upload source switch
    // doesn't redirect the mutation to the wrong character/module.
    const startSource = viewerData.source.kind === 'character'
      ? { kind: 'character' as const, characterId: viewerData.source.characterId }
      : { kind: 'module' as const, moduleId: viewerData.source.moduleId };
    const existingNames = new Set(viewerData.assets.map((a) => a.name));
    const planned: Array<{ file: File; assetName: string; ext: string | undefined }> = [];
    const failures: Array<{ filename: string; reason: string }> = [];
    for (const f of files) {
      if (f.size > MAX_ASSET_BYTES) {
        failures.push({ filename: f.name, reason: `${formatMB(f.size)} > ${MAX_ASSET_MB} MB` });
        continue;
      }
      const { baseName, ext } = splitName(f.name);
      const assetName = disambiguateName(baseName, existingNames);
      existingNames.add(assetName);
      planned.push({ file: f, assetName, ext });
    }

    const total = planned.length;
    if (total === 0) {
      assetUploadStatus = {
        kind: 'error',
        message: `${failures.length} file${failures.length === 1 ? '' : 's'} skipped — all exceeded ${MAX_ASSET_MB} MB. ${formatFailureList(failures)}`,
      };
      render();
      return;
    }
    let processed = 0;
    const results: Array<{ assetName: string; imageId: string; ext?: string }> = [];
    assetUploadStatus = { kind: 'info', message: `Uploading 0/${total}…` };
    render();

    const concurrency = Math.min(6, total);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= total) break;
        const p = planned[i]!;
        try {
          const imageId = await uploadOne(p.file);
          results.push({
            assetName: p.assetName,
            imageId,
            ...(p.ext !== undefined ? { ext: p.ext } : {}),
          });
        } catch (err) {
          const reason = errMsg(err);
          failures.push({ filename: p.file.name, reason });
          log.warn(`viewer-panel: batch upload failed name="${p.assetName}" file="${p.file.name}": ${reason}`);
        }
        processed += 1;
        if (processed === total || processed % Math.max(1, Math.floor(total / 20)) === 0) {
          const tail = failures.length > 0 ? ` (${failures.length} failed)` : '';
          assetUploadStatus = { kind: 'info', message: `Uploading ${processed}/${total}${tail}…` };
          render();
        }
      }
    };
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);

    if (results.length === 0) {
      assetUploadStatus = {
        kind: 'error',
        message: `All ${files.length} upload(s) failed. ${formatFailureList(failures)}`,
      };
      render();
      return;
    }
    const tail = failures.length > 0
      ? ` (${failures.length} failed — ${formatFailureList(failures)})`
      : '';
    assetUploadStatus = {
      kind: failures.length > 0 ? 'error' : 'info',
      message: `Saving ${results.length} asset${results.length === 1 ? '' : 's'}${tail}…`,
    };
    render();
    log.info(`viewer-panel: add_assets via snapshot source kind=${startSource.kind} entries=${results.length}`);
    sendToBackend({ type: 'add_assets', source: startSource, entries: results } as FrontendToBackend);
  }

  function formatFailureList(failures: ReadonlyArray<{ filename: string; reason: string }>): string {
    if (failures.length === 0) return '';
    const max = 3;
    const shown = failures.slice(0, max).map((f) => `"${f.filename}" (${f.reason})`).join(', ');
    if (failures.length <= max) return shown + '.';
    return `${shown}, +${failures.length - max} more — see console.`;
  }

  function formatMB(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData();
    fd.set('image', file, file.name);
    const resp = await fetch('/api/v1/images', {
      method: 'POST',
      body: fd,
      credentials: 'include',
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = ` — ${(await resp.text()).slice(0, 200)}`; } catch { /* */ }
      throw new Error(`HTTP ${resp.status}${detail}`);
    }
    const body = (await resp.json()) as { id?: string };
    if (typeof body?.id !== 'string' || body.id.length === 0) {
      throw new Error('upload response missing id');
    }
    return body.id;
  }

  function splitName(filename: string): { baseName: string; ext: string | undefined } {
    const lastDot = filename.lastIndexOf('.');
    const baseName = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    const ext = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : undefined;
    return { baseName, ext };
  }

  function disambiguateName(base: string, taken: ReadonlySet<string>): string {
    if (!taken.has(base)) return base;
    for (let n = 2; n < 10_000; n++) {
      const candidate = `${base} (${n})`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base} (${Date.now()})`;
  }

  function pickFiles(): Promise<File[]> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*,audio/*';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      let settled = false;
      const done = (result: File[], err?: Error): void => {
        if (settled) return;
        settled = true;
        try { document.body.removeChild(input); } catch { /* */ }
        if (err) reject(err);
        else resolve(result);
      };
      input.addEventListener('change', () => {
        const list = input.files;
        const out: File[] = [];
        if (list) for (let i = 0; i < list.length; i++) out.push(list.item(i)!);
        done(out);
      });
      input.addEventListener('cancel', () => done([]));
      input.click();
    });
  }

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function renderTriggersSection(triggers: readonly ViewerTriggerEntry[]): HTMLElement {
    const det = document.createElement('section');
    if (triggers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = 'No triggers.';
      det.appendChild(empty);
      return det;
    }
    for (let i = 0; i < triggers.length; i++) {
      det.appendChild(renderTriggerRow(triggers[i]!, i));
    }
    return det;
  }

  function renderTriggerRow(t: ViewerTriggerEntry, index: number): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lrv-trigger-row';
    const head = document.createElement('div');
    head.className = 'lrv-trigger-head';
    const name = document.createElement('span');
    name.className = 'lrv-trigger-name';
    name.textContent = t.name;
    const tag = document.createElement('span');
    tag.className = 'lrv-trigger-tag';
    tag.textContent = `${t.bindingType} · ${t.effectCount} effect${t.effectCount === 1 ? '' : 's'}`;
    head.appendChild(name);
    head.appendChild(tag);
    row.appendChild(head);

    if (editingTriggerIndex === index) {
      // Inline editor.
      const editor = document.createElement('div');
      editor.className = 'lrv-trigger-editor';
      const ta = document.createElement('textarea');
      ta.className = 'lrv-trigger-textarea';
      ta.spellcheck = false;
      ta.value = editingTriggerLua;
      ta.rows = Math.max(8, Math.min(24, editingTriggerLua.split('\n').length + 2));
      ta.addEventListener('input', () => {
        editingTriggerLua = ta.value;
        const lines = ta.value.split('\n').length;
        ta.rows = Math.max(8, Math.min(24, lines + 2));
      });
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          commitTriggerLuaEdit(index);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          editingTriggerIndex = null;
          editingTriggerLua = '';
          render();
        }
      });
      editor.appendChild(ta);
      const actions = document.createElement('div');
      actions.className = 'lrv-trigger-edit-actions';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'lrv-asset-action lrv-asset-action-primary';
      saveBtn.textContent = 'Save';
      saveBtn.title = 'Save (Ctrl+Enter)';
      saveBtn.addEventListener('click', () => commitTriggerLuaEdit(index));
      actions.appendChild(saveBtn);
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'lrv-asset-action';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.title = 'Cancel (Esc)';
      cancelBtn.addEventListener('click', () => {
        editingTriggerIndex = null;
        editingTriggerLua = '';
        render();
      });
      actions.appendChild(cancelBtn);
      editor.appendChild(actions);
      row.appendChild(editor);
      queueMicrotask(() => { ta.focus(); });
    } else {
      const luaDet = document.createElement('details');
      luaDet.className = 'lrv-trigger-lua';
      const luaSum = document.createElement('summary');
      const effectsLabel = t.effects.length > 0
        ? ` · ${t.effects.length} V2 effect${t.effects.length === 1 ? '' : 's'}`
        : '';
      const luaLabel = t.lua
        ? `Lua (${t.lua.length} chars)`
        : (t.effects.length > 0 ? 'Lua (none)' : 'Lua (empty)');
      luaSum.textContent = luaLabel + effectsLabel;
      luaDet.appendChild(luaSum);
      luaDet.open = !t.lua && t.effects.length > 0;
      if (t.lua) {
        const pre = document.createElement('pre');
        pre.className = 'lrv-pre';
        pre.textContent = t.lua;
        luaDet.appendChild(pre);
      }
      if (t.effects.length > 0) {
        const pre = document.createElement('pre');
        pre.className = 'lrv-pre';
        pre.textContent = t.effects
          .map((e) => `${'  '.repeat(Math.min(e.indent, 12))}${e.summary}`)
          .join('\n');
        luaDet.appendChild(pre);
      }
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'lrv-asset-action';
      editBtn.textContent = t.lua ? 'Edit lua' : 'Add lua';
      editBtn.style.margin = '4px 0 0 0';
      editBtn.addEventListener('click', () => {
        editingTriggerIndex = index;
        editingTriggerLua = t.lua ?? '';
        render();
      });
      luaDet.appendChild(editBtn);
      row.appendChild(luaDet);
    }
    return row;
  }

  function commitTriggerLuaEdit(index: number): void {
    if (!viewerData) return;
    const source = viewerData.source.kind === 'character'
      ? { kind: 'character' as const, characterId: viewerData.source.characterId }
      : { kind: 'module' as const, moduleId: viewerData.source.moduleId };
    log.info(`viewer-panel: set_trigger_lua index=${index} kind=${source.kind} luaLen=${editingTriggerLua.length}`);
    sendToBackend({
      type: 'set_trigger_lua',
      source,
      triggerIndex: index,
      lua: editingTriggerLua,
    });
    editingTriggerIndex = null;
    editingTriggerLua = '';
  }

  function renderRegexSection(regex: readonly ViewerRegexEntry[]): HTMLElement {
    const det = document.createElement('section');
    det.className = 'lrv-section';
    const sum = document.createElement('div');
    sum.className = 'lrv-section-summary';
    sum.textContent = `Regex · ${regex.length}`;
    det.appendChild(sum);
    if (regex.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = 'No regex rules.';
      det.appendChild(empty);
      return det;
    }
    for (const r of regex) {
      if (r.divider) {
        const div = document.createElement('div');
        div.className = 'lrv-regex-divider';
        const label = document.createElement('span');
        label.className = 'lrv-regex-divider-label';
        label.textContent = r.name;
        div.appendChild(label);
        det.appendChild(div);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'lrv-regex-row';
      if (r.disabled) row.classList.add('lrv-regex-row-disabled');
      const head = document.createElement('div');
      head.className = 'lrv-regex-head';
      const name = document.createElement('span');
      name.className = 'lrv-regex-name';
      name.textContent = r.name;
      head.appendChild(name);
      const tag = document.createElement('span');
      tag.className = 'lrv-regex-tag';
      const tagParts = [r.target, r.placement].filter((p) => p && p.length > 0);
      tag.textContent = tagParts.join(' · ');
      head.appendChild(tag);
      if (r.moduleId) {
        const modBadge = document.createElement('span');
        modBadge.className = 'lrv-regex-module';
        modBadge.textContent = `from module: ${r.moduleId.slice(0, 8)}…`;
        modBadge.title = `Module id: ${r.moduleId}`;
        head.appendChild(modBadge);
      }
      row.appendChild(head);
      const find = document.createElement('div');
      find.className = 'lrv-regex-line';
      const findLabel = document.createElement('span');
      findLabel.className = 'lrv-regex-line-label';
      findLabel.textContent = 'find:';
      find.appendChild(findLabel);
      const findCode = document.createElement('code');
      findCode.textContent = r.find;
      find.appendChild(findCode);
      row.appendChild(find);
      const repl = document.createElement('div');
      repl.className = 'lrv-regex-line';
      const replLabel = document.createElement('span');
      replLabel.className = 'lrv-regex-line-label';
      replLabel.textContent = 'replace:';
      repl.appendChild(replLabel);
      const replCode = document.createElement('code');
      replCode.textContent = r.replace.length > 200 ? r.replace.slice(0, 200) + '…' : r.replace;
      repl.appendChild(replCode);
      row.appendChild(repl);
      det.appendChild(row);
    }
    return det;
  }

  function renderLorebookLegacyNotice(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'lrv-empty lrv-lb-legacy';
    wrap.textContent =
      '⚠️ This is a legacy card imported before 0.3.0. Please reimport this card to unlock the lorebook viewer.';
    return wrap;
  }

  function findGroupModule(g: ViewerLorebookGroup): ModuleSummary | undefined {
    if (g.moduleId) {
      const byId = modules.find((x) => x.id === g.moduleId);
      if (byId) return byId;
    }
    if (g.groupId === 'module') return undefined;
    return modules.find((x) => {
      if (!x.name) return false;
      return g.groupName === x.name
        || g.groupName === `Module: ${x.name}`
        || g.groupName.includes(x.name);
    });
  }

  function pickLoreGroupDisplay(g: ViewerLorebookGroup): string {
    if (!getTranslateEnabled()) return g.groupName;

    const m = findGroupModule(g);
    if (m && m.name) {
      if (m.translatedName && m.translatedName !== m.name) {
        return g.groupName.includes(m.name)
          ? g.groupName.replace(m.name, m.translatedName)
          : m.translatedName;
      }
      void translateModuleName(m.id, m.name);
      return g.translatedGroupName ?? g.groupName;
    }

    const src = viewerData?.source;
    if (src && src.kind === 'character') {
      const c = cards.find((x) => x.character_id === src.characterId);
      if (c && c.character_name) {
        if (c.translated_character_name && c.translated_character_name !== c.character_name) {
          return g.groupName.includes(c.character_name)
            ? g.groupName.replace(c.character_name, c.translated_character_name)
            : c.translated_character_name;
        }
        void translateCharacterName(c.character_id, c.character_name);
      }
    }

    return g.translatedGroupName ?? g.groupName;
  }

  function renderLorebookSection(groups: readonly ViewerLorebookGroup[]): HTMLElement {
    const det = document.createElement('section');
    det.className = 'lrv-section lrv-lb-section';

    const toolbar = document.createElement('div');
    toolbar.className = 'lrv-lb-toolbar';
    const legend = document.createElement('div');
    legend.className = 'lrv-lb-legend';
    legend.setAttribute('aria-label', 'Lorebook entry status legend');
    const legendItems: ReadonlyArray<{ label: string; status: 'constant' | 'enabled' | 'disabled' }> = [
      { label: 'Constant', status: 'constant' },
      { label: 'Enabled', status: 'enabled' },
      { label: 'Disabled', status: 'disabled' },
    ];
    for (const item of legendItems) {
      const legendItem = document.createElement('span');
      legendItem.className = 'lrv-lb-legend-item';
      const dot = document.createElement('span');
      dot.className = `lrv-lb-status lrv-lb-status-${item.status}`;
      dot.setAttribute('aria-hidden', 'true');
      legendItem.appendChild(dot);
      legendItem.appendChild(document.createTextNode(item.label));
      legend.appendChild(legendItem);
    }
    toolbar.appendChild(legend);

    // Prefer the character's own book over attached-module books. Module
    // sources still fall back to their installed live book. Synthetic
    // envelope-only groups use the literal "module" and have no host target.
    const bookTarget = groups.find((group) => group.groupId !== 'module' && !group.moduleId)
      ?? groups.find((group) => group.groupId !== 'module');
    if (bookTarget) {
      const navigationKey = lorebookNavigationKey(bookTarget.groupId);
      const navigationPending = lorebookNavigationPending.has(navigationKey);
      const openBookButton = document.createElement('button');
      openBookButton.type = 'button';
      openBookButton.className = 'lrv-btn lrv-lb-open-lumiverse lrv-lb-open-book';
      openBookButton.textContent = navigationPending ? 'Opening…' : 'Open in Lumiverse';
      openBookButton.disabled = navigationPending;
      openBookButton.title = `Open ${bookTarget.groupName} in Lumiverse's World Book Editor.`;
      openBookButton.addEventListener('click', () => {
        beginOpenWorldBookEditor(bookTarget.groupId);
      });
      toolbar.appendChild(openBookButton);
    }
    det.appendChild(toolbar);

    if (lorebookActionError) {
      const error = document.createElement('div');
      error.className = 'lrv-lb-action-error';
      error.textContent = lorebookActionError;
      det.appendChild(error);
    }

    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lrv-empty';
      empty.textContent = 'No lorebook entries available here.';
      det.appendChild(empty);
      return det;
    }
    for (const g of groups) {
      const risuEntries: import('../types/messages.js').ViewerLorebookEntry[] = [];
      const userAdditions: import('../types/messages.js').ViewerLorebookEntry[] = [];
      for (const e of g.entries) {
        if (e.fromRisu === false) userAdditions.push(e);
        else risuEntries.push(e);
      }
      const grpDet = document.createElement('details');
      grpDet.className = 'lrv-lb-group';
      grpDet.open = !closedLorebookGroups.has(g.groupId);
      grpDet.dataset['worldBookId'] = g.groupId;
      grpDet.addEventListener('toggle', () => {
        if (grpDet.open) closedLorebookGroups.delete(g.groupId);
        else closedLorebookGroups.add(g.groupId);
      });
      const grpSum = document.createElement('summary');
      grpSum.className = 'lrv-lb-group-summary';
      const display = pickLoreGroupDisplay(g);
      const isTranslated = display !== g.groupName;
      grpSum.textContent = `${display} (${g.entries.length})`;
      if (isTranslated) grpSum.title = g.groupName;
      grpDet.appendChild(grpSum);
      renderLorebookEntriesWithFolders(grpDet, g, risuEntries);
      if (userAdditions.length > 0) {
        const uaHead = document.createElement('div');
        uaHead.className = 'lrv-lb-useradds-head';
        uaHead.textContent = `User Additions (${userAdditions.length})`;
        grpDet.appendChild(uaHead);
        renderLorebookEntriesWithFolders(grpDet, g, userAdditions);
      }
      det.appendChild(grpDet);
    }
    return det;
  }

  function renderLorebookEntriesWithFolders(
    container: HTMLElement,
    group: ViewerLorebookGroup,
    entries: readonly ViewerLorebookEntry[],
  ): void {
    const childrenByFolder = new Map<string, ViewerLorebookEntry[]>();
    const folderKeys = new Set<string>();
    for (const e of entries) {
      if (e.risuMode === 'folder' && e.risuFolderKey) folderKeys.add(e.risuFolderKey);
      if (e.risuFolderRef) {
        const arr = childrenByFolder.get(e.risuFolderRef) ?? [];
        arr.push(e);
        childrenByFolder.set(e.risuFolderRef, arr);
      }
    }
    for (const e of entries) {
      if (e.risuMode === 'folder' && e.risuFolderKey) {
        const children = childrenByFolder.get(e.risuFolderKey) ?? [];
        container.appendChild(renderLorebookFolderGroup(group, e, children));
        continue;
      }
      if (e.risuFolderRef && folderKeys.has(e.risuFolderRef)) continue;
      container.appendChild(renderLorebookRow(group, e));
    }
  }

  function renderLorebookFolderGroup(
    group: ViewerLorebookGroup,
    folder: ViewerLorebookEntry,
    children: readonly ViewerLorebookEntry[],
  ): HTMLDetailsElement {
    const det = document.createElement('details');
    det.className = 'lrv-lb-folder-group';
    const folderStateKey = `${group.groupId}::${folder.id}`;
    det.open = openLorebookFolders.has(folderStateKey);
    det.addEventListener('toggle', () => {
      if (det.open) openLorebookFolders.add(folderStateKey);
      else openLorebookFolders.delete(folderStateKey);
    });
    const sum = document.createElement('summary');
    sum.className = 'lrv-lb-folder-summary';
    const icon = document.createElement('span');
    icon.className = 'lrv-lb-folder-icon';
    icon.setAttribute('aria-hidden', 'true');
    sum.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'lrv-lb-folder-name';
    const display = lorebookDisplayComment(folder);
    name.textContent = display && display.length > 0 ? display : '(unnamed folder)';
    sum.appendChild(name);
    kickoffEntryTranslation(folder, name);
    const count = document.createElement('span');
    count.className = 'lrv-lb-folder-count';
    count.textContent = `(${children.length})`;
    sum.appendChild(count);
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'lrv-lb-folder-body';
    for (const c of children) body.appendChild(renderLorebookRow(group, c));
    det.appendChild(body);
    return det;
  }

  function lorebookStatus(e: ViewerLorebookEntry): {
    readonly kind: 'constant' | 'enabled' | 'disabled';
    readonly label: string;
  } {
    if (e.disabled) return { kind: 'disabled', label: 'Disabled' };
    if (e.constant) return { kind: 'constant', label: 'Constant' };
    return { kind: 'enabled', label: 'Enabled' };
  }

  function renderLorebookRow(group: ViewerLorebookGroup, e: ViewerLorebookEntry): HTMLElement {
    if (e.risuMode === 'folder') return renderLorebookFolderHeader(e);
    if (e.risuMode === 'child') return renderLorebookChildLink(e);
    const row = document.createElement('details');
    row.className = 'lrv-lb-row';
    row.dataset['entryId'] = e.id;
    row.dataset['worldBookId'] = group.groupId;
    if (e.disabled) row.classList.add('lrv-lb-row-disabled');
    const entryStateKey = `${group.groupId}::${e.id}`;
    row.open = openLorebookEntries.has(entryStateKey);
    row.addEventListener('toggle', () => {
      if (row.open) openLorebookEntries.add(entryStateKey);
      else openLorebookEntries.delete(entryStateKey);
    });
    const sum = document.createElement('summary');
    sum.className = 'lrv-lb-row-summary';
    const dot = document.createElement('span');
    const status = lorebookStatus(e);
    dot.className = `lrv-lb-status lrv-lb-status-${status.kind}`;
    dot.title = status.label;
    dot.setAttribute('aria-label', status.label);
    sum.appendChild(dot);
    const name = document.createElement('span');
    name.className = 'lrv-lb-name';
    name.textContent = lorebookEntryName(e);
    sum.appendChild(name);
    row.appendChild(sum);
    row.appendChild(renderLorebookRowDetail(group, e));
    kickoffEntryTranslation(e, name);
    return row;
  }

  function renderLorebookFolderHeader(
    e: ViewerLorebookEntry,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lrv-lb-folder';
    const icon = document.createElement('span');
    icon.className = 'lrv-lb-folder-icon';
    icon.setAttribute('aria-hidden', 'true');
    row.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'lrv-lb-folder-name';
    const display = lorebookDisplayComment(e);
    name.textContent = display && display.length > 0 ? display : '(unnamed folder)';
    row.appendChild(name);
    kickoffEntryTranslation(e, name);
    return row;
  }

  function renderLorebookChildLink(
    e: ViewerLorebookEntry,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lrv-lb-child';
    const name = document.createElement('span');
    name.className = 'lrv-lb-child-name';
    const display = lorebookDisplayComment(e);
    name.textContent = display && display.length > 0 ? display : '(linked entry)';
    row.appendChild(name);
    kickoffEntryTranslation(e, name);
    return row;
  }

  function lorebookDisplayComment(e: ViewerLorebookEntry): string | undefined {
    if (getTranslateEnabled() && e.translatedComment) return e.translatedComment;
    return e.comment;
  }

  function classifyViewerScope(d: import('../types/messages.js').ViewerData): void {
    const corpus: string[] = [];
    for (const g of d.lorebook) {
      corpus.push(g.groupName);
      for (const e of g.entries) {
        if (e.comment) corpus.push(e.comment);
      }
    }
    const lang = dominantScriptLang(corpus);
    if (d.source.kind === 'character') {
      setCharacterScopeLang(d.source.characterId, lang);
    } else {
      setModuleScopeLang(d.source.moduleId, lang);
    }
  }

  function viewerScopeForTranslate():
    | { kind: 'module'; moduleId: string }
    | { kind: 'character'; characterId: string }
    | null {
    const src = viewerData?.source;
    if (!src) return null;
    return src.kind === 'module'
      ? { kind: 'module', moduleId: src.moduleId }
      : { kind: 'character', characterId: src.characterId };
  }

  function kickoffEntryTranslation(
    e: ViewerLorebookEntry,
    nameEl: HTMLElement,
  ): void {
    if (!getTranslateEnabled()) return;
    if (e.translatedComment) return;
    if (!e.sourceHash || !e.comment) return;
    const scope = viewerScopeForTranslate();
    if (!scope) return;
    const original = e.comment;
    void translateLorebookComment(scope, e.sourceHash, original).then((tx) => {
      if (tx && tx !== original && nameEl.isConnected && getTranslateEnabled()) {
        nameEl.textContent = tx;
      }
    });
  }

  function lorebookEntryName(e: ViewerLorebookEntry): string {
    const display = lorebookDisplayComment(e);
    if (display && display.length > 0) return display;
    if (e.key.length > 0) return e.key.join(', ');
    return '(unnamed)';
  }

  function renderLorebookRowDetail(
    group: ViewerLorebookGroup,
    e: ViewerLorebookEntry,
  ): HTMLDivElement {
    const body = document.createElement('div');
    body.className = 'lrv-lb-body';
    if (!e.constant && e.key.length > 0) {
      body.appendChild(field('Activation keys', e.key.join(', ')));
    }
    if (typeof e.position === 'number') {
      body.appendChild(field('Position', positionLabel(e.position, e.depth)));
    }
    if (typeof e.orderValue === 'number') {
      body.appendChild(field('Insert order', String(e.orderValue)));
    }
    const promptLabel = document.createElement('div');
    promptLabel.className = 'lrv-lb-field-label';
    promptLabel.textContent = 'Prompt';
    body.appendChild(promptLabel);
    const content = document.createElement('pre');
    content.className = 'lrv-lb-content';
    content.textContent = e.content;
    body.appendChild(content);

    if (group.groupId !== 'module') {
      const actions = document.createElement('div');
      actions.className = 'lrv-lb-actions';
      const mutationKey = `${group.groupId}::${e.id}`;
      const navigationKey = lorebookNavigationKey(group.groupId, e.id);
      const navigationPending = lorebookNavigationPending.has(navigationKey);
      const pendingDisabled = lorebookMutationPending.get(mutationKey);
      const pending = pendingDisabled !== undefined;

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'lrv-btn lrv-lb-open-lumiverse lrv-lb-open-entry';
      openButton.textContent = navigationPending ? 'Opening…' : 'Open in Lumiverse';
      openButton.disabled = navigationPending;
      openButton.title = 'Open this exact entry in Lumiverse\'s World Book Editor.';
      openButton.addEventListener('click', () => {
        beginOpenWorldBookEditor(group.groupId, e.id);
      });
      actions.appendChild(openButton);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'lrv-btn lrv-lb-toggle-entry';
      toggle.textContent = pending
        ? (pendingDisabled ? 'Disabling…' : 'Enabling…')
        : (e.disabled ? 'Enable entry' : 'Disable entry');
      toggle.disabled = pending;
      toggle.addEventListener('click', () => {
        if (lorebookMutationPending.has(mutationKey)) return;
        const source = currentViewerSourceRef();
        if (!source) return;
        lorebookMutationPending.set(mutationKey, !e.disabled);
        openLorebookEntries.add(mutationKey);
        lorebookActionError = null;
        renderSurfaces();
        sendToBackend({
          type: 'set_viewer_lorebook_entry_disabled',
          source,
          worldBookId: group.groupId,
          entryId: e.id,
          disabled: !e.disabled,
        });
      });
      actions.appendChild(toggle);
      body.appendChild(actions);
    }
    return body;
  }

  function field(label: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'lrv-lb-field';
    const l = document.createElement('span');
    l.className = 'lrv-lb-field-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'lrv-lb-field-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function positionLabel(position: number, depth?: number): string {
    switch (position) {
      case 0: return 'before char';
      case 1: return 'after char';
      case 2: return 'before AN';
      case 3: return 'after AN';
      case 4: return `depth ${depth ?? '?'}`;
      case 5: return 'before ex';
      case 6: return 'after ex';
      default: return `pos ${position}`;
    }
  }

  function render(): void {
    renderStatus();
    renderSurfaces();
  }

  const unsubTranslate = subscribeTranslateEnabled(() => {
    rebuildSourceSelect();
    render();
  });

  refreshBtn.addEventListener('click', () => {
    if (!selectedSourceKey) return;
    const o = parseSourceKey(selectedSourceKey);
    if (o) requestForSelection(o);
  });

  function handleBackendMessage(msg: BackendToFrontend): void {
    switch (msg.type) {
      case 'set_active_chat': {
        const next = msg.characterId ?? null;
        if (next === activeCharacterId) break;
        activeCharacterId = next;
        updateCurrentBtn();
        pendingAutoSwitch = false;
        if (next !== null) {
          const switched = selectToCharacter(next, 'set_active_chat');
          pendingAutoSwitch = !switched;
        }
        break;
      }
      case 'cards_updated': {
        cards = msg.cards;
        const keyBeforeRebuild = selectedSourceKey;
        rebuildSourceSelect();
        updateCurrentBtn();
        render();
        let switched = false;
        if (pendingAutoSwitch && activeCharacterId !== null) {
          switched = selectToCharacter(activeCharacterId, 'cards_updated');
          if (switched) pendingAutoSwitch = false;
        }
        // rebuildSourceSelect issues requestForSelection in two cases: no prior
        // selection, OR prior selection no longer in the new options. Skip the
        // trailing re-fetch when either rebuild or auto-switch already issued.
        const rebuildPickedFresh =
          selectedSourceKey !== null
          && (keyBeforeRebuild === null || keyBeforeRebuild !== selectedSourceKey);
        const rebuildIssuedFetch = rebuildPickedFresh && !switched;
        if (selectedSourceKey !== null && !switched && !rebuildIssuedFetch) {
          const o = parseSourceKey(selectedSourceKey);
          if (o?.kind === 'character') requestForSelection(o);
        }
        break;
      }
      case 'modules_pushed': {
        modules = msg.modules;
        const affectedChars = new Set<string>();
        if (msg.attached_by_character) {
          for (const [charId, list] of Object.entries(msg.attached_by_character)) {
            attachedByCharacter.set(charId, list);
            affectedChars.add(charId);
          }
        }
        rebuildSourceSelect();
        render();
        const sel = selectedSourceKey ? parseSourceKey(selectedSourceKey) : null;
        if (sel?.kind === 'character' && affectedChars.has(sel.id)) {
          softRefetchCurrentSelection();
        } else if (sel?.kind === 'module' && !modules.some((m) => m.id === sel.id)) {
          viewerData = null;
          loading = false;
          render();
        }
        break;
      }
      case 'attached_modules_pushed': {
        attachedByCharacter.set(msg.characterId, msg.attached);
        rebuildSourceSelect();
        render();
        const sel = selectedSourceKey ? parseSourceKey(selectedSourceKey) : null;
        if (sel?.kind === 'character' && sel.id === msg.characterId) {
          softRefetchCurrentSelection();
        }
        break;
      }
      case 'viewer_lorebook_entry_disabled_result': {
        const mutationKey = `${msg.worldBookId}::${msg.entryId}`;
        if (selectedSourceKey !== viewerSourceKey(msg.source)) break;
        lorebookMutationPending.delete(mutationKey);
        if (!msg.ok) {
          lorebookActionError = `Could not update lorebook entry: ${msg.error ?? 'unknown error'}`;
          render();
          break;
        }
        lorebookActionError = null;
        if (viewerData) {
          viewerData = {
            ...viewerData,
            lorebook: viewerData.lorebook.map((group) => group.groupId !== msg.worldBookId
              ? group
              : {
                  ...group,
                  entries: group.entries.map((entry) => entry.id === msg.entryId
                    ? { ...entry, disabled: msg.disabled }
                    : entry),
                }),
          };
        }
        render();
        break;
      }
      case 'viewer_data_pushed': {
        const d = msg.data;
        const expectedKey = sourceKey(
          d.source.kind === 'character'
            ? { kind: 'character', id: d.source.characterId, label: d.source.name }
            : { kind: 'module', id: d.source.moduleId, label: d.source.name },
        );
        if (selectedSourceKey !== null && selectedSourceKey !== expectedKey) {
          log.info(`viewer-panel: ignoring stale push for ${expectedKey} (selected=${selectedSourceKey})`);
          return;
        }
        viewerData = d;
        loading = false;
        lastError = null;
        if (assetUploadStatus !== null && assetUploadStatus.kind === 'info') {
          assetUploadStatus = null;
        }
        if (defaultsTextBuffer !== null && d.source.kind === 'character' && defaultsTextBuffer === d.defaultVariablesText) {
          defaultsTextBuffer = null;
        }
        if (bgHtmlTextBuffer !== null && d.source.kind === 'character' && bgHtmlTextBuffer === (d.backgroundHtml ?? '')) {
          bgHtmlTextBuffer = null;
        }
        classifyViewerScope(d);
        render();
        break;
      }
      // `lorebook_import_result` is consumed by the Import → Lorebooks tab
      // (Phase E) for standalone imports. Per-character imports no longer
      // surface UI here either , moved to that tab.
      case 'error':
        if (loading) {
          loading = false;
          lastError = msg.message;
          render();
        } else if (assetUploadStatus !== null) {
          assetUploadStatus = { kind: 'error', message: msg.message };
          render();
        }
        break;
    }
  }

  // Document-level because tiles aren't focusable, so a root listener would miss
  // Escape whenever focus sat on body. The select-mode guard keeps it narrow.
  function onEscapeKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !assetSelectMode) return;
    e.stopPropagation();
    setAssetSelectMode(false);
  }
  document.addEventListener('keydown', onEscapeKeyDown, true);

  function destroy(): void {
    log.info('viewer-panel: destroy');
    destroyed = true;
    try { document.removeEventListener('keydown', onEscapeKeyDown, true); } catch { /* */ }
    try { sourceSelect.destroy(); } catch { /* */ }
    try { unsubTranslate(); } catch { /* */ }
    try { root.replaceChildren(); } catch { /* */ }
  }

  sendToBackend({ type: 'get_cards' });
  sendToBackend({ type: 'request_modules' });

  updateCurrentBtn();
  render();
  log.info('viewer-panel: ready');

  return { handleBackendMessage, destroy };
}
