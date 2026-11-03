import { afterEach, expect, test } from 'bun:test';
import { frontendRuntime } from '../helpers/frontend-mutation-runtime.js';
import { clearWasmoonEngine } from '../../src/interpreter/lua-wasmoon.js';

afterEach(async () => { for (const mode of ['editInput', 'editDisplay']) await clearWasmoonEngine(mode); });

test.each([0, 1, 64])('%s local hashes make no host or unrelated identity reads', async count => {
  const f = frontendRuntime();
  expect(await f.run(`listenEdit('editInput',function(id,text) local result='none';for i=1,${count} do result=hash(id,'x'):await() end;return result end)`))
    .toBe(count ? '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' : 'none');
  expect(f.counts()).toEqual({ serviceCalls: 0, personaReads: 0 });
  expect(f.writes).toEqual([]);
});

test('CBS observes native scenario updates while a Lua callback is suspended', async () => {
  const f = frontendRuntime();
  const work = f.run("listenEdit('editInput',function(id,text) local before=cbs('{{scenario}}');alertInput(id,'pause'):await();return before..'|'..cbs('{{scenario}}') end)");
  await f.entered.promise;
  f.dto.character.scenario = 'New scenario';
  f.event({ character: f.dto.character });
  f.resume.resolve('resume');
  expect(await work).toBe('Old scenario|New scenario');
  expect(f.counts()).toEqual({ serviceCalls: 0, personaReads: 0 });
});

test('native timestamps convert seconds once through bootstrap, events and reload, preserving zero', async () => {
  const initial = frontendRuntime().dto;
  initial.messages[1]!.send_date = 1700000000.125;
  const f = frontendRuntime(initial);
  const read = "listenEdit('editInput',function(id,text) return getChat(id,0).time end)";
  expect(await f.run(read)).toBe(1700000000125);
  f.dto.messages[1]!.send_date = 0; f.dto.messages[1]!.created_at = 1800000000;
  f.event({ message: f.dto.messages[1]! });
  expect(await f.run(read)).toBe(0);
  expect(await frontendRuntime(f.dto).run(read)).toBe(0);
});

test('one frontend executor retains display access IDs without granting chat writes or forged IDs', async () => {
  const f = frontendRuntime();
  await f.run("listenEdit('editDisplay',function(id,text) setChatVar(id,'savedId',id);return text end)", { kind: 'edit', mode: 'editDisplay', value: 'input' });
  expect(await f.run("listenEdit('editInput',function(id,text) setChatVar(getChatVar(id,'savedId'),'x','7');return getChatVar(id,'x') end)")).toBe('7');
  expect(await f.run("listenEdit('editInput',function(id,text) setChatVar('forged','x','9');setChat(getChatVar(id,'savedId'),0,'Denied');return getChatVar(id,'x')..'|'..getChat(id,0).data end)"))
    .toBe('7|Hello');
  expect(f.writes.every(command => command.kind === 'chat.variables')).toBe(true);
});
