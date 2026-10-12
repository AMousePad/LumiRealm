// Per-chat debouncer for stateChanged refresh. Coalesces rapid reloadDisplay/reloadChat
// calls within 50ms into one WS push per chat. Independent timers per chat.

const DEBOUNCE_MS = 50;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleStateChangedRefresh(
  chatId: string,
  runRefresh: (chatId: string) => Promise<void> | void,
  onError?: (err: unknown) => void,
): void {
  if (pendingTimers.has(chatId)) {
    return; // coalesce into existing timer
  }
  const timer = setTimeout(async () => {
    pendingTimers.delete(chatId);
    try {
      await runRefresh(chatId);
    } catch (err) {
      if (onError) onError(err);
    }
  }, DEBOUNCE_MS);
  // Avoid keeping the worker alive during shutdown; next tick re-fans-out.
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }
  pendingTimers.set(chatId, timer);
}

/** Test hook — drop all pending timers without firing them. */
export function resetStateChangedDebouncer(): void {
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
}

/** Diagnostic — count of currently-pending refreshes. */
export function pendingStateChangedTimers(): number {
  return pendingTimers.size;
}

/** Test-only constant for spec verification. */
export const STATE_CHANGED_DEBOUNCE_MS = DEBOUNCE_MS;
