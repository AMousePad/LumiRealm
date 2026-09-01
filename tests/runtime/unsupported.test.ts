import { describe, expect, test } from 'bun:test';
import { unsupported } from '../../src/interpreter/runtime/unsupported.js';
import { RisuCompatUnsupportedError } from '../../src/interpreter/host.js';

describe('unsupported', () => {
  test('throws RisuCompatUnsupportedError', () => {
    expect(() => unsupported('feature', 'reason')).toThrow(RisuCompatUnsupportedError);
  });

  test('error carries feature + reason on the message', () => {
    try {
      unsupported('LLMMain', 'no api.llm.generate');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toContain('LLMMain');
      expect(msg).toContain('no api.llm.generate');
    }
  });
});
