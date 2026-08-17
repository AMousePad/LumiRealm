export type { LlmMessageDTO as LlmMessage } from 'lumiverse-spindle-types';

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
