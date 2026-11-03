import type { ActiveCard } from '../../src/interpreter/dispatch';
import type { RuntimeStateDto } from '../../src/frontend-lua/state-contract';
import { assembleRuntimeConfig } from '../../src/state/display-snapshot-assembly';
import { FrontendRuntimeState } from '../../src/frontend-lua/state';
import { runtimeDisplaySnapshot } from '../../src/frontend-lua/snapshot';

export function runtimeSnapshot(active: ActiveCard, hostState: RuntimeStateDto) {
  const config = assembleRuntimeConfig({
    modulesByNamespaceFromCard: () => null, legacyMediaFindings: () => false, getCompiledLibraries: () => [],
  }, active, hostState.chat.id, active.ownerUserId);
  const state = new FrontendRuntimeState(hostState, async () => { throw new Error('Unexpected state write'); }, () => {});
  return runtimeDisplaySnapshot({ ...config, togglePreferences: null, presetToggles: {} }, state);
}
