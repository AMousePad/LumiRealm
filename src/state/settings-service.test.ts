import { describe, expect, test } from 'bun:test';
import { createSettingsService, type SettingsServiceDeps } from './settings-service.js';

function service(listConnections: SettingsServiceDeps['listConnections']) {
  const warns: string[] = [];
  return {
    warns,
    value: createSettingsService({
      userStorage: () => ({}) as never,
      listConnections,
      send: () => {},
      log: { info: () => {}, warn: (message) => { warns.push(message); } },
      errMsg: (error) => error instanceof Error ? error.message : String(error),
    }),
  };
}

describe('SettingsService.listConnectionsForUser', () => {
  test('preserves the connection fields and user scope', async () => {
    const users: string[] = [];
    const { value } = service(async (userId) => {
      users.push(userId);
      return [{ id: 'id', name: 'name', provider: 'provider', model: 'model', is_default: true }];
    });

    await expect(value.listConnectionsForUser('user-1')).resolves.toEqual([
      { id: 'id', name: 'name', provider: 'provider', model: 'model', is_default: true },
    ]);
    expect(users).toEqual(['user-1']);
  });

  test('keeps call failures non-fatal', async () => {
    const { value, warns } = service(async () => { throw new Error('failed'); });

    await expect(value.listConnectionsForUser('user-1')).resolves.toEqual([]);
    expect(warns).toEqual(['listConnectionsForUser: list threw: failed']);
  });
});
