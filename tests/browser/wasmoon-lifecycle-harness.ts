import {
  clearWasmoonEngine,
  executeWasmoon,
} from '../../src/interpreter/lua-wasmoon.js';

const mode = 'editDisplay-browser-test';
const sourceA = `
  counter = counter or 0
  function lifecycle()
    counter = counter + 1
    return "A" .. counter
  end
`;
const sourceB = `
  function lifecycle()
    return "B|" .. tostring(counter or "clean")
  end
`;

async function run(source: string): Promise<unknown> {
  return executeWasmoon(source, {}, {
    wasmoonKey: mode,
    entry: 'lifecycle',
  });
}

async function main(): Promise<void> {
  clearWasmoonEngine(mode);
  const lifecycleActual = [
    await run(sourceA),
    await run(sourceA),
    await run(sourceB),
    await run(sourceA),
  ];
  const lifecycleExpected = ['A1', 'A2', 'B|clean', 'A1'];
  let updatedDescription = '';
  let updatedName = '';
  let updatedFirstMessage = '';
  const characterActualJson = await executeWasmoon(`
    listenEdit("editDisplay", function()
      local name = getName("trigger")
      local description = getDescription("trigger")
      local firstMessage = getCharacterFirstMessage("trigger")
      setName("trigger", "renamed")
      setDescription("trigger", "updated")
      setCharacterFirstMessage("trigger", "new greeting")
      local persona = getPersonaDescription("trigger")
      local note = getAuthorsNote("trigger")
      return name .. "|" .. description .. "|" .. firstMessage .. "|" .. persona .. "|" .. note
    end)
  `, {
    getNameMain: async () => 'name',
    setNameMain: async (_id: unknown, value: unknown) => {
      updatedName = String(value);
    },
    getDescriptionMain: async () => 'description',
    setDescriptionMain: async (_id: unknown, value: unknown) => {
      updatedDescription = String(value);
    },
    getPersonaDescriptionMain: async () => 'persona',
    getAuthorsNoteMain: async () => 'note',
    getCharacterFirstMessageMain: async () => 'greeting',
    setCharacterFirstMessageMain: async (_id: unknown, value: unknown) => {
      updatedFirstMessage = String(value);
    },
  }, {
    wasmoonKey: 'character-api-browser-test',
    entry: 'callListenMain',
    args: ['editDisplay', 'trigger', JSON.stringify('input'), JSON.stringify({})],
  });
  const characterActual = JSON.parse(String(characterActualJson));
  const actual = {
    lifecycleActual,
    characterActual,
    updatedName,
    updatedDescription,
    updatedFirstMessage,
  };
  const expected = {
    lifecycleActual: lifecycleExpected,
    characterActual: 'name|description|greeting|persona|note',
    updatedName: 'renamed',
    updatedDescription: 'updated',
    updatedFirstMessage: 'new greeting',
  };
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  document.body.dataset.status = passed ? 'pass' : 'fail';
  document.querySelector('pre')!.textContent = JSON.stringify(
    { passed, actual, expected },
    null,
    2,
  );
  clearWasmoonEngine(mode);
}

void main().catch((error: unknown) => {
  document.body.dataset.status = 'error';
  document.querySelector('pre')!.textContent =
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
});
