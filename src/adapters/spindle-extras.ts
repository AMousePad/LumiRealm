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
