import type { EmitContext, EmitFn, EmitResult } from "../types.js";
import { line, resolveCall, setVarCall } from "../types.js";
import type { TriggerEffect } from "../../schemas/triggerscript.js";


function emitV2SetVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    valueType: "var" | "value";
    value: string;
    operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=";
  };
  const code = line(
    ctx,
    `await __risu.setvarV2(${resolveCall(e.var, "value")}, ${JSON.stringify(e.operator)}, ${resolveCall(e.value, e.valueType)});`,
  );
  return { code, needsAwait: true };
}

function emitV2DeclareLocalVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; value: string; valueType: "var" | "value"; indent: number };
  const code = line(
    ctx,
    `__risu.declareLocalVar(${resolveCall(e.var, "value")}, ${resolveCall(e.value, e.valueType)}, ${e.indent});`,
  );
  return { code, needsAwait: false };
}


function emitStructuralNoop(_op: TriggerEffect, _ctx: EmitContext): EmitResult {
  // Structural opcodes are handled by compile.ts directly; this is a safe fallback.
  return { code: "", needsAwait: false };
}

function emitV2Header(_op: TriggerEffect, _ctx: EmitContext): EmitResult {
  return { code: "", needsAwait: false };
}

function emitV2Comment(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value?: string };
  return {
    code: line(ctx, `// ${(e.value ?? "").replace(/\r?\n/g, " ").slice(0, 120)}`),
    needsAwait: false,
  };
}

function emitV2StopTrigger(_op: TriggerEffect, ctx: EmitContext): EmitResult {
  return { code: line(ctx, `return;`), needsAwait: false };
}

function emitV2ConsoleLog(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { source: string; sourceType: "var" | "value" };
  return {
    code: line(ctx, `console.log(${resolveCall(e.source, e.sourceType)});`),
    needsAwait: false,
  };
}


function emitV2CutChat(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { start: string; startType: "var" | "value"; end: string; endType: "var" | "value" };
  return {
    code: line(
      ctx,
      `await __risu.cutChat(Number(${resolveCall(e.start, e.startType)}), Number(${resolveCall(e.end, e.endType)}));`,
    ),
    needsAwait: true,
  };
}

function emitV2ModifyChat(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; value: string; valueType: "var" | "value" };
  return {
    code: line(
      ctx,
      `await __risu.modifyChat(Number(${resolveCall(e.index, e.indexType)}), ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: true,
  };
}

function emitV2SystemPrompt(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    location: "start" | "historyend" | "promptend";
    value: string;
    valueType: "var" | "value";
  };
  return {
    code: line(
      ctx,
      `await __risu.systemPrompt(${JSON.stringify(e.location)}, ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: true,
  };
}

function emitV2Impersonate(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { role: "user" | "char"; value: string; valueType: "var" | "value" };
  return {
    code: line(
      ctx,
      `await __risu.impersonate(${JSON.stringify(e.role)}, ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: true,
  };
}

function emitV2Command(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(ctx, `await __risu.command(${resolveCall(e.value, e.valueType)});`),
    needsAwait: true,
  };
}

function emitV2SendAIprompt(_op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* v2SendAIprompt skipped — lowLevelAccess only */`), needsAwait: false };
  }
  return { code: line(ctx, `__risu.sendAIprompt = true;`), needsAwait: false };
}

function emitV2StopPromptSending(_op: TriggerEffect, ctx: EmitContext): EmitResult {
  return { code: line(ctx, `__risu.stopSending = true;`), needsAwait: false };
}

function emitV2UpdateGUI(_op: TriggerEffect, ctx: EmitContext): EmitResult {
  return { code: line(ctx, `await __risu.updateGUI();`), needsAwait: true };
}

function emitV2UpdateChatAt(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string };
  return {
    code: line(ctx, `await __risu.updateChatAt(Number(${JSON.stringify(e.index)}));`),
    needsAwait: true,
  };
}

function emitV2Wait(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(
      ctx,
      `await __risu.sleep(Number(${resolveCall(e.value, e.valueType)}) * 1000);`,
    ),
    needsAwait: true,
  };
}

function emitV2Tokenize(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(await __risu.tokenize(${resolveCall(e.value, e.valueType)}))`)};`,
    ),
    needsAwait: true,
  };
}

