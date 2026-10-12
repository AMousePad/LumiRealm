import { createDisplayResolver as createResolver } from '../../src/display/resolver.js';
import { runEditDisplayChain as runEdit, runEditDisplayAtActions as runActions, setDisplayLuaEnvironment } from '../../src/display/lua-runner.js';
import { runDisplayTriggerChain as runTriggers } from '../../src/display/trigger-runner.js';
import { makeSnapshotHostApi } from './snapshot-host.js';
import type { DisplaySnapshot } from '../../src/display/snapshot.js';
import type { DisplayVarWriteback } from '../../src/display/host-shim.js';
import type { DisplayRuntimeEffectSink } from './snapshot-host.js';
export * from '../../src/display/resolver.js';

async function withSnapshotHost<T>(run: () => Promise<T>, writeback?: (snap: DisplaySnapshot) => DisplayVarWriteback, effects?: DisplayRuntimeEffectSink): Promise<T> {
  setDisplayLuaEnvironment(snap => ({ api: makeSnapshotHostApi(snap, writeback?.(snap), effects), options: {}, flush: async () => {} }));
  try { return await run(); } finally { setDisplayLuaEnvironment(undefined); }
}

export function createDisplayResolver(...args: [Parameters<typeof createResolver>[0]?, DisplayRuntimeEffectSink?, Parameters<typeof createResolver>[1]?]): ReturnType<typeof createResolver> {
  const resolver = createResolver(args[0], args[2]);
  const writeback = (snap: DisplaySnapshot) => (vars: Record<string, string>) => args[0]?.(snap.chatId, vars);
  return { ...resolver,
    resolveBody: input => withSnapshotHost(() => resolver.resolveBody(input), writeback, args[1]),
    resolveTemplates: input => withSnapshotHost(() => resolver.resolveTemplates(input), writeback, args[1]),
    applyScripts: input => withSnapshotHost(() => resolver.applyScripts(input), writeback, args[1]),
  };
}
type EditArgs = Parameters<typeof runEdit>;
export function runEditDisplayChain(...args: [EditArgs[0], EditArgs[1], EditArgs[2], EditArgs[3], EditArgs[4], DisplayRuntimeEffectSink?, EditArgs[5]?, EditArgs[6]?]) {
  return withSnapshotHost(() => runEdit(args[0], args[1], args[2], args[3], args[4], args[6], args[7]), () => args[4], args[5]);
}
type ActionArgs = Parameters<typeof runActions>;
export function runEditDisplayAtActions(...args: [ActionArgs[0], ActionArgs[1], ActionArgs[2], ActionArgs[3]?, (ActionArgs[4] & { onEffect?: DisplayRuntimeEffectSink })?]) {
  return withSnapshotHost(() => runActions(...args), undefined, args[4]?.onEffect);
}
export function runDisplayTriggerChain(...args: Parameters<typeof runTriggers>) {
  return withSnapshotHost(() => runTriggers(...args));
}
