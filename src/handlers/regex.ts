import type { RegexImporter } from '../state/regex-import.js';
import type { Handler } from './types.js';

export interface RegexHandlerDeps {
  readonly regexImporter: RegexImporter;
}

export function createRegexHandlers(deps: RegexHandlerDeps): {
  readonly import_regex: Handler<'import_regex'>;
} {
  return {
    import_regex: async (msg, ctx) => {
      await deps.regexImporter.handle(msg, ctx.userId);
    },
  };
}
