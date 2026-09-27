import { describe, expect, test } from 'bun:test';
import { runPipeline } from '../../src/interpreter/evaluator/pipeline.js';

describe('Risu history greeting serialization', () => {
  for (const name of ['history', 'messages']) {
    for (const [index, greeting] of [[-1, 'Hello Character'], [0, 'Alternate Character'], [1, '']] as const) {
      test(`${name} preserves the greeting shape at index ${index}`, () => {
        const output = runPipeline({
          template: `{{${name}}}`,
          phase: 'display',
          chatId: `history-${name}-${index}`,
          userName: 'User',
          charName: 'Character',
          character: {
            firstMessage: 'Hello {{char}}',
            alternateGreetings: ['Alternate {{char}}', ''],
            selectedAlternateGreetingIndex: index,
          },
          chat: {
            messages: [
              { role: 'user', content: 'To {{char}}', createdAt: 100 },
              { role: 'assistant', content: 'From {{char}}', createdAt: 200 },
            ],
          },
          variables: {},
        });

        expect(JSON.parse(output)).toEqual([
          JSON.stringify({ role: 'char', data: greeting }),
          JSON.stringify({ role: 'user', data: 'To Character', time: 100 }),
          JSON.stringify({ role: 'char', data: 'From Character', time: 200 }),
        ]);
      });
    }
  }
});
