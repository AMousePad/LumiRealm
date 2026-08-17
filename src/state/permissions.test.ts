import { describe, expect, test } from 'bun:test';
import {
  REQUIRED_PERMISSIONS,
  getMissingPermissions,
  initPermissions,
  subscribeToMissingChanges,
} from './permissions.js';

describe('initPermissions', () => {
  test('loads grants and applies permission changes', async () => {
    let changed: ((detail: { permission: string; granted: boolean; allGranted: string[] }) => void) | undefined;
    const initial = REQUIRED_PERMISSIONS.filter((permission) => permission !== 'images');
    (globalThis as { spindle?: unknown }).spindle = {
      permissions: {
        getGranted: async () => [...initial],
        onChanged(handler: (detail: { permission: string; granted: boolean; allGranted: string[] }) => void) {
          changed = handler;
          return () => {};
        },
      },
    };
    const notifications: string[][] = [];
    const unsubscribe = subscribeToMissingChanges((missing) => {
      notifications.push([...missing]);
    });

    await initPermissions({ info: () => {}, warn: () => {} });
    expect(getMissingPermissions()).toEqual(['images']);
    expect(notifications).toEqual([['images']]);

    changed!({ permission: 'images', granted: true, allGranted: [...REQUIRED_PERMISSIONS] });
    expect(getMissingPermissions()).toEqual([]);
    expect(notifications).toEqual([['images'], []]);
    unsubscribe();
    delete (globalThis as { spindle?: unknown }).spindle;
  });
});
