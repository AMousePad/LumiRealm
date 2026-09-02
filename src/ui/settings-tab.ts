import type {
  BackendToFrontend,
  FrontendToBackend,
  OrphanAssetEntry,
  RepairScanSummary,
} from '../types/messages.js';
import type { FrontendLog } from './drawer.js';
import { mountLogsPanel } from './logs-tab.js';
import { createVirtualGrid, type VirtualGridHandle } from './virtual-grid.js';
import { createSearchableSelect, type SearchableSelectItem } from './searchable-select.js';
import { createChipMultiSelect, type ChipMultiSelectHandle } from './chip-multi-select.js';

// Settings UI for aux/submodel LLM connections.
// Every change is sent as update_settings; state is reflected back via settings_pushed.

interface ConnectionSummary {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly is_default: boolean;
}

type SamplerKey =
  | 'temperature' | 'maxTokens' | 'contextSize'
  | 'topP' | 'minP' | 'topK'
  | 'frequencyPenalty' | 'presencePenalty' | 'repetitionPenalty';

type SamplerBag = Readonly<Record<SamplerKey, number | null>>;

interface Settings {
  readonly auxConnectionId: string | null;
  readonly auxModelOverride: string | null;
  readonly auxSamplers: SamplerBag;
  readonly submodelConnectionId: string | null;
  readonly submodelModelOverride: string | null;
  readonly submodelSamplers: SamplerBag;
  readonly auxPrefillCompat: boolean;
  readonly submodelPrefillCompat: boolean;
  readonly auxDebugCaptureRequest: boolean;
  readonly auxDebugCaptureResponse: boolean;
  readonly legacyMediaFindings: boolean;
  readonly skipAssetThumbnails: boolean;
}

type ChannelKey = 'aux' | 'submodel';

interface ChannelDef {
  readonly key: ChannelKey;
  /** Settings field for the connection UUID. */
  readonly connectionField: 'auxConnectionId' | 'submodelConnectionId';
  /** Settings field for the model override. */
  readonly modelField: 'auxModelOverride' | 'submodelModelOverride';
  /** Settings field for the sampler bag. */
  readonly samplerField: 'auxSamplers' | 'submodelSamplers';
  /** Section title shown in the drawer. */
  readonly title: string;
  /** One-line section description. */
  readonly description: string;
  /** Element-id prefix to dodge collisions between the two sections. */
  readonly idPrefix: string;
}

const CHANNEL_DEFS: readonly ChannelDef[] = [
  {
    key: 'aux',
    connectionField: 'auxConnectionId',
    modelField: 'auxModelOverride',
    samplerField: 'auxSamplers',
    title: 'Auxiliary Model (axLLMMain)',
    description:
      "Routes auxiliary LLM calls through this connection. Low-level access cards usually use this to generate status panels and background-info.",
    idPrefix: 'rs-aux',
  },
  {
    key: 'submodel',
    connectionField: 'submodelConnectionId',
    modelField: 'submodelModelOverride',
    samplerField: 'submodelSamplers',
    title: 'Submodel (V2 runLLM submodel channel)',
    description:
      "Cards use this for lightweight classifiers / status updaters separate from the main and aux models.",
    idPrefix: 'rs-submodel',
  },
];

interface SamplerDef {
  readonly key: SamplerKey;
  readonly label: string;
  readonly type: 'int' | 'float';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultHint: number;
}

const SAMPLER_DEFS: readonly SamplerDef[] = [
  { key: 'temperature',       label: 'Temperature',  type: 'float', min: 0, max: 2,       step: 0.01, defaultHint: 1.0 },
  { key: 'maxTokens',         label: 'Max Response', type: 'int',   min: 1, max: 128000,  step: 1,    defaultHint: 16384 },
  { key: 'contextSize',       label: 'Context Size', type: 'int',   min: 1, max: 2000000, step: 1,    defaultHint: 128000 },
  { key: 'topP',              label: 'Top P',        type: 'float', min: 0, max: 1,       step: 0.01, defaultHint: 0.95 },
  { key: 'minP',              label: 'Min P',        type: 'float', min: 0, max: 1,       step: 0.01, defaultHint: 0 },
  { key: 'topK',              label: 'Top K',        type: 'int',   min: 0, max: 500,     step: 1,    defaultHint: 0 },
  { key: 'frequencyPenalty',  label: 'Freq Penalty', type: 'float', min: 0, max: 2,       step: 0.01, defaultHint: 0 },
  { key: 'presencePenalty',   label: 'Pres Penalty', type: 'float', min: 0, max: 2,       step: 0.01, defaultHint: 0 },
  { key: 'repetitionPenalty', label: 'Rep Penalty',  type: 'float', min: 0, max: 2,       step: 0.01, defaultHint: 0 },
];

export interface SettingsTabHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

export interface MountSettingsPanelOptions {
  readonly root: HTMLElement;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
}

