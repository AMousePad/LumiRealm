export interface RegexInstallCompletion {
  readonly ok: boolean;
  readonly cleanupCompleted: boolean;
}

export interface RegexDeleteCompletion {
  readonly ok: boolean;
  readonly deleted: number;
}

interface PendingInstall {
  readonly userId: string;
  readonly resolve: (result: RegexInstallCompletion) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingInstall>();

interface PendingDelete {
  readonly userId: string;
  readonly resolve: (result: RegexDeleteCompletion) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const pendingDeletes = new Map<string, PendingDelete>();

export function awaitRegexInstall(
  userId: string,
  dispatch: (requestId: string) => void | Promise<void>,
  timeoutMs = 30_000,
): Promise<RegexInstallCompletion> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, cleanupCompleted: false });
    }, timeoutMs);
    pending.set(requestId, { userId, resolve, timer });
    void Promise.resolve(dispatch(requestId)).catch(() => {
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, cleanupCompleted: false });
    });
  });
}

export function completeRegexInstall(
  requestId: string,
  userId: string,
  result: RegexInstallCompletion,
): boolean {
  const entry = pending.get(requestId);
  if (!entry || entry.userId !== userId) return false;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  entry.resolve(result);
  return true;
}

export function awaitRegexDelete(
  userId: string,
  dispatch: (requestId: string) => void | Promise<void>,
  timeoutMs = 30_000,
): Promise<RegexDeleteCompletion> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDeletes.delete(requestId);
      resolve({ ok: false, deleted: 0 });
    }, timeoutMs);
    pendingDeletes.set(requestId, { userId, resolve, timer });
    void Promise.resolve(dispatch(requestId)).catch(() => {
      const entry = pendingDeletes.get(requestId);
      if (!entry) return;
      pendingDeletes.delete(requestId);
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, deleted: 0 });
    });
  });
}

export function completeRegexDelete(
  requestId: string,
  userId: string,
  result: RegexDeleteCompletion,
): boolean {
  const entry = pendingDeletes.get(requestId);
  if (!entry || entry.userId !== userId) return false;
  pendingDeletes.delete(requestId);
  clearTimeout(entry.timer);
  entry.resolve(result);
  return true;
}
