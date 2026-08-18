import type {
  RepairCardTarget,
  RepairModuleTarget,
} from '../types/messages.js';
import type { LumirealmCharacterData } from '../payload/types.js';

export interface RepairTargetCharacterEntry {
  readonly character: { readonly id: string; readonly name?: string | null };
  readonly data: LumirealmCharacterData | null;
}

export interface RepairTargetModuleEntry {
  readonly id: string;
  readonly name: string;
}

export interface RepairTargetSummary {
  readonly charactersToRetranslate: number;
  readonly modulesToReattach: number;
  readonly danglingModuleRefs: number;
  readonly cardTargets: readonly RepairCardTarget[];
  readonly moduleTargets: readonly RepairModuleTarget[];
}

/** Build the repair picker payload and the matching pair counts in one pass. */
export function buildRepairTargetSummary(
  entries: readonly RepairTargetCharacterEntry[],
  modules: readonly RepairTargetModuleEntry[],
): RepairTargetSummary {
  const moduleNames = new Map(modules.map((module) => [
    module.id,
    module.name.trim() || module.id,
  ]));
  const attachmentCounts = new Map<string, number>();
  const cardTargets: RepairCardTarget[] = [];
  let charactersToRetranslate = 0;
  let modulesToReattach = 0;
  let danglingModuleRefs = 0;

  for (const entry of entries) {
    if (!entry.data) continue;
    const attachedModuleIds = entry.data.user_overrides.attached_module_ids ?? [];
    const canRetranslate = entry.data.source !== undefined;
    if (canRetranslate) charactersToRetranslate++;
    cardTargets.push({
      characterId: entry.character.id,
      characterName: entry.character.name?.trim() || '(unnamed)',
      canRetranslate,
      attachedModuleCount: attachedModuleIds.length,
    });
    for (const moduleId of attachedModuleIds) {
      attachmentCounts.set(moduleId, (attachmentCounts.get(moduleId) ?? 0) + 1);
      if (moduleNames.has(moduleId)) modulesToReattach++;
      else danglingModuleRefs++;
    }
  }

  cardTargets.sort((a, b) =>
    a.characterName.localeCompare(b.characterName) || a.characterId.localeCompare(b.characterId));

  const moduleTargets: RepairModuleTarget[] = [];
  for (const [moduleId, attachmentCount] of attachmentCounts) {
    const moduleName = moduleNames.get(moduleId) ?? null;
    moduleTargets.push({
      moduleId,
      moduleName,
      missing: moduleName === null,
      attachmentCount,
    });
  }
  moduleTargets.sort((a, b) =>
    Number(a.missing) - Number(b.missing)
      || (a.moduleName ?? a.moduleId).localeCompare(b.moduleName ?? b.moduleId)
      || a.moduleId.localeCompare(b.moduleId));

  return {
    charactersToRetranslate,
    modulesToReattach,
    danglingModuleRefs,
    cardTargets,
    moduleTargets,
  };
}
