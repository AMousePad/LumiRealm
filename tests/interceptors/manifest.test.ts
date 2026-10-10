import { expect, test } from 'bun:test';
import manifest from '../../spindle.json';

test('the extension declares one request processing budget', async () => {
  expect(manifest.interceptorTimeoutMs).toBe(60_000);
  const source = await Bun.file(new URL('../../spindle.json', import.meta.url)).text();
  expect(source.match(/"interceptorTimeoutMs"\s*:/g)).toHaveLength(1);
});