function emitV2QuickSearchChat(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    value: string;
    valueType: "var" | "value";
    condition: "loose" | "strict" | "regex";
    depth: string;
    depthType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.quickSearchChat(${resolveCall(e.value, e.valueType)}, ${JSON.stringify(e.condition)}, Number(${resolveCall(e.depth, e.depthType)})) ? "1" : "0"`)};`,
    ),
    needsAwait: false,
  };
}


function emitV2GetLastMessage(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `__risu.getLastMessage()`)};`),
    needsAwait: false,
  };
}

function emitV2GetMessageAtIndex(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.getMessageAtIndex(Number(${resolveCall(e.index, e.indexType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetMessageCount(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `String(__risu.getMessageCount())`)};`),
    needsAwait: false,
  };
}

function emitV2GetLastUserMessage(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `__risu.getLastUserMessage()`)};`),
    needsAwait: false,
  };
}

function emitV2GetLastCharMessage(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `__risu.getLastCharMessage()`)};`),
    needsAwait: false,
  };
}

function emitV2GetFirstMessage(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `__risu.getFirstMessage()`)};`),
    needsAwait: false,
  };
}


function emitV2ShowAlert(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(ctx, `await __risu.showAlert("normal", ${resolveCall(e.value, e.valueType)}, "");`),
    needsAwait: true,
  };
}

function emitV2RunLLM(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* v2RunLLM skipped — lowLevelAccess only */`), needsAwait: false };
  }
  const e = op as unknown as {
    value: string;
    valueType: "var" | "value";
    model: "model" | "submodel";
    streaming?: boolean;
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `await __risu.runLLM(${resolveCall(e.value, e.valueType)}, ${JSON.stringify(e.model)}, ${Boolean(e.streaming)})`)};`,
    ),
    needsAwait: true,
  };
}

function emitV2GetAlertInput(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  const e = op as unknown as { display: string; displayType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `await __risu.alertInput(${resolveCall(e.display, e.displayType)})`)};`,
    ),
    needsAwait: true,
  };
}

function emitV2GetAlertSelect(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  const e = op as unknown as {
    display: string;
    displayType: "var" | "value";
    value: string;
    valueType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `await __risu.alertSelect(${resolveCall(e.display, e.displayType)}, String(${resolveCall(e.value, e.valueType)}).split("|"))`)};`,
    ),
    needsAwait: true,
  };
}

function emitV2CheckSimilarity(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* v2CheckSimilarity skipped — lowLevelAccess only */`), needsAwait: false };
  }
  const e = op as unknown as {
    source: string;
    sourceType: "var" | "value";
    value: string;
    valueType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `(await __risu.checkSimilarity(${resolveCall(e.value, e.valueType)}, ${resolveCall(e.source, e.sourceType)})).join("§")`)};`,
    ),
    needsAwait: true,
  };
}

function emitV2ImgGen(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* v2ImgGen skipped — lowLevelAccess only */`), needsAwait: false };
  }
  const e = op as unknown as {
    value: string;
    valueType: "var" | "value";
    negValue: string;
    negValueType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `await __risu.runImgGen(${resolveCall(e.value, e.valueType)}, ${resolveCall(e.negValue, e.negValueType)})`)};`,
    ),
    needsAwait: true,
  };
}


function emitV2ExtractRegex(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    value: string;
    valueType: "var" | "value";
    regex: string;
    regexType: "var" | "value";
    flags: string;
    flagsType: "var" | "value";
    result: string;
    resultType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(
        e.outputVar,
        `__risu.extractRegex(${resolveCall(e.value, e.valueType)}, ${resolveCall(e.regex, e.regexType)}, ${resolveCall(e.flags, e.flagsType)}, ${resolveCall(e.result, e.resultType)})`,
      )};`,
    ),
    needsAwait: false,
  };
}