export function mountSettingsPanel(
  opts: MountSettingsPanelOptions,
): SettingsTabHandle {
  const { sendToBackend, log } = opts;
  log.info('settings-panel: mounting');

  const root = opts.root;
  root.classList.add('risu-settings-drawer');

  let settings: Settings | null = null;
  let connections: readonly ConnectionSummary[] | null = null;
  let lastSavedTs: number = 0;

  // Status pinned at the top so it stays visible across subtabs.
  const status = document.createElement('div');
  status.className = 'rs-status';
  root.appendChild(status);

  // Subtab nav (Auxiliary / Sub / Debug / Cleanup).
  type SettingsSubTabId = 'aux' | 'sub' | 'debug' | 'cleanup';
  const SUB_TABS: ReadonlyArray<{ id: SettingsSubTabId; label: string; title: string }> = [
    { id: 'aux',     label: 'Auxiliary', title: "Aux model, used by Lua's axLLMMain / axLLM calls." },
    { id: 'sub',     label: 'Sub',       title: "Submodel, used by V2 runLLM(model='submodel'). Falls back to Aux when empty." },
    { id: 'debug',   label: 'Debug',     title: 'Capture toggles, parity toggles, and diagnostic logs.' },
    { id: 'cleanup', label: 'Cleanup',   title: 'Find and delete orphaned image assets that no live character or module references.' },
  ];
  const subnav = document.createElement('div');
  subnav.className = 'lr-subtabs';
  subnav.setAttribute('role', 'tablist');
  root.appendChild(subnav);
  const subnavBtns = new Map<SettingsSubTabId, HTMLButtonElement>();
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
  let activeSubTab: SettingsSubTabId = 'aux';

  // ---------- Auxiliary subtab body ----------------------------------------
  const auxBody = document.createElement('section');
  auxBody.className = 'lr-settings-tab-body';

  const auxIntro = document.createElement('p');
  auxIntro.className = 'lr-settings-intro';
  auxIntro.textContent = "Routes Lua's axLLMMain / axLLM calls through this connection. Useful for status-window updaters / classifiers separate from the main chat model.";
  auxBody.appendChild(auxIntro);

  const connRow = document.createElement('div');
  connRow.className = 'rs-row';
  const connLabel = document.createElement('label');
  connLabel.className = 'rs-label';
  connLabel.textContent = 'Connection';
  connLabel.htmlFor = 'rs-aux-conn';
  connRow.appendChild(connLabel);
  const connSelect = createSearchableSelect({
    id: 'rs-aux-conn',
    className: 'rs-trigger',
    placeholder: 'Loading connections…',
    searchPlaceholder: 'Search connections…',
    emptyMessage: 'No matching connections',
    items: [],
    onChange(value) {
      log.info(`settings-tab: connection changed to "${value ?? '<default>'}"`);
      sendToBackend({
        type: 'update_settings',
        patch: { auxConnectionId: value },
      });
    },
  });
  connRow.appendChild(connSelect.root);
  auxBody.appendChild(connRow);

  const modelRow = document.createElement('div');
  modelRow.className = 'rs-row';
  const modelLabel = document.createElement('label');
  modelLabel.className = 'rs-label';
  modelLabel.textContent = 'Model override';
  modelLabel.htmlFor = 'rs-aux-model';
  modelRow.appendChild(modelLabel);
  const modelInput = document.createElement('input');
  modelInput.id = 'rs-aux-model';
  modelInput.type = 'text';
  modelInput.className = 'rs-input';
  modelInput.placeholder = '(use connection default)';
  modelInput.spellcheck = false;
  modelRow.appendChild(modelInput);
  auxBody.appendChild(modelRow);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'rs-row rs-row-buttons';
  const saveModelBtn = document.createElement('button');
  saveModelBtn.type = 'button';
  saveModelBtn.className = 'lrm-btn lrm-btn-primary';
  saveModelBtn.textContent = 'Save';
  saveModelBtn.title = 'Save the model override.';
  buttonRow.appendChild(saveModelBtn);
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'lrm-btn';
  resetBtn.textContent = 'Reset';
  resetBtn.title = 'Clear connection and model.';
  buttonRow.appendChild(resetBtn);
  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'lrm-btn';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Re-fetch connection list.';
  buttonRow.appendChild(refreshBtn);
  auxBody.appendChild(buttonRow);

  const samplersSection = document.createElement('div');
  samplersSection.className = 'rs-subsection';
  const samplersHeader = document.createElement('div');
  samplersHeader.className = 'rs-subsection-header';
  const samplersTitle = document.createElement('h4');
  samplersTitle.className = 'rs-subsection-title';
  samplersTitle.textContent = 'Samplers';
  samplersTitle.title = 'Drag to set, double-click to reset, empty falls back to connection preset.';
  samplersHeader.appendChild(samplersTitle);
  samplersSection.appendChild(samplersHeader);
  const samplersListEl = document.createElement('div');
  samplersListEl.className = 'rs-samplers-list';
  samplersSection.appendChild(samplersListEl);
  auxBody.appendChild(samplersSection);

  const auxPrefillSection = document.createElement('div');
  auxPrefillSection.className = 'rs-subsection';
  const auxPrefillRow = document.createElement('label');
  auxPrefillRow.className = 'rs-checkbox-row';
  const auxPrefillCheck = document.createElement('input');
  auxPrefillCheck.type = 'checkbox';
  auxPrefillCheck.className = 'rs-checkbox';
  auxPrefillCheck.id = 'rs-aux-prefill';
  auxPrefillRow.htmlFor = 'rs-aux-prefill';
  const auxPrefillText = document.createElement('span');
  auxPrefillText.className = 'rs-checkbox-label';
  auxPrefillText.textContent = 'Prefill compatibility';
  auxPrefillText.title = 'Converts the assistant message prefill to a user message prepended with "Begin your response with: <prefill>" to be compatible with models that don\'t support it.';
  auxPrefillRow.appendChild(auxPrefillCheck);
  auxPrefillRow.appendChild(auxPrefillText);
  auxPrefillSection.appendChild(auxPrefillRow);
  auxBody.appendChild(auxPrefillSection);

  // ---------- Sub subtab body ----------------------------------------------
  const subBody = document.createElement('section');
  subBody.className = 'lr-settings-tab-body';

  const subIntro = document.createElement('p');
  subIntro.className = 'lr-settings-intro';
  subIntro.textContent = "Routes V2-effect runLLM(model='submodel') calls through this connection. Cards use this for lightweight classifiers / status updaters separate from the main and aux models. Empty fields inherit from Aux.";
  subBody.appendChild(subIntro);

  const submodelConnRow = document.createElement('div');
  submodelConnRow.className = 'rs-row';
  const submodelConnLabel = document.createElement('label');
  submodelConnLabel.className = 'rs-label';
  submodelConnLabel.textContent = 'Connection';
  submodelConnLabel.htmlFor = 'rs-submodel-conn';
  submodelConnRow.appendChild(submodelConnLabel);
  const submodelConnSelect = createSearchableSelect({
    id: 'rs-submodel-conn',
    className: 'rs-trigger',
    placeholder: 'Loading connections…',
    searchPlaceholder: 'Search connections…',
    emptyMessage: 'No matching connections',
    items: [],
    onChange(value) {
      log.info(`settings-tab: submodel connection changed to "${value ?? '<inherit-aux>'}"`);
      sendToBackend({
        type: 'update_settings',
        patch: { submodelConnectionId: value },
      });
    },
  });
  submodelConnRow.appendChild(submodelConnSelect.root);
  subBody.appendChild(submodelConnRow);

  const submodelModelRow = document.createElement('div');
  submodelModelRow.className = 'rs-row';
  const submodelModelLabel = document.createElement('label');
  submodelModelLabel.className = 'rs-label';
  submodelModelLabel.textContent = 'Model override';
  submodelModelLabel.htmlFor = 'rs-submodel-model';
  submodelModelRow.appendChild(submodelModelLabel);
  const submodelModelInput = document.createElement('input');
  submodelModelInput.id = 'rs-submodel-model';
  submodelModelInput.type = 'text';
  submodelModelInput.className = 'rs-input';
  submodelModelInput.placeholder = '(use connection default)';
  submodelModelInput.spellcheck = false;
  submodelModelRow.appendChild(submodelModelInput);
  subBody.appendChild(submodelModelRow);

  const submodelButtonRow = document.createElement('div');
  submodelButtonRow.className = 'rs-row rs-row-buttons';
  const submodelSaveModelBtn = document.createElement('button');
  submodelSaveModelBtn.type = 'button';
  submodelSaveModelBtn.className = 'lrm-btn lrm-btn-primary';
  submodelSaveModelBtn.textContent = 'Save';
  submodelSaveModelBtn.title = 'Save the model override.';
  submodelButtonRow.appendChild(submodelSaveModelBtn);
  const submodelResetBtn = document.createElement('button');
  submodelResetBtn.type = 'button';
  submodelResetBtn.className = 'lrm-btn';
  submodelResetBtn.textContent = 'Reset';
  submodelResetBtn.title = 'Clear submodel fields.';
  submodelButtonRow.appendChild(submodelResetBtn);
  subBody.appendChild(submodelButtonRow);

  const submodelSamplersSection = document.createElement('div');
  submodelSamplersSection.className = 'rs-subsection';
  const submodelSamplersHeader = document.createElement('div');
  submodelSamplersHeader.className = 'rs-subsection-header';
  const submodelSamplersTitle = document.createElement('h4');
  submodelSamplersTitle.className = 'rs-subsection-title';
  submodelSamplersTitle.textContent = 'Samplers';
  submodelSamplersTitle.title = 'Drag to set, double-click to reset.';
  submodelSamplersHeader.appendChild(submodelSamplersTitle);
  submodelSamplersSection.appendChild(submodelSamplersHeader);
  const submodelSamplersListEl = document.createElement('div');
  submodelSamplersListEl.className = 'rs-samplers-list';
  submodelSamplersSection.appendChild(submodelSamplersListEl);
  subBody.appendChild(submodelSamplersSection);

  const submodelPrefillSection = document.createElement('div');
  submodelPrefillSection.className = 'rs-subsection';
  const submodelPrefillRow = document.createElement('label');
  submodelPrefillRow.className = 'rs-checkbox-row';
  const submodelPrefillCheck = document.createElement('input');
  submodelPrefillCheck.type = 'checkbox';
  submodelPrefillCheck.className = 'rs-checkbox';
  submodelPrefillCheck.id = 'rs-sub-prefill';
  submodelPrefillRow.htmlFor = 'rs-sub-prefill';
  const submodelPrefillText = document.createElement('span');
  submodelPrefillText.className = 'rs-checkbox-label';
  submodelPrefillText.textContent = 'Prefill compatibility';
  submodelPrefillText.title = 'Converts the assistant message prefill to a user message prepended with "Begin your response with: <prefill>" to be compatible with models that don\'t support it.';
  submodelPrefillRow.appendChild(submodelPrefillCheck);
  submodelPrefillRow.appendChild(submodelPrefillText);
  submodelPrefillSection.appendChild(submodelPrefillRow);
  subBody.appendChild(submodelPrefillSection);

  // ---------- Debug subtab body --------------------------------------------
  const debugBody = document.createElement('section');
  debugBody.className = 'lr-settings-tab-body';

  const debugIntro = document.createElement('p');
  debugIntro.className = 'lr-settings-intro';
  debugIntro.textContent = 'Surface aux/submodel call payloads, capture diagnostic logs for bug reports, and tune Risu-parity toggles.';
  debugBody.appendChild(debugIntro);

  const debugCaptureSection = document.createElement('div');
  debugCaptureSection.className = 'rs-subsection';
  const debugCaptureHeader = document.createElement('div');
  debugCaptureHeader.className = 'rs-subsection-header';
  const debugCaptureTitle = document.createElement('h4');
  debugCaptureTitle.className = 'rs-subsection-title';
  debugCaptureTitle.textContent = 'Aux/Sub Debug Capture';
  debugCaptureTitle.title = 'Surface aux/submodel requests and responses in a corner panel.';
  debugCaptureHeader.appendChild(debugCaptureTitle);
  debugCaptureSection.appendChild(debugCaptureHeader);

  const reqCheckRow = document.createElement('label');
  reqCheckRow.className = 'rs-checkbox-row';
  const reqCheck = document.createElement('input');
  reqCheck.type = 'checkbox';
  reqCheck.className = 'rs-checkbox';
  reqCheck.id = 'rs-aux-debug-req';
  reqCheckRow.htmlFor = 'rs-aux-debug-req';
  const reqText = document.createElement('span');
  reqText.className = 'rs-checkbox-label';
  reqText.textContent = 'Capture requests';
  reqText.title = 'Show outgoing aux/submodel call payloads in the panel.';
  reqCheckRow.appendChild(reqCheck);
  reqCheckRow.appendChild(reqText);
  debugCaptureSection.appendChild(reqCheckRow);

  const resCheckRow = document.createElement('label');
  resCheckRow.className = 'rs-checkbox-row';
  const resCheck = document.createElement('input');
  resCheck.type = 'checkbox';
  resCheck.className = 'rs-checkbox';
  resCheck.id = 'rs-aux-debug-res';
  resCheckRow.htmlFor = 'rs-aux-debug-res';
  const resText = document.createElement('span');
  resText.className = 'rs-checkbox-label';
  resText.textContent = 'Capture responses';
  resText.title = 'Show aux/submodel call responses (and errors) in the panel.';
  resCheckRow.appendChild(resCheck);
  resCheckRow.appendChild(resText);
  debugCaptureSection.appendChild(resCheckRow);
  debugBody.appendChild(debugCaptureSection);

  const paritySectionHost = document.createElement('div');
  paritySectionHost.className = 'rs-subsection';
  const parityHeader = document.createElement('div');
  parityHeader.className = 'rs-subsection-header';
  const parityTitle = document.createElement('h4');
  parityTitle.className = 'rs-subsection-title';
  parityTitle.textContent = 'Parity toggles';
  parityTitle.title = "Behaviour toggles ported from Risu's Advanced Settings. Flip only if a card needs legacy behaviour.";
  parityHeader.appendChild(parityTitle);
  paritySectionHost.appendChild(parityHeader);

  const legacyMediaRow = document.createElement('label');
  legacyMediaRow.className = 'rs-checkbox-row';
  const legacyMediaCheck = document.createElement('input');
  legacyMediaCheck.type = 'checkbox';
  legacyMediaCheck.className = 'rs-checkbox';
  legacyMediaCheck.id = 'rs-legacy-media';
  legacyMediaRow.htmlFor = 'rs-legacy-media';
  const legacyMediaText = document.createElement('span');
  legacyMediaText.className = 'rs-checkbox-label';
  legacyMediaText.textContent = 'Legacy media findings';
  legacyMediaText.title = 'Disable the fuzzy-match fallback for asset macros. On = strict exact-match (Risu legacy).';
  legacyMediaRow.appendChild(legacyMediaCheck);
  legacyMediaRow.appendChild(legacyMediaText);
  paritySectionHost.appendChild(legacyMediaRow);
  debugBody.appendChild(paritySectionHost);

  const importSectionHost = document.createElement('div');
  importSectionHost.className = 'rs-subsection';
  const importHeader = document.createElement('div');
  importHeader.className = 'rs-subsection-header';
  const importTitle = document.createElement('h4');
  importTitle.className = 'rs-subsection-title';
  importTitle.textContent = 'Import';
  importHeader.appendChild(importTitle);
  importSectionHost.appendChild(importHeader);

  const skipThumbsRow = document.createElement('label');
  skipThumbsRow.className = 'rs-checkbox-row';
  const skipThumbsCheck = document.createElement('input');
  skipThumbsCheck.type = 'checkbox';
  skipThumbsCheck.className = 'rs-checkbox';
  skipThumbsCheck.id = 'rs-skip-asset-thumbs';
  skipThumbsRow.htmlFor = 'rs-skip-asset-thumbs';
  const skipThumbsText = document.createElement('span');
  skipThumbsText.className = 'rs-checkbox-label';
  skipThumbsText.textContent = 'Skip asset thumbnails';
  skipThumbsText.title = 'On by default. Upload card and module assets without generating thumbnails. Saves processing time and disk space. Applies to future imports only. Lumi surfaces that use thumbnails fall back to the full-size image.';
  skipThumbsRow.appendChild(skipThumbsCheck);
  skipThumbsRow.appendChild(skipThumbsText);
  importSectionHost.appendChild(skipThumbsRow);
  debugBody.appendChild(importSectionHost);

  // Logs panel mounts inline inside the Debug subtab.
  const logsHost = document.createElement('div');
  logsHost.className = 'rs-subsection lr-settings-logs-host';
  const logsHeader = document.createElement('div');
  logsHeader.className = 'rs-subsection-header';
  const logsTitle = document.createElement('h4');
  logsTitle.className = 'rs-subsection-title';
  logsTitle.textContent = 'Logs';
  logsTitle.title = 'Capture diagnostics for a bug report.';
  logsHeader.appendChild(logsTitle);
  logsHost.appendChild(logsHeader);
  const logsMount = document.createElement('div');
  logsHost.appendChild(logsMount);
  debugBody.appendChild(logsHost);
  const logsHandle = mountLogsPanel({ root: logsMount, sendToBackend, log });

  // ---------- Cleanup subtab body ------------------------------------------
  const cleanupBody = document.createElement('section');
  cleanupBody.className = 'lr-settings-tab-body';

  const cleanupIntro = document.createElement('p');
  cleanupIntro.className = 'lr-settings-intro';
  cleanupIntro.textContent =
    'Find image assets owned by LumiRealm that no live character or module references. Orphans typically come from deleting a card while the extension was off, or from interrupted imports.';
  cleanupBody.appendChild(cleanupIntro);

  const cleanupActions = document.createElement('div');
  cleanupActions.className = 'rs-row rs-row-buttons';
  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'lrm-btn lrm-btn-primary';
  scanBtn.textContent = 'Scan for orphans';
  scanBtn.title = 'Cross-checks every image we own against live characters, modules, and active journals.';
  cleanupActions.appendChild(scanBtn);
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'lrm-btn lrm-btn-danger';
  deleteBtn.textContent = 'Delete selected (0)';
  deleteBtn.disabled = true;
  cleanupActions.appendChild(deleteBtn);
  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'lrm-btn';
  selectAllBtn.textContent = 'Select all';
  selectAllBtn.disabled = true;
  cleanupActions.appendChild(selectAllBtn);
  const selectNoneBtn = document.createElement('button');
  selectNoneBtn.type = 'button';
  selectNoneBtn.className = 'lrm-btn';
  selectNoneBtn.textContent = 'Select none';
  selectNoneBtn.disabled = true;
  cleanupActions.appendChild(selectNoneBtn);
  cleanupBody.appendChild(cleanupActions);

  const cleanupSummary = document.createElement('div');
  cleanupSummary.className = 'rs-cleanup-summary';
  cleanupSummary.textContent = 'No scan run yet.';
  cleanupBody.appendChild(cleanupSummary);

  let cleanupOrphans: readonly OrphanAssetEntry[] = [];
  const cleanupSelected = new Set<string>();
  let cleanupScanning = false;
  let cleanupDeleting = false;

  const CLEANUP_ROW_H = 80;
  let cleanupGrid: VirtualGridHandle | null = null;

  function refreshCleanupActionState(): void {
    const sel = cleanupSelected.size;
    const repairBlocking = repairScanning || repairApplying;
    deleteBtn.textContent = `Delete selected (${sel})`;
    deleteBtn.disabled = sel === 0 || cleanupDeleting || cleanupScanning || repairBlocking;
    selectAllBtn.disabled = cleanupOrphans.length === 0 || cleanupScanning || cleanupDeleting || repairBlocking;
    selectNoneBtn.disabled = sel === 0 || cleanupScanning || cleanupDeleting || repairBlocking;
    scanBtn.disabled = cleanupScanning || cleanupDeleting || repairBlocking;
    scanBtn.textContent = cleanupScanning ? 'Scanning…' : 'Scan for orphans';
  }

  function renderCleanupRow(o: OrphanAssetEntry): HTMLElement {
    const row = document.createElement('label');
    row.className = 'rs-cleanup-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'rs-cleanup-check';
    cb.checked = cleanupSelected.has(o.id);
    cb.addEventListener('change', () => {
      if (cb.checked) cleanupSelected.add(o.id);
      else cleanupSelected.delete(o.id);
      refreshCleanupActionState();
    });
    row.appendChild(cb);

    const thumb = document.createElement('div');
    thumb.className = 'rs-cleanup-thumb';
    if (o.url && (o.mime.startsWith('image/') || o.mime === '')) {
      const img = document.createElement('img');
      img.src = o.url;
      img.alt = o.filename || o.id;
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'rs-cleanup-thumb-placeholder';
      ph.textContent = o.mime || '?';
      thumb.appendChild(ph);
    }
    row.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'rs-cleanup-meta';
    const name = document.createElement('div');
    name.className = 'rs-cleanup-name';
    name.textContent = o.filename || '(no filename)';
    name.title = o.filename;
    meta.appendChild(name);
    const sub = document.createElement('div');
    sub.className = 'rs-cleanup-sub';
    const subParts: string[] = [];
    if (o.mime) subParts.push(o.mime);
    if (typeof o.width === 'number' && typeof o.height === 'number') {
      subParts.push(`${o.width}x${o.height}`);
    }
    if (o.createdAt > 0) {
      const ts = new Date(o.createdAt);
      subParts.push(ts.toLocaleString());
    }
    sub.textContent = subParts.join(' · ');
    meta.appendChild(sub);
    const idLine = document.createElement('div');
    idLine.className = 'rs-cleanup-id';
    const ownerHint = o.ownerCharacterId
      ? `was tagged for character ${o.ownerCharacterId.slice(0, 8)}…`
      : 'no owner tag';
    idLine.textContent = `${o.id.slice(0, 8)}… · ${ownerHint}`;
    idLine.title = `${o.id}${o.ownerCharacterId ? `\nowner: ${o.ownerCharacterId}` : ''}`;
    meta.appendChild(idLine);
    row.appendChild(meta);

    return row;
  }

  function ensureCleanupGrid(): VirtualGridHandle {
    if (cleanupGrid) return cleanupGrid;
    cleanupGrid = createVirtualGrid<OrphanAssetEntry>({
      hostClassName: 'rs-cleanup-list',
      innerClassName: 'rs-cleanup-list-inner',
      rowHeight: CLEANUP_ROW_H,
      overscanRows: 3,
      getItems: () => cleanupOrphans,
      renderItem: renderCleanupRow,
    });
    cleanupBody.appendChild(cleanupGrid.host);
    return cleanupGrid;
  }

  function renderCleanupList(): void {
    const grid = ensureCleanupGrid();
    grid.refresh();
  }

  function renderCleanupSummary(extra?: string): void {
    if (cleanupOrphans.length === 0) {
      cleanupSummary.textContent = extra ?? 'No orphans found.';
      return;
    }
    const head = `${cleanupOrphans.length} orphan${cleanupOrphans.length === 1 ? '' : 's'} found.`;
    cleanupSummary.textContent = extra ? `${head} ${extra}` : head;
  }

  scanBtn.addEventListener('click', () => {
    if (cleanupScanning) return;
    log.info('settings-tab: orphan scan requested');
    cleanupScanning = true;
    cleanupOrphans = [];
    cleanupSelected.clear();
    cleanupSummary.textContent = 'Scanning…';
    if (cleanupGrid) cleanupGrid.invalidate();
    refreshCleanupActionState();
    sendToBackend({ type: 'request_orphan_scan' });
  });

  selectAllBtn.addEventListener('click', () => {
    for (const o of cleanupOrphans) cleanupSelected.add(o.id);
    renderCleanupList();
    refreshCleanupActionState();
  });
  selectNoneBtn.addEventListener('click', () => {
    cleanupSelected.clear();
    renderCleanupList();
    refreshCleanupActionState();
  });
  deleteBtn.addEventListener('click', () => {
    if (cleanupSelected.size === 0 || cleanupDeleting) return;
    const count = cleanupSelected.size;
    if (!confirm(
      `Delete ${count} orphan asset${count === 1 ? '' : 's'}? This cannot be undone.`,
    )) return;
    log.info(`settings-tab: orphan delete count=${count}`);
    cleanupDeleting = true;
    cleanupSummary.textContent = `Deleting ${count} asset${count === 1 ? '' : 's'}…`;
    refreshCleanupActionState();
    sendToBackend({
      type: 'delete_orphan_assets',
      imageIds: Array.from(cleanupSelected),
    });
  });

  // ---------- Repair section (inside Cleanup subtab) ----------------------
  const repairSection = document.createElement('div');
  repairSection.className = 'rs-repair-section';

  const repairHeader = document.createElement('h3');
  repairHeader.className = 'rs-repair-header';
  repairHeader.textContent = 'Repair extension card states';
  repairSection.appendChild(repairHeader);

  const repairIntro = document.createElement('p');
  repairIntro.className = 'lr-settings-intro';
  repairIntro.textContent =
    'Fixes cards that may be broken from fucking around and finding out, older cards, or from a failed migration.';
  repairSection.appendChild(repairIntro);

  const repairScanBtn = document.createElement('button');
  repairScanBtn.type = 'button';
  repairScanBtn.className = 'lrm-btn lrm-btn-primary';
  repairScanBtn.textContent = 'Scan for problems';
  repairSection.appendChild(repairScanBtn);

  const repairResultBox = document.createElement('div');
  repairResultBox.className = 'rs-repair-result';
  repairResultBox.style.display = 'none';
  repairSection.appendChild(repairResultBox);

  cleanupBody.appendChild(repairSection);

  type RepairKey = 'staleCharRegex' | 'staleModuleRegex' | 'deadJournals' | 'forceRetranslate';
  const repairChecked: Record<RepairKey, boolean> = {
    staleCharRegex: true,
    staleModuleRegex: true,
    deadJournals: true,
    forceRetranslate: false,
  };
  let repairScanning = false;
  let repairApplying = false;
  let repairLastSummary: RepairScanSummary | null = null;
  const repairSelectedCharacterIds = new Set<string>();
  const repairSelectedModuleIds = new Set<string>();
  let repairCardPicker: ChipMultiSelectHandle | null = null;
  let repairModulePicker: ChipMultiSelectHandle | null = null;

  function destroyRepairPickers(): void {
    try { repairCardPicker?.destroy(); } catch { /* */ }
    try { repairModulePicker?.destroy(); } catch { /* */ }
    repairCardPicker = null;
    repairModulePicker = null;
  }

  function refreshRepairUi(): void {
    repairScanBtn.disabled = repairScanning || repairApplying || cleanupScanning || cleanupDeleting;
    repairScanBtn.textContent = repairScanning ? 'Scanning…' : 'Scan for problems';
    refreshCleanupActionState();
  }

  function renderRepairResult(): void {
    destroyRepairPickers();
    repairResultBox.replaceChildren();
    const s = repairLastSummary;
    if (!s) {
      repairResultBox.style.display = 'none';
      return;
    }
    repairResultBox.style.display = '';
    const total = s.staleCharRegex + s.staleModuleRegex + s.deadJournals;
    const summaryLine = document.createElement('div');
    summaryLine.className = 'rs-repair-summary';
    summaryLine.textContent = total === 0 && s.cardTargets.length === 0 && s.moduleTargets.length === 0
      ? 'No issues detected.'
      : `Scan complete (${s.elapsedMs}ms). Pick what to apply and scope the slow repair:`;
    repairResultBox.appendChild(summaryLine);

    const rows: { key: Exclude<RepairKey, 'forceRetranslate'>; label: string; count: number }[] = [
      { key: 'staleCharRegex', label: 'Stale character regex rows (envelope gone)', count: s.staleCharRegex },
      { key: 'staleModuleRegex', label: 'Stale module regex rows (module envelope gone)', count: s.staleModuleRegex },
      { key: 'deadJournals', label: 'Dead image journals (owner gone)', count: s.deadJournals },
    ];
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'lrm-btn lrm-btn-danger';
    applyBtn.textContent = repairApplying ? 'Applying…' : 'Apply repair';

    const hasApplicableSelection = (): boolean => (
      (repairChecked.staleCharRegex && s.staleCharRegex > 0)
      || (repairChecked.staleModuleRegex && s.staleModuleRegex > 0)
      || (repairChecked.deadJournals && s.deadJournals > 0)
      || (repairChecked.forceRetranslate
        && (repairSelectedCharacterIds.size > 0 || repairSelectedModuleIds.size > 0))
    );
    let targetCountSpan: HTMLSpanElement | null = null;
    const refreshApplyBtn = (): void => {
      applyBtn.disabled = repairApplying || !hasApplicableSelection();
      if (targetCountSpan) {
        targetCountSpan.textContent =
          `${repairSelectedCharacterIds.size} cards · ${repairSelectedModuleIds.size} modules`;
      }
    };

    for (const r of rows) {
      const row = document.createElement('label');
      row.className = 'rs-repair-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = repairChecked[r.key];
      cb.disabled = r.count === 0;
      cb.addEventListener('change', () => {
        repairChecked[r.key] = cb.checked;
        refreshApplyBtn();
      });
      row.appendChild(cb);
      const labelText = document.createElement('span');
      labelText.textContent = r.label;
      if (r.count === 0) labelText.classList.add('rs-repair-row-empty');
      row.appendChild(labelText);
      const countSpan = document.createElement('span');
      countSpan.className = 'rs-repair-count';
      countSpan.textContent = r.count === 0 ? '0' : String(r.count);
      row.appendChild(countSpan);
      repairResultBox.appendChild(row);
    }

    const targetRow = document.createElement('label');
    targetRow.className = 'rs-repair-row';
    const targetCheck = document.createElement('input');
    targetCheck.type = 'checkbox';
    targetCheck.checked = repairChecked.forceRetranslate;
    targetCheck.disabled = s.charactersToRetranslate === 0 && s.moduleTargets.length === 0;
    targetCheck.addEventListener('change', () => {
      repairChecked.forceRetranslate = targetCheck.checked;
      refreshApplyBtn();
    });
    targetRow.appendChild(targetCheck);
    const targetLabel = document.createElement('span');
    targetLabel.className = 'rs-repair-row-danger';
    targetLabel.textContent = 'Force re-translate';
    targetRow.appendChild(targetLabel);
    targetCountSpan = document.createElement('span');
    targetCountSpan.className = 'rs-repair-count';
    targetRow.appendChild(targetCountSpan);
    repairResultBox.appendChild(targetRow);

    if (s.cardTargets.length > 0 || s.moduleTargets.length > 0) {
      const scope = document.createElement('div');
      scope.className = 'rs-repair-scope';
      const scopeIntro = document.createElement('div');
      scopeIntro.className = 'rs-repair-scope-intro';
      scopeIntro.textContent =
        'Cards are re-translated individually. Modules are refreshed across their selected character attachments; missing modules scrub dangling references.';
      scope.appendChild(scopeIntro);

      const columns = document.createElement('div');
      columns.className = 'rs-repair-scope-columns';
      scope.appendChild(columns);

      const cardGroup = document.createElement('section');
      cardGroup.className = 'rs-repair-target-group';
      const cardHeading = document.createElement('div');
      cardHeading.className = 'rs-repair-target-heading';
      cardHeading.textContent = `Cards (${s.charactersToRetranslate} repairable)`;
      cardGroup.appendChild(cardHeading);
      const legacyCount = s.cardTargets.filter((target) => !target.canRetranslate).length;
      if (legacyCount > 0) {
        const legacyHint = document.createElement('div');
        legacyHint.className = 'rs-repair-target-hint';
        legacyHint.textContent = `${legacyCount} legacy card${legacyCount === 1 ? '' : 's'} disabled - re-import required.`;
        cardGroup.appendChild(legacyHint);
      }
      repairCardPicker = createChipMultiSelect({
        items: s.cardTargets.map((target) => ({
          value: target.characterId,
          label: target.characterName,
          secondary: target.canRetranslate
            ? `${target.attachedModuleCount} attached module${target.attachedModuleCount === 1 ? '' : 's'}`
            : 'Legacy card - re-import required',
          disabled: !target.canRetranslate,
          searchTerms: [target.characterId],
          title: `${target.characterName}\n${target.characterId}`,
        })),
        selectedValues: [...repairSelectedCharacterIds],
        placeholder: `Search cards… (${s.cardTargets.length})`,
        searchPlaceholder: 'Search cards by name or ID…',
        emptySearchMessage: 'No matching cards',
        emptySelectionMessage: 'No cards selected',
        className: 'rs-repair-card-picker',
        collapsedChipLimit: 6,
        onChange(values) {
          repairSelectedCharacterIds.clear();
          for (const value of values) repairSelectedCharacterIds.add(value);
          refreshApplyBtn();
        },
      });
      repairCardPicker.setDisabled(repairApplying);
      cardGroup.appendChild(repairCardPicker.root);
      columns.appendChild(cardGroup);

      const moduleGroup = document.createElement('section');
      moduleGroup.className = 'rs-repair-target-group';
      const moduleHeading = document.createElement('div');
      moduleHeading.className = 'rs-repair-target-heading';
      moduleHeading.textContent = `Modules (${s.moduleTargets.length} in use)`;
      moduleGroup.appendChild(moduleHeading);
      repairModulePicker = createChipMultiSelect({
        items: s.moduleTargets.map((target) => ({
          value: target.moduleId,
          label: target.moduleName ?? `Missing module ${target.moduleId.slice(0, 8)}…`,
          secondary: target.missing
            ? `${target.attachmentCount} dangling reference${target.attachmentCount === 1 ? '' : 's'}`
            : `${target.attachmentCount} character attachment${target.attachmentCount === 1 ? '' : 's'}`,
          group: target.missing ? 'Missing references' : 'Available modules',
          danger: target.missing,
          searchTerms: [target.moduleId],
          title: `${target.moduleName ?? 'Missing module'}\n${target.moduleId}`,
        })),
        selectedValues: [...repairSelectedModuleIds],
        placeholder: `Search modules… (${s.moduleTargets.length})`,
        searchPlaceholder: 'Search modules by name or ID…',
        emptySearchMessage: 'No matching modules',
        emptySelectionMessage: 'No modules selected',
        className: 'rs-repair-module-picker',
        collapsedChipLimit: 6,
        onChange(values) {
          repairSelectedModuleIds.clear();
          for (const value of values) repairSelectedModuleIds.add(value);
          refreshApplyBtn();
        },
      });
      repairModulePicker.setDisabled(repairApplying);
      moduleGroup.appendChild(repairModulePicker.root);
      columns.appendChild(moduleGroup);
      repairResultBox.appendChild(scope);
    }

    refreshApplyBtn();
    applyBtn.addEventListener('click', () => {
      if (!hasApplicableSelection()) return;
      const willRetranslate = repairChecked.forceRetranslate
        && (repairSelectedCharacterIds.size > 0 || repairSelectedModuleIds.size > 0);
      const willDeleteRows = (repairChecked.staleCharRegex && s.staleCharRegex > 0)
        || (repairChecked.staleModuleRegex && s.staleModuleRegex > 0);
      const parts: string[] = [];
      if (repairChecked.staleCharRegex && s.staleCharRegex > 0) {
        parts.push(`delete ${s.staleCharRegex} stale character regex row(s)`);
      }
      if (repairChecked.staleModuleRegex && s.staleModuleRegex > 0) {
        parts.push(`delete ${s.staleModuleRegex} stale module regex row(s)`);
      }
      if (repairChecked.deadJournals && s.deadJournals > 0) {
        parts.push(`clear ${s.deadJournals} dead journal(s)`);
      }
      if (willRetranslate) {
        const targetParts: string[] = [];
        if (repairSelectedCharacterIds.size > 0) {
          targetParts.push(`re-translate ${repairSelectedCharacterIds.size} selected character(s)`);
        }
        const selectedModules = s.moduleTargets.filter((target) => repairSelectedModuleIds.has(target.moduleId));
        const liveAttachments = selectedModules
          .filter((target) => !target.missing)
          .reduce((sum, target) => sum + target.attachmentCount, 0);
        const danglingAttachments = selectedModules
          .filter((target) => target.missing)
          .reduce((sum, target) => sum + target.attachmentCount, 0);
        if (liveAttachments > 0) targetParts.push(`refresh ${liveAttachments} selected module attachment(s)`);
        if (danglingAttachments > 0) targetParts.push(`scrub ${danglingAttachments} dangling ref(s)`);
        parts.push(targetParts.join(' + ') + ' (slow)');
      }
      if (!confirm(`Apply repair? This will:\n\n• ${parts.join('\n• ')}\n\n${willDeleteRows ? 'Deleted rows cannot be recovered. ' : ''}${willRetranslate ? 'Re-translation may take a while for large libraries.' : ''}`)) {
        return;
      }
      log.info(
        `settings-tab: repair apply ${JSON.stringify(repairChecked)} ` +
          `cards=${repairSelectedCharacterIds.size} modules=${repairSelectedModuleIds.size}`,
      );
      repairApplying = true;
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';
      repairCardPicker?.setDisabled(true);
      repairModulePicker?.setDisabled(true);
      sendToBackend({
        type: 'apply_repair',
        options: {
          applyStaleCharRegex: repairChecked.staleCharRegex,
          applyStaleModuleRegex: repairChecked.staleModuleRegex,
          applyDeadJournals: repairChecked.deadJournals,
          applyForceRetranslate: repairChecked.forceRetranslate,
          characterIds: [...repairSelectedCharacterIds],
          moduleIds: [...repairSelectedModuleIds],
        },
      });
    });
    repairResultBox.appendChild(applyBtn);
  }

  repairScanBtn.addEventListener('click', () => {
    if (repairScanning || repairApplying) return;
    log.info('settings-tab: repair scan requested');
    repairScanning = true;
    repairLastSummary = null;
    repairSelectedCharacterIds.clear();
    repairSelectedModuleIds.clear();
    destroyRepairPickers();
    repairResultBox.style.display = 'none';
    refreshRepairUi();
    sendToBackend({ type: 'request_repair_scan' });
  });

  // ---------- Subtab activation -------------------------------------------
  const panelsHost = document.createElement('div');
  panelsHost.className = 'lr-subtab-panels';
  panelsHost.appendChild(auxBody);
  panelsHost.appendChild(subBody);
  panelsHost.appendChild(debugBody);
  panelsHost.appendChild(cleanupBody);
  root.appendChild(panelsHost);

  function activateSubTab(id: SettingsSubTabId): void {
    activeSubTab = id;
    for (const [k, btn] of subnavBtns) {
      const sel = k === id;
      btn.classList.toggle('lr-subtab-active', sel);
      btn.setAttribute('aria-selected', sel ? 'true' : 'false');
    }
    auxBody.hidden = id !== 'aux';
    subBody.hidden = id !== 'sub';
    debugBody.hidden = id !== 'debug';
    cleanupBody.hidden = id !== 'cleanup';
  }
  activateSubTab(activeSubTab);

  function buildConnectionItems(inheritLabel: string): SearchableSelectItem[] {
    const items: SearchableSelectItem[] = [];
    items.push({
      value: '',
      label: connections === null
        ? 'Loading connections…'
        : connections.length === 0
          ? 'No connections. Set one up in Lumi.'
          : inheritLabel,
      disabled: connections === null || connections.length === 0,
    });
    if (connections) {
      for (const c of connections) {
        const modelSuffix = c.model ? ` / ${c.model}` : '';
        const defaultTag = c.is_default ? ' [default]' : '';
        items.push({
          value: c.id,
          label: `${c.name}${defaultTag}`,
          secondary: `${c.provider}${modelSuffix}`,
          searchTerms: [c.provider, c.model].filter((s): s is string => !!s),
        });
      }
    }
    return items;
  }

  function renderConnectionSelect(): void {
    const items = buildConnectionItems('Use default connection');
    const current = settings?.auxConnectionId ?? '';
    if (current && connections && !connections.find((c) => c.id === current)) {
      items.push({
        value: current,
        label: `${current.slice(0, 8)}… (deleted? unknown)`,
      });
    }
    connSelect.setItems(items);
    connSelect.setValue(current);
  }

  function renderModelInput(): void {
    if (!isModelInputFocused()) {
      modelInput.value = settings?.auxModelOverride ?? '';
    }
  }

  function renderSubmodelConnectionSelect(): void {
    const items = buildConnectionItems('Inherit from Aux Model');
    const current = settings?.submodelConnectionId ?? '';
    if (current && connections && !connections.find((c) => c.id === current)) {
      items.push({
        value: current,
        label: `${current.slice(0, 8)}… (deleted? unknown)`,
      });
    }
    submodelConnSelect.setItems(items);
    submodelConnSelect.setValue(current);
  }

  function renderSubmodelModelInput(): void {
    if (document.activeElement !== submodelModelInput) {
      submodelModelInput.value = settings?.submodelModelOverride ?? '';
    }
  }

  function renderSamplers(): void {
    samplersListEl.innerHTML = '';
    if (!settings) {
      const placeholder = document.createElement('div');
      placeholder.className = 'rs-samplers-placeholder';
      placeholder.textContent = 'Loading…';
      samplersListEl.appendChild(placeholder);
      return;
    }
    for (const def of SAMPLER_DEFS) {
      samplersListEl.appendChild(buildSamplerSlider(def, 'aux'));
    }
  }

  function renderSubmodelSamplers(): void {
    submodelSamplersListEl.innerHTML = '';
    if (!settings) {
      const placeholder = document.createElement('div');
      placeholder.className = 'rs-samplers-placeholder';
      placeholder.textContent = 'Loading…';
      submodelSamplersListEl.appendChild(placeholder);
      return;
    }
    for (const def of SAMPLER_DEFS) {
      submodelSamplersListEl.appendChild(buildSamplerSlider(def, 'submodel'));
    }
  }

  function buildSamplerSlider(def: SamplerDef, channel: ChannelKey): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'rs-slider-row';

    const header = document.createElement('div');
    header.className = 'rs-slider-header';
    const label = document.createElement('span');
    label.className = 'rs-slider-label';
    label.textContent = def.label;
    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'rs-slider-input';
    numInput.min = String(def.min);
    numInput.max = String(def.max);
    numInput.step = String(def.step);
    numInput.placeholder = String(def.defaultHint);
    header.appendChild(label);
    header.appendChild(numInput);

    const track = document.createElement('div');
    track.className = 'rs-slider-track';
    track.title = 'Drag to set, double-click to reset';
    const fill = document.createElement('div');
    fill.className = 'rs-slider-fill';
    const thumb = document.createElement('div');
    thumb.className = 'rs-slider-thumb';
    track.appendChild(fill);
    track.appendChild(thumb);

    row.appendChild(header);
    row.appendChild(track);

    const decimals = (String(def.step).split('.')[1] || '').length;

    const snap = (raw: number): number => {
      const clamped = Math.min(def.max, Math.max(def.min, raw));
      const stepped = Math.round((clamped - def.min) / def.step) * def.step + def.min;
      return def.type === 'int' ? Math.round(stepped) : parseFloat(stepped.toFixed(decimals));
    };
    const posToValue = (clientX: number): number => {
      const rect = track.getBoundingClientRect();
      if (!rect || rect.width === 0) return def.defaultHint;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return snap(def.min + ratio * (def.max - def.min));
    };
    const applyVisual = (displayValue: number, isSet: boolean): void => {
      const range = def.max - def.min;
      const pct = range > 0 ? Math.max(0, Math.min(100, ((displayValue - def.min) / range) * 100)) : 0;
      fill.style.width = `${pct}%`;
      thumb.style.left = `${pct}%`;
      track.classList.toggle('rs-slider-track-set', isSet);
      label.classList.toggle('rs-slider-label-set', isSet);
      numInput.classList.toggle('rs-slider-input-set', isSet);
    };
    const syncFromModel = (): void => {
      const bag = channel === 'aux' ? settings?.auxSamplers : settings?.submodelSamplers;
      const v = bag?.[def.key] ?? null;
      const isSet = v !== null;
      const display = isSet ? v! : def.defaultHint;
      if (document.activeElement !== numInput) numInput.value = isSet ? String(v) : '';
      applyVisual(display, isSet);
    };

    let dragging = false;
    let dragValue: number | null = null;

    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      try { track.setPointerCapture(e.pointerId); } catch { /* */ }
      dragValue = posToValue(e.clientX);
      applyVisual(dragValue, true);
    });
    track.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dragValue = posToValue(e.clientX);
      applyVisual(dragValue, true);
    });
    track.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { track.releasePointerCapture(e.pointerId); } catch { /* */ }
      if (dragValue !== null) {
        commitSampler(def.key, dragValue, channel);
      }
      dragValue = null;
    });
    track.addEventListener('dblclick', () => {
      commitSampler(def.key, null, channel);
    });

    const commitInput = (raw: string): void => {
      if (raw === '') {
        commitSampler(def.key, null, channel);
        return;
      }
      const num = def.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
      if (Number.isFinite(num)) {
        commitSampler(def.key, snap(num), channel);
      }
    };
    numInput.addEventListener('change', () => commitInput(numInput.value));
    numInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') numInput.blur();
      else if (e.key === 'Escape') { numInput.blur(); syncFromModel(); }
    });

    syncFromModel();
    return row;
  }

  function commitSampler(key: SamplerKey, value: number | null, channel: ChannelKey): void {
    if (!settings) return;
    const baseBag = channel === 'aux' ? settings.auxSamplers : settings.submodelSamplers;
    const next: SamplerBag = { ...baseBag, [key]: value };
    log.info(`settings-tab: ${channel} sampler ${key}=${value === null ? '<inherit>' : String(value)}`);
    if (channel === 'aux') {
      sendToBackend({ type: 'update_settings', patch: { auxSamplers: next } });
    } else {
      sendToBackend({ type: 'update_settings', patch: { submodelSamplers: next } });
    }
  }

  function isModelInputFocused(): boolean {
    return document.activeElement === modelInput;
  }

  function renderStatus(): void {
    if (!settings) {
      status.textContent = 'Loading…';
      status.classList.remove('rs-status-ok', 'rs-status-warn');
      return;
    }
    const parts: string[] = [];
    if (settings.auxConnectionId) {
      const conn = connections?.find((c) => c.id === settings!.auxConnectionId);
      parts.push(conn ? `Connection: ${conn.name}` : `Connection: ${settings.auxConnectionId.slice(0, 8)}… (unknown)`);
    } else {
      parts.push('Connection: (default)');
    }
    if (settings.auxModelOverride) {
      parts.push(`Model: ${settings.auxModelOverride}`);
    } else {
      parts.push('Model: (use connection default)');
    }
    status.textContent = parts.join('\n');
    status.classList.add('rs-status-ok');
    status.classList.remove('rs-status-warn');
  }

  function renderDebugChecks(): void {
    auxPrefillCheck.checked = settings?.auxPrefillCompat === true;
    submodelPrefillCheck.checked = settings?.submodelPrefillCompat === true;
    reqCheck.checked = settings?.auxDebugCaptureRequest === true;
    resCheck.checked = settings?.auxDebugCaptureResponse === true;
  }

  function renderParityChecks(): void {
    legacyMediaCheck.checked = settings?.legacyMediaFindings === true;
    skipThumbsCheck.checked = settings?.skipAssetThumbnails === true;
  }

  function render(): void {
    renderConnectionSelect();
    renderModelInput();
    renderSamplers();
    renderSubmodelConnectionSelect();
    renderSubmodelModelInput();
    renderSubmodelSamplers();
    renderDebugChecks();
    renderParityChecks();
    renderStatus();
  }

  saveModelBtn.addEventListener('click', () => {
    const raw = modelInput.value.trim();
    log.info(`settings-tab: model override saved as "${raw}"`);
    sendToBackend({
      type: 'update_settings',
      patch: { auxModelOverride: raw === '' ? null : raw },
    });
  });

  modelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveModelBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      modelInput.value = settings?.auxModelOverride ?? '';
      modelInput.blur();
    }
  });

  resetBtn.addEventListener('click', () => {
    if (!confirm('Reset auxiliary model settings to defaults? Connection, model override, and all samplers will be cleared.')) return;
    log.info('settings-tab: reset to defaults');
    const clearedSamplers: SamplerBag = {
      temperature: null, maxTokens: null, contextSize: null,
      topP: null, minP: null, topK: null,
      frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
    };
    sendToBackend({
      type: 'update_settings',
      patch: {
        auxConnectionId: null,
        auxModelOverride: null,
        auxSamplers: clearedSamplers,
      },
    });
  });

  refreshBtn.addEventListener('click', () => {
    log.info('settings-tab: refresh connections clicked');
    connections = null;
    renderConnectionSelect();
    sendToBackend({ type: 'request_connections_list' });
  });

  submodelSaveModelBtn.addEventListener('click', () => {
    const raw = submodelModelInput.value.trim();
    log.info(`settings-tab: submodel model override saved as "${raw}"`);
    sendToBackend({
      type: 'update_settings',
      patch: { submodelModelOverride: raw === '' ? null : raw },
    });
  });

  submodelModelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submodelSaveModelBtn.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      submodelModelInput.value = settings?.submodelModelOverride ?? '';
      submodelModelInput.blur();
    }
  });

  submodelResetBtn.addEventListener('click', () => {
    if (!confirm('Reset submodel settings to defaults? Connection, model override, and all submodel samplers will be cleared (falls back to Aux Model).')) return;
    log.info('settings-tab: submodel reset to defaults');
    const clearedSamplers: SamplerBag = {
      temperature: null, maxTokens: null, contextSize: null,
      topP: null, minP: null, topK: null,
      frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
    };
    sendToBackend({
      type: 'update_settings',
      patch: {
        submodelConnectionId: null,
        submodelModelOverride: null,
        submodelSamplers: clearedSamplers,
      },
    });
  });

  auxPrefillCheck.addEventListener('change', () => {
    log.info(`settings-tab: auxPrefillCompat=${auxPrefillCheck.checked}`);
    sendToBackend({ type: 'update_settings', patch: { auxPrefillCompat: auxPrefillCheck.checked } });
  });
  submodelPrefillCheck.addEventListener('change', () => {
    log.info(`settings-tab: submodelPrefillCompat=${submodelPrefillCheck.checked}`);
    sendToBackend({ type: 'update_settings', patch: { submodelPrefillCompat: submodelPrefillCheck.checked } });
  });
  reqCheck.addEventListener('change', () => {
    log.info(`settings-tab: auxDebugCaptureRequest=${reqCheck.checked}`);
    sendToBackend({
      type: 'update_settings',
      patch: { auxDebugCaptureRequest: reqCheck.checked },
    });
  });
  resCheck.addEventListener('change', () => {
    log.info(`settings-tab: auxDebugCaptureResponse=${resCheck.checked}`);
    sendToBackend({
      type: 'update_settings',
      patch: { auxDebugCaptureResponse: resCheck.checked },
    });
  });

  legacyMediaCheck.addEventListener('change', () => {
    log.info(`settings-tab: legacyMediaFindings=${legacyMediaCheck.checked}`);
    sendToBackend({
      type: 'update_settings',
      patch: { legacyMediaFindings: legacyMediaCheck.checked },
    });
  });

  skipThumbsCheck.addEventListener('change', () => {
    log.info(`settings-tab: skipAssetThumbnails=${skipThumbsCheck.checked}`);
    sendToBackend({
      type: 'update_settings',
      patch: { skipAssetThumbnails: skipThumbsCheck.checked },
    });
  });

  sendToBackend({ type: 'request_settings' });
  sendToBackend({ type: 'request_connections_list' });

  async function deleteRepairRegexRows(
    msg: Extract<BackendToFrontend, { type: 'delete_repair_regex_rows' }>,
  ): Promise<void> {
    let deleted = 0;
    let ok = false;
    try {
      const response = await fetch('/api/v1/regex-scripts/bulk-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: msg.ids }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`bulk-delete HTTP ${response.status}`);
      const body = await response.json() as { count?: unknown };
      const count = body.count;
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error('bulk-delete returned an invalid count');
      }
      deleted = count;
      ok = true;
      log.info(`settings-tab: repair regex cleanup deleted=${deleted}/${msg.ids.length}`);
    } catch (error) {
      log.warn(`settings-tab: repair regex cleanup failed: ${String(error)}`);
    }
    sendToBackend({
      type: 'repair_regex_rows_deleted',
      requestId: msg.requestId,
      deleted,
      ok,
    });
  }

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (msg.type === 'delete_repair_regex_rows') {
      void deleteRepairRegexRows(msg);
      return;
    }
    if (msg.type === 'settings_pushed') {
      const setSamplers = Object.entries(msg.settings.auxSamplers)
        .filter(([, v]) => v !== null)
        .map(([k]) => k);
      log.info(
        `settings-tab: settings_pushed auxConn=${msg.settings.auxConnectionId ?? '<default>'} ` +
          `auxModel=${msg.settings.auxModelOverride ?? '<connection>'} ` +
          `samplersSet=[${setSamplers.join(',')}]`,
      );
      settings = {
        auxConnectionId: msg.settings.auxConnectionId,
        auxModelOverride: msg.settings.auxModelOverride,
        auxSamplers: msg.settings.auxSamplers,
        submodelConnectionId: msg.settings.submodelConnectionId,
        submodelModelOverride: msg.settings.submodelModelOverride,
        submodelSamplers: msg.settings.submodelSamplers,
        auxPrefillCompat: msg.settings.auxPrefillCompat,
        submodelPrefillCompat: msg.settings.submodelPrefillCompat,
        auxDebugCaptureRequest: msg.settings.auxDebugCaptureRequest,
        auxDebugCaptureResponse: msg.settings.auxDebugCaptureResponse,
        legacyMediaFindings: msg.settings.legacyMediaFindings,
        skipAssetThumbnails: msg.settings.skipAssetThumbnails,
      };
      lastSavedTs = Date.now();
      render();
      return;
    }
    if (msg.type === 'connections_list_pushed') {
      log.info(`settings-tab: connections_list_pushed count=${msg.connections.length}`);
      connections = msg.connections;
      render();
      return;
    }
    if (msg.type === 'open_settings_cleanup') {
      activateSubTab('cleanup');
      if (!cleanupScanning && !cleanupDeleting) {
        log.info('settings-tab: open_settings_cleanup, auto-firing scan');
        cleanupScanning = true;
        cleanupOrphans = [];
        cleanupSelected.clear();
        cleanupSummary.textContent = 'Scanning…';
        if (cleanupGrid) cleanupGrid.invalidate();
        refreshCleanupActionState();
        sendToBackend({ type: 'request_orphan_scan' });
      }
      return;
    }
    if (msg.type === 'orphan_scan_started') {
      cleanupScanning = true;
      refreshCleanupActionState();
      return;
    }
    if (msg.type === 'orphan_scan_result') {
      cleanupScanning = false;
      cleanupOrphans = msg.orphans;
      cleanupSelected.clear();
      if (msg.error) {
        cleanupSummary.textContent = `Scan failed: ${msg.error}`;
      } else {
        const s = msg.summary;
        const liveTotal = s.liveCharacterRefs + s.liveModuleRefs + s.liveJournalRefs;
        const tail =
          `Scanned ${s.scannedTotal} owned image${s.scannedTotal === 1 ? '' : 's'} ` +
          `against ${liveTotal} live ref${liveTotal === 1 ? '' : 's'} ` +
          `(${s.charactersScanned} char${s.charactersScanned === 1 ? '' : 's'}, ` +
          `${s.modulesScanned} module${s.modulesScanned === 1 ? '' : 's'}) ` +
          `in ${s.elapsedMs}ms.`;
        const trunc = s.truncated
          ? ` Showing the newest ${msg.orphans.length} of ${s.totalOrphans}, delete this batch and re-scan to see the rest.`
          : '';
        renderCleanupSummary(tail + trunc);
      }
      renderCleanupList();
      refreshCleanupActionState();
      log.info(
        `settings-tab: orphan_scan_result orphans=${msg.orphans.length} ` +
          `total=${msg.summary.totalOrphans} truncated=${msg.summary.truncated} ` +
          `error=${msg.error ?? '<none>'}`,
      );
      return;
    }
    if (msg.type === 'orphan_delete_result') {
      cleanupDeleting = false;
      let removedCount = 0;
      if (!msg.error) {
        const skippedSet = new Set(msg.skippedIds);
        const remaining: OrphanAssetEntry[] = [];
        for (const o of cleanupOrphans) {
          if (cleanupSelected.has(o.id) && !skippedSet.has(o.id)) {
            removedCount++;
            continue;
          }
          remaining.push(o);
        }
        cleanupOrphans = remaining;
      }
      cleanupSelected.clear();
      const parts: string[] = [];
      parts.push(`Requested ${msg.requested}`);
      parts.push(`deleted ${msg.deleted}`);
      if (msg.absent > 0) parts.push(`absent ${msg.absent}`);
      if (msg.failed > 0) parts.push(`failed ${msg.failed}`);
      if (msg.skipped > 0) parts.push(`skipped ${msg.skipped} (became live)`);
      if (msg.error) {
        cleanupSummary.textContent = `Delete failed: ${msg.error} (${parts.join(', ')}).`;
      } else {
        renderCleanupSummary(`${parts.join(', ')}.`);
      }
      renderCleanupList();
      refreshCleanupActionState();
      log.info(
        `settings-tab: orphan_delete_result removed=${removedCount} ` +
          `failed=${msg.failed} skipped=${msg.skipped} error=${msg.error ?? '<none>'}`,
      );
      return;
    }
    if (msg.type === 'repair_scan_result') {
      repairScanning = false;
      if (msg.error) {
        repairLastSummary = null;
        repairSelectedCharacterIds.clear();
        repairSelectedModuleIds.clear();
        destroyRepairPickers();
        repairResultBox.style.display = '';
        repairResultBox.replaceChildren();
        const errLine = document.createElement('div');
        errLine.className = 'rs-repair-summary rs-repair-error';
        errLine.textContent = `Scan failed: ${msg.error}`;
        repairResultBox.appendChild(errLine);
      } else {
        repairLastSummary = msg.summary;
        repairSelectedCharacterIds.clear();
        for (const target of msg.summary.cardTargets) {
          if (target.canRetranslate) repairSelectedCharacterIds.add(target.characterId);
        }
        repairSelectedModuleIds.clear();
        for (const target of msg.summary.moduleTargets) {
          repairSelectedModuleIds.add(target.moduleId);
        }
        renderRepairResult();
      }
      refreshRepairUi();
      log.info(`settings-tab: repair_scan_result ${JSON.stringify(msg.summary)} error=${msg.error ?? '<none>'}`);
      return;
    }
    if (msg.type === 'repair_apply_result') {
      repairApplying = false;
      destroyRepairPickers();
      const r = msg.result;
      const parts: string[] = [];
      if (r.staleCharRegexDeleted > 0) parts.push(`${r.staleCharRegexDeleted} char regex deleted`);
      if (r.staleModuleRegexDeleted > 0) parts.push(`${r.staleModuleRegexDeleted} module regex deleted`);
      if (r.deadJournalsCleared > 0) parts.push(`${r.deadJournalsCleared} journals cleared`);
      if (r.charactersRetranslated > 0) parts.push(`${r.charactersRetranslated} characters re-translated`);
      if (r.charactersSkippedLegacy > 0) parts.push(`${r.charactersSkippedLegacy} pre-0.3 cards skipped (need re-import)`);
      if (r.modulesReattached > 0) parts.push(`${r.modulesReattached} modules reattached`);
      if (r.modulesScrubbed > 0) parts.push(`${r.modulesScrubbed} dangling refs scrubbed`);
      const summary = parts.length === 0 ? 'Nothing to repair.' : parts.join(', ') + '.';
      repairResultBox.replaceChildren();
      repairResultBox.style.display = '';
      const line = document.createElement('div');
      line.className = msg.error ? 'rs-repair-summary rs-repair-error' : 'rs-repair-summary';
      line.textContent = msg.error ? `Repair failed: ${msg.error}. ${summary}` : `Repair complete (${r.elapsedMs}ms): ${summary}`;
      repairResultBox.appendChild(line);
      const rescanBtn = document.createElement('button');
      rescanBtn.type = 'button';
      rescanBtn.className = 'lrm-btn';
      rescanBtn.textContent = 'Re-scan';
      rescanBtn.addEventListener('click', () => {
        log.info('settings-tab: repair re-scan after apply');
        repairScanning = true;
        repairLastSummary = null;
        repairSelectedCharacterIds.clear();
        repairSelectedModuleIds.clear();
        destroyRepairPickers();
        repairResultBox.style.display = 'none';
        refreshRepairUi();
        sendToBackend({ type: 'request_repair_scan' });
      });
      repairResultBox.appendChild(rescanBtn);
      refreshRepairUi();
      log.info(`settings-tab: repair_apply_result ${JSON.stringify(r)} error=${msg.error ?? '<none>'}`);
      return;
    }
    // Forward to the inline logs panel (Debug subtab).
    try { logsHandle.handleBackendMessage(msg); } catch (err) { log.warn('settings-tab: logs panel handler threw:', err); }
  }

  render();
  log.info('settings-panel: ready');

  return {
    handleBackendMessage,
    destroy(): void {
      log.info('settings-panel: destroy');
      try { connSelect.destroy(); } catch { /* */ }
      try { submodelConnSelect.destroy(); } catch { /* */ }
      try { logsHandle.destroy(); } catch { /* */ }
      try { cleanupGrid?.destroy(); } catch { /* */ }
      destroyRepairPickers();
      try { root.replaceChildren(); } catch { /* */ }
    },
  };
}
