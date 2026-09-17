import type { RisuCompatSettings } from './settings-store.js';
import type { AuxDebugCaptureEvent } from '../interpreter/runtime/dispatch-context.js';
import type { TriggerTemplateContext } from '../interpreter/runtime/template.js';

export type DispatchAuxDebugCapture = (event: AuxDebugCaptureEvent) => void;

export interface DispatchSeams {
  readonly chatId: string;
  readonly binding: string;
  readonly rememberOurWrite: (chatId: string, msgId: string, content: string) => void;
  readonly stateChanged: () => void;
  readonly auxConnectionId: string | null;
  readonly auxModelOverride: string | null;
  readonly auxSamplers: RisuCompatSettings['auxSamplers'];
  readonly submodelConnectionId: string | null;
  readonly submodelModelOverride: string | null;
  readonly submodelSamplers: RisuCompatSettings['submodelSamplers'];
  readonly auxPrefillCompat: boolean;
  readonly submodelPrefillCompat: boolean;
  readonly auxDebugCapture?: DispatchAuxDebugCapture;
  readonly resolveTemplate: (text: string) => Promise<string>;
  readonly templateContext: TriggerTemplateContext;
}

export interface BuildDispatchSeamsArgs {
  readonly chatId: string;
  readonly binding: string;
  readonly settings: RisuCompatSettings;
  readonly rememberOurWrite: (chatId: string, msgId: string, content: string) => void;
  readonly stateChanged: () => void;
  readonly auxDebugCapture: DispatchAuxDebugCapture | undefined;
  readonly resolveTemplate: (text: string) => Promise<string>;
  readonly templateContext: TriggerTemplateContext;
}

// Single source of truth for the dispatch-context / runtime-opts shape that
// `withDispatchContext`, `makeRisuTriggerRuntime`, and listenEdit chains share.
// Adding a new sampler or routing field touches one place instead of four.
export function buildDispatchSeams(args: BuildDispatchSeamsArgs): DispatchSeams {
  let templateContext: ReturnType<TriggerTemplateContext> | undefined;
  const seams: {
    chatId: string;
    binding: string;
    rememberOurWrite: BuildDispatchSeamsArgs['rememberOurWrite'];
    stateChanged: () => void;
    auxConnectionId: string | null;
    auxModelOverride: string | null;
    auxSamplers: RisuCompatSettings['auxSamplers'];
    submodelConnectionId: string | null;
    submodelModelOverride: string | null;
    submodelSamplers: RisuCompatSettings['submodelSamplers'];
    auxPrefillCompat: boolean;
    submodelPrefillCompat: boolean;
    auxDebugCapture?: DispatchAuxDebugCapture;
    resolveTemplate: (text: string) => Promise<string>;
    templateContext: TriggerTemplateContext;
  } = {
    chatId: args.chatId,
    binding: args.binding,
    rememberOurWrite: args.rememberOurWrite,
    stateChanged: args.stateChanged,
    auxConnectionId: args.settings.auxConnectionId,
    auxModelOverride: args.settings.auxModelOverride,
    auxSamplers: args.settings.auxSamplers,
    submodelConnectionId: args.settings.submodelConnectionId,
    submodelModelOverride: args.settings.submodelModelOverride,
    submodelSamplers: args.settings.submodelSamplers,
    auxPrefillCompat: args.settings.auxPrefillCompat,
    submodelPrefillCompat: args.settings.submodelPrefillCompat,
    resolveTemplate: args.resolveTemplate,
    templateContext: () => templateContext ??= args.templateContext(),
  };
  if (args.auxDebugCapture) seams.auxDebugCapture = args.auxDebugCapture;
  return seams;
}