function emitV2RegexTest(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    value: string;
    valueType: "var" | "value";
    regex: string;
    regexType: "var" | "value";
    flags: string;
    flagsType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(
        e.outputVar,
        `__risu.regexTest(${resolveCall(e.value, e.valueType)}, ${resolveCall(e.regex, e.regexType)}, ${resolveCall(e.flags, e.flagsType)}) ? "1" : "0"`,
      )};`,
    ),
    needsAwait: false,
  };
}

function emitV2ReplaceString(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    source: string;
    sourceType: "var" | "value";
    regex: string;
    regexType: "var" | "value";
    result: string;
    resultType: "var" | "value";
    replacement: string;
    replacementType: "var" | "value";
    flags: string;
    flagsType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(
        e.outputVar,
        `__risu.replaceString(${resolveCall(e.source, e.sourceType)}, ${resolveCall(e.regex, e.regexType)}, ${resolveCall(e.result, e.resultType)}, ${resolveCall(e.replacement, e.replacementType)}, ${resolveCall(e.flags, e.flagsType)})`,
      )};`,
    ),
    needsAwait: false,
  };
}


function emitV2Random(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    min: string;
    minType: "var" | "value";
    max: string;
    maxType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(__risu.random(Number(${resolveCall(e.min, e.minType)}), Number(${resolveCall(e.max, e.maxType)})))`)};`,
    ),
    needsAwait: false,
  };
}


function emitV2GetCharAt(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    source: string;
    sourceType: "var" | "value";
    index: string;
    indexType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `(String(${resolveCall(e.source, e.sourceType)})[Number(${resolveCall(e.index, e.indexType)})] ?? "null")`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetCharCount(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { source: string; sourceType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(String(${resolveCall(e.source, e.sourceType)}).length)`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2ToLowerCase(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { source: string; sourceType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(${resolveCall(e.source, e.sourceType)}).toLowerCase()`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2ToUpperCase(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { source: string; sourceType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(${resolveCall(e.source, e.sourceType)}).toUpperCase()`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2SetCharAt(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    source: string;
    sourceType: "var" | "value";
    index: string;
    indexType: "var" | "value";
    value: string;
    valueType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(
        e.outputVar,
        `__risu.setCharAt(${resolveCall(e.source, e.sourceType)}, Number(${resolveCall(e.index, e.indexType)}), ${resolveCall(e.value, e.valueType)})`,
      )};`,
    ),
    needsAwait: false,
  };
}

function emitV2SplitString(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    source: string;
    sourceType: "var" | "value";
    delimiter: string;
    delimiterType: "var" | "value" | "regex";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(
        e.outputVar,
        `JSON.stringify(__risu.splitString(${resolveCall(e.source, e.sourceType)}, ${resolveCall(e.delimiter, e.delimiterType)}, ${JSON.stringify(e.delimiterType)}))`,
      )};`,
    ),
    needsAwait: false,
  };
}

function emitV2ConcatString(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    source1: string;
    source1Type: "var" | "value";
    source2: string;
    source2Type: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(${resolveCall(e.source1, e.source1Type)}) + String(${resolveCall(e.source2, e.source2Type)})`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2Calculate(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    expression: string;
    expressionType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(__risu.calculate(${resolveCall(e.expression, e.expressionType)}))`)};`,
    ),
    needsAwait: false,
  };
}


function emitV2MakeArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string };
  return {
    code: line(
      ctx,
      `__risu.makeArrayVar(${resolveCall(e.var, "value")});`,
    ),
    needsAwait: false,
  };
}

