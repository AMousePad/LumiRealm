import { calcString } from '../../risu-compat/risu-helpers.js';
import type { VarsApi } from './vars.js';

export function calculate(
  vars: Pick<VarsApi, 'resolve' | 'getVar' | 'getStoredVar' | 'setVar'>,
  readGlobal: (name: string) => string,
  expression: unknown,
  expressionType: string,
  outputVar: string,
): void {
  try {
    // Risu runTrigger substitutes trigger locals before calcString evaluates parentheses.
    const resolved = vars.resolve(expression, expressionType === 'value' ? 'value' : 'var')
      .replace(/\$([a-zA-Z0-9_]+)/g, (_, name: string) => {
        const value = parseFloat(vars.getVar(name));
        return Number.isNaN(value) ? '0' : value.toString();
      });
    const result = calcString(resolved, vars.getStoredVar, readGlobal);
    vars.setVar(vars.resolve(outputVar, 'value'), result.toString());
  } catch {
    vars.setVar(vars.resolve(outputVar, 'value'), '0');
  }
}
