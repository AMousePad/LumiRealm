import type { BackendToFrontend } from '../types/messages.js';
import type { ModalConfirmOptions } from '../state/consent-modals.js';
import type { JournalStorage } from '../state/image-journal.js';

export interface PromptOrphanReviewDeps {
  readonly detectDeletedWhileOff: (userId: string) => Promise<{
    readonly characterIds: readonly string[];
    readonly moduleIds: readonly string[];
  }>;
  readonly journalStorage: () => JournalStorage;
  readonly clearImageJournal: (storage: JournalStorage, userId: string, characterId: string) => Promise<void>;
  readonly clearModuleImageJournal: (storage: JournalStorage, userId: string, moduleId: string) => Promise<void>;
  readonly queueModalConfirm: (
    userId: string,
    options: Omit<ModalConfirmOptions, 'userId'>,
  ) => Promise<{ confirmed: boolean } | null>;
  readonly toastFor: (
    userId: string | undefined,
    kind: 'success' | 'warning' | 'error' | 'info',
    message: string,
    options?: { title?: string; duration?: number },
  ) => void;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly log: { readonly info: (m: string) => void; readonly debug: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

export function makePromptOrphanReviewIfAny(
  deps: PromptOrphanReviewDeps,
): (userId: string) => Promise<void> {
  const {
    detectDeletedWhileOff,
    journalStorage,
    clearImageJournal,
    clearModuleImageJournal,
    queueModalConfirm,
    toastFor,
    send,
    log,
    errMsg,
  } = deps;
  const orphanReviewPromptedFor = new Set<string>();

  return async (userId) => {
    if (orphanReviewPromptedFor.has(userId)) return;
    orphanReviewPromptedFor.add(userId);
    const tStart = Date.now();
    const detected = await detectDeletedWhileOff(userId);
    const charCount = detected.characterIds.length;
    const moduleCount = detected.moduleIds.length;
    if (charCount + moduleCount === 0) {
      log.debug(`orphan-review: nothing detected elapsed=${Date.now() - tStart}ms`);
      return;
    }
    // Surface the actual IDs at info level so the user can verify what's flagged, truncated for line readability.
    const charPreview = detected.characterIds.slice(0, 8).join(',');
    const charPreviewSuffix = detected.characterIds.length > 8 ? `…(+${detected.characterIds.length - 8})` : '';
    const modulePreview = detected.moduleIds.slice(0, 8).join(',');
    const modulePreviewSuffix = detected.moduleIds.length > 8 ? `…(+${detected.moduleIds.length - 8})` : '';
    log.info(
      `orphan-review: detected chars=${charCount} modules=${moduleCount} ` +
        `elapsed=${Date.now() - tStart}ms ` +
        `charIds=[${charPreview}${charPreviewSuffix}] ` +
        `moduleIds=[${modulePreview}${modulePreviewSuffix}]`,
    );
    const parts: string[] = [];
    if (charCount > 0) parts.push(`${charCount} character${charCount === 1 ? '' : 's'}`);
    if (moduleCount > 0) parts.push(`${moduleCount} module${moduleCount === 1 ? '' : 's'}`);
    const summarySubject = parts.join(' and ');
    const message =
      `Found leftover image journals for ${summarySubject} whose Lumi entries ` +
      `are gone. This includes anything deleted while LumiRealm wasn't running ` +
      `and incomplete cleanups from earlier sessions. Open Cleanup to review ` +
      `the actual image assets?`;
    log.info(`orphan-review: opening confirm modal`);
    const queued = await queueModalConfirm(userId, {
      title: 'Leftover RisuAI image entries detected',
      message,
      variant: 'info',
      confirmLabel: 'Review',
      cancelLabel: 'Dismiss',
    });
    let result: { confirmed: boolean } | null = queued;
    if (queued === null) {
      log.warn(`orphan-review: spindle.modal.confirm failed, falling back to toast`);
    }
    if (result === null) {
      try {
        toastFor(userId, 'warning',
          `Found leftover image journals for ${summarySubject}. ` +
            `Open Settings, Cleanup to review orphaned image assets.`,
          { title: 'lumirealm: leftover image entries' },
        );
      } catch (err) {
        log.warn(`orphan-review: toast fallback threw: ${errMsg(err)}`);
      }
      result = { confirmed: false };
    }
    // Drop the journals either way so the same set never re-prompts, orphan images themselves stay in Lumi storage and remain findable via Cleanup.
    for (const characterId of detected.characterIds) {
      await clearImageJournal(journalStorage(), userId, characterId).catch((err) => {
        log.warn(`orphan-review: clearImageJournal threw char=${characterId}: ${errMsg(err)}`);
      });
    }
    for (const moduleId of detected.moduleIds) {
      await clearModuleImageJournal(journalStorage(), userId, moduleId).catch((err) => {
        log.warn(`orphan-review: clearModuleImageJournal threw module=${moduleId}: ${errMsg(err)}`);
      });
    }
    log.info(
      `orphan-review: confirmed=${result.confirmed} cleared chars=${charCount} modules=${moduleCount}`,
    );
    if (result.confirmed) {
      send({ type: 'open_settings_cleanup' }, userId);
    }
  };
}
