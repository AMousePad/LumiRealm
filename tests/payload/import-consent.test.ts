import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { importCard, type SpindleImportApi } from '../../src/payload/import.js';
import { RisuConsentDeclinedError } from '../../src/payload/codec.js';
import type { UserStorageLike } from '../../src/payload/installer.js';

const bytes = zipSync({ 'card.json': strToU8(JSON.stringify({
  spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: 'Consent fixture', extensions: { risuai: {
      lowLevelAccess: true, triggerscript: [{ type: 'output', lowLevelAccess: false,
        effect: [{ type: 'triggerlua', code: 'onOutput = function() end' }] }],
    } },
  },
})) });

test.each([true, false, undefined])('fresh import records only explicit consent %s', async (confirmed) => {
  const events: string[] = [];
  const unused = async (): Promise<never> => { throw new Error('unexpected asset or lore operation'); };
  const spindle: SpindleImportApi = {
    characters: {
      create: async () => { events.push('create'); return { id: 'character' }; },
      update: async () => { events.push('update'); }, setAvatar: unused,
    },
    world_books: { create: unused, update: unused, entries: { create: unused } },
    images: { uploadMany: unused },
    ...(confirmed === undefined ? {} : { requestConsent: async () => {
      events.push('consent'); return { confirmed };
    } }),
  };
  const pending = importCard({ bytes, fileName: 'fixture.charx', extensionVersion: 'test',
    userId: 'user', spindle, userStorage: {} as UserStorageLike });
  if (confirmed) {
    const result = await pending;
    expect(events[0]).toBe('consent');
    expect(events).toContain('create');
    expect(result.lumirealm.user_overrides.low_level_access_granted).toBe(true);
    expect(result.lumirealm.user_overrides.consent_acknowledged_at).toBeGreaterThan(0);
    expect(result.lumirealm.payload.requires.lowLevelAccess).toBe(true);
  } else {
    await expect(pending).rejects.toBeInstanceOf(RisuConsentDeclinedError);
    expect(events).toEqual(confirmed === false ? ['consent'] : []);
  }
});
