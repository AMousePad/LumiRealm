import type { SpindleAPI } from 'lumiverse-spindle-types';

import type { StoredRegexScript } from '../payload/types.js';
import type { BackendToFrontend } from '../types/messages.js';
import { awaitRegexInstall } from '../migrations/install-coordinator.js';
import { describeRegexOwnershipFailures, ensureRegexOwnership } from './regex-ownership.js';

type RegexApi = Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;

export interface CharacterRegexInstallDeps {
  readonly regexApi: RegexApi;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
}

/**
 * Installs the complete current character projection and only cleans stale
 * generated rows after ownership and frontend verification both succeed.
 */
export async function installCurrentCharacterRegexScripts(
  args: {
    readonly characterId: string;
    readonly characterName: string;
    readonly scripts: readonly StoredRegexScript[];
    readonly userId: string;
  },
  deps: CharacterRegexInstallDeps,
): Promise<void> {
  const pending = args.scripts.map((script) => ({
    ...script,
    metadata: { ...(script.metadata ?? {}) },
  }));
  const ownership = await ensureRegexOwnership(deps.regexApi, pending, args.userId);
  if (!ownership.allOwned) {
    throw new Error(
      `regex ownership incomplete: unowned=${ownership.unowned} failed=${ownership.failed}` +
        ` [${describeRegexOwnershipFailures(ownership.failures)}]`,
    );
  }
  const completion = await awaitRegexInstall(args.userId, (requestId) => {
    deps.send({
      type: 'install_regex_scripts',
      characterId: args.characterId,
      characterName: args.characterName,
      scripts: ownership.scripts.map((script) => ({
        ...script,
        metadata: { ...(script.metadata ?? {}) },
      })),
      cleanupStale: true,
      requestId,
    }, args.userId);
  });
  if (!completion.ok || !completion.cleanupCompleted) {
    throw new Error('regex install or verified stale cleanup did not complete');
  }
}
