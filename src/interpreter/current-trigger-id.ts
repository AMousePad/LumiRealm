let currentTriggerId: string | null = null;

export const getCurrentTriggerId = (): string | null => currentTriggerId;

export function setCurrentTriggerId(triggerId: string | null): void {
  currentTriggerId = triggerId;
}
