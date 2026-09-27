import { logStore, type LogLevel } from './store.js';

type LogFn = (msg: string, ...rest: unknown[]) => void;

export interface FrontendLogger {
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
  trace: LogFn;
}

function formatLine(msg: string, rest: readonly unknown[]): string {
  if (rest.length === 0) return msg;
  const tail = rest.map((r) => {
    if (r instanceof Error) return `${r.name}: ${r.message}`;
    if (typeof r === 'string') return r;
    try { return JSON.stringify(r); } catch { return String(r); }
  }).join(' ');
  return `${msg} ${tail}`;
}

function consoleFor(level: LogLevel): (...args: unknown[]) => void {
  if (level === 'error') return console.error.bind(console);
  if (level === 'warn')  return console.warn.bind(console);
  return console.log.bind(console);
}

export function makeFrontendLogger(category: string): FrontendLogger {
  function emit(level: LogLevel, msg: string, rest: readonly unknown[]): void {
    const record = logStore.shouldEmit(level);
    const consoleEmit = level === 'error' || record;
    if (consoleEmit) {
      try { consoleFor(level)('[lumirealm]', `${category}:`, msg, ...rest); } catch { /* */ }
    }
    if (record) logStore.push(level, category, formatLine(msg, rest));
  }
  return {
    error: (m, ...r) => emit('error', m, r),
    warn:  (m, ...r) => emit('warn',  m, r),
    info:  (m, ...r) => emit('info',  m, r),
    debug: (m, ...r) => emit('debug', m, r),
    trace: (m, ...r) => emit('trace', m, r),
  };
}
