import type { TriggerEffect, TriggerScript } from '../core/schemas/triggerscript.js';

export type RestrictedTriggerMode = 'display' | 'request';

const SAFE_EFFECT_TYPES = [
  'v2SetVar',
  'v2If',
  'v2IfAdvanced',
  'v2Else',
  'v2EndIndent',
  // Risu skips v2Loop itself, but its allowed v2EndIndent still jumps back.
  // The structured interpreter needs the opener to preserve that behavior.
  'v2Loop',
  'v2LoopNTimes',
  'v2BreakLoop',
  'v2ConsoleLog',
  'v2StopTrigger',
  'v2Random',
  'v2ExtractRegex',
  'v2RegexTest',
  'v2GetCharAt',
  'v2GetCharCount',
  'v2ToLowerCase',
  'v2ToUpperCase',
  'v2SetCharAt',
  'v2SplitString',
  'v2JoinArrayVar',
  'v2ConcatString',
  'v2MakeArrayVar',
  'v2GetArrayVarLength',
  'v2GetArrayVar',
  'v2SetArrayVar',
  'v2PushArrayVar',
  'v2PopArrayVar',
  'v2ShiftArrayVar',
  'v2UnshiftArrayVar',
  'v2SpliceArrayVar',
  'v2SliceArrayVar',
  'v2GetIndexOfValueInArrayVar',
  'v2RemoveIndexFromArrayVar',
  'v2Calculate',
  'v2Comment',
  'v2DeclareLocalVar',
] as const;

const ALLOWED_BY_MODE: Readonly<Record<RestrictedTriggerMode, ReadonlySet<string>>> = {
  display: new Set([
    'v2GetDisplayState',
    'v2SetDisplayState',
    ...SAFE_EFFECT_TYPES,
  ]),
  request: new Set([
    'v2GetRequestState',
    'v2SetRequestState',
    'v2GetRequestStateRole',
    'v2SetRequestStateRole',
    'v2GetRequestStateLength',
    ...SAFE_EFFECT_TYPES,
  ]),
};

function matchesBinding(source: TriggerScript, mode: RestrictedTriggerMode): boolean {
  const firstType = source.effect?.[0]?.type;
  return firstType === 'triggerlua'
    || firstType === 'triggercode'
    || source.type === mode;
}

function restrictEffects(
  source: TriggerScript,
  mode: RestrictedTriggerMode,
): TriggerScript {
  const allowed = ALLOWED_BY_MODE[mode];
  return {
    ...source,
    effect: source.effect.map((effect) => {
      if (allowed.has(effect.type)) return effect;
      const indent = 'indent' in effect && typeof effect.indent === 'number'
        ? effect.indent
        : 0;
      return { type: 'v2Comment', value: '', indent } as TriggerEffect;
    }),
  };
}

export function selectRestrictedTriggers(
  sources: readonly TriggerScript[],
  mode: RestrictedTriggerMode,
): readonly TriggerScript[] {
  return sources
    .filter((source) => matchesBinding(source, mode))
    .map((source) => restrictEffects(source, mode))
    .filter(
      (source) =>
        source.conditions.length > 0
        || source.effect.some((effect) => effect.type !== 'v2Comment'),
    );
}
