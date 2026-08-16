import {
  actionFromLiveScript,
  bindAtActionToLiveScript,
  type AtAtPhase,
  type RuntimeAtAtAction,
} from '../interpreter/at-actions-runtime.js';
import type { FeRegexScript } from './regex-apply.js';

interface ModuleScriptIdentity {
  readonly moduleId: string;
  readonly phase: AtAtPhase;
  readonly sourceIndex: number;
  readonly sourceRowIndex: number;
  readonly order?: number;
  readonly requiresRuntimeAction: boolean;
}

export type ModuleDisplayStep =
  | {
      readonly kind: 'script';
      readonly script: FeRegexScript;
    }
  | {
      readonly kind: 'action';
      readonly script: FeRegexScript;
      readonly action: RuntimeAtAtAction;
    }
  | {
      readonly kind: 'skip';
      readonly script: FeRegexScript;
      readonly reason: string;
    };

export function buildModuleDisplayPlan(
  scripts: readonly FeRegexScript[],
  actions: readonly RuntimeAtAtAction[],
): ModuleDisplayStep[] {
  const moduleActions = actions.filter(
    (action) => (action.sourceOrigin ?? 'character').startsWith('module:'),
  );
  const byLiveId = groupBy(
    moduleActions.filter(
      (action): action is RuntimeAtAtAction & { liveScriptId: string } =>
        typeof action.liveScriptId === 'string'
        && action.liveScriptId.length > 0,
    ),
    (action) => action.liveScriptId,
  );
  const bySource = groupBy(
    moduleActions.filter(
      (action): action is RuntimeAtAtAction & {
        sourceOrigin: string;
        sourceRowIndex: number;
      } =>
        typeof action.sourceOrigin === 'string'
        && typeof action.sourceRowIndex === 'number'
        && Number.isInteger(action.sourceRowIndex),
    ),
    (action) => sourceKey(action.sourceOrigin, action.sourceRowIndex),
  );

  return scripts.map((script) => {
    const rawMetadata = readRisuMetadata(script);
    const identity = readModuleIdentity(rawMetadata);
    const idMatches = byLiveId.get(script.id) ?? [];

    if (!identity) {
      if (
        idMatches.length > 0
        || (
          hasModuleTag(rawMetadata)
          && actionFromLiveScript({
            findRegex: script.find_regex,
            flag: script.flags,
            out: script.replace_string,
            phase: 'editdisplay',
          })
        )
      ) {
        return {
          kind: 'skip',
          script,
          reason: 'module action row has incomplete source identity',
        };
      }
      return { kind: 'script', script };
    }

    const origin = `module:${identity.moduleId}`;
    const sourceMatches =
      bySource.get(sourceKey(origin, identity.sourceRowIndex)) ?? [];
    if (sourceMatches.length > 0) {
      if (
        sourceMatches.length !== 1
        || idMatches.length !== 1
        || sourceMatches[0] !== idMatches[0]
      ) {
        return {
          kind: 'skip',
          script,
          reason: 'module action row identity is missing or ambiguous',
        };
      }
      const raw = sourceMatches[0]!;
      if (!bindingMatches(raw, identity, script.id)) {
        return {
          kind: 'skip',
          script,
          reason: 'module action row identity does not match its source',
        };
      }
      const action = bindAtActionToLiveScript(raw, {
        findRegex: script.find_regex,
        flag: script.flags,
        out: script.replace_string,
        phase: identity.phase,
        order: identity.order ?? raw.order,
        hasExplicitOrder: identity.order !== undefined,
      });
      return action
        ? { kind: 'action', script, action }
        : { kind: 'script', script };
    }

    if (idMatches.length > 0 || identity.requiresRuntimeAction) {
      return {
        kind: 'skip',
        script,
        reason: 'module action metadata has no matching runtime source',
      };
    }

    if (!identity.requiresRuntimeAction) {
      return { kind: 'script', script };
    }
    const action = actionFromLiveScript({
      findRegex: script.find_regex,
      flag: script.flags,
      out: script.replace_string,
      phase: identity.phase,
      order: identity.order ?? 0,
      hasExplicitOrder: identity.order !== undefined,
      sourceIndex: identity.sourceIndex,
      sourceRowIndex: identity.sourceRowIndex,
      sourceOrigin: origin,
      liveScriptId: script.id,
    });
    return action
      ? { kind: 'action', script, action }
      : { kind: 'script', script };
  });
}

function bindingMatches(
  action: RuntimeAtAtAction,
  identity: ModuleScriptIdentity,
  liveScriptId: string,
): boolean {
  return action.liveScriptId === liveScriptId
    && action.sourceOrigin === `module:${identity.moduleId}`
    && action.sourceIndex === identity.sourceIndex
    && action.sourceRowIndex === identity.sourceRowIndex
    && action.phase === identity.phase;
}

function readRisuMetadata(
  script: FeRegexScript,
): Readonly<Record<string, unknown>> | null {
  const metadata = script.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const risu = metadata['_risu'];
  return risu && typeof risu === 'object'
    ? risu as Readonly<Record<string, unknown>>
    : null;
}

function hasModuleTag(
  metadata: Readonly<Record<string, unknown>> | null,
): boolean {
  return typeof metadata?.['module_id'] === 'string';
}

function readModuleIdentity(
  metadata: Readonly<Record<string, unknown>> | null,
): ModuleScriptIdentity | null {
  if (!metadata) return null;
  const moduleId = metadata['module_id'];
  const phase = metadata['phase'];
  const sourceIndex = metadata['source_index'];
  const sourceRowIndex = metadata['source_row_index'];
  if (
    typeof moduleId !== 'string'
    || moduleId.length === 0
    || !isAtActionPhase(phase)
    || typeof sourceIndex !== 'number'
    || !Number.isInteger(sourceIndex)
    || typeof sourceRowIndex !== 'number'
    || !Number.isInteger(sourceRowIndex)
  ) return null;
  const order = metadata['order_flag'];
  return {
    moduleId,
    phase,
    sourceIndex,
    sourceRowIndex,
    ...(typeof order === 'number' && Number.isFinite(order)
      ? { order }
      : {}),
    requiresRuntimeAction:
      metadata['at_action'] === 'emo'
      || metadata['at_action'] === 'inject'
      || (
        Array.isArray(metadata['flag_actions'])
        && metadata['flag_actions'].includes('inject')
      ),
  };
}

function sourceKey(origin: string, sourceRowIndex: number): string {
  return `${origin}\u0000${sourceRowIndex}`;
}

function groupBy<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const current = grouped.get(key);
    if (current) current.push(value);
    else grouped.set(key, [value]);
  }
  return grouped;
}

function isAtActionPhase(value: unknown): value is AtAtPhase {
  return value === 'editinput'
    || value === 'editoutput'
    || value === 'editprocess'
    || value === 'editdisplay'
    || value === 'edittrans';
}
