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
}

test('persona retains the native marker for its unwrapped value', () => {
  const { blocks } = translateRisuPromptBlocks([{ type: 'persona', name: 'plain', innerFormat: '{{slot}}' }], []);
  expect(blocks.find(block => block.name === 'plain')!.marker).toBe('persona_description');
});

// Risu sends the personality and scenario in the description's own message, which the marker cannot hold.
test('an unwrapped description stays content-bearing', () => {
  const { blocks } = translateRisuPromptBlocks([{ type: 'description', name: 'plain', innerFormat: '{{slot}}' }], []);
  const block = blocks.find(block => block.name === 'plain')!;
  expect(block.marker).toBeNull();
  // The host's {{#if}} would read a comparison operator in the card's text, so the gates test its length.
  expect(block.content).toContain('{{#if {{risuLength::{{personality}}}}}}');
  expect(block.content).toContain('{{#if {{risuLength::{{scenario}}}}}}');
});
