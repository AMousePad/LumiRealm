declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

// Permissions LumiRealm's own code uses directly. Missing entries fire the
// missing-permissions modal, and core functionality is degraded without them.
export const REQUIRED_PERMISSIONS: readonly string[] = [
  'chat_mutation',
  'chats',
  'characters',
  'generation',
  'interceptor',
  'context_handler',
  'macro_interceptor',
  'ui_panels',
  'ephemeral_storage',
  'world_books',
  'personas',
  'app_manipulation',
  'images',
  'regex_scripts',
];

export const PERMISSION_PURPOSE: Readonly<Record<string, string>> = {
  chat_mutation: 'apply Risu setChat / addChat / editOutput writebacks',
  chats: 'read chats and message history for trigger dispatch',
  characters: 'read and update Risu character data on import',
  generation: 'dispatch aux + submodel LLM calls (axLLM / runLLM)',
  interceptor: 'apply editInput / editRequest hooks at prompt assembly',
  context_handler: 'run input/start triggers pre-assembly and honor stopSending',
  macro_interceptor: 'route Risu CBS macros through the in-worker pipeline',
  ui_panels: 'mount the LumiRealm drawer + floating overlays',
  ephemeral_storage: 'cache Risu envelopes and image journals',
  world_books: 'create and update Risu lorebooks on import',
  personas: 'read the active persona for {{user}} resolution',
  app_manipulation: 'inject the bg-html host and message overlay',
  images: 'upload and serve card-bundled assets and SVG rasters',
  regex_scripts: 'patch character + module display regex rows during translator migrations and orphan cleanup',
};

interface PermLog {
  info(msg: string): void;
  warn(msg: string): void;
}

const granted = new Set<string>();
let loaded = false;
const missingChangeListeners = new Set<(missing: readonly string[]) => void>();

function computeMissing(): readonly string[] {
  return REQUIRED_PERMISSIONS.filter((p) => !granted.has(p));
}

export async function initPermissions(log: PermLog): Promise<void> {
  try {
    const list = await spindle.permissions.getGranted();
    for (const p of list) granted.add(p);
    loaded = true;
    const initialMissing = computeMissing();
    log.info(
      `permissions.init: granted=[${[...granted].join(',')}] missing=[${initialMissing.join(',')}]`,
    );
    // Fire listeners after initial load so any user who connected before
    // permissions were known (race during boot) still receives the missing-
    // permissions modal. Subsequent changes go through api.onChanged below.
    for (const fn of missingChangeListeners) {
      try { fn(initialMissing); } catch (err) {
        log.warn(`permissions.init: listener threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    log.warn(`permissions.init: getGranted failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    spindle.permissions.onChanged((detail) => {
      granted.clear();
      for (const p of detail.allGranted) granted.add(p);
      const missing = computeMissing();
      log.info(
        `permissions.changed: ${detail.permission}=${detail.granted ? 'granted' : 'revoked'} ` +
          `granted=[${detail.allGranted.join(',')}] missing=[${missing.join(',')}]`,
      );
      for (const fn of missingChangeListeners) {
        try { fn(missing); } catch (err) {
          log.warn(`permissions.changed: listener threw: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  } catch (err) {
    log.warn(`permissions.init: onChanged subscribe failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function isPermissionsLoaded(): boolean {
  return loaded;
}

export function getMissingPermissions(): readonly string[] {
  if (!loaded) return [];
  return computeMissing();
}

export function subscribeToMissingChanges(
  handler: (missing: readonly string[]) => void,
): () => void {
  missingChangeListeners.add(handler);
  return () => { missingChangeListeners.delete(handler); };
}
