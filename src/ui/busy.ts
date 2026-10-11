export interface BusyTask {
  readonly id: string;
  readonly kind: 'import' | 'module' | 'repair';
  readonly label: string;
}

let current: BusyTask | null = null;
const listeners = new Set<() => void>();

export function currentTask(): BusyTask | null { return current; }
export function startTask(task: BusyTask): boolean {
  if (current) return false;
  current = task;
  for (const listener of listeners) listener();
  return true;
}
export function finishTask(id: string): void {
  if (current?.id !== id) return;
  current = null;
  for (const listener of listeners) listener();
}
export function subscribeTask(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setButtonBusy(button: HTMLButtonElement, label: string, busy: boolean, disabled = busy): void {
  button.textContent = label;
  button.classList.toggle('lr-busy', busy);
  button.setAttribute('aria-busy', String(busy));
  button.disabled = disabled;
}
