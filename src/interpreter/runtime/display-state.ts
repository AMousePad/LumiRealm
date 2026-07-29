// V2 trigger displayState / requestState opcodes. Dispatch-scoped; not persisted.

import { toStr } from '../../util/coerce.js';

export interface DisplayStateApi {
  getDisplayState(): string;
  setDisplayState(v: unknown): void;
  getRequestState(i: unknown): string;
  setRequestState(i: unknown, v: unknown): void;
  getRequestStateRole(i: unknown): string;
  setRequestStateRole(i: unknown, v: unknown): void;
  getRequestStateLength(): number;
  getRequestStateMessages(): readonly {
    readonly role: string;
    readonly content: string;
  }[];
}

export function makeDisplayStateApi(
  initialDisplayState: unknown = '',
  initialRequestState: readonly { readonly role: string; readonly content: string }[] = [],
): DisplayStateApi {
  const displayState: { text: string } = { text: toStr(initialDisplayState) };
  const requestState: { role: string; content: string }[] =
    initialRequestState.map((message) => ({
      role: toStr(message.role),
      content: toStr(message.content),
    }));

  return {
    getDisplayState(): string { return displayState.text; },
    setDisplayState(v: unknown): void { displayState.text = toStr(v); },
    getRequestState(i: unknown): string {
      return requestState[Number(i)]?.content ?? 'null';
    },
    setRequestState(i: unknown, v: unknown): void {
      const n = Number(i);
      if (!requestState[n]) throw new RangeError(`request state index out of range: ${n}`);
      requestState[n] = { ...requestState[n]!, content: toStr(v) };
    },
    getRequestStateRole(i: unknown): string {
      return requestState[Number(i)]?.role ?? 'null';
    },
    setRequestStateRole(i: unknown, v: unknown): void {
      const n = Number(i);
      if (!requestState[n]) throw new RangeError(`request state index out of range: ${n}`);
      const role = toStr(v);
      if (role !== 'user' && role !== 'assistant' && role !== 'system') return;
      requestState[n] = { ...requestState[n]!, role };
    },
    getRequestStateLength(): number { return requestState.length; },
    getRequestStateMessages: () => requestState.map((message) => ({ ...message })),
  };
}
