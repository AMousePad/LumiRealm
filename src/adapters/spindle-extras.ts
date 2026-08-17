declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

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
export function getPreAssemblyContractVersion(): number {
  const contracts = (spindle as unknown as {
    contracts?: Readonly<Record<string, number>>;
  }).contracts;
  return typeof contracts?.['preAssemblyGenerationContext'] === 'number'
    ? contracts['preAssemblyGenerationContext']
    : 0;
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
