import { expect, test } from 'bun:test';
import { compileTrigger } from '../../src/core/triggers/compile';
import type { TriggerEffect, TriggerScript } from '../../src/core/schemas/triggerscript';
import type { HostApi } from '../../src/interpreter/host';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime';
import { interpretTrigger } from '../../src/interpreter/trigger-interpreter';
import { divergenceLuaScriptNS, makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';
import { basicTriggerContext } from '../helpers/trigger-runtime';

async function fixture(ui: NonNullable<HostApi['ui']>) {
  const host = makeLuaDivergenceHost();
  const runtime = await makeRisuTriggerRuntime({ ...host.api, ui }, {}, divergenceLuaScriptNS, {
    preloaded: host.preloaded, templateContext: basicTriggerContext,
  });
  return runtime;
}

for (const execution of ['interpreted', 'compiled']) {
  async function run(effects: TriggerEffect[], ui: NonNullable<HostApi['ui']>, lowLevelAccess = true, displayMode = false) {
    const runtime = await fixture(ui);
    const trigger: TriggerScript = { type: 'manual', comment: '', conditions: [], effect: effects };
    const gates = { lowLevelAccess, displayMode, stepBudget: 100 };
    if (execution === 'compiled') {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction('__risu', compileTrigger(trigger, gates).body)(runtime);
    } else await interpretTrigger(trigger, runtime, console, gates);
    return runtime;
  }

  for (const type of ['normal', 'error', 'v2']) {
    test(`${execution} ${type} alert displays without waiting or clearing variables`, async () => {
      const notices: unknown[] = [];
      const effect = type === 'v2'
        ? { type: 'v2ShowAlert', value: 'Notice', valueType: 'value', indent: 0 }
        : { type: 'showAlert', alertType: type, value: 'Notice', inputVar: 'x' };
      const runtime = await run([effect, {
        type: 'v2SetVar', var: 'after', value: 'done', valueType: 'value', operator: '=', indent: 0,
      }] as TriggerEffect[], { alert: (message, kind) => {
        notices.push([message, kind]);
        return new Promise(() => {});
      } }, type !== 'v2');
      expect(notices).toEqual([['Notice', type === 'error' ? 'error' : 'info']]);
      expect(runtime.getVar('after')).toBe('done');
      expect(runtime.getVar('x')).toBe('2');
    });
  }

  test(`${execution} legacy select preserves duplicate labels and selected index`, async () => {
    const calls: unknown[] = [];
    const runtime = await run([{ type: 'showAlert', alertType: 'select', value: 'Same§§Same', inputVar: 'x' }] as TriggerEffect[], {
      pick: async (title, options) => { calls.push([title, options]); return '2'; },
    });
    expect(calls).toEqual([['', ['Same', '', 'Same']]]);
    expect(runtime.getVar('x')).toBe('2');
  });

  test(`${execution} legacy input writes empty variable names and cancellation`, async () => {
    const runtime = await run([{ type: 'showAlert', alertType: 'input', value: 'Question', inputVar: '' }] as TriggerEffect[], {
      prompt: async () => null,
    });
    expect(runtime.getVar('')).toBe('');
  });

  test(`${execution} alert access and display gates remain in effect`, async () => {
    const calls: string[] = [];
    const ui = { alert: async (value: string) => { calls.push(value); } };
    const legacy = { type: 'showAlert', alertType: 'normal', value: 'Notice', inputVar: 'x' };
    await run([legacy] as TriggerEffect[], ui, false);
    await run([legacy] as TriggerEffect[], ui, true, true);
    await run([{ type: 'v2ShowAlert', value: 'Notice', valueType: 'value', indent: 0 }] as TriggerEffect[], ui, false, true);
    expect(calls).toEqual([]);
  });
}

test('selection and input propagate host failures and preserve index responses', async () => {
  const error = new Error('Modal unavailable');
  const runtime = await fixture({ pick: async () => '2', prompt: async () => { throw error; } });
  expect(await runtime.alertSelect('Pick', ['Same', '', 'Same'])).toBe('2');
  await expect(runtime.alertInput('Question')).rejects.toBe(error);
});

test('selection retains serialized title and option boundaries', async () => {
  const calls: unknown[] = [];
  const runtime = await fixture({ pick: async (title, options) => { calls.push([title, options]); return '1'; } });
  await runtime.alertSelect(undefined, ['__DISPLAY__Title', 'One||Two', '']);
  await runtime.alertSelect('Title||First', ['Last']);
  await runtime.alertSelect(undefined, []);
  expect(calls).toEqual([
    ['Title', ['One', 'Two', '']], ['Title', ['First', 'Last']], ['', ['']],
  ]);
});

test('Lua selection returns the clicked duplicate index through the async wrapper', async () => {
  const host = makeLuaDivergenceHost();
  const calls: unknown[] = [];
  const api: HostApi = { ...host.api, ui: { pick: async (title, options) => { calls.push([title, options]); return '2'; } } };
  const runtime = await makeRisuTriggerRuntime(api, {}, divergenceLuaScriptNS, {
    preloaded: host.preloaded, binding: 'manual', lowLevelAccess: true,
  });
  await runtime.runLua(`onButtonClick = async(function(id)
    setChatVar(id, 'selected', alertSelect(id, {'Same', '', 'Same'}):await())
  end)`);
  expect(calls).toEqual([['', ['Same', '', 'Same']]]);
  expect(runtime.getVar('selected')).toBe('2');
});
