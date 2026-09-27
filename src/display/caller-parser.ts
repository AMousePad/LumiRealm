import { buildEvaluatorContext, type VarReadRecorder } from '../interpreter/evaluator/context.js';
import { evaluate } from '../interpreter/evaluator/scanner.js';
import { lookup } from '../interpreter/evaluator/dispatch.js';
import type { RunPipelineInput } from '../interpreter/evaluator/pipeline.js';
import { normalizeMacroName } from '../core/cbs/index.js';
import type { EvaluatorCtx } from '../interpreter/evaluator/types.js';

const assetTypes = 'raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source';
const assetPattern = new RegExp(`{{(${assetTypes})::(.+?)}}`, 'gms');
const additionalAssets = new Set(assetTypes.split('|').map(normalizeMacroName));
const callerAssets = new Set([...additionalAssets, 'inlay', 'inlayed', 'inlayeddata']);

function deferAssets(names: ReadonlySet<string>): NonNullable<EvaluatorCtx['resolveLeaf']> {
  return (name, _args, raw) => raw !== undefined && names.has(normalizeMacroName(name))
    ? { text: `{{${raw}}}`, terminal: true }
    : undefined;
}

export const deferDisplayAssets = deferAssets(additionalAssets);
const deferCallerAssets = deferAssets(callerAssets);

function replaceAssets(body: string, getContext: () => EvaluatorCtx): string {
  if (!body.includes('{{')) return body;
  const end = body.lastIndexOf('}}') + 2;
  if (end < 2) return body;
  let context: EvaluatorCtx | undefined;
  const replace = (_full: string, type: string, name: string): string => type === 'bg' ? ''
    : lookup(type)!.handler(context ??= getContext(), [name], `${type}::${name}`);
  return body.slice(0, end).replace(assetPattern, replace) + body.slice(end);
}

export function displayAssetBaseline(body: string): string | undefined {
  if (!body.includes('{{')) return undefined;
  const end = body.lastIndexOf('}}') + 2;
  // Initial asset removal can form a new token; Risu skips it when later stages leave the text unchanged.
  return end >= 2 && body.slice(0, end).search(assetPattern) >= 0 ? body : undefined;
}

export function finalizeDisplayAssets(input: RunPipelineInput, recorder: VarReadRecorder): string {
  return replaceAssets(input.template, () => buildEvaluatorContext({ ...input, commit: false, recorder }));
}

export function parseDisplayCaller(input: RunPipelineInput, recorder: VarReadRecorder): string {
  const context = buildEvaluatorContext({
    ...input,
    commit: false,
    visualize: true,
    recorder,
    reparseMacroResults: false,
    resolveLeaf: deferCallerAssets,
  });
  // Risu displaya parses once; ParseMarkdown resolves assets before editDisplay.
  const body = evaluate(input.template, context);
  return replaceAssets(body, () => context);
}
