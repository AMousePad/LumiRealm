import type { BackendToFrontend, FrontendToBackend, LogLevelWire } from '../types/messages.js';
import type { FrontendLog } from './drawer.js';
import { createSearchableSelect } from './searchable-select.js';
import { logStore } from '../log/store.js';

// The backend only pushes log state on request/set/clear, so a live buffer
// would otherwise display the count captured at enable time (always 0) forever.
const STATUS_POLL_MS = 1000;

interface LevelOption {
  readonly value: LogLevelWire;
  readonly label: string;
  readonly title: string;
}

const LEVEL_OPTIONS: readonly LevelOption[] = [
  { value: 'silent', label: 'Silent',  title: 'Drop everything, including errors. Same as logging off but the master switch stays on.' },
  { value: 'error',  label: 'Error',   title: 'Errors only.' },
  { value: 'warn',   label: 'Warn',    title: 'Errors + warnings.' },
  { value: 'info',   label: 'Info (default)', title: 'Lifecycle events: chat open/close, import phases, generation start/end, button clicks.' },
  { value: 'debug',  label: 'Debug',   title: 'Per-call internals: resolveReadonly, ensureActiveCardForChat, refreshBgHtml, macroInterceptor enter/exit.' },
  { value: 'trace',  label: 'Trace',   title: 'Everything: WS frame traffic, [macro-tap], per-Lua-call ctx, periodic summaries. Very noisy.' },
];

interface MountOpts {
  readonly root: HTMLElement;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
}

interface LogsPanelHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

interface State {
  enabled: boolean;
  includeChatData: boolean;
  level: LogLevelWire;
  eventCount: number;
  bufferBytes: number;
  /** False until the first log_state_pushed lands, so mount does not claim 0. */
  backendStateKnown: boolean;
  lastDownloadAt: number | null;
  lastError: string | null;
}

