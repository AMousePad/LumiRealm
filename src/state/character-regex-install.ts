import type { SpindleAPI } from 'lumiverse-spindle-types';

import type { StoredRegexScript } from '../payload/types.js';
import type { BackendToFrontend } from '../types/messages.js';
import { awaitRegexInstall } from '../migrations/install-coordinator.js';
import { describeRegexOwnershipFailures, ensureRegexOwnership } from './regex-ownership.js';

type RegexApi = Pick<SpindleAPI['regex_scripts'], 'list' | 'create' | 'update'>;

export interface CharacterRegexInstallDeps {
  readonly regexApi: RegexApi;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  /** Frontend cookie-auth REST delete. Reaches rows the Spindle API refuses. */
  readonly deleteRegexRows?: (userId: string, ids: readonly string[]) => Promise<number>;
  readonly log?: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
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
  let ownership = await ensureRegexOwnership(deps.regexApi, pending, args.userId);
  if (ownership.unowned > 0 && deps.deleteRegexRows) {
    // Rows predating host regex ownership can be neither updated nor deleted
    // through Spindle, which pins the card below every later migration. Drop
    // them over REST, then recreate them from the same projection as owned rows.
    const ids = ownership.unownedRowIds;
    deps.log?.info(
      `regex takeover: char=${args.characterId} deleting ${ids.length} unowned row(s) [${ids.join(',')}]`,
    );
    const removed = await deps.deleteRegexRows(args.userId, ids);
    // script_id is unique per user, so the replacement cannot be created before
    // the old row is gone. Anything already deleted is recreated by the next
    // run, which no longer finds a row shadowing it.
    if (removed !== ids.length) {
      throw new Error(
        `unowned regex takeover removed ${removed}/${ids.length} row(s), deleted rows are recreated on the next run`,
      );
    }
    ownership = await ensureRegexOwnership(deps.regexApi, pending, args.userId);
    deps.log?.info(
      `regex takeover: char=${args.characterId} recreated created=${ownership.created} ` +
        `stillUnowned=${ownership.unowned} failed=${ownership.failed}`,
    );
  }
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
