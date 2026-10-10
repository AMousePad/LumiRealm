// Console shim, DOM/CSS snapshot, bundle download.
// Pairs with store.ts and the backend log_request_export round-trip.

import { logStore, redact } from './store.js';
import type { LogEventWire } from '../types/messages.js';
import { isLogTransportNoise } from './transport.js';

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

let consoleShimInstalled = false;
const originalConsole: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

function methodToLevel(m: ConsoleMethod): 'error' | 'warn' | 'info' | 'debug' | 'trace' {
  if (m === 'warn') return 'warn';
  if (m === 'error') return 'error';
  if (m === 'debug') return 'debug';
  if (m === 'info') return 'info';
  return 'trace';
}

export function installConsoleCapture(): void {
  if (consoleShimInstalled) return;
  for (const m of CONSOLE_METHODS) {
    const original = console[m] as (...args: unknown[]) => void;
    originalConsole[m] = original.bind(console);
    (console as unknown as Record<string, (...args: unknown[]) => void>)[m] = (...args: unknown[]) => {
      try { originalConsole[m]?.(...args); } catch { /* */ }
      try {
        const level = methodToLevel(m);
        if (!logStore.shouldEmit(level)) return;
        if (typeof args[0] === 'string' && (args[0].startsWith('[lumirealm] ')
          || (args[0] === '[lumirealm]' && args.length > 1))) return;
        if (args[0] === '[WS] ←' && args[1] === 'SPINDLE_FRONTEND_MSG') {
          const payload = args[2] as { identifier?: string; data?: { type?: string } } | undefined;
          if (payload?.identifier === 'lumirealm' && isLogTransportNoise(payload.data?.type ?? '')) return;
        }
        const text = args.map(formatArg).join(' ');
        if (text.startsWith('[lumirealm] ')) return;
        logStore.push(level, 'console', text);
      } catch { /* never throw from console */ }
    };
  }
  consoleShimInstalled = true;
}

export function removeConsoleCapture(): void {
  if (!consoleShimInstalled) return;
  for (const m of CONSOLE_METHODS) {
    const original = originalConsole[m];
    if (original) (console as unknown as Record<string, (...args: unknown[]) => void>)[m] = original;
  }
  consoleShimInstalled = false;
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try { return JSON.stringify(a); } catch { return String(a); }
}

const DOM_ALLOWLIST: readonly string[] = [
  '[data-risu-bg-host]',
  '[data-message-id]',
];

const CREDENTIAL_INPUT_PATTERNS = [
  /\bapi[-_ ]?key\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
];

function isCredentialInput(el: Element): boolean {
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
  const t = el.getAttribute('type')?.toLowerCase() ?? '';
  if (t === 'password') return true;
  const haystack = `${el.getAttribute('name') ?? ''} ${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  return CREDENTIAL_INPUT_PATTERNS.some((re) => re.test(haystack));
}

function sanitizeNode(node: Node): void {
  if (!(node instanceof Element)) return;
  if (isCredentialInput(node)) {
    node.setAttribute('value', '[REDACTED]');
    if ('value' in node) (node as HTMLInputElement).value = '[REDACTED]';
    node.setAttribute('data-lumirealm-redacted', 'credential');
  }
  if ((node as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot) {
    const root = (node as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (root) {
      for (const child of Array.from(root.children)) sanitizeNode(child);
    }
  }
  for (const child of Array.from(node.childNodes)) sanitizeNode(child);
}

export function captureDomSnapshot(includeChatData: boolean): string | null {
  if (!includeChatData) return null;
  const fragments: string[] = [];
  const seen = new WeakSet<Element>();
  for (const sel of DOM_ALLOWLIST) {
    const matches = document.querySelectorAll(sel);
    for (const el of Array.from(matches)) {
      if (seen.has(el)) continue;
      seen.add(el);
      try {
        const cloned = el.cloneNode(true) as Element;
        sanitizeNode(cloned);
        fragments.push(`<!-- ${sel} -->\n${cloned.outerHTML}`);
      } catch { /* skip on serialization errors */ }
    }
  }
  return fragments.length > 0 ? fragments.join('\n\n') : null;
}

export interface StylesheetCapture {
  readonly source: string;
  readonly css: string;
}

export function captureStylesheets(): readonly StylesheetCapture[] {
  const out: StylesheetCapture[] = [];
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i];
    if (!sheet) continue;
    const source = sheet.href ?? `inline:${i}`;
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      const css = Array.from(rules).map((r) => r.cssText).join('\n');
      out.push({ source, css });
    } catch {
      out.push({ source, css: '/* cross-origin sheet — rules inaccessible */' });
    }
  }
  return out;
}

export interface BundleSession {
  readonly extensionVersion: string;
  readonly userId: string | null;
  readonly activeChatId: string | null;
  readonly activeCharacterId: string | null;
  readonly userAgent: string;
  readonly url: string;
  readonly viewport: { width: number; height: number };
}

export interface LogBundle {
  readonly schema: 'lumirealm-log-v1';
  readonly exportedAt: string;
  readonly mode: { enabled: boolean; includeChatData: boolean };
  readonly session: BundleSession;
  readonly events: {
    readonly backend: readonly LogEventWire[];
    readonly frontend: readonly LogEventWire[];
  };
  readonly domSnapshot: string | null;
  readonly stylesheets: readonly StylesheetCapture[];
}

export function buildBundle(args: {
  backendEvents: readonly LogEventWire[];
  session: Omit<BundleSession, 'userAgent' | 'url' | 'viewport'>;
  includeChatData: boolean;
}): LogBundle {
  const snap = logStore.snapshot();
  const frontendEvents: LogEventWire[] = snap.events.map((e) => ({
    ts: e.ts, level: e.level, category: e.category,
    message: !args.includeChatData ? redact(e.message) : e.message,
  }));
  return {
    schema: 'lumirealm-log-v1',
    exportedAt: new Date().toISOString(),
    mode: { enabled: true, includeChatData: args.includeChatData },
    session: {
      ...args.session,
      userAgent: navigator.userAgent,
      url: location.href,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    events: { backend: args.backendEvents, frontend: frontendEvents },
    domSnapshot: captureDomSnapshot(args.includeChatData),
    stylesheets: captureStylesheets(),
  };
}

export function downloadBundle(bundle: LogBundle): void {
  const { events, ...metadata } = bundle;
  const parts: BlobPart[] = [JSON.stringify(metadata, null, 2).slice(0, -1), ',"events":{'];
  const encoder = new TextEncoder();
  // Encode each record separately so the export need not fit in one JavaScript string.
  for (const [index, source] of (['backend', 'frontend'] as const).entries()) {
    parts.push(`${index ? ',' : ''}"${source}":[`);
    for (const [i, event] of events[source].entries()) {
      if (i) parts.push(',');
      parts.push(encoder.encode(JSON.stringify(event, null, 2)));
    }
    parts.push(']');
  }
  parts.push('}}');
  const blob = new Blob(parts, { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `lumirealm-log-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
