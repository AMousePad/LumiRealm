export interface CaptureUserIdDeps {
  readonly capturedUserIds: Set<string>;
  readonly getSettingsForUser: (userId: string) => Promise<unknown>;
  readonly runMassModuleMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly runMassCharacterMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly runMacroUnprefixSweepIfNeeded: (userId: string) => Promise<void>;
  readonly runVarScopeMigrationIfNeeded: (userId: string) => Promise<void>;
  // Sends the initial missing-permissions notification to the newly captured
  // user. Without this, a user who connects after permissions finish loading
  // never sees the modal until perms change at runtime.
  readonly notifyMissingPermsForUser: (userId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

const MASS_MIGRATION_DEFER_MS = 3000;

export function makeCaptureUserId(deps: CaptureUserIdDeps): (userId: string | undefined, where: string) => void {
  const {
    capturedUserIds,
    getSettingsForUser,
    runMassModuleMigrationIfNeeded,
    runMassCharacterMigrationIfNeeded,
    runMacroUnprefixSweepIfNeeded,
    runVarScopeMigrationIfNeeded,
    log,
    errMsg,
  } = deps;

  const { notifyMissingPermsForUser } = deps;
  return (userId, where) => {
    if (!userId || capturedUserIds.has(userId)) return;
    capturedUserIds.add(userId);
    log.info(`captureUserId: bootstrap from ${where} userId=${userId}`);
    try { notifyMissingPermsForUser(userId); } catch (err) {
      log.warn(`captureUserId: notifyMissingPermsForUser failed for user=${userId}: ${errMsg(err)}`);
    }
    void getSettingsForUser(userId).catch((err) => {
      log.warn(`captureUserId: settings preload failed for user=${userId}: ${errMsg(err)}`);
    });
    // Modules first since characters attach to them, then characters.
    setTimeout(() => {
      void (async () => {
        try {
          await runMassModuleMigrationIfNeeded(userId);
        } catch (err) {
          log.warn(`captureUserId: mass module migration failed: ${errMsg(err)}`);
        }
        try {
          await runMassCharacterMigrationIfNeeded(userId);
        } catch (err) {
          log.warn(`captureUserId: mass character migration failed: ${errMsg(err)}`);
        }
        try {
          await runMacroUnprefixSweepIfNeeded(userId);
        } catch (err) {
          log.warn(`captureUserId: macro un-prefix sweep failed: ${errMsg(err)}`);
        }
        try {
          await runVarScopeMigrationIfNeeded(userId);
        } catch (err) {
          log.warn(`captureUserId: var-scope migration failed: ${errMsg(err)}`);
        }
      })();
    }, MASS_MIGRATION_DEFER_MS);
  };
}
