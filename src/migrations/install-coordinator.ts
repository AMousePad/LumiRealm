export interface RegexInstallCompletion {
  readonly ok: boolean;
  readonly cleanupCompleted: boolean;
}

interface PendingInstall {
  readonly userId: string;
  readonly resolve: (result: RegexInstallCompletion) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingInstall>();

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
