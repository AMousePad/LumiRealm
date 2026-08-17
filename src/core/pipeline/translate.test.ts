import { describe, expect, test } from 'bun:test';

import { translateFromStoredSource } from './translate.js';

const displayScript = (comment: string) => ({
  comment,
  in: 'before',
  out: 'after',
  type: 'editdisplay',
  flag: 'g',
  ableFlag: true,
});

describe('translateFromStoredSource regex folders', () => {
  test('groups card fields and the embedded Risu sidecar under the CharX folder', () => {
    const bundle = translateFromStoredSource({
      card: {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
          name: 'Ada',
          extensions: { risuai: { customScripts: [displayScript('Card rule')] } },
        },
      },
      module: {
        id: 'module-1',
        name: 'Ada Rules',
        description: '',
        regex: [displayScript('Module rule')],
      },
    }, {
      uuid: () => 'id',
      now: () => 1,
    });

    const foldersByOrigin = Object.fromEntries(bundle.regexScripts.map((script) => [
      (script.metadata._risu as { origin: string }).origin,
      script.folder,
    ]));

    expect(foldersByOrigin).toEqual({
      character: 'CharX — Ada',
      module: 'CharX — Ada',
    });
  });
});
