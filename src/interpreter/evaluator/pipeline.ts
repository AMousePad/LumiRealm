
import { evaluate } from "./scanner.js";
import {
  buildEvaluatorContext,
  type BuildEvaluatorCtxInput,
  type VarReadRecorder,
} from "./context.js";

export type PipelinePhase = "commit" | "display";

export interface RunPipelineInput extends Omit<BuildEvaluatorCtxInput, "commit"> {
  /** Raw CBS template — card first_mes, bg-html, or a message's stored content. */
  readonly template: string;
  /** Controls the dry-fire gate on mutating handlers. */
  readonly phase: PipelinePhase;
}

export interface RunPipelineOptions {
  readonly recorder?: VarReadRecorder;
}

export function runPipeline(input: RunPipelineInput, opts?: RunPipelineOptions): string {
  const commit = input.phase === "commit";

  const ctx = buildEvaluatorContext({
    chatId: input.chatId,
    ...(opts?.recorder ? { recorder: opts.recorder } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.characterId !== undefined ? { characterId: input.characterId } : {}),
    userName: input.userName,
    charName: input.charName,
    ...(input.personaText !== undefined ? { personaText: input.personaText } : {}),
    character: input.character,
    chat: input.chat,
    variables: input.variables,
    // Risu chatVar.svelte.ts default fallback.
    ...(input.scriptstateDefaults ? { scriptstateDefaults: input.scriptstateDefaults } : {}),
    ...(input.system ? { system: input.system } : {}),
    ...(input.screenWidth !== undefined ? { screenWidth: input.screenWidth } : {}),
    ...(input.screenHeight !== undefined ? { screenHeight: input.screenHeight } : {}),
    ...(input.currentMessageIndexOverride !== undefined
      ? { currentMessageIndexOverride: input.currentMessageIndexOverride }
      : {}),
    ...(input.currentMessageRoleOverride !== undefined
      ? { currentMessageRoleOverride: input.currentMessageRoleOverride }
      : {}),
    ...(input.legacyMediaFindings !== undefined
      ? { legacyMediaFindings: input.legacyMediaFindings }
      : {}),
    ...(input.modulesByNamespace ? { modulesByNamespace: input.modulesByNamespace } : {}),
    ...(input.lorebook ? { lorebook: input.lorebook } : {}),
    ...(input.positionPt ? { positionPt: input.positionPt } : {}),
    ...(input.cbsContext ? { cbsContext: true } : {}),
    ...(input.rmVar ? { rmVar: true } : {}),
    ...(input.runVar ? { runVar: true } : {}),
    ...(input.suppressVarPersist ? { suppressVarPersist: true } : {}),
    commit,
  });

  return evaluate(input.template, ctx);
}
