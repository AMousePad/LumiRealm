export interface CaptureUserIdDeps {
  readonly capturedUserIds: Set<string>;
  readonly getSettingsForUser: (userId: string) => Promise<unknown>;
  readonly seedGlobalModules: (userId: string) => Promise<void>;
  readonly runMassModuleMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly runMassCharacterMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly runRetiredMacroMigrationIfNeeded: (userId: string) => Promise<void>;
  readonly runVarScopeMigrationIfNeeded: (userId: string) => Promise<void>;
  // Sends the initial missing-permissions notification to the newly captured
  // user. Without this, a user who connects after permissions finish loading
  // never sees the modal until perms change at runtime.
  readonly notifyMissingPermsForUser: (userId: string) => void;
  readonly log: { readonly info: (m: string) => void; readonly warn: (m: string) => void };
  readonly errMsg: (e: unknown) => string;
}

const MASS_MIGRATION_DEFER_MS = 3000;

export interface CaptureUser {
  captureUserId(userId: string | undefined, where: string): void;
  /** Mass migrations need a live frontend to ack regex installs, so they hold until one speaks. */
  markFrontendReady(userId: string | undefined): void;
}

export function makeCaptureUserId(deps: CaptureUserIdDeps): CaptureUser {
  const {
    capturedUserIds,
    getSettingsForUser,
    seedGlobalModules,
    runMassModuleMigrationIfNeeded,
    runMassCharacterMigrationIfNeeded,
    runRetiredMacroMigrationIfNeeded,
    runVarScopeMigrationIfNeeded,
    log,
    errMsg,
  } = deps;

  const { notifyMissingPermsForUser } = deps;
  const frontendReadyUsers = new Set<string>();
  const migrationWaiters = new Map<string, () => void>();

  const runMigrationChain = (userId: string): void => {
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
          await runRetiredMacroMigrationIfNeeded(userId);
        } catch (err) {
          log.warn(`captureUserId: retired macro migration failed: ${errMsg(err)}`);
        }
        try {
          await runVarScopeMigrationIfNeeded(userId);
        } catch (err) {
          log.warn(`captureUserId: var-scope migration failed: ${errMsg(err)}`);
        }
      })();
    }, MASS_MIGRATION_DEFER_MS);
  };

  const captureUserId = (userId: string | undefined, where: string): void => {
    if (!userId || capturedUserIds.has(userId)) return;
    capturedUserIds.add(userId);
    log.info(`captureUserId: bootstrap from ${where} userId=${userId}`);
    try { notifyMissingPermsForUser(userId); } catch (err) {
      log.warn(`captureUserId: notifyMissingPermsForUser failed for user=${userId}: ${errMsg(err)}`);
    }
    void getSettingsForUser(userId).catch((err) => {
      log.warn(`captureUserId: settings preload failed for user=${userId}: ${errMsg(err)}`);
    });
    // Before any chat can open, or the first active card is built with an empty
    // global list and silently misses those modules until the next module push.
    void seedGlobalModules(userId).catch((err) => {
      log.warn(`captureUserId: global module seed failed for user=${userId}: ${errMsg(err)}`);
    });
    // Modules first since characters attach to them, then characters. The chain
    // waits for a frontend: regex installs need its ack, and a boot with no tab
    // open used to time out every step and burn the retry until the next boot.
    if (frontendReadyUsers.has(userId)) {
      runMigrationChain(userId);
    } else {
      migrationWaiters.set(userId, () => runMigrationChain(userId));
    }
  };

  const markFrontendReady = (userId: string | undefined): void => {
    if (!userId || frontendReadyUsers.has(userId)) return;
    frontendReadyUsers.add(userId);
    const waiter = migrationWaiters.get(userId);
    if (waiter) {
      migrationWaiters.delete(userId);
      waiter();
    }
  };

  return { captureUserId, markFrontendReady };
}
