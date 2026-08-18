import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type {
  RealmCard,
  RealmFrontendToBackend,
  RealmBackendToFrontend,
  RealmSort,
} from './messages.js';
import { realmResourceUrl, realmShareUrl } from './messages.js';
import { extractRealmId } from './api.js';
import { REALM_STYLES } from './styles.js';
import { renderDescription } from './markdown.js';

export interface RealmFrontendLog {
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

export interface RealmFrontendDeps {
  readonly ctx: SpindleFrontendContext;
  readonly sendToBackend: (msg: RealmFrontendToBackend) => void;
  readonly log: RealmFrontendLog;
  readonly mountTarget: HTMLElement;
  readonly onImportStart?: (label: string, onCancel?: () => void, totalBytes?: number) => void;
}

export interface RealmFrontendHandle {
  open(): void;
  close(): void;
  isOpen(): boolean;
  handleBackendMessage(msg: RealmBackendToFrontend): void;
  destroy(): void;
}

export function isRealmBackendMessage(msg: { type: string }): msg is RealmBackendToFrontend {
  return (
    msg.type === 'realm_search_result' ||
    msg.type === 'realm_info_result' ||
    msg.type === 'realm_download_started'
  );
}

interface UiState {
  search: string;
  page: number;
  sort: RealmSort;
  nsfw: boolean;
  loading: boolean;
  cards: readonly RealmCard[];
  additionalHTML: string;
  errorText: string;
  selected: RealmCard | null;
  promptOpen: boolean;
  downloading: boolean;
  pendingSearchReq: string | null;
  pendingInfoReq: string | null;
  pendingDownloadReq: string | null;
}

const ICON_HUB =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14.4 14.4 0 0 1 0 18M12 3a14.4 14.4 0 0 0 0 18"/></svg>';

const ICON_SEARCH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

const ICON_LEFT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>';

const ICON_RIGHT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>';

const SEARCH_DEBOUNCE_MS = 350;
const TOAST_DURATION_MS = 4000;

const MODAL_MAX_WIDTH = 1357;
const MODAL_MAX_HEIGHT_CAP = 1600;
const MODAL_VIEWPORT_MARGIN = 32;

function computeModalWidth(): number {
  const vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1180;
  return Math.max(640, Math.min(MODAL_MAX_WIDTH, vw - MODAL_VIEWPORT_MARGIN * 2));
}

function computeModalMaxHeight(): number {
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 880;
  return Math.max(400, Math.min(MODAL_MAX_HEIGHT_CAP, vh - MODAL_VIEWPORT_MARGIN * 2));
}

interface ModalSurface {
  readonly handle: { dismiss(): void; root: HTMLElement };
  readonly bodyEl: HTMLDivElement;
  readonly toolbarEl: HTMLDivElement;
  readonly searchInputEl: HTMLInputElement;
  readonly sortBtns: ReadonlyMap<RealmSort, HTMLButtonElement>;
  readonly nsfwBtn: HTMLButtonElement;
  readonly additionalEl: HTMLDivElement;
}

export function setupRealmModal(deps: RealmFrontendDeps): RealmFrontendHandle {
  const { ctx, sendToBackend, log } = deps;
  const cleanups: (() => void)[] = [];
  cleanups.push(ctx.dom.addStyle(REALM_STYLES));

  const state: UiState = {
    search: '',
    page: 0,
    sort: 'recommended',
    nsfw: false,
    loading: false,
    cards: [],
    additionalHTML: '',
    errorText: '',
    selected: null,
    promptOpen: false,
    downloading: false,
    pendingSearchReq: null,
    pendingInfoReq: null,
    pendingDownloadReq: null,
  };

  let surface: ModalSurface | null = null;
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastEl: HTMLDivElement | null = null;
  let popupOverlay: HTMLElement | null = null;
  let promptOverlay: HTMLElement | null = null;

  const launchBtn = document.createElement('button');
  launchBtn.type = 'button';
  launchBtn.className = 'lr-realm-launcher';
  launchBtn.title = 'Browse RisuRealm characters';
  const launchIcon = document.createElement('span');
  launchIcon.className = 'lr-realm-launcher-icon';
  launchIcon.innerHTML = ICON_HUB;
  const launchLabel = document.createElement('span');
  launchLabel.textContent = 'Browse RisuRealm';
  launchBtn.append(launchIcon, launchLabel);
  launchBtn.addEventListener('click', () => open());
  deps.mountTarget.appendChild(launchBtn);
  cleanups.push(() => launchBtn.remove());

  function open(): void {
    if (surface) return;
    log.info('realm: opening modal');
    let modalHandle: ReturnType<typeof ctx.ui.showModal>;
    try {
      modalHandle = ctx.ui.showModal({
        title: 'RisuRealm',
        width: computeModalWidth(),
        maxHeight: computeModalMaxHeight(),
      });
    } catch (err) {
      log.error('realm: showModal failed:', err);
      return;
    }

    const root = document.createElement('div');
    root.className = 'lr-realm-root';
    modalHandle.root.appendChild(root);

    const toolbar = document.createElement('div');
    toolbar.className = 'lr-realm-toolbar';
    root.appendChild(toolbar);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'lr-realm-search';
    toolbar.appendChild(searchWrap);

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search RisuRealm…';
    searchInput.value = state.search;
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.page = 0;
        if (state.sort === 'recommended' || state.sort === 'random') {
          state.sort = '';
        }
        doSearch();
      }, SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        state.page = 0;
        if (state.sort === 'recommended' || state.sort === 'random') {
          state.sort = '';
        }
        doSearch();
      }
    });
    searchWrap.appendChild(searchInput);

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.title = 'Search';
    searchBtn.innerHTML = ICON_SEARCH;
    searchBtn.addEventListener('click', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      state.page = 0;
      if (state.sort === 'recommended' || state.sort === 'random') {
        state.sort = '';
      }
      doSearch();
    });
    searchWrap.appendChild(searchBtn);

    const SORTS: readonly { id: RealmSort; label: string }[] = [
      { id: 'recommended', label: 'Recommended' },
      { id: '', label: 'Recent' },
      { id: 'trending', label: 'Trending' },
      { id: 'downloads', label: 'Downloads' },
      { id: 'random', label: 'Random' },
    ];
    const sortBtns = new Map<RealmSort, HTMLButtonElement>();
    const sortRow = document.createElement('div');
    sortRow.className = 'lr-realm-sort';
    toolbar.appendChild(sortRow);
    for (const s of SORTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lr-realm-pill';
      b.textContent = s.label;
      b.addEventListener('click', () => {
        const next: RealmSort = state.sort === s.id ? 'recommended' : s.id;
        state.sort = next;
        if (next === 'recommended' && state.nsfw) state.nsfw = false;
        state.page = 0;
        doSearch();
      });
      sortRow.appendChild(b);
      sortBtns.set(s.id, b);
    }

    const nsfwBtn = document.createElement('button');
    nsfwBtn.type = 'button';
    nsfwBtn.className = 'lr-realm-pill danger';
    nsfwBtn.textContent = 'NSFW';
    nsfwBtn.addEventListener('click', () => {
      state.nsfw = !state.nsfw;
      if (state.nsfw && state.sort === 'recommended') state.sort = 'trending';
      state.page = 0;
      doSearch();
    });
    toolbar.appendChild(nsfwBtn);

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'lr-realm-secondary';
    importBtn.textContent = 'Import by URL/ID';
    importBtn.addEventListener('click', () => {
      state.promptOpen = true;
      render();
    });
    toolbar.appendChild(importBtn);

    const additionalEl = document.createElement('div');
    additionalEl.className = 'lr-realm-additional';
    additionalEl.hidden = true;
    root.appendChild(additionalEl);

    const body = document.createElement('div');
    body.className = 'lr-realm-body';
    root.appendChild(body);

    surface = {
      handle: modalHandle,
      bodyEl: body,
      toolbarEl: toolbar,
      searchInputEl: searchInput,
      sortBtns,
      nsfwBtn,
      additionalEl,
    };

    modalHandle.onDismiss(() => {
      log.info('realm: modal dismissed');
      surface = null;
      state.selected = null;
      state.promptOpen = false;
      popupOverlay?.remove();
      popupOverlay = null;
      promptOverlay?.remove();
      promptOverlay = null;
      if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = undefined;
      }
      toastEl?.remove();
      toastEl = null;
    });

    if (state.cards.length === 0 && !state.loading) {
      doSearch();
    } else {
      render();
    }
  }

  function close(): void {
    surface?.handle.dismiss();
  }

  function render(): void {
    if (!surface) return;
    const { sortBtns, nsfwBtn, additionalEl, bodyEl } = surface;

    nsfwBtn.classList.toggle('active', state.nsfw);
    for (const [id, btn] of sortBtns) {
      btn.classList.toggle('active', id === state.sort);
    }

    additionalEl.hidden = true;
    additionalEl.textContent = '';

    bodyEl.replaceChildren();
    if (state.loading) {
      const status = document.createElement('div');
      status.className = 'lr-realm-status';
      const spinner = document.createElement('span');
      spinner.className = 'lr-realm-spinner';
      const label = document.createElement('span');
      label.textContent = 'Loading…';
      status.append(spinner, label);
      bodyEl.appendChild(status);
    } else if (state.errorText.length > 0) {
      const status = document.createElement('div');
      status.className = 'lr-realm-status error';
      status.textContent = state.errorText;
      bodyEl.appendChild(status);
    } else if (state.cards.length === 0) {
      const status = document.createElement('div');
      status.className = 'lr-realm-status';
      status.textContent = 'No characters found.';
      bodyEl.appendChild(status);
    } else {
      const grid = document.createElement('div');
      grid.className = 'lr-realm-grid';
      for (const card of state.cards) {
        grid.appendChild(renderCard(card));
      }
      bodyEl.appendChild(grid);
      if (state.sort !== 'random' && state.sort !== 'recommended') {
        bodyEl.appendChild(renderPager());
      }
    }

    if (toastEl) bodyEl.appendChild(toastEl);
    syncOverlays();
  }

  function syncOverlays(): void {
    if (state.selected) {
      if (popupOverlay) popupOverlay.remove();
      const next = renderPopup(state.selected);
      document.body.appendChild(next);
      popupOverlay = next;
    } else if (popupOverlay) {
      popupOverlay.remove();
      popupOverlay = null;
    }
    if (state.promptOpen) {
      if (promptOverlay) promptOverlay.remove();
      const next = renderPrompt();
      document.body.appendChild(next);
      promptOverlay = next;
    } else if (promptOverlay) {
      promptOverlay.remove();
      promptOverlay = null;
    }
  }

  function renderCard(card: RealmCard): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lr-realm-card';
    btn.addEventListener('click', () => {
      state.selected = card;
      render();
    });

    if (card.img && card.img.length > 0) {
      const img = document.createElement('img');
      img.className = 'lr-realm-thumb';
      img.alt = card.name;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = realmResourceUrl(card.img);
      img.addEventListener('error', () => {
        const fb = document.createElement('div');
        fb.className = 'lr-realm-thumb-fallback';
        fb.textContent = '?';
        img.replaceWith(fb);
      });
      btn.appendChild(img);
    } else {
      const fb = document.createElement('div');
      fb.className = 'lr-realm-thumb-fallback';
      fb.textContent = '?';
      btn.appendChild(fb);
    }

    const bodyEl = document.createElement('div');
    bodyEl.className = 'lr-realm-card-body';
    btn.appendChild(bodyEl);

    const name = document.createElement('div');
    name.className = 'lr-realm-card-name';
    name.textContent = card.name || '(unnamed)';
    bodyEl.appendChild(name);

    const desc = document.createElement('div');
    desc.className = 'lr-realm-card-desc';
    desc.textContent = pickDescription(card.desc);
    bodyEl.appendChild(desc);

    if (card.tags && card.tags.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'lr-realm-tags';
      const visible = card.tags.slice(0, 5);
      for (const t of visible) {
        const tag = document.createElement('span');
        tag.className = 'lr-realm-tag';
        tag.textContent = t;
        tags.appendChild(tag);
      }
      if (card.tags.length > visible.length) {
        const more = document.createElement('span');
        more.className = 'lr-realm-tag';
        more.textContent = `+${card.tags.length - visible.length}`;
        tags.appendChild(more);
      }
      bodyEl.appendChild(tags);
    }

    const stats = document.createElement('div');
    stats.className = 'lr-realm-card-stats';
    const featureLabels: string[] = [];
    if (card.hasLore) featureLabels.push('Lorebook');
    if (card.hasEmotion) featureLabels.push('Emotion');
    if (card.hasAsset) featureLabels.push('Assets');
    const featurePart = featureLabels.length > 0 ? ` · ${featureLabels.join(' · ')}` : '';
    stats.textContent = `↓ ${card.download ?? 0}${featurePart}`;
    bodyEl.appendChild(stats);

    return btn;
  }

  function renderPager(): HTMLElement {
    const pager = document.createElement('div');
    pager.className = 'lr-realm-pager';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.title = 'Previous page';
    prev.disabled = state.page === 0;
    prev.innerHTML = ICON_LEFT;
    prev.addEventListener('click', () => {
      if (state.page > 0) {
        state.page -= 1;
        doSearch();
      }
    });
    pager.appendChild(prev);

    const label = document.createElement('div');
    label.className = 'lr-realm-pager-page';
    label.textContent = String(state.page + 1);
    pager.appendChild(label);

    const next = document.createElement('button');
    next.type = 'button';
    next.title = 'Next page';
    next.innerHTML = ICON_RIGHT;
    next.addEventListener('click', () => {
      state.page += 1;
      doSearch();
    });
    pager.appendChild(next);
    return pager;
  }

  function renderPopup(card: RealmCard): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'lr-realm-popup-overlay';
    let pointerDownOnOverlay = false;
    wrap.addEventListener('pointerdown', (ev) => {
      pointerDownOnOverlay = ev.target === wrap;
    });
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap && pointerDownOnOverlay) {
        state.selected = null;
        render();
      }
    });

    const popup = document.createElement('div');
    popup.className = 'lr-realm-popup';
    wrap.appendChild(popup);

    const headerRow = document.createElement('div');
    headerRow.className = 'lr-realm-popup-header';
    popup.appendChild(headerRow);

    if (card.img) {
      const img = document.createElement('img');
      img.className = 'lr-realm-popup-thumb';
      img.alt = card.name;
      img.referrerPolicy = 'no-referrer';
      img.src = realmResourceUrl(card.img);
      headerRow.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'lr-realm-popup-info';
    headerRow.appendChild(info);

    const name = document.createElement('div');
    name.className = 'lr-realm-popup-name';
    name.textContent = card.name || '(unnamed)';
    info.appendChild(name);

    if (card.authorname) {
      const author = document.createElement('div');
      author.className = 'lr-realm-popup-author';
      author.textContent = `by ${card.authorname}`;
      info.appendChild(author);
    }

    if (card.tags && card.tags.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'lr-realm-tags';
      for (const t of card.tags) {
        const tag = document.createElement('span');
        tag.className = 'lr-realm-tag';
        tag.textContent = t;
        tags.appendChild(tag);
      }
      info.appendChild(tags);
    }

    const featureRow = document.createElement('div');
    featureRow.className = 'lr-realm-popup-author';
    const featureBits: string[] = [`↓ ${card.download ?? 0}`];
    if (card.hasLore) featureBits.push('Lorebook');
    if (card.hasEmotion) featureBits.push('Emotion');
    if (card.hasAsset) featureBits.push('Assets');
    if (card.viewScreen && card.viewScreen !== 'none') featureBits.push(`view: ${card.viewScreen}`);
    featureRow.textContent = featureBits.join(' · ');
    info.appendChild(featureRow);

    if (card.license && card.license.length > 0) {
      const lic = document.createElement('div');
      lic.className = 'lr-realm-popup-license';
      lic.textContent = `License: ${card.license}`;
      info.appendChild(lic);
    }

    const desc = document.createElement('div');
    desc.className = 'lr-realm-popup-desc';
    desc.appendChild(renderDescription(pickDescription(card.desc)));
    popup.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'lr-realm-popup-actions';
    popup.appendChild(actions);

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'lr-realm-primary';
    importBtn.disabled = state.downloading;
    if (state.downloading) {
      const spin = document.createElement('span');
      spin.className = 'lr-realm-spinner';
      const lbl = document.createElement('span');
      lbl.textContent = 'Downloading…';
      importBtn.append(spin, lbl);
    } else {
      importBtn.textContent = 'Import to Lumiverse';
    }
    importBtn.addEventListener('click', () => {
      if (state.downloading) return;
      doDownload(card.id);
    });
    actions.appendChild(importBtn);

    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = 'lr-realm-secondary';
    linkBtn.textContent = 'Copy share link';
    linkBtn.addEventListener('click', () => {
      const url = realmShareUrl(card.id);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => showToast('Share link copied'),
          () => showToast('Copy failed', true),
        );
      } else {
        showToast(url);
      }
    });
    actions.appendChild(linkBtn);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lr-realm-secondary';
    cancel.textContent = 'Close';
    cancel.addEventListener('click', () => {
      state.selected = null;
      render();
    });
    actions.appendChild(cancel);

    return wrap;
  }

  function renderPrompt(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'lr-realm-prompt-overlay';
    let pointerDownOnOverlay = false;
    wrap.addEventListener('pointerdown', (ev) => {
      pointerDownOnOverlay = ev.target === wrap;
    });
    wrap.addEventListener('click', (ev) => {
      if (ev.target === wrap && pointerDownOnOverlay) {
        state.promptOpen = false;
        render();
      }
    });

    const promptEl = document.createElement('div');
    promptEl.className = 'lr-realm-prompt';
    wrap.appendChild(promptEl);

    const heading = document.createElement('div');
    heading.style.fontWeight = '600';
    heading.textContent = 'Import character from URL or ID';
    promptEl.appendChild(heading);

    const input = document.createElement('input');
    input.placeholder = 'realm.risuai.net/character/… or character id';
    promptEl.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'lr-realm-prompt-actions';
    promptEl.appendChild(actions);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'lr-realm-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      state.promptOpen = false;
      render();
    });
    actions.appendChild(cancel);

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'lr-realm-primary';
    ok.textContent = 'Import';
    const submit = (): void => {
      const id = extractRealmId(input.value);
      if (!id) {
        showToast('Could not parse URL or ID', true);
        return;
      }
      state.promptOpen = false;
      doDownload(id);
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') submit();
    });
    actions.appendChild(ok);

    setTimeout(() => input.focus(), 0);
    return wrap;
  }

  function showToast(message: string, isError = false): void {
    if (!surface) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastEl?.remove();
    toastEl = document.createElement('div');
    toastEl.className = isError ? 'lr-realm-toast error' : 'lr-realm-toast';
    toastEl.textContent = message;
    surface.bodyEl.appendChild(toastEl);
    toastTimer = setTimeout(() => {
      toastEl?.remove();
      toastEl = null;
      toastTimer = undefined;
    }, TOAST_DURATION_MS);
  }

  function pickDescription(raw: string): string {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (trimmed.length === 0) return '';
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, string>;
        const lang =
          (typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : 'en') ?? 'en';
        return obj[lang] ?? obj.en ?? obj.xx ?? Object.values(obj)[0] ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  function nextRequestId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function doSearch(): void {
    state.loading = true;
    state.errorText = '';
    const requestId = nextRequestId('search');
    state.pendingSearchReq = requestId;
    log.info(
      `realm modal: search req=${requestId} q=${JSON.stringify(state.search)} page=${state.page} sort=${state.sort} nsfw=${state.nsfw}`,
    );
    sendToBackend({
      type: 'realm_search',
      requestId,
      search: state.search,
      page: state.page,
      nsfw: state.nsfw,
      sort: state.sort,
    });
    render();
  }

  function doDownload(id: string): void {
    if (state.downloading) return;
    state.downloading = true;
    const requestId = nextRequestId('download');
    state.pendingDownloadReq = requestId;
    log.info(`realm modal: download req=${requestId} id=${id}`);
    const label = state.selected?.name || `RisuRealm character ${id}`;
    deps.onImportStart?.(label);
    sendToBackend({ type: 'realm_download', requestId, id });
    // The blocking import overlay sits above this modal. Keep the Realm
    // surface mounted underneath so the browsing session resumes when the
    // import finishes and the overlay hides.
  }

  function handleBackendMessage(msg: RealmBackendToFrontend): void {
    switch (msg.type) {
      case 'realm_search_result': {
        if (state.pendingSearchReq && msg.requestId !== state.pendingSearchReq) return;
        state.pendingSearchReq = null;
        state.loading = false;
        if (msg.ok) {
          state.cards = msg.cards;
          state.errorText = '';
          state.additionalHTML = msg.additionalHTML ?? '';
        } else {
          state.cards = [];
          state.errorText = msg.error ?? 'Search failed';
          state.additionalHTML = '';
        }
        render();
        break;
      }
      case 'realm_info_result': {
        if (state.pendingInfoReq && msg.requestId !== state.pendingInfoReq) return;
        state.pendingInfoReq = null;
        if (msg.ok && msg.info) {
          state.selected = msg.info;
          if (!surface) open();
          render();
        } else {
          showToast(msg.error ?? 'Lookup failed', true);
        }
        break;
      }
      case 'realm_download_started': {
        if (state.pendingDownloadReq && msg.requestId !== state.pendingDownloadReq) return;
        state.pendingDownloadReq = null;
        state.downloading = false;
        if (msg.ok) {
          showToast('Downloaded — translating now…');
          state.selected = null;
          render();
        } else {
          showToast(msg.error ?? 'Download failed', true);
          render();
        }
        break;
      }
    }
  }

  const onKeyDownCapture = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    if (state.promptOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      state.promptOpen = false;
      render();
      return;
    }
    if (state.selected) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      state.selected = null;
      render();
    }
  };
  document.addEventListener('keydown', onKeyDownCapture, /* capture */ true);
  cleanups.push(() => document.removeEventListener('keydown', onKeyDownCapture, /* capture */ true));

  function destroy(): void {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (toastTimer) clearTimeout(toastTimer);
    surface?.handle.dismiss();
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        void 0;
      }
    }
  }

  return {
    open,
    close,
    isOpen: () => surface !== null,
    handleBackendMessage,
    destroy,
  };
}
