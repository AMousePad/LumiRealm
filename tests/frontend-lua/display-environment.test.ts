import { afterEach, expect, test } from 'bun:test';
import { getDisplayLuaEnvironment, setDisplayLuaEnvironment, runEditDisplayChain } from '../../src/display/lua-runner.js';
import { FrontendLuaUnavailableError } from '../../src/frontend-lua/protocol.js';
import { snapshot, context } from '../helpers/display-lua-fixture.js';

afterEach(() => setDisplayLuaEnvironment(undefined));

test('display fails explicitly when its live runtime is unavailable', async () => {
  setDisplayLuaEnvironment(undefined);
  const value = snapshot('');
  expect(() => getDisplayLuaEnvironment(value)).toThrow(FrontendLuaUnavailableError);
  await expect(runEditDisplayChain(value, 'input', context, text => text, () => {})).rejects.toThrow(FrontendLuaUnavailableError);
});
