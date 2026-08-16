import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from './types/messages.js';
import { createDisplayResolver } from './display/resolver.js';
import {
  setDisplaySnapshot,
  getDisplaySnapshot,
  applyVarDelta,
  diffSnapshotVars,
  getDisplayResolutionMode,
  setDisplayResolutionMode,
  type DisplayResolutionMode,
} from './display/snapshot.js';
import { MSG_DEP_KEY } from './interpreter/evaluator/context.js';
import { setWasmoonEnabled } from './interpreter/runtime.js';
import { STYLES } from './ui/styles.js';
import { createSidebar } from './ui/sidebar.js';
import { createAuxDebugPanel } from './ui/aux-debug.js';
import { setupBgHtmlRenderer } from './bghtml/render.js';
import { setupIslandStyles } from './bghtml/island-styles.js';
// Risu compiled CSS (Tailwind v4 + theme vars). GPL-3.0 output; reason LumiRealm is GPL-3.0.
import risuEnvironmentCss from './bghtml/risu-environment.css' with { type: 'text' };
import { setupImportOverlay } from './ui/import-overlay.js';
import { setupBgmPlayer } from './audio/bgm.js';
import { setupSvgRasterizer } from './svg-raster.js';
import { setupRealmModal, isRealmBackendMessage } from './realm/frontend.js';
import { setupTranslateToggle } from './ui/translate-toggle.js';
import { initTranslateOrchestrator } from './ui/translate-orchestrator.js';
import { setupAlertModal } from './ui/alert-modal.js';
import { setupPickModal } from './ui/pick-modal.js';
import { setupLegacyReimportModal } from './ui/legacy-reimport-modal.js';
import { setupHostVersionModal } from './ui/host-version-modal.js';
import { setupPermissionsModal } from './ui/permissions-modal.js';
import { setupBridgeStatusBanner } from './ui/bridge-status-banner.js';
import { logStore, isLogThreshold, DEFAULT_LOG_LEVEL, type LogThreshold } from './log/store.js';
import {
  installConsoleCapture,
  removeConsoleCapture,
  buildBundle,
  downloadBundle,
} from './log/frontend-capture.js';
import { buildArchive, downloadBlob } from './export/archive-writer.js';

const HANDSHAKE_RETRY_MS = 3000;

export const flog = {
  error(msg: string, ...rest: unknown[]): void {
    console.error('[lumirealm]', msg, ...rest);
    logStore.push('error', 'frontend', formatLine(msg, rest));
  },
  warn(msg: string, ...rest: unknown[]): void {
    if (logStore.shouldEmit('warn')) console.warn('[lumirealm]', msg, ...rest);
    logStore.push('warn', 'frontend', formatLine(msg, rest));
  },
  info(msg: string, ...rest: unknown[]): void {
    if (logStore.shouldEmit('info')) console.log('[lumirealm]', msg, ...rest);
    logStore.push('info', 'frontend', formatLine(msg, rest));
  },
  debug(msg: string, ...rest: unknown[]): void {
    if (logStore.shouldEmit('debug')) console.log('[lumirealm]', msg, ...rest);
    logStore.push('debug', 'frontend', formatLine(msg, rest));
  },
  trace(msg: string, ...rest: unknown[]): void {
    if (logStore.shouldEmit('trace')) console.log('[lumirealm]', msg, ...rest);
    logStore.push('trace', 'frontend', formatLine(msg, rest));
  },
};

function formatLine(msg: string, rest: readonly unknown[]): string {
  if (rest.length === 0) return msg;
  const tail = rest.map((r) => {
    if (r instanceof Error) return `${r.name}: ${r.message}`;
    if (typeof r === 'string') return r;
    try { return JSON.stringify(r); } catch { return String(r); }
  }).join(' ');
  return `${msg} ${tail}`;
}

const LOG_STATE_LS_KEY = 'lumirealm/log-state-v1';

