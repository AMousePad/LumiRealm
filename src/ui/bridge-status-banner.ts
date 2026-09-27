import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { BackendToFrontend } from '../types/messages.js';
import { filterBridgePermissions } from '../bridge-permissions.js';

// Bottom-right banner driven by phoneline dial outcomes. Non-blocking, since
// bridge perms are not required for core LumiRealm function.

export interface BridgeStatusBannerHandle {
  handleBackendMessage(msg: BackendToFrontend): void;
  destroy(): void;
}

const EXT_LABELS: Readonly<Record<string, string>> = {
  lumiagent: 'LumiAgent',
  lumirealm: 'LumiRealm',
};

function labelFor(id: string | null | undefined): string {
  if (!id) return 'extension';
  return EXT_LABELS[id] ?? id;
}

export function setupBridgeStatusBanner(opts: {
  ctx: SpindleFrontendContext;
  log: { warn: (m: string, ...rest: unknown[]) => void };
}): BridgeStatusBannerHandle {
  const { log } = opts;
  let host: HTMLDivElement | null = null;
  let lastKey: string | null = null;
  const dismissedKeys = new Set<string>();

  function clearBanner(): void {
    if (host) {
      try { host.remove(); } catch { /* */ }
      host = null;
    }
  }

  function makePermChip(text: string): HTMLSpanElement {
    const chip = document.createElement('span');
    chip.className = 'lr-bridge-perm';
    chip.textContent = text;
    Object.assign(chip.style, {
      display: 'inline-block',
      padding: '1px 6px',
      margin: '0 1px',
      background: 'var(--lumiverse-surface-alt, rgba(147, 112, 219, 0.18))',
      color: 'var(--lumiverse-primary, #9370db)',
      borderRadius: '3px',
      fontFamily: 'var(--lumiverse-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      fontSize: '0.9em',
      fontWeight: '600',
    } satisfies Partial<CSSStyleDeclaration>);
    return chip;
  }

  function renderBody(
    body: HTMLDivElement,
    missing: readonly string[],
    missingSide: string,
    otherSide: string,
  ): void {
    body.textContent = '';
    body.appendChild(document.createTextNode(`${missingSide} is missing the `));
    if (missing.length === 1) {
      body.appendChild(document.createTextNode('permission '));
      body.appendChild(makePermChip(missing[0]!));
    } else {
      body.appendChild(document.createTextNode('permissions '));
      missing.forEach((p, i) => {
        if (i > 0) body.appendChild(document.createTextNode(', '));
        body.appendChild(makePermChip(p));
      });
    }
    body.appendChild(document.createTextNode(`, required for ${otherSide} communication. The agent integration will not work until this is granted in Lumiverse's extension panel.`));
  }

  function show(missing: readonly string[], forCaller: string | null): void {
    // On LumiRealm, the failing side is always LumiRealm (the responder is
    // the requester reading caller's request envelope). forCaller names the
    // bridge in the title.
    const missingSide = 'LumiRealm';
    const otherSide = labelFor(forCaller);
    const key = `${otherSide}::${[...missing].sort().join(',')}`;
    if (lastKey === key && host) return;
    lastKey = key;
    if (dismissedKeys.has(key)) {
      clearBanner();
      return;
    }
    clearBanner();
    try {
      host = document.createElement('div');
      host.className = 'lr-bridge-banner';
      Object.assign(host.style, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        maxWidth: '420px',
        background: 'var(--lumiverse-bg-elevated, #1a1a1a)',
        color: 'var(--lumiverse-text, #e5e5e5)',
        border: '1px solid var(--lumiverse-border, #333)',
        borderRadius: '6px',
        padding: '12px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        fontSize: '13px',
        lineHeight: '1.4',
        zIndex: '9999',
      } satisfies Partial<CSSStyleDeclaration>);

      const title = document.createElement('div');
      title.textContent = `${otherSide} bridge offline`;
      Object.assign(title.style, {
        fontWeight: '600',
        marginBottom: '6px',
        color: 'var(--lumiverse-warning, #f0a04b)',
      } satisfies Partial<CSSStyleDeclaration>);
      host.appendChild(title);

      const body = document.createElement('div');
      renderBody(body, missing, missingSide, otherSide);
      Object.assign(body.style, { marginBottom: '10px' } satisfies Partial<CSSStyleDeclaration>);
      host.appendChild(body);

      const actions = document.createElement('div');
      Object.assign(actions.style, {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
      } satisfies Partial<CSSStyleDeclaration>);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Dismiss';
      Object.assign(dismiss.style, {
        background: 'transparent',
        color: 'var(--lumiverse-text-secondary, #aaa)',
        border: '1px solid var(--lumiverse-border, #333)',
        borderRadius: '4px',
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: '12px',
      } satisfies Partial<CSSStyleDeclaration>);
      dismiss.addEventListener('click', () => {
        dismissedKeys.add(key);
        clearBanner();
      });
      actions.appendChild(dismiss);
      host.appendChild(actions);

      document.body.appendChild(host);
    } catch (err) {
      log.warn('bridge-status-banner: render failed', err);
      clearBanner();
    }
  }

  return {
    handleBackendMessage(msg: BackendToFrontend): void {
      if (msg.type !== 'notify_bridge_status') return;
      const missing = filterBridgePermissions(msg.missingPermissions);
      if (!msg.offline || missing.length === 0) {
        lastKey = null;
        dismissedKeys.clear();
        clearBanner();
        return;
      }
      show(missing, msg.forCaller ?? null);
    },
    destroy(): void {
      clearBanner();
    },
  };
}
