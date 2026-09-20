import { buildEvaluatorContext, type VarReadRecorder } from '../interpreter/evaluator/context.js';
import { evaluate } from '../interpreter/evaluator/scanner.js';
import { lookup } from '../interpreter/evaluator/dispatch.js';
import type { RunPipelineInput } from '../interpreter/evaluator/pipeline.js';
import { normalizeMacroName } from '../core/cbs/index.js';

const assetTypes = 'raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source';
const assetPattern = new RegExp(`{{(${assetTypes})::(.+?)}}`, 'gms');
const deferredAssets = new Set([...assetTypes.split('|'), 'inlay', 'inlayed', 'inlayeddata'].map(normalizeMacroName));

export function parseDisplayCaller(input: RunPipelineInput, recorder: VarReadRecorder): string {
  const context = buildEvaluatorContext({
    ...input,
    commit: false,
    visualize: true,
    recorder,
    reparseMacroResults: false,
    resolveLeaf: (name, _args, raw) => raw !== undefined && deferredAssets.has(normalizeMacroName(name))
      ? { text: `{{${raw}}}`, terminal: true }
      : undefined,
  });
  // Risu displaya parses once; ParseMarkdown resolves assets before editDisplay.
  const body = evaluate(input.template, context);
  return body.replace(assetPattern, (_full, type: string, name: string) =>
    type === 'bg' ? '' : lookup(type)!.handler(context, [name], `${type}::${name}`));
}
