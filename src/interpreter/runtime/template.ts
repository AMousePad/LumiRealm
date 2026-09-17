import { buildEvaluatorContext, freshParserContext, type BuildEvaluatorCtxInput } from '../evaluator/context.js';
import type { VarScope } from '../../core/cbs/index.js';

export type TriggerTemplateContext = () => Promise<BuildEvaluatorCtxInput>;

export function createTriggerTemplateParser(
  input: BuildEvaluatorCtxInput,
  read: (scope: VarScope, name: string) => string,
): (text: string) => string {
  const base = buildEvaluatorContext({
    ...input, commit: false, rmVar: false, runVar: false, cbsContext: true,
    currentMessageIndexOverride: -1,
  });
  const vars = { ...base.vars, get: read };
  return text => freshParserContext({ ...base, vars }).evaluate!(text);
}
