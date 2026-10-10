import { snapshot, context, chatId } from '../helpers/display-lua-fixture.js';
import { createDisplayResolver } from '../../src/display/resolver.js';
import { clearDisplaySnapshot, getDisplaySnapshot, setDisplaySnapshot } from '../../src/display/snapshot.js';
import { logStore } from '../../src/log/store.js';

export async function checkDisplay() {
  logStore.setState({ enabled: true });
  const originalFetch = globalThis.fetch;
  const network: string[] = [];
  globalThis.fetch = ((input, options) => {
    if (String(input).startsWith('data:')) return originalFetch(input, options);
    network.push(String(input));
    throw new Error('Display requested network access');
  }) as typeof fetch;
  function check(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Display mismatch: ${JSON.stringify({ actual, expected })}`);
  }
  try {
    const writes: Record<string, string>[] = [];
    const effects: unknown[] = [];
    const resolver = createDisplayResolver((_id, values) => { writes.push(values); }, effect => { effects.push(effect); });
    setDisplaySnapshot(snapshot(`listenEdit('editDisplay', function(id, text, meta)
      setChat(id, 0, 'denied')
      return text..'|'..getName(id)..'|'..getCharacterFirstMessage(id)..'|'..cbs('{{chatindex}}')..'|'..getChat(id,0).time
    end)`));
    const first = await resolver.resolveBody({ content: '{{user}}', context });
    check(first?.content, 'User|Character|Greeting|-1|1700000000000');
    check(first?.cacheable, true);
    check(effects, []);
    setDisplaySnapshot(snapshot(`listenEdit('editDisplay', function(id, text)
      setChatVar(id, 'x', text)
      return getChatVar(id, 'x')
    end)`));
    for (let round = 0; round < 3; round++) {
      await Promise.all(['A', 'B', 'A'].map(content => resolver.resolveBody({ content, context })));
      check(getDisplaySnapshot(chatId)!.vars.local.x, 'A');
    }
    check(writes.every(values => Object.keys(values).every(key => key === 'x')), true);
    setDisplaySnapshot(snapshot(`n=0; listenEdit('editDisplay', function(id, text) n=n+1; return tostring(n) end)`));
    check((await resolver.resolveBody({ content: 'same', context }))?.content, '1');
    check((await resolver.resolveBody({ content: 'same', context }))?.content, '2');
    setDisplaySnapshot(snapshot(`listenEdit('editDisplay', function(id, text)
      setChatVar(id, 'savedKey', id); return text
    end)`));
    await resolver.resolveBody({ content: 'same', context });
    const vars = getDisplaySnapshot(chatId)!.vars;
    setDisplaySnapshot({ ...snapshot(`
      setChatVar(getChatVar('', 'savedKey'), 'beforeError', '1')
      error('chunk abort')
    `), vars });
    check((await resolver.resolveBody({ content: 'same', context }))?.content, 'same');
    check(getDisplaySnapshot(chatId)!.vars.local.beforeError, '1');
    check(network, []);
    return { passed: true, networkRequests: network.length, concurrentRounds: 3 };
  } finally { globalThis.fetch = originalFetch; clearDisplaySnapshot(chatId); }
}
