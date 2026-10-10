import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { BackendToFrontend, FrontendToBackend } from '../types/messages.js';
import { mountCardsPanel } from './drawer.js';
import type { FrontendLog } from './drawer.js';
import { mountVariablesPanel } from './variables-tab.js';
import { mountSettingsPanel } from './settings-tab.js';
import { mountModulesPanel } from './modules-tab.js';
import { mountViewerPanel } from './viewer-tab.js';
import { mountTogglesPanel } from './toggles-tab.js';
// Logs panel now mounts INSIDE settings-tab's Debug subtab (Phase C);
// the standalone logs mount on the Settings tab was removed.

// Single drawer tab with lazy-mounted sub-panels.
// Panels stay alive after first mount so backend pushes keep their state hot.

import LUMIREALM_ICON_SVG from './icons/sidebar.svg' with { type: 'text' };

export type SidebarTabId =
  | 'import'
  | 'viewer'
  | 'state'
  | 'settings';

interface SubTabDef {
  readonly id: SidebarTabId;
  readonly label: string;
  readonly title: string;
}

const SUB_TABS: readonly SubTabDef[] = [
  { id: 'import',         label: 'Import',         title: 'Import cards and manage modules.' },
  { id: 'viewer',         label: 'Viewer',         title: 'Inspect character and module contents.' },
  { id: 'state',          label: 'State',          title: 'Variables, toggles, and persistent UIs for the active chat.' },
  { id: 'settings',       label: 'Settings',       title: 'Aux model, parity toggles, and diagnostic logs.' },
];

type StateSubTabId = 'variables' | 'toggles';

const STATE_SUB_TABS: readonly { id: StateSubTabId; label: string; title: string }[] = [
  { id: 'variables', label: 'Variables', title: 'Live macro variables.' },
  { id: 'toggles',   label: 'Toggles',   title: 'Custom toggles.' },
];

interface SubPanelHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
  setActiveChatId?(chatId: string | null): void;
}

// Lumiverse 1.1.5 exposes frontend host actions at ctx.host.surfaces. The
// runtime contract landed ahead of spindle-types 0.6.15, so keep the local
// type narrow until the package declaration catches up.
interface WorldBookEditorHost {
  readonly surfaces?: {
    invoke(
      ref: { readonly kind: 'modal'; readonly id: 'world_book_editor' },
      params: { readonly id: string; readonly entryId?: string },
    ): void | Promise<void>;
  };
}

export interface SidebarHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  setActiveChatId(chatId: string | null): void;
  setActiveSubTab(id: SidebarTabId): void;
  getActiveSubTab(): SidebarTabId;
  readonly headerRoot: HTMLElement;
  destroy(): void;
}

export interface CreateSidebarOptions {
  readonly ctx: SpindleFrontendContext;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
  readonly log: FrontendLog;
  readonly initialTab?: SidebarTabId;
  readonly onImportStart?: (fileName: string, onCancel?: () => void, totalBytes?: number) => void;
  readonly onUploadProgress?: (sent: number, total: number) => void;
  readonly onModuleImportStart?: (fileName: string, onCancel?: () => void, totalBytes?: number) => void;
}

