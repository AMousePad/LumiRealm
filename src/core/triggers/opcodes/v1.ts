import type { EmitContext, EmitFn, EmitResult } from "../types.js";
import { line, resolveCall, setVarCall } from "../types.js";
import type { TriggerEffect } from "../../schemas/triggerscript.js";


function emitSetvar(op: TriggerEffect, ctx: EmitContext): EmitResult {
  // Risu triggers.ts: setvar coerces both sides via Number(), falls back to 0 on NaN.
  const effect = op as unknown as {
    var: string;
    value: string;
    operator: "=" | "+=" | "-=" | "*=" | "/=";
  };
  const code = line(
    ctx,
    `await __risu.setvarV1(${JSON.stringify(effect.var)}, ${JSON.stringify(effect.operator)}, ${JSON.stringify(effect.value)});`,
  );
  return { code, needsAwait: true };
}

function emitImpersonate(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { role: "user" | "char"; value: string };
  const value = resolveCall(effect.value, "value");
  const code = line(
    ctx,
    `await __risu.impersonate(${JSON.stringify(effect.role)}, ${value});`,
  );
  return { code, needsAwait: true };
}

function emitSystemPrompt(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as {
    location: "start" | "historyend" | "promptend";
    value: string;
  };
  const value = resolveCall(effect.value, "value");
  const code = line(
    ctx,
    `await __risu.systemPrompt(${JSON.stringify(effect.location)}, ${value});`,
  );
  return { code, needsAwait: true };
}

function emitCommand(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { value: string };
  const value = resolveCall(effect.value, "value");
  const code = line(ctx, `await __risu.command(${value});`);
  return { code, needsAwait: true };
}

function emitStop(_op: TriggerEffect, ctx: EmitContext): EmitResult {
  return { code: line(ctx, `__risu.stopSending = true;`), needsAwait: false };
}

function emitRuntrigger(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { value: string };
  const code = line(ctx, `await __risu.runTrigger(${JSON.stringify(effect.value)});`);
  return { code, needsAwait: true };
}

function emitCutChat(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { start: string; end: string };
  const code = line(
    ctx,
    `await __risu.cutChat(Number(${resolveCall(effect.start, "value")}), Number(${resolveCall(effect.end, "value")}));`,
  );
  return { code, needsAwait: true };
}

function emitModifyChat(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { index: string; value: string };
  const code = line(
    ctx,
    `await __risu.modifyChat(Number(${resolveCall(effect.index, "value")}), ${resolveCall(effect.value, "value")});`,
  );
  return { code, needsAwait: true };
}

function emitShowAlert(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { alertType: string; value: string; inputVar: string };
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* showAlert skipped — requires lowLevelAccess */`), needsAwait: false };
  }
  if (ctx.displayMode) {
    return { code: line(ctx, `return;`), needsAwait: false };
  }
  const value = resolveCall(effect.value, "value");
  const inputVar = resolveCall(effect.inputVar, "value");
  const code = line(
    ctx,
    `await __risu.showAlert(${JSON.stringify(effect.alertType)}, ${value}, ${inputVar});`,
  );
  return { code, needsAwait: true };
}

function emitSendAIprompt(_op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* sendAIprompt skipped — requires lowLevelAccess */`), needsAwait: false };
  }
  return { code: line(ctx, `__risu.sendAIprompt = true;`), needsAwait: false };
}

function emitRunLLM(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* runLLM skipped — requires lowLevelAccess */`), needsAwait: false };
  }
  const effect = op as unknown as { value: string; inputVar: string };
  const code = line(
    ctx,
    `${setVarCall(effect.inputVar, `await __risu.runLLM(${resolveCall(effect.value, "value")}, "model")`)};`,
  );
  return { code, needsAwait: true };
}

function emitRunAxLLM(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* runAxLLM skipped — requires lowLevelAccess */`), needsAwait: false };
  }
  const effect = op as unknown as { value: string; inputVar: string };
  const code = line(
    ctx,
    `${setVarCall(effect.inputVar, `await __risu.runLLM(${resolveCall(effect.value, "value")}, "submodel")`)};`,
  );
  return { code, needsAwait: true };
}

function emitCheckSimilarity(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return {
      code: line(ctx, `/* checkSimilarity skipped — requires lowLevelAccess */`),
      needsAwait: false,
    };
  }
  const effect = op as unknown as { value: string; source: string; inputVar: string };
  const code = line(
    ctx,
    `${setVarCall(effect.inputVar, `(await __risu.checkSimilarity(${resolveCall(effect.value, "value")}, ${resolveCall(effect.source, "value")})).join("§")`)};`,
  );
  return { code, needsAwait: true };
}

function emitExtractRegex(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* extractRegex skipped — requires lowLevelAccess */`), needsAwait: false };
  }
  const effect = op as unknown as {
    value: string;
    regex: string;
    flags: string;
    result: string;
    inputVar: string;
  };
  const code = line(
    ctx,
    `${setVarCall(
      effect.inputVar,
      `__risu.extractRegex(${resolveCall(effect.value, "value")}, ${JSON.stringify(effect.regex)}, ${JSON.stringify(effect.flags)}, ${JSON.stringify(effect.result)}, true)`,
    )};`,
  );
  return { code, needsAwait: false };
}

function emitImgGen(op: TriggerEffect, ctx: EmitContext): EmitResult {
  if (!ctx.lowLevelAccess) {
    return { code: line(ctx, `/* runImgGen skipped — requires lowLevelAccess */`), needsAwait: false };
  }
  const effect = op as unknown as { value: string; negValue: string; inputVar: string };
  const code = line(
    ctx,
    `${setVarCall(effect.inputVar, `await __risu.runImgGen(${resolveCall(effect.value, "value")}, ${resolveCall(effect.negValue, "value")})`)};`,
  );
  return { code, needsAwait: true };
}

function emitTriggerCode(op: TriggerEffect, ctx: EmitContext): EmitResult {
  // triggercode has no executor case in Risu, no-op at runtime. Warn rather
  // than execute arbitrary card JS (ACE risk).
  const effect = op as { code?: string };
  const label = JSON.stringify(String(effect.code ?? '').slice(0, 60));
  const code = line(
    ctx,
    `__risu.warnDroppedTriggerCode && __risu.warnDroppedTriggerCode(${label});`,
  );
  return { code, needsAwait: false };
}

function emitTriggerLua(op: TriggerEffect, ctx: EmitContext): EmitResult {
  const effect = op as unknown as { code: string };
  const code = line(ctx, `await __risu.runLua(${JSON.stringify(effect.code)});`);
  return { code, needsAwait: true };
}

export const V1_EMITTERS: Readonly<Record<string, EmitFn>> = {
  setvar: emitSetvar,
  impersonate: emitImpersonate,
  systemprompt: emitSystemPrompt,
  command: emitCommand,
  stop: emitStop,
  runtrigger: emitRuntrigger,
  cutchat: emitCutChat,
  modifychat: emitModifyChat,
  showAlert: emitShowAlert,
  sendAIprompt: emitSendAIprompt,
  runLLM: emitRunLLM,
  runAxLLM: emitRunAxLLM,
  checkSimilarity: emitCheckSimilarity,
  extractRegex: emitExtractRegex,
  runImgGen: emitImgGen,
  triggercode: emitTriggerCode,
  triggerlua: emitTriggerLua,
};
