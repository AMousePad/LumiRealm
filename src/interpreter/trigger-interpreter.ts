import type { TriggerScript, TriggerEffect } from '../core/schemas/triggerscript.js';
import type { RisuTriggerRuntime } from './runtime.js';

export interface InterpConsole {
  log(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
  info(...a: unknown[]): void;
}

export interface InterpretOpts {
  readonly displayMode: boolean;
  readonly lowLevelAccess: boolean;
  readonly stepBudget?: number;
}

export class TriggerBudgetExceededError extends Error {
  constructor(budget: number) {
    super(`trigger interpreter exceeded step budget (${budget})`);
    this.name = 'TriggerBudgetExceededError';
  }
}

const DEFAULT_STEP_BUDGET = 5_000_000;

type Flow = 'normal' | 'return' | 'break';

type Any = Record<string, any>;

type Node =
  | { kind: 'leaf'; op: TriggerEffect }
  | { kind: 'if'; op: TriggerEffect; then: Node[]; else: Node[] | null }
  | { kind: 'loop'; body: Node[] }
  | { kind: 'loopN'; op: TriggerEffect; body: Node[] }
  | { kind: 'break' };

interface InterpCtx {
  readonly rt: RisuTriggerRuntime;
  readonly console: InterpConsole;
  readonly displayMode: boolean;
  readonly lowLevelAccess: boolean;
  readonly budget: number;
  steps: number;
}

function readIndent(op: TriggerEffect): number {
  const raw = (op as { indent?: unknown }).indent;
  if (typeof raw === 'number' && raw >= 0) return raw;
  return 0;
}

function parseBlock(
  effects: readonly TriggerEffect[],
  start: number,
  minIndent: number,
): { nodes: Node[]; next: number } {
  const nodes: Node[] = [];
  let i = start;
  while (i < effects.length) {
    const op = effects[i]!;
    const opIndent = readIndent(op);

    if (opIndent < minIndent) break;
    if (
      (op.type === 'v2EndIndent' || op.type === 'v2Else') &&
      opIndent === minIndent &&
      minIndent > 0
    ) {
      break;
    }

    switch (op.type) {
      case 'v2If':
      case 'v2IfVar':
      case 'v2IfAdvanced': {
        const thenRes = parseBlock(effects, i + 1, opIndent + 1);
        i = thenRes.next;
        const node: Node = { kind: 'if', op, then: thenRes.nodes, else: null };
        const endOp = effects[i];
        if (endOp && endOp.type === 'v2EndIndent' && readIndent(endOp) === opIndent + 1) {
          i++;
          const elseOp = effects[i];
          if (elseOp && elseOp.type === 'v2Else' && readIndent(elseOp) === opIndent) {
            const elseRes = parseBlock(effects, i + 1, opIndent + 1);
            node.else = elseRes.nodes;
            i = elseRes.next;
            const elseEnd = effects[i];
            if (elseEnd && elseEnd.type === 'v2EndIndent' && readIndent(elseEnd) === opIndent + 1) {
              i++;
            }
          }
        }
        nodes.push(node);
        break;
      }
      case 'v2Loop': {
        const bodyRes = parseBlock(effects, i + 1, opIndent + 1);
        i = bodyRes.next;
        const endOp = effects[i];
        if (endOp && endOp.type === 'v2EndIndent' && readIndent(endOp) === opIndent + 1) {
          i++;
        }
        nodes.push({ kind: 'loop', body: bodyRes.nodes });
        break;
      }
      case 'v2LoopNTimes': {
        const bodyRes = parseBlock(effects, i + 1, opIndent + 1);
        i = bodyRes.next;
        const endOp = effects[i];
        if (endOp && endOp.type === 'v2EndIndent' && readIndent(endOp) === opIndent + 1) {
          i++;
        }
        nodes.push({ kind: 'loopN', op, body: bodyRes.nodes });
        break;
      }
      case 'v2BreakLoop': {
        nodes.push({ kind: 'break' });
        i++;
        break;
      }
      case 'v2Else':
      case 'v2EndIndent': {
        i++;
        break;
      }
      default: {
        nodes.push({ kind: 'leaf', op });
        i++;
        break;
      }
    }
  }
  return { nodes, next: i };
}

function evalCondition(op: TriggerEffect, rt: RisuTriggerRuntime): boolean {
  const e = op as unknown as {
    type: string;
    condition: string;
    target: string;
    targetType: 'var' | 'value';
    source: string;
    sourceType?: 'var' | 'value';
  };
  const sourceKind = e.type === 'v2If' ? 'var' : e.sourceType ?? 'var';
  return rt.compare(rt.resolve(e.source, sourceKind), rt.resolve(e.target, e.targetType), e.condition);
}

type LeafHandler = (op: TriggerEffect, ctx: InterpCtx) => void | Flow | Promise<void | Flow>;

const NOOP: LeafHandler = () => {};

const LEAVES: Readonly<Record<string, LeafHandler>> = {
  v2Header: NOOP,
  v2If: NOOP,
  v2IfVar: NOOP,
  v2IfAdvanced: NOOP,
  v2Else: NOOP,
  v2EndIndent: NOOP,
  v2Loop: NOOP,
  v2LoopNTimes: NOOP,
  v2BreakLoop: NOOP,
  v2Comment: NOOP,

  setvar: async (op, { rt }) => {
    const e = op as Any;
    await rt.setvarV1(e.var, e.operator, e.value);
  },
  impersonate: async (op, { rt }) => {
    const e = op as Any;
    await rt.impersonate(e.role, rt.resolve(e.value, 'value'));
  },
  systemprompt: async (op, { rt }) => {
    const e = op as Any;
    await rt.systemPrompt(e.location, rt.resolve(e.value, 'value'));
  },
  command: async (op, { rt }) => {
    const e = op as Any;
    await rt.command(rt.resolve(e.value, 'value'));
  },
  stop: (_op, { rt }) => {
    rt.stopSending = true;
  },
  runtrigger: async (op, { rt }) => {
    const e = op as Any;
    await rt.runTrigger(e.value);
  },
  cutchat: async (op, { rt }) => {
    const e = op as Any;
    await rt.cutChat(Number(rt.resolve(e.start, 'value')), Number(rt.resolve(e.end, 'value')));
  },
  modifychat: async (op, { rt }) => {
    const e = op as Any;
    await rt.modifyChat(Number(rt.resolve(e.index, 'value')), rt.resolve(e.value, 'value'));
  },
  showAlert: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    await ctx.rt.showAlert(e.alertType, ctx.rt.resolve(e.value, 'value'), ctx.rt.resolve(e.inputVar, 'value'));
  },
  sendAIprompt: (_op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    ctx.rt.sendAIprompt = true;
  },
  runLLM: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(e.inputVar, await ctx.rt.runLLM(ctx.rt.resolve(e.value, 'value'), 'model'));
  },
  runAxLLM: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(e.inputVar, await ctx.rt.runLLM(ctx.rt.resolve(e.value, 'value'), 'submodel'));
  },
  checkSimilarity: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(
      e.inputVar,
      ((await ctx.rt.checkSimilarity(ctx.rt.resolve(e.value, 'value'), ctx.rt.resolve(e.source, 'value'))) as unknown as string[]).join('§'),
    );
  },
  extractRegex: (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(e.inputVar, ctx.rt.extractRegex(ctx.rt.resolve(e.value, 'value'), e.regex, e.flags, e.result));
  },
  runImgGen: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(e.inputVar, await ctx.rt.runImgGen(ctx.rt.resolve(e.value, 'value'), ctx.rt.resolve(e.negValue, 'value')));
  },
  triggercode: (op, { rt }) => {
    const e = op as Any;
    if (rt.warnDroppedTriggerCode) rt.warnDroppedTriggerCode(String(e.code ?? '').slice(0, 60));
  },
  triggerlua: async (op, { rt }) => {
    const e = op as Any;
    await rt.runLua(e.code);
  },

  v2StopTrigger: () => 'return',
  v2ConsoleLog: (op, ctx) => {
    const e = op as Any;
    ctx.console.log(ctx.rt.resolve(e.source, e.sourceType));
  },
  v2SetVar: async (op, { rt }) => {
    const e = op as Any;
    await rt.setvarV2(rt.resolve(e.var, 'value'), e.operator, rt.resolve(e.value, e.valueType));
  },
  v2DeclareLocalVar: (op, { rt }) => {
    const e = op as Any;
    rt.declareLocalVar(rt.resolve(e.var, 'value'), rt.resolve(e.value, e.valueType), e.indent);
  },
  v2CutChat: async (op, { rt }) => {
    const e = op as Any;
    await rt.cutChat(Number(rt.resolve(e.start, e.startType)), Number(rt.resolve(e.end, e.endType)));
  },
  v2ModifyChat: async (op, { rt }) => {
    const e = op as Any;
    await rt.modifyChat(Number(rt.resolve(e.index, e.indexType)), rt.resolve(e.value, e.valueType));
  },
  v2SystemPrompt: async (op, { rt }) => {
    const e = op as Any;
    await rt.systemPrompt(e.location, rt.resolve(e.value, e.valueType));
  },
  v2Impersonate: async (op, { rt }) => {
    const e = op as Any;
    await rt.impersonate(e.role, rt.resolve(e.value, e.valueType));
  },
  v2Command: async (op, { rt }) => {
    const e = op as Any;
    await rt.command(rt.resolve(e.value, e.valueType));
  },
  v2SendAIprompt: (_op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    ctx.rt.sendAIprompt = true;
  },
  v2StopPromptSending: (_op, { rt }) => {
    rt.stopSending = true;
  },
  v2UpdateGUI: async (_op, { rt }) => {
    await rt.updateGUI();
  },
  v2UpdateChatAt: async (op, { rt }) => {
    const e = op as Any;
    await rt.updateChatAt(Number(e.index));
  },
  v2Wait: async (op, { rt }) => {
    const e = op as Any;
    await rt.sleep(Number(rt.resolve(e.value, e.valueType)) * 1000);
  },
  v2Tokenize: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(await rt.tokenize(rt.resolve(e.value, e.valueType))));
  },
  v2QuickSearchChat: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      rt.quickSearchChat(rt.resolve(e.value, e.valueType), e.condition, Number(rt.resolve(e.depth, e.depthType))) ? '1' : '0',
    );
  },
  v2GetLastMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getLastMessage());
  },
  v2GetMessageAtIndex: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getMessageAtIndex(Number(rt.resolve(e.index, e.indexType))));
  },
  v2GetMessageCount: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.getMessageCount()));
  },
  v2GetLastUserMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getLastUserMessage());
  },
  v2GetLastCharMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getLastCharMessage());
  },
  v2GetFirstMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getFirstMessage());
  },
  v2ShowAlert: async (op, ctx) => {
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    await ctx.rt.showAlert('normal', ctx.rt.resolve(e.value, e.valueType), '');
  },
  v2RunLLM: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, await ctx.rt.runLLM(ctx.rt.resolve(e.value, e.valueType), e.model, Boolean(e.streaming)));
  },
  v2GetAlertInput: async (op, ctx) => {
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, await ctx.rt.alertInput(ctx.rt.resolve(e.display, e.displayType)));
  },
  v2GetAlertSelect: async (op, ctx) => {
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(
      e.outputVar,
      await ctx.rt.alertSelect(ctx.rt.resolve(e.display, e.displayType), String(ctx.rt.resolve(e.value, e.valueType)).split('|')),
    );
  },
  v2CheckSimilarity: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(
      e.outputVar,
      ((await ctx.rt.checkSimilarity(ctx.rt.resolve(e.value, e.valueType), ctx.rt.resolve(e.source, e.sourceType))) as unknown as string[]).join('§'),
    );
  },
  v2ImgGen: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, await ctx.rt.runImgGen(ctx.rt.resolve(e.value, e.valueType), ctx.rt.resolve(e.negValue, e.negValueType)));
  },
  v2ExtractRegex: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      rt.extractRegex(
        rt.resolve(e.value, e.valueType),
        rt.resolve(e.regex, e.regexType),
        rt.resolve(e.flags, e.flagsType),
        rt.resolve(e.result, e.resultType),
      ),
    );
  },
  v2RegexTest: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      rt.regexTest(rt.resolve(e.value, e.valueType), rt.resolve(e.regex, e.regexType), rt.resolve(e.flags, e.flagsType)) ? '1' : '0',
    );
  },
  v2ReplaceString: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      rt.replaceString(
        rt.resolve(e.source, e.sourceType),
        rt.resolve(e.regex, e.regexType),
        rt.resolve(e.result, e.resultType),
        rt.resolve(e.replacement, e.replacementType),
        rt.resolve(e.flags, e.flagsType),
      ),
    );
  },
  v2Random: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.random(Number(rt.resolve(e.min, e.minType)), Number(rt.resolve(e.max, e.maxType)))));
  },
  v2GetCharAt: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.resolve(e.source, e.sourceType))[Number(rt.resolve(e.index, e.indexType))] ?? 'null');
  },
  v2GetCharCount: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(String(rt.resolve(e.source, e.sourceType)).length));
  },
  v2ToLowerCase: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.resolve(e.source, e.sourceType)).toLowerCase());
  },
  v2ToUpperCase: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.resolve(e.source, e.sourceType)).toUpperCase());
  },
  v2SetCharAt: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      rt.setCharAt(rt.resolve(e.source, e.sourceType), Number(rt.resolve(e.index, e.indexType)), rt.resolve(e.value, e.valueType)),
    );
  },
  v2SplitString: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      JSON.stringify(rt.splitString(rt.resolve(e.source, e.sourceType), rt.resolve(e.delimiter, e.delimiterType), e.delimiterType)),
    );
  },
  v2ConcatString: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.resolve(e.source1, e.source1Type)) + String(rt.resolve(e.source2, e.source2Type)));
  },
  v2Calculate: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.calculate(rt.resolve(e.expression, e.expressionType))));
  },
  v2MakeArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.makeArrayVar(rt.resolve(e.var, 'value'));
  },
  v2GetArrayVarLength: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.arrayLength(rt.resolve(e.var, 'value'))));
  },
  v2GetArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.arrayGet(rt.resolve(e.var, 'value'), Number(rt.resolve(e.index, e.indexType))));
  },
  v2SetArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.arraySet(rt.resolve(e.var, 'value'), Number(rt.resolve(e.index, e.indexType)), rt.resolve(e.value, e.valueType));
  },
  v2PushArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.arrayPush(rt.resolve(e.var, 'value'), rt.resolve(e.value, e.valueType));
  },
  v2PopArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.arrayPop(rt.resolve(e.var, 'value')));
  },
  v2ShiftArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.arrayShift(rt.resolve(e.var, 'value')));
  },
  v2UnshiftArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.arrayUnshift(rt.resolve(e.var, 'value'), rt.resolve(e.value, e.valueType));
  },
  v2SpliceArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.arraySplice(rt.resolve(e.var, 'value'), Number(rt.resolve(e.start, e.startType)), rt.resolve(e.item, e.itemType));
  },
  v2SliceArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(
      e.outputVar,
      rt.arraySlice(rt.resolve(e.var, 'value'), Number(rt.resolve(e.start, e.startType)), Number(rt.resolve(e.end, e.endType))),
    );
  },
  v2JoinArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.arrayJoin(rt.resolve(e.var, e.varType), rt.resolve(e.delimiter, e.delimiterType)));
  },
  v2GetIndexOfValueInArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.arrayIndexOf(rt.resolve(e.var, 'value'), rt.resolve(e.value, e.valueType))));
  },
  v2RemoveIndexFromArrayVar: (op, { rt }) => {
    const e = op as Any;
    rt.arrayRemoveIndex(rt.resolve(e.var, 'value'), Number(rt.resolve(e.index, e.indexType)));
  },
  v2MakeDictVar: (op, { rt }) => {
    const e = op as Any;
    rt.makeDictVar(rt.resolve(e.var, 'value'));
  },
  v2GetDictVar: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.dictGet(rt.resolve(e.var, e.varType), rt.resolve(e.key, e.keyType)));
  },
  v2SetDictVar: (op, { rt }) => {
    const e = op as Any;
    if (e.varType === 'value') return;
    rt.dictSet(rt.resolve(e.var, e.varType), rt.resolve(e.key, e.keyType), rt.resolve(e.value, e.valueType));
  },
  v2DeleteDictKey: (op, { rt }) => {
    const e = op as Any;
    if (e.varType === 'value') return;
    rt.dictDelete(rt.resolve(e.var, e.varType), rt.resolve(e.key, e.keyType));
  },
  v2HasDictKey: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.dictHasKey(rt.resolve(e.var, e.varType), rt.resolve(e.key, e.keyType)) ? '1' : '0');
  },
  v2ClearDict: (op, { rt }) => {
    const e = op as Any;
    rt.dictClear(rt.resolve(e.var, 'value'));
  },
  v2GetDictSize: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.dictSize(rt.resolve(e.var, e.varType))));
  },
  v2GetDictKeys: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, JSON.stringify(rt.dictKeys(rt.resolve(e.var, e.varType))));
  },
  v2GetDictValues: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, JSON.stringify(rt.dictValues(rt.resolve(e.var, e.varType))));
  },
  v2GetCharacterDesc: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, await rt.getCharacterDesc());
  },
  v2SetCharacterDesc: async (op, { rt }) => {
    const e = op as Any;
    await rt.setCharacterDesc(rt.resolve(e.value, e.valueType));
  },
  v2GetPersonaDesc: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, await rt.getPersonaDesc());
  },
  v2SetPersonaDesc: async (op, { rt }) => {
    const e = op as Any;
    await rt.setPersonaDesc(rt.resolve(e.value, e.valueType));
  },
  v2GetReplaceGlobalNote: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, await rt.getReplaceGlobalNote());
  },
  v2SetReplaceGlobalNote: async (op, { rt }) => {
    const e = op as Any;
    await rt.setReplaceGlobalNote(rt.resolve(e.value, e.valueType));
  },
  v2GetAuthorNote: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, await rt.getAuthorNote());
  },
  v2SetAuthorNote: async (op, { rt }) => {
    const e = op as Any;
    await rt.setAuthorNote(rt.resolve(e.value, e.valueType));
  },
  v2ModifyLorebook: async (op, { rt }) => {
    const e = op as Any;
    await rt.modifyLorebook(rt.resolve(e.target, e.targetType), rt.resolve(e.value, e.valueType));
  },
  v2GetLorebook: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getLorebookByKey(rt.resolve(e.target, e.targetType)));
  },
  v2GetLorebookCount: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.getLorebookCount()));
  },
  v2GetLorebookEntry: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getLorebookEntry(Number(rt.resolve(e.index, e.indexType))));
  },
  v2SetLorebookActivation: async (op, { rt }) => {
    const e = op as Any;
    await rt.setLorebookActivation(Number(rt.resolve(e.index, e.indexType)), Boolean(e.value));
  },
  v2GetLorebookIndexViaName: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.getLorebookIndexViaName(rt.resolve(e.name, e.nameType))));
  },
  v2GetAllLorebooks: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, JSON.stringify(rt.getAllLorebooks()));
  },
  v2GetLorebookByName: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, JSON.stringify(rt.getLorebookByName(rt.resolve(e.name, e.nameType))));
  },
  v2GetLorebookByIndex: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, rt.getLorebookByIndex(Number(rt.resolve(e.index, e.indexType))));
  },
  v2CreateLorebook: async (op, { rt }) => {
    const e = op as Any;
    await rt.createLorebook(
      rt.resolve(e.name, e.nameType),
      rt.resolve(e.key, e.keyType),
      rt.resolve(e.content, e.contentType),
      Number(rt.resolve(e.insertOrder, e.insertOrderType)),
    );
  },
  v2ModifyLorebookByIndex: async (op, { rt }) => {
    const e = op as Any;
    await rt.modifyLorebookByIndex(
      Number(rt.resolve(e.index, e.indexType)),
      rt.resolve(e.name, e.nameType),
      rt.resolve(e.key, e.keyType),
      rt.resolve(e.content, e.contentType),
      rt.resolve(e.insertOrder, e.insertOrderType),
    );
  },
  v2DeleteLorebookByIndex: async (op, { rt }) => {
    const e = op as Any;
    await rt.deleteLorebookByIndex(Number(rt.resolve(e.index, e.indexType)));
  },
  v2GetLorebookCountNew: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(e.outputVar, String(rt.getLorebookCount()));
  },
  v2SetLorebookAlwaysActive: async (op, { rt }) => {
    const e = op as Any;
    await rt.setLorebookAlwaysActive(Number(rt.resolve(e.index, e.indexType)), Boolean(e.value));
  },
  v2GetDisplayState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, ctx.rt.getDisplayState());
  },
  v2SetDisplayState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setDisplayState(ctx.rt.resolve(e.value, e.valueType));
  },
  v2GetRequestState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, ctx.rt.getRequestState(Number(ctx.rt.resolve(e.index, e.indexType))));
  },
  v2SetRequestState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setRequestState(Number(ctx.rt.resolve(e.index, e.indexType)), ctx.rt.resolve(e.value, e.valueType));
  },
  v2GetRequestStateRole: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, ctx.rt.getRequestStateRole(Number(ctx.rt.resolve(e.index, e.indexType))));
  },
  v2SetRequestStateRole: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setRequestStateRole(Number(ctx.rt.resolve(e.index, e.indexType)), ctx.rt.resolve(e.value, e.valueType));
  },
  v2GetRequestStateLength: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(e.outputVar, String(ctx.rt.getRequestStateLength()));
  },
  v2RunTrigger: async (op, { rt }) => {
    const e = op as Any;
    await rt.runTrigger(e.target);
  },
};

