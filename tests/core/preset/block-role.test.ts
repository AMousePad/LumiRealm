import { expect, test } from 'bun:test';
import { translateRisuPromptBlocks } from '../../../src/core/preset/risup-translator';

for (const type of ['persona', 'description', 'authornote']) {
  test(`${type} uses Risu role2 for its prompt role`, () => {
    for (const [role2, expected] of [['user', 'user'], ['bot', 'assistant'], ['system', 'system']] as const) {
      const { blocks } = translateRisuPromptBlocks([{ type, name: 'authored', role: 'system', role2 }], []);
      expect(blocks.find(block => block.name === 'authored')!.role).toBe(expected);
    }
  });
}
