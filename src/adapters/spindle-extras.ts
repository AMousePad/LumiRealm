declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// Lumi's pre-write content processor hook. Feature-detected:
// older Lumi builds leave this undefined.
export interface MessageContentProcessorCtx {
  readonly chatId: string;
  readonly messageId?: string;
  readonly content: string;
  readonly isUser: boolean;
  readonly extra?: Record<string, unknown>;
  readonly origin: 'create' | 'update' | 'swipe_add' | 'swipe_update' | 'render';
  readonly swipeIndex?: number;
  readonly userId: string;
}
export interface MessageContentProcessorPatch {
  content?: string;
  extra?: Record<string, unknown>;
}
export type MessageContentProcessorHandler = (
  ctx: MessageContentProcessorCtx,
) => Promise<MessageContentProcessorPatch | void>;
export type RegisterMessageContentProcessor = (
  handler: MessageContentProcessorHandler,
  priority?: number,
) => void;

export function getRegisterMessageContentProcessor(): RegisterMessageContentProcessor | undefined {
  return (spindle as unknown as {
    registerMessageContentProcessor?: RegisterMessageContentProcessor;
  }).registerMessageContentProcessor;
}

// Macro interceptor: fires at the top of MacroEvaluator.evaluate.
export interface MacroInterceptorSnapshotEnv {
  readonly commit: boolean;
  readonly names: Record<string, string>;
  readonly character: Record<string, unknown>;
  readonly chat: Record<string, unknown>;
  readonly system: Record<string, unknown>;
  readonly variables: {
    readonly local: Record<string, string>;
    readonly global: Record<string, string>;
    readonly chat: Record<string, string>;
  };
  readonly extra: Record<string, unknown>;
}
export interface MacroInterceptorCtx {
  readonly template: string;
  readonly env: MacroInterceptorSnapshotEnv;
  readonly commit: boolean;
  readonly phase: 'prompt' | 'display' | 'response' | 'other';
  readonly sourceHint?: string;
  readonly userId?: string;
}
export interface MacroInterceptorRichResult {
  readonly text: string;
  readonly touchedVars?: readonly string[];
  readonly volatile?: boolean;
}
export type MacroInterceptorResult = string | MacroInterceptorRichResult | void;
export type MacroInterceptorHandler = (ctx: MacroInterceptorCtx) => Promise<MacroInterceptorResult>;
export type RegisterMacroInterceptor = (
  handler: MacroInterceptorHandler,
  priority?: number,
) => void;

export function getRegisterMacroInterceptor(): RegisterMacroInterceptor | undefined {
  return (spindle as unknown as {
    registerMacroInterceptor?: RegisterMacroInterceptor;
  }).registerMacroInterceptor;
}

// Prompt-assembly interceptor (editInput / editRequest hook chain entry).
export interface InterceptorContext {
  chatId?: string;
  connectionId?: string;
  personaId?: string;
  generationType?: 'normal' | 'continue' | 'regenerate' | 'swipe' | 'impersonate';
}
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}
export type InterceptorHandler = (
  messages: LlmMessage[],
  context: unknown,
) => Promise<LlmMessage[] | { messages: LlmMessage[]; parameters?: Record<string, unknown> }>;
export type RegisterInterceptor = (handler: InterceptorHandler, priority?: number) => void;

export function getRegisterInterceptor(): RegisterInterceptor | undefined {
  return (spindle as unknown as {
    registerInterceptor?: RegisterInterceptor;
  }).registerInterceptor;
}

// Awaited by the host before world-info activation and macro resolution.
export interface GenerationContextShape {
  chatId?: string;
  connectionId?: string;
  personaId?: string;
  generationType?: 'normal' | 'continue' | 'regenerate' | 'swipe' | 'impersonate';
  userId?: string;
  dryRun?: boolean;
  cancelGeneration?: boolean;
}
export type ContextHandlerFn = (context: unknown) => Promise<unknown>;
export type RegisterContextHandler = (
  handler: ContextHandlerFn,
  priority?: number,
  opts?: { timeoutMs?: number },
) => void;

export function getRegisterContextHandler(): RegisterContextHandler | undefined {
  return (spindle as unknown as {
    registerContextHandler?: RegisterContextHandler;
  }).registerContextHandler;
}

// Older hosts expose registerContextHandler without the context contract, so
// gate on the version, not the function.
export function getPreAssemblyContractVersion(): number {
  const contracts = (spindle as unknown as {
    contracts?: Readonly<Record<string, number>>;
  }).contracts;
  return typeof contracts?.['preAssemblyGenerationContext'] === 'number'
    ? contracts['preAssemblyGenerationContext']
    : 0;
}

// World-info interceptor (Tier 2 lorebook decorator gates).
export function getRegisterWorldInfoInterceptor():
  | typeof spindle.registerWorldInfoInterceptor
  | null {
  const fn = (spindle as unknown as { registerWorldInfoInterceptor?: unknown }).registerWorldInfoInterceptor;
  return typeof fn === 'function'
    ? (spindle.registerWorldInfoInterceptor.bind(spindle) as typeof spindle.registerWorldInfoInterceptor)
    : null;
}

// Modal confirm dialog. Optional on older Lumi builds.
export interface ModalConfirmOptions {
  title: string;
  message: string;
  variant?: 'info' | 'warning' | 'danger' | 'success';
  confirmLabel?: string;
  cancelLabel?: string;
  userId?: string;
}
export interface ModalConfirmApi {
  readonly confirm: (options: ModalConfirmOptions) => Promise<{ confirmed: boolean }>;
}

export function getModalConfirmApi(): ModalConfirmApi | null {
  const m = (spindle as unknown as { modal?: { confirm?: ModalConfirmApi['confirm'] } }).modal;
  // .bind(m) preserves `this` for hosts whose modal.confirm references private state (queue, decorators).
  // Without it the wrapper object becomes the receiver and the modal pipeline silently fails.
  return m?.confirm ? { confirm: m.confirm.bind(m) } : null;
}

// Connections list with extension-side typing.
export interface ConnectionDTOLike {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly is_default: boolean;
}
export type ConnectionsListFn = (uid?: string) => Promise<readonly ConnectionDTOLike[]>;

export function getConnectionsListFn(): ConnectionsListFn | null {
  const fn = (spindle as unknown as {
    connections?: { list?: ConnectionsListFn };
  }).connections?.list;
  return fn ?? null;
}
