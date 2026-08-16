import type { LumirealmCharacterData, StoredRisuCard } from '../payload/types.js';
import type { RisuBinding } from './runtime.js';


export interface SpindleEventShape {
  readonly chatId?: string;
  readonly characterId?: string;
  readonly [k: string]: unknown;
}

export function eventToBinding(event: string): RisuBinding | null {
  switch (event) {
    case 'GENERATION_STARTED':
      return 'start';
    case 'GENERATION_ENDED':
      return 'output';
    default:
      return null;
  }
}

export const GENERATION_STARTED_BINDINGS: readonly RisuBinding[] = [
  'start',
  'request',
];

export const GENERATION_ENDED_BINDINGS: readonly RisuBinding[] = [
  'output',
];

export interface ActiveCard {
  readonly card: StoredRisuCard;
  readonly chatId: string;
  /** Owning user. Cache hits in cross-user requests must reject if mismatched. */
  readonly ownerUserId: string;
  /** Raw lumirealm character data (carries user_overrides — esp.
   *  `default_variables_overrides` consumed by State → Variables → Default). */
  readonly lumirealm: LumirealmCharacterData;
}
