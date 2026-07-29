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
}

export function makeDisplayStateApi(initialDisplayState: unknown = ''): DisplayStateApi {
  const displayState: { text: string } = { text: toStr(initialDisplayState) };
  const requestState: { role: string; content: string }[] = [];

  return {
    getDisplayState(): string { return displayState.text; },
    setDisplayState(v: unknown): void { displayState.text = toStr(v); },
    getRequestState(i: unknown): string { return toStr(requestState[Number(i)]?.content ?? ''); },
    setRequestState(i: unknown, v: unknown): void {
      const n = Number(i);
      while (requestState.length <= n) requestState.push({ role: 'user', content: '' });
      requestState[n] = { ...requestState[n]!, content: toStr(v) };
    },
    getRequestStateRole(i: unknown): string { return toStr(requestState[Number(i)]?.role ?? ''); },
    setRequestStateRole(i: unknown, v: unknown): void {
      const n = Number(i);
      while (requestState.length <= n) requestState.push({ role: 'user', content: '' });
      requestState[n] = { ...requestState[n]!, role: toStr(v) };
    },
    getRequestStateLength(): number { return requestState.length; },
  };
}
