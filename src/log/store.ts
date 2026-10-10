export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type LogThreshold = 'silent' | LogLevel;

export const LEVEL_RANK: Readonly<Record<LogThreshold, number>> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

export const DEFAULT_LOG_LEVEL: LogThreshold = 'info';

export const LOG_LEVEL_VALUES: readonly LogThreshold[] = [
  'silent', 'error', 'warn', 'info', 'debug', 'trace',
];

export function isLogThreshold(v: unknown): v is LogThreshold {
  return typeof v === 'string' && (LOG_LEVEL_VALUES as readonly string[]).includes(v);
}

export function meetsThreshold(call: LogLevel, threshold: LogThreshold): boolean {
  return LEVEL_RANK[call] <= LEVEL_RANK[threshold];
}

export interface LogEvent {
  ts: number;
  level: LogLevel;
  category: string;
  message: string;
  // `null` for system/boot events with no user attribution.
  userId?: string | null;
}

export interface LogState {
  enabled: boolean;
  includeChatData: boolean;
  level: LogThreshold;
}

export interface LogStateSnapshot extends LogState {
  eventCount: number;
  bufferBytes: number;
}

const STATE_STORAGE_KEY = 'lumirealm/log-state.json';

const DEFAULT_STATE: LogState = { enabled: false, includeChatData: false, level: DEFAULT_LOG_LEVEL };

const SYSTEM_KEY: string = '__SYSTEM__';

class LogStore {
  private events: LogEvent[] = [];
  private bytes = 0;
  // SYSTEM_KEY entry is the single-user fallback for the frontend bundle and
  // for backend boot before any user has connected.
  private statesByUser = new Map<string, LogState>();

  private keyOf(userId: string | null | undefined): string {
    return typeof userId === 'string' && userId.length > 0 ? userId : SYSTEM_KEY;
  }

  private stateFor(userId: string | null | undefined): LogState {
    return this.statesByUser.get(this.keyOf(userId)) ?? DEFAULT_STATE;
  }

  isEnabled(userId?: string | null): boolean {
    return this.stateFor(userId).enabled;
  }
  shouldRedact(userId?: string | null): boolean {
    return !this.stateFor(userId).includeChatData;
  }
  getLevel(userId?: string | null): LogThreshold {
    return this.stateFor(userId).level;
  }

  // `null` userId is system-tagged (boot, sweep timers), visible to every
  // user via snapshot, so emit if ANY user is enabled. `undefined` falls back the same way.
  shouldEmit(level: LogLevel, userId?: string | null): boolean {
    if (userId !== undefined && userId !== null) {
      const s = this.stateFor(userId);
      return s.enabled && meetsThreshold(level, s.level);
    }
    for (const s of this.statesByUser.values()) {
      if (s.enabled && meetsThreshold(level, s.level)) return true;
    }
    return false;
  }

  push(level: LogLevel, category: string, message: string, userId?: string | null): void {
    if (!this.shouldEmit(level, userId)) return;
    let redactNow: boolean;
    if (userId !== undefined) {
      redactNow = !this.stateFor(userId).includeChatData;
    } else {
      // Conservative: redact if ANY observing user redacts.
      redactNow = false;
      for (const s of this.statesByUser.values()) {
        if (s.enabled && !s.includeChatData) { redactNow = true; break; }
      }
    }
    const text = redactNow ? redact(message) : message;
    const tagged: string | null = typeof userId === 'string' && userId.length > 0 ? userId : null;
    const ev: LogEvent = { ts: Date.now(), level, category, message: text, userId: tagged };
    const size = approxBytes(ev);
    this.events.push(ev);
    this.bytes += size;
  }

  snapshot(userId?: string | null): { events: readonly LogEvent[] } {
    if (userId === undefined) return { events: this.events.slice() };
    const target = typeof userId === 'string' && userId.length > 0 ? userId : null;
    return { events: this.events.filter((e) => e.userId === target || e.userId === null) };
  }

