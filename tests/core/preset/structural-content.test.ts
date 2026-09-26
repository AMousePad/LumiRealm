import { expect, test } from 'bun:test';
import { translateRisuPromptBlocks } from '../../../src/core/preset/risup-translator';

for (const type of ['persona', 'description']) {
  for (const innerFormat of ['<wrapper>{{slot}}</wrapper>', '{{#if_pure 0}}{{slot}}{{/if_pure}}', 'replacement']) {
    test(`${type} retains authored content instead of a host structural marker: ${innerFormat}`, () => {
      const { blocks } = translateRisuPromptBlocks([{ type, name: 'authored', innerFormat }], []);
      const block = blocks.find(block => block.name === 'authored')!;
      expect(block.marker).toBeNull();
      expect(block.content).toBeTruthy();
      expect(block.content).not.toContain('{{slot}}');
    });
  }
  test(`${type} retains the native marker for its unwrapped value`, () => {
    const { blocks } = translateRisuPromptBlocks([{ type, name: 'plain', innerFormat: '{{slot}}' }], []);
    expect(blocks.find(block => block.name === 'plain')!.marker).toBe(type === 'persona' ? 'persona_description' : 'char_description');
  });
}
