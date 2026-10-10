import type { TriggerEffect } from '../../core/schemas/triggerscript.js';
import type { VarsApi } from './vars.js';

// Risu runTrigger includes operand parsing and destination writes in each collection's catch boundary.
export function runCollectionEffect(vars: VarsApi, effect: TriggerEffect): void {
  const e = effect as Record<string, string>;
  const { getVar, setVar } = vars;
  const name = (value: string) => vars.resolve(value, 'value');
  const value = (key: string) => vars.resolve(e[key], e[key + 'Type'] === 'value' ? 'value' : 'var');
  const output = () => name(e.outputVar!);
  const resetArray = () => setVar(name(e.var!), '[]');

  switch (effect.type) {
    case 'v2GetArrayVarLength':
    case 'v2GetArrayVar':
    case 'v2SliceArrayVar':
    case 'v2GetIndexOfValueInArrayVar': {
      const fallback = { v2GetArrayVarLength: '0', v2GetArrayVar: 'null', v2SliceArrayVar: '[]', v2GetIndexOfValueInArrayVar: '-1' }[effect.type];
      try {
        const array = JSON.parse(getVar(name(e.var!)));
        if (effect.type === 'v2GetArrayVarLength') setVar(output(), array.length.toString());
        else if (effect.type === 'v2GetArrayVar') {
          const index = Number(value('index'));
          setVar(output(), array[index] ?? 'null');
        } else if (effect.type === 'v2SliceArrayVar') {
          const start = Number(value('start')), end = Number(value('end'));
          setVar(output(), JSON.stringify(array.slice(start, end)));
        } else {
          const item = value('value');
          setVar(output(), array.indexOf(item).toString());
        }
      } catch { setVar(output(), fallback); }
      break;
    }
    case 'v2PushArrayVar':
    case 'v2UnshiftArrayVar':
    case 'v2SpliceArrayVar':
    case 'v2RemoveIndexFromArrayVar': {
      try {
        const target = name(e.var!);
        const array = JSON.parse(getVar(target));
        if (effect.type === 'v2PushArrayVar' || effect.type === 'v2UnshiftArrayVar') {
          const item = value('value');
          if (effect.type === 'v2PushArrayVar') array.push(item);
          else array.unshift(item);
        } else if (effect.type === 'v2SpliceArrayVar') {
          const start = Number(value('start')), item = value('item');
          array.splice(start, 0, item);
        } else {
          const index = Number(value('index'));
          array.splice(index, 1);
        }
        setVar(target, JSON.stringify(array));
      } catch { resetArray(); }
      break;
    }
    case 'v2PopArrayVar':
    case 'v2ShiftArrayVar': {
      try {
        const target = name(e.var!);
        const array = JSON.parse(getVar(target));
        setVar(output(), (effect.type === 'v2PopArrayVar' ? array.pop() : array.shift()) ?? 'null');
        setVar(target, JSON.stringify(array));
      } catch {
        resetArray();
        setVar(output(), 'null');
      }
      break;
    }
    case 'v2SetArrayVar': {
      const item = value('value'), index = Number(value('index'));
      if (Number.isNaN(index)) break;
      try {
        const target = name(e.var!);
        const array = JSON.parse(getVar(target));
        array[index] = item;
        setVar(target, JSON.stringify(array));
      } catch { /* Risu leaves invalid storage unchanged for indexed assignment. */ }
      break;
    }
    case 'v2JoinArrayVar': {
      try {
        const array = JSON.parse(value('var'));
        const delimiter = value('delimiter');
        setVar(output(), array.join(delimiter));
      } catch { setVar(output(), ''); }
      break;
    }
    case 'v2GetDictVar':
    case 'v2HasDictKey': {
      try {
        const dict = JSON.parse(value('var'));
        const key = value('key');
        if (effect.type === 'v2GetDictVar') setVar(output(), dict[key] ?? 'null');
        else setVar(output(), Object.hasOwn(dict, key) ? '1' : '0');
      } catch { setVar(output(), effect.type === 'v2GetDictVar' ? 'null' : '0'); }
      break;
    }
    case 'v2SetDictVar': {
      try {
        const item = value('value'), key = value('key');
        if (e.varType === 'value') break;
        const dict = JSON.parse(getVar(name(e.var!)));
        dict[key] = item;
        setVar(name(e.var!), JSON.stringify(dict));
      } catch {
        if (e.varType === 'var') {
          const item = value('value'), key = value('key');
          const dict: Record<string, string> = {};
          dict[key] = item;
          setVar(name(e.var!), JSON.stringify(dict));
        }
      }
      break;
    }
    case 'v2DeleteDictKey': {
      try {
        if (e.varType === 'value') break;
        const dict = JSON.parse(getVar(name(e.var!)));
        const key = value('key');
        delete dict[key];
        setVar(name(e.var!), JSON.stringify(dict));
      } catch {
        if (e.varType === 'var') setVar(name(e.var!), '{}');
      }
      break;
    }
    case 'v2GetDictSize':
    case 'v2GetDictKeys':
    case 'v2GetDictValues': {
      try {
        const dict = JSON.parse(value('var'));
        if (effect.type === 'v2GetDictSize') setVar(output(), Object.keys(dict).length.toString());
        else {
          const result = effect.type === 'v2GetDictKeys' ? Object.keys(dict) : Object.values(dict);
          setVar(output(), JSON.stringify(result));
        }
      } catch { setVar(output(), effect.type === 'v2GetDictSize' ? '0' : '[]'); }
      break;
    }
  }
}
