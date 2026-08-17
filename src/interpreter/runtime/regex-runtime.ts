// Risu scripts.ts. @@-action regex runtime.

import { toStr } from '../../util/coerce.js';
import { applyMatchTemplate } from './match-template.js';
import type {
  HostApi,
  DispatchData,
  ScriptNS,
  RegexRuntimeOpts,
} from '../host.js';

export interface RisuRegexRuntime {
  text(): string;
  setCurrentText(t: unknown): Promise<void>;
  setExpression(name: unknown): Promise<void>;
  inject(content: unknown): Promise<void>;
  repeatBack(regex: RegExp, mode?: string): Promise<void>;
  applyMatchTemplate(template: string, match: RegExpMatchArray | null): string;
  flush(): Promise<void>;
}

export async function makeRisuRegexRuntime(
  api: HostApi,
  data: DispatchData,
  scriptNs: ScriptNS,
  opts: RegexRuntimeOpts = {},
): Promise<RisuRegexRuntime> {
  void scriptNs; void opts;
  let currentText = toStr((data && (data.content || data.message || data.text)) ?? '');
  let dirty = false;

  function text(): string { return currentText; }
  async function setCurrentText(t: unknown): Promise<void> { currentText = toStr(t); dirty = true; }

  async function setExpression(name: unknown): Promise<void> {
    try {
      if (api.characters.setExpression) {
        await api.characters.setExpression(toStr(name));
      } else if (api.chat.setExpression) {
        await api.chat.setExpression(toStr(name));
      } else if (api.broadcast?.emit) {
        api.broadcast.emit('risu:emotion', { name: toStr(name) });
      }
    } catch { /* */ }
  }

  async function inject(content: unknown): Promise<void> {
    try {
      await api.chat.inject(
        'risu-inject-' + Math.random().toString(36).slice(2, 8),
        toStr(content),
        { mode: 'context', role: 'system' },
      );
    } catch { /* */ }
  }

  async function repeatBack(regex: RegExp, mode?: string): Promise<void> {
    try {
      const msgs = await api.chat.getMessages();
      const recent = msgs.slice(-10);
      for (let i = recent.length - 1; i >= 0; i--) {
        const m = toStr(recent[i]!.content).match(regex);
        if (!m) continue;
        const piece = m[0];
        const suffix = toStr(mode || '').toLowerCase();
        const endNl = suffix === 'end_nl' || suffix === 'start_nl';
        const atStart = suffix === 'start' || suffix === 'start_nl';
        const tail = endNl ? '\n' : '';
        currentText = atStart ? (piece + tail + currentText) : (currentText + tail + piece);
        dirty = true;
        break;
      }
    } catch { /* */ }
  }

  async function flush(): Promise<void> {
    if (dirty && data && typeof data === 'object') {
      try { (data as { content?: string }).content = currentText; } catch { /* */ }
    }
  }

  return {
    text, setCurrentText, setExpression, inject, repeatBack,
    applyMatchTemplate,
    flush,
  };
}
