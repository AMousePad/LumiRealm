import { expect, test } from 'bun:test';
import manifest from '../../spindle.json';

test('the extension declares its request processing budget', () => {
  expect(manifest.interceptorTimeoutMs).toBe(30_000);
});
