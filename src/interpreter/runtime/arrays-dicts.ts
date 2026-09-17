// Risu runTrigger stores collections as JSON in ordinary chat variables.

import { toStr } from '../../util/coerce.js';
import type { VarsApi } from './vars.js';

export interface ArraysDictsApi {
  makeArrayVar(name: string): void;
  arrayLength(name: string): string;
  arrayGet(name: string, i: unknown): string;
  arraySet(name: string, i: unknown, v: unknown): void;
  arrayPush(name: string, v: unknown): void;
  arrayPop(name: string): string;
  arrayShift(name: string): string;
  arrayUnshift(name: string, v: unknown): void;
  arraySplice(name: string, start: unknown, item: unknown): void;
  arraySlice(name: string, start: unknown, end: unknown): string;
  arrayJoin(name: string, delim: unknown): string;
  arrayIndexOf(name: string, v: unknown): number;
  arrayRemoveIndex(name: string, i: unknown): void;
  makeDictVar(name: string): void;
  dictGet(name: string, k: unknown): string;
  dictSet(name: string, k: unknown, v: unknown): void;
  dictDelete(name: string, k: unknown): void;
  dictHasKey(name: string, k: unknown): boolean;
  dictClear(name: string): void;
  dictSize(name: string): number;
  dictKeys(name: string): string[];
  dictValues(name: string): unknown[];
}

export function makeArraysDictsApi(vars: VarsApi): ArraysDictsApi {
  // Risu applies native operations to parsed JSON, including non-collection values.
  function read<T>(json: string, operation: (value: any) => T, fallback: T): T {
    try { return operation(JSON.parse(json)); }
    catch { return fallback; }
  }
  function changeArray<T>(name: string, operation: (value: any) => T, fallback: T, reset = true): T {
    try {
      const value = JSON.parse(vars.getVar(name));
      const result = operation(value);
      vars.setVar(name, JSON.stringify(value));
      return result;
    } catch {
      if (reset) vars.setVar(name, '[]');
      return fallback;
    }
  }
  function dictSet(name: string, key: unknown, value: unknown): void {
    const k = toStr(key), v = toStr(value);
    let dict: any;
    try {
      dict = JSON.parse(vars.getVar(name));
      dict[k] = v;
    } catch {
      dict = {};
      dict[k] = v;
    }
    vars.setVar(name, JSON.stringify(dict));
  }

  return {
    makeArrayVar: (name) => vars.setVar(name, '[]'),
    arrayLength: (name) => read(vars.getVar(name), a => a.length.toString(), '0'),
    arrayGet: (name, i) => read(vars.getVar(name), a => toStr(a[Number(i)] ?? 'null'), 'null'),
    arraySet: (name, i, v) => {
      if (!Number.isNaN(Number(i))) changeArray(name, a => { a[Number(i)] = toStr(v); }, undefined, false);
    },
    arrayPush: (name, v) => { changeArray(name, a => a.push(toStr(v)), undefined); },
    arrayPop: (name) => changeArray(name, a => toStr(a.pop() ?? 'null'), 'null'),
    arrayShift: (name) => changeArray(name, a => toStr(a.shift() ?? 'null'), 'null'),
    arrayUnshift: (name, v) => { changeArray(name, a => a.unshift(toStr(v)), undefined); },
    arraySplice: (name, start, item) => { changeArray(name, a => a.splice(Number(start), 0, toStr(item)), undefined); },
    arraySlice: (name, start, end) => read(vars.getVar(name), a => JSON.stringify(a.slice(Number(start), Number(end))), '[]'),
    arrayJoin: (value, delim) => read(value, a => a.join(toStr(delim)), ''),
    arrayIndexOf: (name, v) => read(vars.getVar(name), a => a.indexOf(toStr(v)), -1),
    arrayRemoveIndex: (name, i) => { changeArray(name, a => a.splice(Number(i), 1), undefined); },

    makeDictVar: (name) => vars.setVar(name, '{}'),
    dictGet: (value, k) => read(value, d => toStr(d[toStr(k)] ?? 'null'), 'null'),
    dictSet,
    dictDelete: (name, k) => {
      const json = read(vars.getVar(name), d => { delete d[toStr(k)]; return JSON.stringify(d); }, '{}');
      vars.setVar(name, json);
    },
    dictHasKey: (value, k) => read(value, d => Object.hasOwn(d, toStr(k)), false),
    dictClear: (name) => vars.setVar(name, '{}'),
    dictSize: (value) => read(value, d => Object.keys(d).length, 0),
    dictKeys: (value) => read(value, d => Object.keys(d), []),
    dictValues: (value) => read(value, d => Object.values(d), []),
  };
}