export function createSidebar(opts: CreateSidebarOptions): SidebarHandle {
  const { ctx, sendToBackend, log } = opts;
  const openWorldBookEditor = async (worldBookId: string, entryId?: string): Promise<void> => {
    const surfaces = (ctx.host as unknown as WorldBookEditorHost).surfaces;
    if (!surfaces) throw new Error('Lumiverse host action API is unavailable');
    await surfaces.invoke(
      { kind: 'modal', id: 'world_book_editor' },
      { id: worldBookId, ...(entryId ? { entryId } : {}) },
    );
  };
  log.info('sidebar: registering single drawer tab');
  const tab = ctx.ui.registerDrawerTab({
    id: 'lumirealm',
    title: 'LumiRealm',
    shortName: 'LumiRealm',
    description: 'Run RisuAI .charx cards and .risum modules in Lumiverse.',
    keywords: [
      'risu', 'charx', 'risum', 'module', 'import', 'translate',
      'lua', 'lumirealm', 'persistent', 'portal', 'overlay',
      'variables', 'vars', 'settings', 'aux',
    ],
    iconSvg: LUMIREALM_ICON_SVG,
  });

  const root = tab.root;
  root.classList.add('lr-sidebar');

  const headerEl = document.createElement('div');
  headerEl.className = 'lr-sidebar-header';
  root.appendChild(headerEl);

  const navEl = document.createElement('div');
  navEl.className = 'lr-sidebar-nav';
  navEl.setAttribute('role', 'tablist');
  root.appendChild(navEl);

  const navButtons = new Map<SidebarTabId, HTMLButtonElement>();
  for (const sub of SUB_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lr-sidebar-nav-btn';
    btn.textContent = sub.label;
    btn.title = sub.title;
    btn.dataset['subtab'] = sub.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.addEventListener('click', () => {
      activateSubTab(sub.id);
    });
    navEl.appendChild(btn);
    navButtons.set(sub.id, btn);
  }

  const panelsHost = document.createElement('div');
  panelsHost.className = 'lr-sidebar-panels';
  root.appendChild(panelsHost);

  const panelHosts = new Map<SidebarTabId, HTMLDivElement>();
  const panels = new Map<SidebarTabId, SubPanelHandle>();
  for (const sub of SUB_TABS) {
    const host = document.createElement('div');
    host.className = 'lr-sidebar-panel';
    host.dataset['subtab'] = sub.id;
    host.hidden = true;
    panelsHost.appendChild(host);
    panelHosts.set(sub.id, host);
  }

  let activeSubTab: SidebarTabId = opts.initialTab ?? 'import';
  let cachedActiveChatId: string | null = null;

  function ensurePanelMounted(id: SidebarTabId): SubPanelHandle {
    const existing = panels.get(id);
    if (existing) return existing;
    const host = panelHosts.get(id);
    if (!host) {
      throw new Error(`sidebar: missing host for sub-tab ${id}`);
    }
    let handle: SubPanelHandle;
    switch (id) {
      case 'import': {
        const modulesHandle = mountModulesPanel({
          root: host,
          sendToBackend,
          log,
          mountCharactersHeader: (slotRoot) =>
            mountCardsPanel({
              root: slotRoot,
              ctx,
              sendToBackend,
              log,
              ...(opts.onImportStart ? { onImportStart: opts.onImportStart } : {}),
              ...(opts.onUploadProgress ? { onUploadProgress: opts.onUploadProgress } : {}),
            }),
          ...(opts.onModuleImportStart ? { onImportStart: opts.onModuleImportStart } : {}),
          ...(opts.onUploadProgress ? { onUploadProgress: opts.onUploadProgress } : {}),
        });
        handle = {
          handleBackendMessage(msg) {
            modulesHandle.handleBackendMessage(msg);
          },
          destroy() {
            try { modulesHandle.destroy(); } catch { void 0; }
            try { host.replaceChildren(); } catch { void 0; }
          },
        };
        break;
      }
      case 'viewer':
        handle = mountViewerPanel({ root: host, sendToBackend, log, openWorldBookEditor });
        break;
      case 'state': {
        const subNav = document.createElement('div');
        subNav.className = 'lr-subnav';
        subNav.setAttribute('role', 'tablist');
        host.appendChild(subNav);

        const subPanelsHost = document.createElement('div');
        subPanelsHost.className = 'lr-subnav-panels';
        host.appendChild(subPanelsHost);

        const subBtns = new Map<StateSubTabId, HTMLButtonElement>();
        const subHosts = new Map<StateSubTabId, HTMLDivElement>();
        const subHandles = new Map<StateSubTabId, SubPanelHandle>();
        let activeSub: StateSubTabId = 'variables';

        function activateSub(id: StateSubTabId): void {
          for (const [navId, btn] of subBtns) {
            const sel = navId === id;
            btn.classList.toggle('lr-subnav-btn-active', sel);
            btn.setAttribute('aria-selected', sel ? 'true' : 'false');
          }
          for (const [hostId, h] of subHosts) {
            h.hidden = hostId !== id;
          }
          activeSub = id;
          ensureSubMounted(id);
        }

        function ensureSubMounted(id: StateSubTabId): SubPanelHandle {
          const existing = subHandles.get(id);
          if (existing) return existing;
          const h = subHosts.get(id);
          if (!h) throw new Error(`state-subtab missing host ${id}`);
          let sub: SubPanelHandle;
          switch (id) {
            case 'variables':
              sub = mountVariablesPanel({ root: h, sendToBackend, log });
              if (sub.setActiveChatId) sub.setActiveChatId(cachedActiveChatId);
              break;
            case 'toggles':
              sub = mountTogglesPanel({ root: h, sendToBackend, log });
              if (sub.setActiveChatId) sub.setActiveChatId(cachedActiveChatId);
              break;
            default: {
              const ex: never = id;
              throw new Error(`state-subtab unknown ${ex as string}`);
            }
          }
          subHandles.set(id, sub);
          return sub;
        }

        for (const def of STATE_SUB_TABS) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lr-subnav-btn';
          btn.textContent = def.label;
          btn.title = def.title;
          btn.setAttribute('role', 'tab');
          btn.setAttribute('aria-selected', 'false');
          btn.addEventListener('click', () => activateSub(def.id));
          subNav.appendChild(btn);
          subBtns.set(def.id, btn);

          const subHost = document.createElement('div');
          subHost.className = 'lr-subnav-panel';
          subHost.dataset['subnav'] = def.id;
          subHost.hidden = true;
          subPanelsHost.appendChild(subHost);
          subHosts.set(def.id, subHost);
        }

        ensureSubMounted('variables');
        activateSub(activeSub);

        handle = {
          handleBackendMessage(msg) {
            for (const sub of subHandles.values()) {
              try { sub.handleBackendMessage(msg); } catch (err) { log.error('state subpanel msg threw:', err); }
            }
          },
          setActiveChatId(chatId) {
            for (const sub of subHandles.values()) {
              if (sub.setActiveChatId) {
                try { sub.setActiveChatId(chatId); } catch (err) { log.error('state subpanel chat threw:', err); }
              }
            }
          },
          destroy() {
            for (const sub of subHandles.values()) {
              try { sub.destroy(); } catch { void 0; }
            }
            try { host.replaceChildren(); } catch { void 0; }
          },
        };
        break;
      }
      case 'settings': {
        // Settings tab is self-contained: Auxiliary / Sub / Debug subtabs
        // (logs panel embedded under Debug). See ui/settings-tab.ts.
        const settingsHandle = mountSettingsPanel({ root: host, sendToBackend, log });
        handle = {
          handleBackendMessage(msg) {
            settingsHandle.handleBackendMessage(msg);
          },
          destroy() {
            try { settingsHandle.destroy(); } catch { void 0; }
            try { host.replaceChildren(); } catch { void 0; }
          },
        };
        break;
      }
      default: {
        // Exhaustiveness guard.
        const exhaustive: never = id;
        throw new Error(`sidebar: unknown sub-tab ${exhaustive as string}`);
      }
    }
    panels.set(id, handle);
    log.info(`sidebar: panel mounted id=${id}`);
    return handle;
  }

  function activateSubTab(id: SidebarTabId): void {
    if (id !== activeSubTab) {
      const prevHost = panelHosts.get(activeSubTab);
      if (prevHost) prevHost.hidden = true;
    }
    for (const [navId, btn] of navButtons) {
      const selected = navId === id;
      btn.classList.toggle('lr-sidebar-nav-btn-active', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    activeSubTab = id;
    ensurePanelMounted(id);
    const host = panelHosts.get(id);
    if (host) host.hidden = false;
  }

  // Pre-mount cards so the get_cards round-trip happens at sidebar-open;
  // other panels need the cards list on first render.
  ensurePanelMounted('import');
  activateSubTab(activeSubTab);

  function handleBackendMessage(msg: BackendToFrontend): void {
    if (msg.type === 'open_settings_cleanup') {
      // Open the drawer panel + focus the LumiRealm tab in case the user
      // closed it after dismissing an earlier prompt.
      try { tab.activate(); } catch (err) { log.warn('sidebar: tab.activate threw', err); }
      if (activeSubTab !== 'settings') activateSubTab('settings');
    }
    for (const handle of panels.values()) {
      try {
        handle.handleBackendMessage(msg);
      } catch (err) {
        log.error('sidebar: panel handleBackendMessage threw:', err);
      }
    }
  }

  function setActiveChatId(chatId: string | null): void {
    cachedActiveChatId = chatId;
    for (const handle of panels.values()) {
      if (handle.setActiveChatId) {
        try {
          handle.setActiveChatId(chatId);
        } catch (err) {
          log.error('sidebar: panel setActiveChatId threw:', err);
        }
      }
    }
  }

  function destroy(): void {
    log.info('sidebar: destroy');
    for (const handle of panels.values()) {
      try { handle.destroy(); } catch { /* ignore */ }
    }
    panels.clear();
    try { tab.destroy(); } catch { /* ignore */ }
  }

  return {
    handleBackendMessage,
    setActiveChatId,
    setActiveSubTab: activateSubTab,
    getActiveSubTab: () => activeSubTab,
    headerRoot: headerEl,
    destroy,
  };
}
