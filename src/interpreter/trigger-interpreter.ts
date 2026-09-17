import type { TriggerScript, TriggerEffect } from '../core/schemas/triggerscript.js';
import type { RisuTriggerRuntime } from './runtime.js';
import { triggerNeedsTemplates } from '../core/triggers/templates.js';

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

interface InterpCtx {
  readonly rt: RisuTriggerRuntime;
  readonly console: InterpConsole;
  readonly displayMode: boolean;
  readonly lowLevelAccess: boolean;
  readonly budget: number;
  steps: number;
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
    ctx.rt.setVar(e.inputVar, ctx.rt.extractRegex(ctx.rt.resolve(e.value, 'value'), e.regex, e.flags, e.result, true));
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
    const value = rt.resolve(e.value, e.valueType === 'value' ? 'value' : 'var');
    await rt.setvarV2(rt.resolve(e.var, 'value'), e.operator, value);
  },
  v2DeclareLocalVar: (op, { rt }) => {
    const e = op as Any;
    const value = rt.resolve(e.value, e.valueType === 'value' ? 'value' : 'var');
    rt.declareLocalVar(rt.resolve(e.var, 'value'), value, e.indent);
  },
  v2CutChat: async (op, { rt }) => {
    const e = op as Any;
    await rt.cutChat(Number(rt.resolve(e.start, e.startType === 'value' ? 'value' : 'var')), Number(rt.resolve(e.end, e.endType === 'value' ? 'value' : 'var')), true);
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
    rt.setResult(e.outputVar, String(await rt.tokenize(rt.resolve(e.value, e.valueType))));
  },
  v2QuickSearchChat: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(
      e.outputVar,
      rt.quickSearchChat(rt.resolve(e.value, e.valueType), e.condition, Number(rt.resolve(e.depth, e.depthType))) ? '1' : '0',
    );
  },
  v2GetLastMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), rt.getLastMessage());
  },
  v2GetMessageAtIndex: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, rt.getMessageAtIndex(Number(rt.resolve(e.index, e.indexType))));
  },
  v2GetMessageCount: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), String(rt.getMessageCount()));
  },
  v2GetLastUserMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, rt.getLastUserMessage());
  },
  v2GetLastCharMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, rt.getLastCharMessage());
  },
  v2GetFirstMessage: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), rt.getFirstMessage());
  },
  v2ShowAlert: async (op, ctx) => {
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    await ctx.rt.showAlert('normal', ctx.rt.resolve(e.value, e.valueType), '');
  },
  v2RunLLM: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setResult(e.outputVar, await ctx.rt.runLLM(ctx.rt.resolve(e.value, e.valueType), e.model, Boolean(e.streaming)));
  },
  v2GetAlertInput: async (op, ctx) => {
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setResult(e.outputVar, await ctx.rt.alertInput(ctx.rt.resolve(e.display, e.displayType)));
  },
  v2GetAlertSelect: async (op, ctx) => {
    if (ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setResult(
      e.outputVar,
      await ctx.rt.alertSelect(ctx.rt.resolve(e.display, e.displayType), String(ctx.rt.resolve(e.value, e.valueType)).split('|')),
    );
  },
  v2CheckSimilarity: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setResult(
      e.outputVar,
      ((await ctx.rt.checkSimilarity(ctx.rt.resolve(e.value, e.valueType), ctx.rt.resolve(e.source, e.sourceType))) as unknown as string[]).join('§'),
    );
  },
  v2ImgGen: async (op, ctx) => {
    if (!ctx.lowLevelAccess) return;
    const e = op as Any;
    ctx.rt.setResult(e.outputVar, await ctx.rt.runImgGen(ctx.rt.resolve(e.value, e.valueType), ctx.rt.resolve(e.negValue, e.negValueType)));
  },
  v2ExtractRegex: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(
      e.outputVar,
      rt.extractRegex(
        rt.resolve(e.value, e.valueType),
        rt.resolve(e.regex, e.regexType),
        rt.resolve(e.flags, e.flagsType),
        () => rt.resolve(e.result, e.resultType),
      ),
    );
  },
  v2RegexTest: (op, { rt }) => rt.regexEffect(op),
  v2ReplaceString: (op, { rt }) => rt.regexEffect(op),
  v2Random: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(rt.random(Number(rt.resolve(e.min, e.minType)), Number(rt.resolve(e.max, e.maxType)))));
  },
  v2GetCharAt: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(rt.resolve(e.source, e.sourceType))[Number(rt.resolve(e.index, e.indexType))] ?? 'null');
  },
  v2GetCharCount: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(String(rt.resolve(e.source, e.sourceType)).length));
  },
  v2ToLowerCase: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(rt.resolve(e.source, e.sourceType)).toLowerCase());
  },
  v2ToUpperCase: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(rt.resolve(e.source, e.sourceType)).toUpperCase());
  },
  v2SetCharAt: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(
      e.outputVar,
      rt.setCharAt(rt.resolve(e.source, e.sourceType), Number(rt.resolve(e.index, e.indexType)), rt.resolve(e.value, e.valueType)),
    );
  },
  v2SplitString: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(
      e.outputVar,
      JSON.stringify(rt.splitString(rt.resolve(e.source, e.sourceType), rt.resolve(e.delimiter, e.delimiterType), e.delimiterType)),
    );
  },
  v2ConcatString: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(rt.resolve(e.source1, e.source1Type)) + String(rt.resolve(e.source2, e.source2Type)));
  },
  v2Calculate: (op, { rt }) => {
    const e = op as Any;
    rt.calculate(e.expression, e.expressionType, e.outputVar);
  },
  v2MakeArrayVar: (op, { rt }) => {
    const e = op as Any;
    const name = rt.resolve(e.var, 'value');
    if (name.startsWith('[') && name.endsWith(']')) return 'return';
    rt.setVar(name, '[]');
  },
  v2GetArrayVarLength: (op, { rt }) => rt.collectionEffect(op),
  v2GetArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2SetArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2PushArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2PopArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2ShiftArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2UnshiftArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2SpliceArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2SliceArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2JoinArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2GetIndexOfValueInArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2RemoveIndexFromArrayVar: (op, { rt }) => rt.collectionEffect(op),
  v2MakeDictVar: (op, { rt }) => {
    const e = op as Any;
    if (e.var.startsWith('{') && e.var.endsWith('}')) return 'return';
    rt.setVar(rt.resolve(e.var, 'value'), '{}');
  },
  v2GetDictVar: (op, { rt }) => rt.collectionEffect(op),
  v2SetDictVar: (op, { rt }) => rt.collectionEffect(op),
  v2DeleteDictKey: (op, { rt }) => rt.collectionEffect(op),
  v2HasDictKey: (op, { rt }) => rt.collectionEffect(op),
  v2ClearDict: (op, { rt }) => {
    const e = op as Any;
    if (e.var.startsWith('{') && e.var.endsWith('}')) return 'return';
    rt.setVar(rt.resolve(e.var, 'value'), '{}');
  },
  v2GetDictSize: (op, { rt }) => rt.collectionEffect(op),
  v2GetDictKeys: (op, { rt }) => rt.collectionEffect(op),
  v2GetDictValues: (op, { rt }) => rt.collectionEffect(op),
  v2GetCharacterDesc: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), await rt.getCharacterDesc());
  },
  v2SetCharacterDesc: async (op, { rt }) => {
    const e = op as Any;
    await rt.setCharacterDesc(rt.resolve(e.value, e.valueType));
  },
  v2GetPersonaDesc: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), await rt.getPersonaDesc());
  },
  v2SetPersonaDesc: async (op, { rt }) => {
    const e = op as Any;
    await rt.setPersonaDesc(rt.resolve(e.value, e.valueType));
  },
  v2GetReplaceGlobalNote: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), await rt.getReplaceGlobalNote());
  },
  v2SetReplaceGlobalNote: async (op, { rt }) => {
    const e = op as Any;
    await rt.setReplaceGlobalNote(rt.resolve(e.value, e.valueType));
  },
  v2GetAuthorNote: async (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), await rt.getAuthorNote());
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
    rt.setResult(e.outputVar, rt.getLorebookByKey(rt.resolve(e.target, e.targetType)));
  },
  v2GetLorebookCount: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), String(rt.getLorebookCount()));
  },
  v2GetLorebookEntry: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, rt.getLorebookEntry(Number(rt.resolve(e.index, e.indexType))));
  },
  v2SetLorebookActivation: async (op, { rt }) => {
    const e = op as Any;
    await rt.setLorebookActivation(Number(rt.resolve(e.index, e.indexType)), Boolean(e.value));
  },
  v2GetLorebookIndexViaName: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, String(rt.getLorebookIndexViaName(rt.resolve(e.name, e.nameType))));
  },
  v2GetAllLorebooks: (op, { rt }) => {
    const e = op as Any;
    rt.setVar(rt.resolve(e.outputVar, 'value'), JSON.stringify(rt.getAllLorebooks()));
  },
  v2GetLorebookByName: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, JSON.stringify(rt.getLorebookByName(rt.resolve(e.name, e.nameType))));
  },
  v2GetLorebookByIndex: (op, { rt }) => {
    const e = op as Any;
    rt.setResult(e.outputVar, rt.getLorebookByIndex(Number(rt.resolve(e.index, e.indexType))));
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
    rt.setVar(rt.resolve(e.outputVar, 'value'), String(rt.getLorebookCount()));
  },
  v2SetLorebookAlwaysActive: async (op, { rt }) => {
    const e = op as Any;
    await rt.setLorebookAlwaysActive(Number(rt.resolve(e.index, e.indexType)), Boolean(e.value));
  },
  v2GetDisplayState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(ctx.rt.resolve(e.outputVar, 'value'), ctx.rt.getDisplayState());
  },
  v2SetDisplayState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setDisplayState(ctx.rt.resolve(e.value, e.valueType));
  },
  v2GetRequestState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setResult(e.outputVar, ctx.rt.getRequestState(Number(ctx.rt.resolve(e.index, e.indexType))));
  },
  v2SetRequestState: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setRequestState(Number(ctx.rt.resolve(e.index, e.indexType)), ctx.rt.resolve(e.value, e.valueType));
  },
  v2GetRequestStateRole: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setResult(e.outputVar, ctx.rt.getRequestStateRole(Number(ctx.rt.resolve(e.index, e.indexType))));
  },
  v2SetRequestStateRole: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setRequestStateRole(Number(ctx.rt.resolve(e.index, e.indexType)), ctx.rt.resolve(e.value, e.valueType));
  },
  v2GetRequestStateLength: (op, ctx) => {
    if (!ctx.displayMode) return 'return';
    const e = op as Any;
    ctx.rt.setVar(ctx.rt.resolve(e.outputVar, 'value'), String(ctx.rt.getRequestStateLength()));
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
  const handler = LEAVES[op.type];
  if (!handler) return 'normal';
  const r = await handler(op, ctx);
  return r === 'return' || r === 'break' ? r : 'normal';
}

export async function interpretTrigger(
  trigger: TriggerScript,
  rt: RisuTriggerRuntime,
  console: InterpConsole,
  opts: InterpretOpts,
): Promise<void> {
  if (triggerNeedsTemplates(trigger)) await rt.prepareTemplates();
  const conditions = (trigger.conditions ?? []) as readonly unknown[];
  if (conditions.length > 0 && !rt.checkConditions(conditions)) return;

  const effects = (trigger.effect ?? []) as readonly TriggerEffect[];
  const ctx: InterpCtx = {
    rt,
    console,
    displayMode: opts.displayMode,
    lowLevelAccess: opts.lowLevelAccess,
    budget: opts.stepBudget ?? DEFAULT_STEP_BUDGET,
    steps: 0,
  };
  const control = { loops: {}, ticks: 0 };
  for (let index = 0; index < effects.length; index++) {
    bumpBudget(ctx);
    const next = await rt.advanceControl(effects, index, control);
    if (next !== undefined) { index = next; continue; }
    if (await execLeaf(effects[index]!, ctx) === 'return') return;
  }
}

export const __test = { LEAVES };