function emitV2GetArrayVarLength(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(__risu.arrayLength(${resolveCall(e.var, "value")}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; index: string; indexType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.arrayGet(${resolveCall(e.var, "value")}, Number(${resolveCall(e.index, e.indexType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2SetArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    index: string;
    indexType: "var" | "value";
    value: string;
    valueType: "var" | "value";
  };
  return {
    code: line(
      ctx,
      `__risu.arraySet(${resolveCall(e.var, "value")}, Number(${resolveCall(e.index, e.indexType)}), ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2PushArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; value: string; valueType: "var" | "value" };
  return {
    code: line(
      ctx,
      `__risu.arrayPush(${resolveCall(e.var, "value")}, ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2PopArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.arrayPop(${resolveCall(e.var, "value")})`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2ShiftArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.arrayShift(${resolveCall(e.var, "value")})`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2UnshiftArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; value: string; valueType: "var" | "value" };
  return {
    code: line(
      ctx,
      `__risu.arrayUnshift(${resolveCall(e.var, "value")}, ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2SpliceArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    start: string;
    startType: "var" | "value";
    item: string;
    itemType: "var" | "value";
  };
  return {
    code: line(
      ctx,
      `__risu.arraySplice(${resolveCall(e.var, "value")}, Number(${resolveCall(e.start, e.startType)}), ${resolveCall(e.item, e.itemType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2SliceArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    start: string;
    startType: "var" | "value";
    end: string;
    endType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(
        e.outputVar,
        `__risu.arraySlice(${resolveCall(e.var, "value")}, Number(${resolveCall(e.start, e.startType)}), Number(${resolveCall(e.end, e.endType)}))`,
      )};`,
    ),
    needsAwait: false,
  };
}

function emitV2JoinArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    varType: "var" | "value";
    delimiter: string;
    delimiterType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.arrayJoin(${resolveCall(e.var, e.varType)}, ${resolveCall(e.delimiter, e.delimiterType)})`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetIndexOfValueInArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; value: string; valueType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(__risu.arrayIndexOf(${resolveCall(e.var, "value")}, ${resolveCall(e.value, e.valueType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2RemoveIndexFromArrayVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; index: string; indexType: "var" | "value" };
  return {
    code: line(
      ctx,
      `__risu.arrayRemoveIndex(${resolveCall(e.var, "value")}, Number(${resolveCall(e.index, e.indexType)}));`,
    ),
    needsAwait: false,
  };
}


function emitV2MakeDictVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string };
  return {
    code: line(ctx, `__risu.makeDictVar(${resolveCall(e.var, "value")});`),
    needsAwait: false,
  };
}

function emitV2GetDictVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    varType: "var" | "value";
    key: string;
    keyType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.dictGet(${resolveCall(e.var, e.varType)}, ${resolveCall(e.key, e.keyType)})`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2SetDictVar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    varType: "var" | "value";
    key: string;
    keyType: "var" | "value";
    value: string;
    valueType: "var" | "value";
  };
  // Risu triggers.ts: varType==='value' is a no-op.
  if (e.varType === "value") {
    return { code: line(ctx, `/* v2SetDictVar skipped — varType='value' is a no-op in Risu */`), needsAwait: false };
  }
  return {
    code: line(
      ctx,
      `__risu.dictSet(${resolveCall(e.var, e.varType)}, ${resolveCall(e.key, e.keyType)}, ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2DeleteDictKey(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; varType: "var" | "value"; key: string; keyType: "var" | "value" };
  if (e.varType === "value") {
    return { code: line(ctx, `/* v2DeleteDictKey skipped — varType='value' */`), needsAwait: false };
  }
  return {
    code: line(
      ctx,
      `__risu.dictDelete(${resolveCall(e.var, e.varType)}, ${resolveCall(e.key, e.keyType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2HasDictKey(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    var: string;
    varType: "var" | "value";
    key: string;
    keyType: "var" | "value";
    outputVar: string;
  };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.dictHasKey(${resolveCall(e.var, e.varType)}, ${resolveCall(e.key, e.keyType)}) ? "1" : "0"`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2ClearDict(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string };
  return {
    code: line(ctx, `__risu.dictClear(${resolveCall(e.var, "value")});`),
    needsAwait: false,
  };
}

function emitV2GetDictSize(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; varType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(__risu.dictSize(${resolveCall(e.var, e.varType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetDictKeys(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; varType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `JSON.stringify(__risu.dictKeys(${resolveCall(e.var, e.varType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetDictValues(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { var: string; varType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `JSON.stringify(__risu.dictValues(${resolveCall(e.var, e.varType)}))`)};`,
    ),
    needsAwait: false,
  };
}


function emitV2GetCharacterDesc(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `await __risu.getCharacterDesc()`)};`),
    needsAwait: true,
  };
}

function emitV2SetCharacterDesc(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(ctx, `await __risu.setCharacterDesc(${resolveCall(e.value, e.valueType)});`),
    needsAwait: true,
  };
}

function emitV2GetPersonaDesc(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `await __risu.getPersonaDesc()`)};`),
    needsAwait: true,
  };
}

function emitV2SetPersonaDesc(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(ctx, `await __risu.setPersonaDesc(${resolveCall(e.value, e.valueType)});`),
    needsAwait: true,
  };
}

function emitV2GetReplaceGlobalNote(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `await __risu.getReplaceGlobalNote()`)};`),
    needsAwait: true,
  };
}

function emitV2SetReplaceGlobalNote(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(ctx, `await __risu.setReplaceGlobalNote(${resolveCall(e.value, e.valueType)});`),
    needsAwait: true,
  };
}

function emitV2GetAuthorNote(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `await __risu.getAuthorNote()`)};`),
    needsAwait: true,
  };
}

function emitV2SetAuthorNote(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  return {
    code: line(ctx, `await __risu.setAuthorNote(${resolveCall(e.value, e.valueType)});`),
    needsAwait: true,
  };
}


function emitV2ModifyLorebook(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    target: string;
    targetType: "var" | "value";
    value: string;
    valueType: "var" | "value";
  };
  return {
    code: line(
      ctx,
      `await __risu.modifyLorebook(${resolveCall(e.target, e.targetType)}, ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: true,
  };
}

function emitV2GetLorebook(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { target: string; targetType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.getLorebookByKey(${resolveCall(e.target, e.targetType)})`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetLorebookCount(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `String(__risu.getLorebookCount())`)};`),
    needsAwait: false,
  };
}

function emitV2GetLorebookEntry(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.getLorebookEntry(Number(${resolveCall(e.index, e.indexType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2SetLorebookActivation(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; value: boolean };
  return {
    code: line(
      ctx,
      `await __risu.setLorebookActivation(Number(${resolveCall(e.index, e.indexType)}), ${Boolean(e.value)});`,
    ),
    needsAwait: true,
  };
}

function emitV2GetLorebookIndexViaName(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { name: string; nameType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `String(__risu.getLorebookIndexViaName(${resolveCall(e.name, e.nameType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetAllLorebooks(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `JSON.stringify(__risu.getAllLorebooks())`)};`),
    needsAwait: false,
  };
}

function emitV2GetLorebookByName(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { name: string; nameType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `JSON.stringify(__risu.getLorebookByName(${resolveCall(e.name, e.nameType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2GetLorebookByIndex(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; outputVar: string };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.getLorebookByIndex(Number(${resolveCall(e.index, e.indexType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2CreateLorebook(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    name: string;
    nameType: "var" | "value";
    key: string;
    keyType: "var" | "value";
    content: string;
    contentType: "var" | "value";
    insertOrder: string;
    insertOrderType: "var" | "value";
  };
  return {
    code: line(
      ctx,
      `await __risu.createLorebook(${resolveCall(e.name, e.nameType)}, ${resolveCall(e.key, e.keyType)}, ${resolveCall(e.content, e.contentType)}, Number(${resolveCall(e.insertOrder, e.insertOrderType)}));`,
    ),
    needsAwait: true,
  };
}

function emitV2ModifyLorebookByIndex(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    index: string;
    indexType: "var" | "value";
    name: string;
    nameType: "var" | "value";
    key: string;
    keyType: "var" | "value";
    content: string;
    contentType: "var" | "value";
    insertOrder: string;
    insertOrderType: "var" | "value";
  };
  return {
    code: line(
      ctx,
      `await __risu.modifyLorebookByIndex(Number(${resolveCall(e.index, e.indexType)}), ${resolveCall(e.name, e.nameType)}, ${resolveCall(e.key, e.keyType)}, ${resolveCall(e.content, e.contentType)}, ${resolveCall(e.insertOrder, e.insertOrderType)});`,
    ),
    needsAwait: true,
  };
}

function emitV2DeleteLorebookByIndex(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value" };
  return {
    code: line(
      ctx,
      `await __risu.deleteLorebookByIndex(Number(${resolveCall(e.index, e.indexType)}));`,
    ),
    needsAwait: true,
  };
}

function emitV2GetLorebookCountNew(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `String(__risu.getLorebookCount())`)};`),
    needsAwait: false,
  };
}

function emitV2SetLorebookAlwaysActive(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; value: boolean };
  return {
    code: line(
      ctx,
      `await __risu.setLorebookAlwaysActive(Number(${resolveCall(e.index, e.indexType)}), ${Boolean(e.value)});`,
    ),
    needsAwait: true,
  };
}


function emitV2GetDisplayState(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `__risu.getDisplayState()`)};`),
    needsAwait: false,
  };
}

function emitV2SetDisplayState(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { value: string; valueType: "var" | "value" };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(ctx, `__risu.setDisplayState(${resolveCall(e.value, e.valueType)});`),
    needsAwait: false,
  };
}

function emitV2GetRequestState(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; outputVar: string };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.getRequestState(Number(${resolveCall(e.index, e.indexType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2SetRequestState(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    index: string;
    indexType: "var" | "value";
    value: string;
    valueType: "var" | "value";
  };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(
      ctx,
      `__risu.setRequestState(Number(${resolveCall(e.index, e.indexType)}), ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2GetRequestStateRole(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { index: string; indexType: "var" | "value"; outputVar: string };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(
      ctx,
      `${setVarCall(e.outputVar, `__risu.getRequestStateRole(Number(${resolveCall(e.index, e.indexType)}))`)};`,
    ),
    needsAwait: false,
  };
}

function emitV2SetRequestStateRole(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as {
    index: string;
    indexType: "var" | "value";
    value: string;
    valueType: "var" | "value";
  };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(
      ctx,
      `__risu.setRequestStateRole(Number(${resolveCall(e.index, e.indexType)}), ${resolveCall(e.value, e.valueType)});`,
    ),
    needsAwait: false,
  };
}

function emitV2GetRequestStateLength(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { outputVar: string };
  if (!ctx.displayMode) return { code: line(ctx, `return;`), needsAwait: false };
  return {
    code: line(ctx, `${setVarCall(e.outputVar, `String(__risu.getRequestStateLength())`)};`),
    needsAwait: false,
  };
}


function emitV2RunTrigger(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const e = op as unknown as { target: string };
  return { code: line(ctx, `await __risu.runTrigger(${JSON.stringify(e.target)});`), needsAwait: true };
}


export const V2_EMITTERS: Readonly<Record<string, EmitFn>> = {
  v2Header: emitV2Header,
  v2If: emitStructuralNoop,
  // Risu triggers.ts: v2IfVar is an alias for v2If.
  v2IfVar: emitStructuralNoop,
  v2IfAdvanced: emitStructuralNoop,
  v2Else: emitStructuralNoop,
  v2EndIndent: emitStructuralNoop,
  v2Loop: emitStructuralNoop,
  v2LoopNTimes: emitStructuralNoop,
  v2BreakLoop: emitStructuralNoop,
  v2Comment: emitV2Comment,
  v2StopTrigger: emitV2StopTrigger,
  v2ConsoleLog: emitV2ConsoleLog,
  v2SetVar: emitV2SetVar,
  v2DeclareLocalVar: emitV2DeclareLocalVar,
  v2CutChat: emitV2CutChat,
  v2ModifyChat: emitV2ModifyChat,
  v2SystemPrompt: emitV2SystemPrompt,
  v2Impersonate: emitV2Impersonate,
  v2Command: emitV2Command,
  v2SendAIprompt: emitV2SendAIprompt,
  v2StopPromptSending: emitV2StopPromptSending,
  v2UpdateGUI: emitV2UpdateGUI,
  v2UpdateChatAt: emitV2UpdateChatAt,
  v2Wait: emitV2Wait,
  v2Tokenize: emitV2Tokenize,
  v2QuickSearchChat: emitV2QuickSearchChat,
  v2GetLastMessage: emitV2GetLastMessage,
  v2GetMessageAtIndex: emitV2GetMessageAtIndex,
  v2GetMessageCount: emitV2GetMessageCount,
  v2GetLastUserMessage: emitV2GetLastUserMessage,
  v2GetLastCharMessage: emitV2GetLastCharMessage,
  v2GetFirstMessage: emitV2GetFirstMessage,
  v2ShowAlert: emitV2ShowAlert,
  v2RunLLM: emitV2RunLLM,
  v2GetAlertInput: emitV2GetAlertInput,
  v2GetAlertSelect: emitV2GetAlertSelect,
  v2CheckSimilarity: emitV2CheckSimilarity,
  v2ImgGen: emitV2ImgGen,
  v2ExtractRegex: emitV2ExtractRegex,
  v2RegexTest: emitV2RegexTest,
  v2ReplaceString: emitV2ReplaceString,
  v2Random: emitV2Random,
  v2GetCharAt: emitV2GetCharAt,
  v2GetCharCount: emitV2GetCharCount,
  v2ToLowerCase: emitV2ToLowerCase,
  v2ToUpperCase: emitV2ToUpperCase,
  v2SetCharAt: emitV2SetCharAt,
  v2SplitString: emitV2SplitString,
  v2ConcatString: emitV2ConcatString,
  v2Calculate: emitV2Calculate,
  v2MakeArrayVar: emitV2MakeArrayVar,
  v2GetArrayVarLength: emitV2GetArrayVarLength,
  v2GetArrayVar: emitV2GetArrayVar,
  v2SetArrayVar: emitV2SetArrayVar,
  v2PushArrayVar: emitV2PushArrayVar,
  v2PopArrayVar: emitV2PopArrayVar,
  v2ShiftArrayVar: emitV2ShiftArrayVar,
  v2UnshiftArrayVar: emitV2UnshiftArrayVar,
  v2SpliceArrayVar: emitV2SpliceArrayVar,
  v2SliceArrayVar: emitV2SliceArrayVar,
  v2JoinArrayVar: emitV2JoinArrayVar,
  v2GetIndexOfValueInArrayVar: emitV2GetIndexOfValueInArrayVar,
  v2RemoveIndexFromArrayVar: emitV2RemoveIndexFromArrayVar,
  v2MakeDictVar: emitV2MakeDictVar,
  v2GetDictVar: emitV2GetDictVar,
  v2SetDictVar: emitV2SetDictVar,
  v2DeleteDictKey: emitV2DeleteDictKey,
  v2HasDictKey: emitV2HasDictKey,
  v2ClearDict: emitV2ClearDict,
  v2GetDictSize: emitV2GetDictSize,
  v2GetDictKeys: emitV2GetDictKeys,
  v2GetDictValues: emitV2GetDictValues,
  v2GetCharacterDesc: emitV2GetCharacterDesc,
  v2SetCharacterDesc: emitV2SetCharacterDesc,
  v2GetPersonaDesc: emitV2GetPersonaDesc,
  v2SetPersonaDesc: emitV2SetPersonaDesc,
  v2GetReplaceGlobalNote: emitV2GetReplaceGlobalNote,
  v2SetReplaceGlobalNote: emitV2SetReplaceGlobalNote,
  v2GetAuthorNote: emitV2GetAuthorNote,
  v2SetAuthorNote: emitV2SetAuthorNote,
  v2ModifyLorebook: emitV2ModifyLorebook,
  v2GetLorebook: emitV2GetLorebook,
  v2GetLorebookCount: emitV2GetLorebookCount,
  v2GetLorebookEntry: emitV2GetLorebookEntry,
  v2SetLorebookActivation: emitV2SetLorebookActivation,
  v2GetLorebookIndexViaName: emitV2GetLorebookIndexViaName,
  v2GetAllLorebooks: emitV2GetAllLorebooks,
  v2GetLorebookByName: emitV2GetLorebookByName,
  v2GetLorebookByIndex: emitV2GetLorebookByIndex,
  v2CreateLorebook: emitV2CreateLorebook,
  v2ModifyLorebookByIndex: emitV2ModifyLorebookByIndex,
  v2DeleteLorebookByIndex: emitV2DeleteLorebookByIndex,
  v2GetLorebookCountNew: emitV2GetLorebookCountNew,
  v2SetLorebookAlwaysActive: emitV2SetLorebookAlwaysActive,
  v2GetDisplayState: emitV2GetDisplayState,
  v2SetDisplayState: emitV2SetDisplayState,
  v2GetRequestState: emitV2GetRequestState,
  v2SetRequestState: emitV2SetRequestState,
  v2GetRequestStateRole: emitV2GetRequestStateRole,
  v2SetRequestStateRole: emitV2SetRequestStateRole,
  v2GetRequestStateLength: emitV2GetRequestStateLength,
  v2RunTrigger: emitV2RunTrigger,
};
