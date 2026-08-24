// Coalesces tagged work items into a single callback per scheduled frame.
// Used by island-styles to turn per-change adopter nudges / body-wide DOM
// walks into at-most-one recalc pass per frame instead of per mutation.

export type FrameScheduler = (cb: () => void) => void;

export interface RafBatcher {
  /** Queue an item; duplicates within one frame collapse via Set dedupe. */
  schedule(item: string): void;
  pendingCount(): number;
  /** Run the pending batch now (test hook / teardown). */
  flush(): void;
  /** Drop pending items without running them. */
  dispose(): void;
}

export function createRafBatcher(
  scheduleFrame: FrameScheduler,
  processBatch: (items: string[]) => void,
): RafBatcher {
  let scheduled = false;
  const pending = new Set<string>();

  function run(): void {
    scheduled = false;
    if (pending.size === 0) return;
    const items = Array.from(pending);
    pending.clear();
    processBatch(items);
  }

  return {
    schedule(item: string): void {
      pending.add(item);
      if (scheduled) return;
      scheduled = true;
      scheduleFrame(run);
    },
    pendingCount(): number {
      return pending.size;
    },
    flush(): void {
      run();
    },
    dispose(): void {
      pending.clear();
      scheduled = false;
    },
  };
}