export function mountLogsPanel(opts: MountOpts): LogsPanelHandle {
  const { root, sendToBackend, log } = opts;
  log.info('logs-tab: mounting');

  const state: State = {
    enabled: false,
    includeChatData: false,
    level: 'info',
    eventCount: 0,
    bufferBytes: 0,
    backendStateKnown: false,
    lastDownloadAt: null,
    lastError: null,
  };

  root.classList.add('lr-logs-panel');

  const wrap = document.createElement('div');
  wrap.className = 'lr-logs';
  root.appendChild(wrap);

  const intro = document.createElement('p');
  intro.className = 'lr-logs-intro';
  intro.textContent = 'Capture diagnostics for a bug report. Download turns logging off.';
  wrap.appendChild(intro);

  const enableRow = makeCheckboxRow({
    id: 'lr-logs-enable',
    label: 'Enable logging',
    title: 'Capture events into a downloadable bundle.',
    onChange: (checked) => {
      sendToBackend({
        type: 'log_set_state',
        enabled: checked,
        includeChatData: state.includeChatData,
        level: state.level,
      });
    },
  });
  wrap.appendChild(enableRow.row);

  const chatRow = makeCheckboxRow({
    id: 'lr-logs-include-chat',
    label: 'Include chat data',
    title: 'Off: message content and DOM are redacted. On: full chat data captured.',
    onChange: (checked) => {
      sendToBackend({
        type: 'log_set_state',
        enabled: state.enabled,
        includeChatData: checked,
        level: state.level,
      });
    },
  });
  wrap.appendChild(chatRow.row);

  const levelRow = document.createElement('div');
  levelRow.className = 'lr-logs-row';
  const levelLabel = document.createElement('label');
  levelLabel.htmlFor = 'lr-logs-level';
  levelLabel.textContent = 'Verbosity';
  levelLabel.title = 'Threshold for which logs are recorded. Higher levels include lower ones.';
  const levelSelect = createSearchableSelect({
    id: 'lr-logs-level',
    className: 'lr-logs-trigger',
    placeholder: 'Verbosity',
    searchPlaceholder: 'Search levels…',
    items: LEVEL_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
      title: opt.title,
      secondary: opt.title,
    })),
    onChange(value) {
      if (value === null) return;
      const next = value as LogLevelWire;
      log.info(`logs-tab: level set to ${next}`);
      sendToBackend({
        type: 'log_set_state',
        enabled: state.enabled,
        includeChatData: state.includeChatData,
        level: next,
      });
    },
  });
  levelRow.appendChild(levelLabel);
  levelRow.appendChild(levelSelect.root);
  wrap.appendChild(levelRow);

  const status = document.createElement('div');
  status.className = 'lr-logs-status';
  wrap.appendChild(status);

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'lr-logs-download';
  downloadBtn.textContent = 'Download';
  downloadBtn.title = 'Save the bundle and turn logging off.';
  downloadBtn.addEventListener('click', () => {
    if (!state.enabled && totals().events === 0) {
      flash('Nothing to download. Enable logging first.');
      return;
    }
    log.info('logs-tab: requesting export');
    sendToBackend({ type: 'log_request_export' });
    flash('Preparing bundle…');
  });
  wrap.appendChild(downloadBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'lr-logs-clear';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Drop buffered events.';
  clearBtn.addEventListener('click', () => {
    sendToBackend({ type: 'log_clear' });
  });
  wrap.appendChild(clearBtn);

  const flashEl = document.createElement('div');
  flashEl.className = 'lr-logs-flash';
  wrap.appendChild(flashEl);

  let flashTimer: number | undefined;
  function flash(text: string): void {
    flashEl.textContent = text;
    if (flashTimer !== undefined) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { flashEl.textContent = ''; }, 6000);
  }

  // Backend and frontend keep separate buffers and are only merged at export,
  // so the status has to sum both or it silently undercounts by every UI event.
  function totals(): { events: number; bytes: number } {
    const local = logStore.getState();
    return {
      events: state.eventCount + local.eventCount,
      bytes: state.bufferBytes + local.bufferBytes,
    };
  }

  function render(): void {
    enableRow.input.checked = state.enabled;
    chatRow.input.checked = state.includeChatData;
    chatRow.input.disabled = !state.enabled;
    chatRow.row.classList.toggle('lr-logs-row-disabled', !state.enabled);
    if (levelSelect.getValue() !== state.level) levelSelect.setValue(state.level);

    const levelTxt = `level=${state.level}`;
    if (!state.backendStateKnown) {
      status.textContent = `Loading state… · ${levelTxt}`;
    } else {
      const { events, bytes } = totals();
      const kb = (bytes / 1024).toFixed(1);
      status.textContent = state.enabled
        ? `${events} events, ${kb} KB · ${levelTxt}`
        : `Off. ${events} events, ${kb} KB · ${levelTxt}.`;
    }
    if (state.lastError) {
      status.textContent += `  ·  ${state.lastError}`;
    }
  }

  // Ask backend for current state on mount.
  sendToBackend({ type: 'log_request_state' });
  render();

  const poll = window.setInterval(() => {
    // Frontend events accrue locally, so repaint even while the buffer is off
    // and no backend round-trip is warranted.
    if (!state.enabled) {
      render();
      return;
    }
    sendToBackend({ type: 'log_request_state' });
  }, STATUS_POLL_MS);

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (msg.type === 'log_state_pushed') {
      state.enabled = msg.enabled;
      state.includeChatData = msg.includeChatData;
      if (msg.level !== undefined) state.level = msg.level;
      state.eventCount = msg.eventCount;
      state.bufferBytes = msg.bufferBytes;
      state.backendStateKnown = true;
      render();
    } else if (msg.type === 'log_export_pushed') {
      // Frontend handles the download. Refresh status text and confirm.
      state.lastDownloadAt = Date.now();
      flash('Bundle downloaded. Logging is off.');
    }
  }

  function destroy(): void {
    log.info('logs-tab: destroy');
    window.clearInterval(poll);
    if (flashTimer !== undefined) window.clearTimeout(flashTimer);
    levelSelect.destroy();
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  return { handleBackendMessage, destroy };
}

interface CheckboxRowOpts {
  id: string;
  label: string;
  title: string;
  onChange: (checked: boolean) => void;
}
interface CheckboxRow {
  row: HTMLDivElement;
  input: HTMLInputElement;
}

function makeCheckboxRow(opts: CheckboxRowOpts): CheckboxRow {
  const row = document.createElement('div');
  row.className = 'lr-logs-row';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = opts.id;

  const label = document.createElement('label');
  label.htmlFor = opts.id;
  label.textContent = opts.label;
  label.title = opts.title;

  input.addEventListener('change', () => opts.onChange(input.checked));

  row.appendChild(input);
  row.appendChild(label);
  return { row, input };
}