function hydrateLogStateFromLocalStorage(): void {
  try {
    const raw = localStorage.getItem(LOG_STATE_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { enabled?: unknown; includeChatData?: unknown; level?: unknown };
    if (typeof parsed.enabled === 'boolean' && typeof parsed.includeChatData === 'boolean') {
      logStore.setState({
        enabled: parsed.enabled,
        includeChatData: parsed.includeChatData,
        level: isLogThreshold(parsed.level) ? parsed.level : DEFAULT_LOG_LEVEL,
      });
    }
  } catch { /* */ }
}

function persistLogStateToLocalStorage(state: { enabled: boolean; includeChatData: boolean; level: LogThreshold }): void {
  try {
    localStorage.setItem(LOG_STATE_LS_KEY, JSON.stringify(state));
  } catch { /* */ }
}

export function setup(ctx: SpindleFrontendContext): () => void {
  hydrateLogStateFromLocalStorage();
  flog.info('frontend setup: begin');
  const cleanups: (() => void)[] = [];

  const readiness = ctx as unknown as { deferReady?: () => void; ready?: () => void };
  const hasReadiness = typeof readiness.deferReady === 'function' && typeof readiness.ready === 'function';
  if (hasReadiness) readiness.deferReady!();

  const displayRegistered = Boolean(ctx.display);
  const display = ctx.display;
  if (display) {
    cleanups.push(display.registerResolver(createDisplayResolver(
      (chatId, vars) => {
        // Mirror editDisplay writes into the local snapshot so init-once guards
        // see their guard var set next render. Without it the guard never engages,
        // init re-runs every render, and writeback clobbers committed progress.
        applyVarDelta(chatId, 'local', vars);
        ctx.sendToBackend({ type: 'display_writeback', chatId, vars });
      },
      (effect) => {
        if (effect.kind === 'set-expression') {
          display.setExpression(effect);
          return;
        }
        void ctx.chats.updateMessage(
          effect.chatId,
          effect.messageId,
          { content: effect.content },
        ).catch((err) => {
          flog.warn(
            `display action message update failed chat=${effect.chatId} ` +
              `message=${effect.messageId}: ${String(err)}`,
          );
        });
      },
    )));
  }
  // Ownership is per-character: the host reads character.extensions.lumirealm.display_owner
  // (stamped by writeLumirealm + the boot backfill). display_authority is a separate signal
  // telling the backend to short-circuit ('on') or keep resolving ('shadow'/'off').
  const sendDisplayAuthority = (chatId: string | null): void => {
    if (!chatId) return;
    ctx.sendToBackend({
      type: 'display_authority',
      chatId,
      authoritative: getDisplayResolutionMode() === 'on',
    });
  };
  (window as unknown as { __lumirealmDisplayMode?: (m: string) => void }).__lumirealmDisplayMode = (m: string) => {
    const mode: DisplayResolutionMode = m === 'shadow' || m === 'on' ? m : 'off';
    setDisplayResolutionMode(mode);
    sendDisplayAuthority(activeRisuChatId);
    flog.info(`display resolution mode='${mode}' resolverRegistered=${displayRegistered}`);
    if (!displayRegistered) {
      flog.warn('display resolver NOT registered: host ctx.display is undefined — the Lumiverse core frontend lacks the display hook.');
    }
  };
  cleanups.push(() => {
    try { delete (window as unknown as Record<string, unknown>).__lumirealmDisplayMode; } catch { /* */ }
  });
  (window as unknown as { __lumirealmWasmoon?: (on?: boolean) => void }).__lumirealmWasmoon = (on?: boolean) => {
    const enabled = on !== false;
    setWasmoonEnabled(enabled);
    flog.info(`wasmoon editDisplay engine ${enabled ? 'ENABLED (wasmoon)' : 'DISABLED (fengari fallback)'} — reopen the chat to apply`);
  };
  cleanups.push(() => {
    try { delete (window as unknown as Record<string, unknown>).__lumirealmWasmoon; } catch { /* */ }
  });

  const originalFetch = window.fetch.bind(window);
  const taggedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const urlStr = typeof url === 'string' ? url : '';
    const isResolveBatch = urlStr.includes('/api/v1/macros/resolve-batch');
    const isRegexApply = urlStr.includes('/api/v1/regex-scripts/apply');
    const isDisplayPreprocess = urlStr.includes('/display-preprocess');
    if (!isResolveBatch && !isRegexApply && !isDisplayPreprocess) return originalFetch(input, init);
    const t0 = performance.now();
    if (isRegexApply) {
      let preview = '';
      try {
        const body = init?.body;
        if (typeof body === 'string') {
          const parsed = JSON.parse(body) as { content?: string; scripts?: unknown[]; resolved_find_patterns?: Record<string, string>; resolved_replacements?: Record<string, string>; dynamic_macros?: Record<string, string> };
          const findKeys = Object.keys(parsed.resolved_find_patterns ?? {});
          const replaceKeys = Object.keys(parsed.resolved_replacements ?? {});
          const dynKeys = Object.keys(parsed.dynamic_macros ?? {});
          preview = `scripts=${parsed.scripts?.length ?? 0} content_len=${parsed.content?.length ?? 0} preFind=${findKeys.length} preReplace=${replaceKeys.length} dyn=[${dynKeys.join(',')}]`;
        }
      } catch { /* */ }
      flog.trace(`[macro-tap] → POST regex-scripts/apply ${preview}`);
      const resp = await originalFetch(input, init);
      try {
        const clone = resp.clone();
        const text = await clone.text();
        const parsed = (() => { try { return JSON.parse(text) as { result?: string; touched_vars?: string[]; cacheable?: boolean }; } catch { return null; } })();
        if (parsed && typeof parsed.result === 'string') {
          const stillRaw = /\{\{(?!\s*(?:user|char|bot|notChar|not_char|charName)\s*\}\})/i.test(parsed.result);
          flog.trace(`[macro-tap] ← regex-scripts/apply 200 in ${Math.round(performance.now() - t0)}ms result_len=${parsed.result.length} touched=${parsed.touched_vars?.length ?? 0} cacheable=${parsed.cacheable} still_has_raw_cbs=${stillRaw} result[0..200]=${JSON.stringify(parsed.result.slice(0, 200))}`);
        } else {
          flog.warn(`[macro-tap] ← regex-scripts/apply HTTP ${resp.status} in ${Math.round(performance.now() - t0)}ms (body not JSON)`);
        }
      } catch (err) {
        flog.warn('[macro-tap] regex-scripts/apply clone/parse failed:', err);
      }
      return resp;
    }
    if (isDisplayPreprocess) {
      flog.trace(`[macro-tap] → POST display-preprocess`);
      const resp = await originalFetch(input, init);
      flog.trace(`[macro-tap] ← display-preprocess HTTP ${resp.status} in ${Math.round(performance.now() - t0)}ms`);
      return resp;
    }
    let reqPreview: string = '';
    try {
      const body = init?.body;
      if (typeof body === 'string') {
        const parsed = JSON.parse(body) as { templates?: Record<string, string>; chat_id?: string; character_id?: string };
        const keys = Object.keys(parsed.templates ?? {});
        const firstKey = keys[0];
        const firstTmpl = firstKey ? parsed.templates?.[firstKey] : undefined;
        reqPreview = `templates=${keys.length} chat_id=${parsed.chat_id ?? '?'} character_id=${parsed.character_id ?? '?'} first_template[0..200]=${JSON.stringify((firstTmpl ?? '').slice(0, 200))}`;
      }
    } catch { /* */ }
    flog.trace(`[macro-tap] → POST resolve-batch ${reqPreview}`);
    const resp = await originalFetch(input, init);
    try {
      const clone = resp.clone();
      const text = await clone.text();
      const parsed = (() => { try { return JSON.parse(text) as { resolved?: Record<string, string> }; } catch { return null; } })();
      if (parsed?.resolved) {
        const entries = Object.entries(parsed.resolved);
        const leaksRaw = entries.filter(([, v]) => /\{\{/.test(v));
        const emptyKeys = entries.filter(([, v]) => v.length === 0).length;
        flog.trace(`[macro-tap] ← resolve-batch 200 in ${Math.round(performance.now() - t0)}ms keys=${entries.length} leaks_with_raw_macros=${leaksRaw.length} empty_keys=${emptyKeys}`);
        if (leaksRaw.length > 0) {
          for (const [k, v] of leaksRaw.slice(0, 3)) {
            flog.warn(`[macro-tap]   leak id=${k} resolved[0..300]=${JSON.stringify(v.slice(0, 300))}`);
          }
        }
        for (const [k, v] of entries) {
          flog.trace(`[macro-tap]   id=${k} len=${v.length} resolved[0..200]=${JSON.stringify(v.slice(0, 200))}`);
        }
      } else {
        flog.warn(`[macro-tap] ← resolve-batch HTTP ${resp.status} in ${Math.round(performance.now() - t0)}ms (body not JSON)`);
      }
    } catch (err) {
      flog.warn('[macro-tap] clone/parse failed:', err);
    }
    return resp;
  };
  Object.assign(taggedFetch, originalFetch);
  (window as unknown as { fetch: typeof fetch }).fetch = taggedFetch as typeof fetch;
  cleanups.push(() => {
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetch as typeof fetch;
  });

  const dumpBubble = (): unknown => {
    const out: unknown[] = [];
    const bubbles = document.querySelectorAll('[data-message-id]');
    for (const b of bubbles) {
      const msgId = b.getAttribute('data-message-id') || '?';
      const islands: unknown[] = [];
      const islandEls = b.querySelectorAll('[class*="_htmlIsland_"]');
      for (const ie of islandEls) {
        const sr = (ie as Element).shadowRoot;
        islands.push({
          cls: ie.className,
          hasShadow: sr !== null,
          shadowMode: sr?.mode ?? null,
          shadowChildren: sr ? sr.childElementCount : null,
          shadowHasStyle: sr ? sr.querySelectorAll('style').length : null,
          shadowAdoptedSheets: sr ? sr.adoptedStyleSheets.length : null,
          lightInnerLen: ie.innerHTML.length,
          shadowInnerLen: sr ? Array.from(sr.children).map((c) => c.outerHTML).join('').length : null,
        });
      }
      out.push({ msgId: msgId.slice(0, 8), bubbleHtmlLen: b.innerHTML.length, islandCount: islandEls.length, islands });
    }
    console.log('[lumirealm] [BUBBLE-DUMP]', JSON.stringify(out, null, 2));
    return out;
  };

  const dumpStyleScope = (): unknown => {
    const chatScope = document.getElementById('risu-compat-chat-scope-css');
    const islandSheets = (() => {
      const out: { adoptedSheetCount: number; cssRulesCount: number }[] = [];
      const shadows = document.querySelectorAll('[class*="_htmlIsland_"]');
      for (const s of shadows) {
        const sr = (s as Element).shadowRoot;
        if (!sr) continue;
        const adopted = sr.adoptedStyleSheets ?? [];
        let totalRules = 0;
        for (const sh of adopted) {
          try { totalRules += sh.cssRules.length; } catch { /* */ }
        }
        out.push({ adoptedSheetCount: adopted.length, cssRulesCount: totalRules });
      }
      return out;
    })();
    const result = {
      chatScopeBytes: chatScope?.textContent?.length ?? null,
      bgHtmlHostExists: document.querySelector('[data-risu-bg-host]') !== null,
      islandShadows: islandSheets,
    };
    console.log('[lumirealm] [STYLE-SCOPE]', JSON.stringify(result, null, 2));
    return result;
  };

  (window as unknown as { __riCompatDump?: {
    bubble: () => unknown;
    styleScope: () => unknown;
  } }).__riCompatDump = {
    bubble: dumpBubble,
    styleScope: dumpStyleScope,
  };
  cleanups.push(() => {
    try { delete (window as unknown as Record<string, unknown>).__riCompatDump; } catch { /* */ }
  });


  cleanups.push(ctx.dom.addStyle(STYLES));
  flog.info('frontend setup: styles injected');

  const sendToBackend = (msg: FrontendToBackend): void => {
    flog.trace(`frontend send: ${msg.type}`, msg);
    ctx.sendToBackend(msg);
  };

  // Blocking import-progress overlay shown from picker-click and realm-Import
  // through phase=done. Locks UI to prevent mid-import navigation. Created
  // before the sidebar so notifyImportStart wires into the cards-panel picker.
  const importOverlay = setupImportOverlay(flog, sendToBackend);
  cleanups.push(() => importOverlay.destroy());

  let sidebar: ReturnType<typeof createSidebar> | null = null;
  try {
    sidebar = createSidebar({
      ctx,
      sendToBackend,
      log: flog,
      onImportStart: (fileName, onCancel, totalBytes) =>
        importOverlay.notifyImportStart(fileName, 'drawer', onCancel, totalBytes),
      onUploadProgress: (sent, total) => importOverlay.setUploadProgress(sent, total),
      onModuleImportStart: (fileName, onCancel, totalBytes) =>
        importOverlay.notifyImportStart(fileName, 'module', onCancel, totalBytes),
    });
    cleanups.push(() => sidebar?.destroy());
    flog.info('frontend setup: unified sidebar registered');
  } catch (err) {
    flog.error('createSidebar failed:', err);
    return () => {
      for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
    };
  }

  const islandStyles = setupIslandStyles(flog, {
    riskuEnvironmentCss: risuEnvironmentCss,
  });
  cleanups.push(() => islandStyles.destroy());

  const bgRenderer = setupBgHtmlRenderer(ctx, flog, islandStyles);
  cleanups.push(() => bgRenderer.destroy());

  // BGM player: singleton <audio> driven by `risu-ctrl="bgm___volume___url"` markers.
  // Risu observer.svelte.ts
  const bgmPlayer = setupBgmPlayer(flog);
  cleanups.push(() => bgmPlayer.destroy());

  let auxDebug: ReturnType<typeof createAuxDebugPanel> | null = null;
  try {
    auxDebug = createAuxDebugPanel(flog);
    cleanups.push(() => auxDebug?.destroy());
  } catch (err) {
    flog.error('createAuxDebugPanel failed:', err);
  }

  const alertModal = setupAlertModal({ ctx, sendToBackend, log: flog });
  cleanups.push(() => alertModal.destroy());

  const pickModal = setupPickModal({ ctx, sendToBackend, log: flog });
  cleanups.push(() => pickModal.destroy());

  const legacyReimportModal = setupLegacyReimportModal({ ctx, sendToBackend, log: flog });
  cleanups.push(() => legacyReimportModal.destroy());

  const hostVersionModal = setupHostVersionModal({ ctx, sendToBackend, log: flog });
  cleanups.push(() => hostVersionModal.destroy());

  const permissionsModal = setupPermissionsModal({ ctx, sendToBackend, log: flog });
  cleanups.push(() => permissionsModal.destroy());

  const bridgeBanner = setupBridgeStatusBanner({ ctx, log: flog });
  cleanups.push(() => bridgeBanner.destroy());

  let realm: ReturnType<typeof setupRealmModal> | null = null;
  try {
    if (!sidebar) throw new Error('realm: sidebar required');
    realm = setupRealmModal({
      ctx,
      sendToBackend,
      log: flog,
      mountTarget: sidebar.headerRoot,
      onImportStart: (label) => importOverlay.notifyImportStart(label, 'realm'),
    });
    cleanups.push(() => realm?.destroy());
    flog.info('frontend setup: realm modal registered');
  } catch (err) {
    flog.error('setupRealmModal failed:', err);
  }

  const translateToggle = setupTranslateToggle({
    mountTarget: sidebar.headerRoot,
    sendToBackend,
    log: flog,
  });
  cleanups.push(() => translateToggle.destroy());

  const translateOrchestrator = initTranslateOrchestrator({ sendToBackend, log: flog });
  cleanups.push(() => translateOrchestrator.destroy());

  const svgRasterizer = setupSvgRasterizer({ log: flog, sendToBackend });

  // Risu Chat.svelte:206-231: clicks on [risu-trigger] call runTrigger(char,'manual',{manualName}).
  // Capture phase to beat Lumi handlers. risu-trigger/risu-btn/risu-id survive Lumi's sanitizer
  // (richHtmlSanitizer.ts db9ef7c isAllowedCustomAttributeName).
  let activeRisuChatId: string | null = null;
  const onClickCapture = (e: Event): void => {
    const path = typeof (e as Event & { composedPath?: () => EventTarget[] }).composedPath === 'function'
      ? (e as Event & { composedPath: () => EventTarget[] }).composedPath()
      : [];
    const t = (path[0] as HTMLElement | undefined) ?? (e.target as HTMLElement | null);
    if (!t || typeof t.closest !== 'function') return;
    const el = t.closest('[risu-trigger], [risu-btn]') as HTMLElement | null;
    if (!el) return;
    const triggerName = el.getAttribute('risu-trigger');
    const btn = triggerName ? null : el.getAttribute('risu-btn');
    if (!triggerName && !btn) return;
    const idAttr = el.getAttribute('risu-id') ?? undefined;
    const chatId = activeRisuChatId;
    if (!chatId) {
      const label = triggerName ?? `btn=${btn}`;
      flog.warn(`manual click: active chat isn't a lumirealm chat, ignoring ${label}`);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (triggerName) {
      flog.info(`manual-trigger click: triggerName=${triggerName} triggerId=${idAttr ?? '<none>'} chatId=${chatId}`);
      sendToBackend({
        type: 'manual_trigger',
        triggerName,
        ...(idAttr !== undefined ? { triggerId: idAttr } : {}),
        chatId,
      });
    } else if (btn) {
      flog.info(`manual-button click: btn=${btn} btnId=${idAttr ?? '<none>'} chatId=${chatId}`);
      sendToBackend({
        type: 'manual_button_click',
        btn,
        ...(idAttr !== undefined ? { btnId: idAttr } : {}),
        chatId,
      });
    }
  };
  document.addEventListener('click', onClickCapture, /* capture */ true);
  cleanups.push(() => document.removeEventListener('click', onClickCapture, /* capture */ true));

  // window.__riCompat.fire(triggerName, triggerId?): console entry point for manual triggers.
  // Non-enumerable so it stays out of auto-complete on unrelated objects.
  const debugHook = {
    get activeChatId(): string | null { return activeRisuChatId; },
    fire(triggerName: string, triggerId?: string): boolean {
      const chatId = activeRisuChatId;
      if (!chatId) {
        flog.warn(`__riCompat.fire: active chat isn't a lumirealm chat; open one first. triggerName=${triggerName}`);
        return false;
      }
      if (typeof triggerName !== 'string' || triggerName.length === 0) {
        flog.warn('__riCompat.fire: triggerName must be a non-empty string');
        return false;
      }
      sendToBackend({
        type: 'manual_trigger',
        triggerName,
        ...(triggerId !== undefined ? { triggerId } : {}),
        chatId,
      });
      return true;
    },
    requestVariablesSnapshot(): boolean {
      if (!activeRisuChatId) {
        flog.warn('__riCompat.requestVariablesSnapshot: no active Risu chat');
        return false;
      }
      sendToBackend({ type: 'request_variables_snapshot', chatId: activeRisuChatId });
      flog.info(`__riCompat.requestVariablesSnapshot: requested for chatId=${activeRisuChatId}`);
      return true;
    },
  };
  try {
    Object.defineProperty(window, '__riCompat', {
      value: debugHook,
      writable: false,
      configurable: true,
      enumerable: false,
    });
    cleanups.push(() => {
      try { delete (window as unknown as Record<string, unknown>).__riCompat; } catch { /* */ }
    });
  } catch (err) {
    flog.warn(`__riCompat install failed: ${(err as Error).message}`);
  }

  // Risu {{screen_width}}/{{screen_height}} macros need real viewport dims; the backend has none.
  // Sent on: every handshake retry (backend may not be up yet), resize (250ms debounce),
  // and first cards_updated (re-seed after backend restart).
  let lastSentW = -1;
  let lastSentH = -1;
  const reportDims = (reason: string, force = false): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!force && w === lastSentW && h === lastSentH) return;
    lastSentW = w;
    lastSentH = h;
    flog.debug(`screen_dims: reporting reason=${reason} w=${w} h=${h}`);
    sendToBackend({ type: 'screen_dims', width: w, height: h });
  };
  let resizeTimer: number | undefined;
  const onResize = (): void => {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => reportDims('resize'), 250);
  };
  window.addEventListener('resize', onResize);
  cleanups.push(() => {
    window.removeEventListener('resize', onResize);
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  });

  // Retry handshake until backend responds; cold worker or WS hiccup can delay first reply.
  let ready = false;

  const unsub = ctx.onBackendMessage((raw) => {
    const msg = raw as BackendToFrontend;
    flog.trace(`frontend recv: ${msg.type}`, msg);
    if (msg.type === 'log_state_pushed') {
      const level: LogThreshold = isLogThreshold(msg.level) ? msg.level : DEFAULT_LOG_LEVEL;
      logStore.setState({ enabled: msg.enabled, includeChatData: msg.includeChatData, level });
      persistLogStateToLocalStorage({ enabled: msg.enabled, includeChatData: msg.includeChatData, level });
      if (msg.enabled) installConsoleCapture();
      else removeConsoleCapture();
      // Fall through to sidebar broadcast; the Logs panel needs it.
    }
    if (msg.type === 'log_export_pushed') {
      try {
        const bundle = buildBundle({
          backendEvents: msg.events,
          session: {
            extensionVersion: msg.session.extensionVersion,
            userId: msg.session.userId,
            activeChatId: msg.session.activeChatId ?? activeRisuChatId,
            activeCharacterId: msg.session.activeCharacterId,
          },
          includeChatData: logStore.getState().includeChatData,
        });
        downloadBundle(bundle);
      } catch (err) {
        flog.error('log_export_pushed: bundle/download failed', err);
      }
      // Auto-disable per spec.
      sendToBackend({ type: 'log_set_state', enabled: false, includeChatData: false });
      // Fall through so the Logs panel can show "Downloaded".
    }
    if (msg.type === 'export_archive') {
      const plan = msg.plan;
      void (async () => {
        try {
          const result = await buildArchive(plan, flog);
          downloadBlob(result.blob, result.fileName);
          const skipped = result.skippedAssets.length;
          flog.info(
            `export_archive: wrote ${result.fileName} entries=${plan.entries.length}` +
              (skipped > 0 ? ` skipped=${skipped}` : ''),
          );
          if (skipped > 0) {
            window.alert(
              `Exported ${result.fileName}, but ${skipped} asset(s) could not be read ` +
                `and were left out. The archive is incomplete.`,
            );
          }
        } catch (err) {
          flog.error('export_archive: archive build failed', err);
          window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
      return;
    }
    if (msg.type === 'display_snapshot') {
      if (getDisplayResolutionMode() !== 'off') {
        const prev = getDisplaySnapshot(msg.snapshot.chatId);
        setDisplaySnapshot(msg.snapshot);
        if (prev) {
          // Identity change (persona swap/edit): {{user}}/{{persona}}/persona image
          // resolve from these fields, and the var diff below cannot see them.
          const ns = msg.snapshot;
          if (prev.userName !== ns.userName || prev.charName !== ns.charName
            || prev.personaText !== ns.personaText || prev.personaImage !== ns.personaImage) {
            ctx.display?.invalidate(['*']);
            return;
          }
          const changed = diffSnapshotVars(prev, msg.snapshot);
          const pc = prev.chat, nc = msg.snapshot.chat;
          if (pc.lastMessageId !== nc.lastMessageId || pc.messageCount !== nc.messageCount
            || pc.lastMessage !== nc.lastMessage || pc.lastUserMessage !== nc.lastUserMessage
            || pc.lastCharMessage !== nc.lastCharMessage) {
            changed.push(MSG_DEP_KEY);
          }
          if (changed.length > 0) ctx.display?.invalidate(changed);
        } else {
          // First snapshot for this chat: the host gates resolver use on
          // ready() (snapshot present), so re-resolve everything now that it is.
          ctx.display?.invalidate(['*']);
        }
      }
      return;
    }
    if (msg.type === 'set_variables') {
      if (getDisplayResolutionMode() !== 'off' && typeof msg.characterId === 'string') {
        const snap = getDisplaySnapshot(msg.chatId);
        const changed: string[] = [];
        for (const scope of ['local', 'global', 'chat'] as const) {
          const incoming = msg.scopes[scope] ?? {};
          const cur = { ...(snap?.vars[scope] ?? {}) };
          for (const [k, v] of Object.entries(incoming)) {
            if (cur[k] !== v) changed.push(`${scope}:${k}`);
          }
          for (const k of Object.keys(cur)) {
            if (!(k in incoming)) changed.push(`${scope}:${k}`);
          }
          applyVarDelta(msg.chatId, scope, { ...incoming });
        }
        if (changed.length > 0) ctx.display?.invalidate(changed);
      }
      // fall through to sidebar broadcast
    }
    if (msg.type === 'cards_updated') {
      if (!ready) {
        flog.info('handshake complete on first cards_updated');
        // Force resend: screen_dims sent before backend was ready may have been dropped.
        reportDims('cards_updated', /* force */ true);
      }
      ready = true;
    }
    if (msg.type === 'set_active_chat') {
      const prevChatId = activeRisuChatId;
      activeRisuChatId = msg.chatId;
      sendDisplayAuthority(msg.chatId);
      if (activeRisuChatId !== prevChatId) {
        if (sidebar) sidebar.setActiveChatId(activeRisuChatId);
      }
      // Fall through to sidebar broadcast so the viewer panel can read
      // msg.characterId for its auto-follow + Current button.
      sidebar?.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'render_bg_html' || msg.type === 'clear_bg_html') {
      try {
        bgRenderer.handleMessage(msg);
      } catch (err) {
        flog.error('bg-html dispatch failed:', err);
      }
      return;
    }
    if (msg.type === 'rasterize_svgs') {
      svgRasterizer.handleRasterizeSvgsMessage(msg);
      return;
    }
    if (msg.type === 'aux_debug_capture') {
      auxDebug?.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'request_alert') {
      alertModal.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'request_pick') {
      pickModal.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'notify_legacy_card_needs_reimport') {
      legacyReimportModal.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'notify_host_version_outdated') {
      hostVersionModal.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'notify_missing_permissions') {
      permissionsModal.handleBackendMessage(msg);
      return;
    }
    if (msg.type === 'notify_bridge_status') {
      bridgeBanner.handleBackendMessage(msg);
      return;
    }
    if (isRealmBackendMessage(msg)) {
      realm?.handleBackendMessage(msg);
      // Realm replies feed the overlay too (download-started ack, etc.)
      try { importOverlay.handleBackendMessage(msg as unknown as BackendToFrontend); } catch (err) { flog.warn('importOverlay realm dispatch threw:', err); }
      return;
    }
    // Import-related backend messages drive the blocking overlay (start /
    // phase / asset upload / done / error). Fire BEFORE the sidebar fan-out
    // so the overlay state stays consistent with the cards-panel status UI.
    try { importOverlay.handleBackendMessage(msg); } catch (err) { flog.warn('importOverlay dispatch threw:', err); }
    try { translateToggle.handleBackendMessage(msg); } catch (err) { flog.warn('translateToggle dispatch threw:', err); }
    // All other messages fan out to sidebar panels; each panel filters by msg.type.
    sidebar?.handleBackendMessage(msg);
  });
  cleanups.push(unsub);

  function handshake(): void {
    flog.info('handshake: sending get_cards + screen_dims + log_request_state');
    sendToBackend({ type: 'get_cards' });
    sendToBackend({ type: 'log_request_state' });
    reportDims('handshake', /* force */ true);
  }

  handshake();
  const retry = window.setInterval(() => {
    if (ready) {
      window.clearInterval(retry);
      return;
    }
    flog.debug(`handshake retry (ready=${ready})`);
    handshake();
  }, HANDSHAKE_RETRY_MS);
  cleanups.push(() => window.clearInterval(retry));

  if (hasReadiness) readiness.ready!();
  flog.info('frontend setup: done');
  return () => {
    flog.info('frontend teardown');
    for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
  };
}