function bumpBudget(ctx: InterpCtx): void {
  ctx.steps++;
  if (ctx.steps > ctx.budget) throw new TriggerBudgetExceededError(ctx.budget);
}

async function execLeaf(op: TriggerEffect, ctx: InterpCtx): Promise<Flow> {
  bumpBudget(ctx);
  const handler = LEAVES[op.type];
  if (!handler) return 'normal';
  const r = await handler(op, ctx);
  return r === 'return' || r === 'break' ? r : 'normal';
}

async function execNodes(nodes: readonly Node[], loopDepth: number, ctx: InterpCtx): Promise<Flow> {
  for (const node of nodes) {
    switch (node.kind) {
      case 'leaf': {
        const f = await execLeaf(node.op, ctx);
        if (f !== 'normal') return f;
        break;
      }
      case 'if': {
        const cond = evalCondition(node.op, ctx.rt);
        const branch = cond ? node.then : node.else;
        if (branch) {
          const f = await execNodes(branch, loopDepth, ctx);
          if (f !== 'normal') return f;
        }
        break;
      }
      case 'loop': {
        for (;;) {
          const tick = ctx.rt.loopTick();
          if ((tick & 0xff) === 0) await ctx.rt.sleep(1);
          bumpBudget(ctx);
          const f = await execNodes(node.body, loopDepth + 1, ctx);
          if (f === 'break') break;
          if (f === 'return') return 'return';
        }
        break;
      }
      case 'loopN': {
        const e = node.op as Any;
        const lim = Math.max(0, Number(ctx.rt.resolve(e.value, e.valueType)) || 0);
        let broke = false;
        for (let n = 0; n < lim; n++) {
          bumpBudget(ctx);
          const f = await execNodes(node.body, loopDepth + 1, ctx);
          if (f === 'break') {
            broke = true;
            break;
          }
          if (f === 'return') return 'return';
        }
        void broke;
        break;
      }
      case 'break': {
        bumpBudget(ctx);
        return loopDepth > 0 ? 'break' : 'return';
      }
    }
  }
  return 'normal';
}

export async function interpretTrigger(
  trigger: TriggerScript,
  rt: RisuTriggerRuntime,
  console: InterpConsole,
  opts: InterpretOpts,
): Promise<void> {
  const conditions = (trigger.conditions ?? []) as readonly unknown[];
  if (conditions.length > 0 && !rt.checkConditions(conditions)) return;

  const effects = (trigger.effect ?? []) as readonly TriggerEffect[];
  const { nodes } = parseBlock(effects, 0, 0);
  const ctx: InterpCtx = {
    rt,
    console,
    displayMode: opts.displayMode,
    lowLevelAccess: opts.lowLevelAccess,
    budget: opts.stepBudget ?? DEFAULT_STEP_BUDGET,
    steps: 0,
  };
  await execNodes(nodes, 0, ctx);
}

export const __test = { parseBlock, evalCondition, LEAVES };
