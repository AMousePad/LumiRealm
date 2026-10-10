import { beforeAll, describe, expect, test } from 'bun:test';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';
import { cbsRisuCases } from './cbs-risu-divergence-cases.js';

describe('CBS Risu source-backed divergence cases', () => {
  const actual: string[] = [];
  const divergence = process.env.RISU_PARITY_STRICT === '1' ? test : test.failing;

  // Execute outside test.failing so an unrelated runtime exception cannot satisfy a parity assertion.
  beforeAll(() => {
    for (const fixture of cbsRisuCases) {
      actual.push(runPipeline({
        template: fixture.template,
        phase: 'display',
        chatId: '',
        userName: 'User',
        charName: 'Character',
        character: { firstMessage: 'Greeting' },
        chat: {
          messageCount: 3,
          messages: [
            { role: 'user', content: 'Hello', createdAt: 1700000000000 },
            { role: 'assistant', content: 'Welcome', createdAt: 1700000005000 },
          ],
        },
        currentMessageIndexOverride: fixture.mode ? 1 : -1,
        currentMessageRoleOverride: 'assistant',
        cbsContext: !fixture.mode,
        rmVar: fixture.mode === 'rmVar',
        variables: {
          local: {
            x: '2',
            nested: '{{char}}',
            nested2: '{{getvar::nested}}',
            nestedWrite: '{{settempvar::side::changed}}',
          },
        },
      }));
    }
  });

  for (const [index, fixture] of cbsRisuCases.entries()) {
    const check = fixture.knownFailure ? divergence : test;
    check(`${fixture.name} (Risu ${fixture.source})`, () => {
      expect(actual[index]).toBe(fixture.expected);
    });
  }
});