  clear(userId?: string | null): void {
    if (userId === undefined) {
      this.events = [];
      this.bytes = 0;
      return;
    }
    const target = typeof userId === 'string' && userId.length > 0 ? userId : null;
    this.events = this.events.filter((e) => e.userId !== target && e.userId !== null);
    this.bytes = this.events.reduce((a, e) => a + approxBytes(e), 0);
  }

  getState(userId?: string | null): LogStateSnapshot {
    const s = this.stateFor(userId);
    let eventCount = 0;
    let bufferBytes = 0;
    if (userId === undefined) {
      eventCount = this.events.length;
      bufferBytes = this.bytes;
    } else {
      const target = typeof userId === 'string' && userId.length > 0 ? userId : null;
      for (const e of this.events) {
        if (e.userId === target || e.userId === null) {
          eventCount += 1;
          bufferBytes += approxBytes(e);
        }
      }
    }
    return { ...s, eventCount, bufferBytes };
  }

  setState(next: Partial<LogState>, userId?: string | null): LogStateSnapshot {
    const key = this.keyOf(userId);
    const prior = this.statesByUser.get(key) ?? DEFAULT_STATE;
    const merged: LogState = {
      enabled: next.enabled ?? prior.enabled,
      includeChatData: next.includeChatData ?? prior.includeChatData,
      level: isLogThreshold(next.level) ? next.level : prior.level,
    };
    this.statesByUser.set(key, merged);
    if (!merged.enabled && prior.enabled) this.clear(userId);
    return this.getState(userId);
  }
}

export const logStore = new LogStore();

function approxBytes(ev: LogEvent): number {
  return ev.message.length + ev.category.length + 32;
}

const REDACT_PATTERNS: readonly { re: RegExp; to: string }[] = [
  { re: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, to: 'Bearer [REDACTED]' },
  { re: /\bsk-[A-Za-z0-9_-]{20,}/g, to: 'sk-[REDACTED]' },
  { re: /\b(api[_-]?key|secret|password|token)\s*[=:]\s*[^\s,;}]+/gi, to: '$1=[REDACTED]' },
  { re: /\b(content|content_preview|message|message_preview|text|text_preview|raw|raw_preview|template|prompt|response|reply)\s*=\s*"[^"]*"/gi, to: '$1="[REDACTED]"' },
  { re: /\b(content|content_preview|message|message_preview|text|text_preview|raw|raw_preview|template|prompt|response|reply)\s*=\s*'[^']*'/gi, to: "$1='[REDACTED]'" },
  { re: /"[^"\n]{80,}"/g, to: '"[CONTENT_REDACTED]"' },
  { re: /'[^'\n]{80,}'/g, to: "'[CONTENT_REDACTED]'" },
];

export function redact(input: string): string {
  let out = input;
  for (const { re, to } of REDACT_PATTERNS) out = out.replace(re, to);
  return out;
}

interface StorageGetJson {
  getJson<T>(path: string, opts?: { fallback?: T; userId?: string | undefined }): Promise<T>;
}
interface StorageSetJson {
  setJson(path: string, value: unknown, opts?: { userId?: string | undefined }): Promise<void>;
}

interface PersistedShape {
  enabled?: boolean;
  includeChatData?: boolean;
  level?: LogThreshold;
}

export async function loadPersistedLogState(storage: StorageGetJson, userId: string): Promise<void> {
  try {
    const fallback: PersistedShape = { enabled: false, includeChatData: false, level: DEFAULT_LOG_LEVEL };
    const got = await storage.getJson<PersistedShape>(STATE_STORAGE_KEY, { fallback, userId });
    logStore.setState({
      enabled: got.enabled === true,
      includeChatData: got.includeChatData === true,
      level: isLogThreshold(got.level) ? got.level : DEFAULT_LOG_LEVEL,
    }, userId);
  } catch { /* keep defaults */ }
}

export async function persistLogState(storage: StorageSetJson, userId: string): Promise<void> {
  try {
    const s = logStore.getState(userId);
    const payload: PersistedShape = { enabled: s.enabled, includeChatData: s.includeChatData, level: s.level };
    await storage.setJson(STATE_STORAGE_KEY, payload, { userId });
  } catch { /* swallow */ }
}
