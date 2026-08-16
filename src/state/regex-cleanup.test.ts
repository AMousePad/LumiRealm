import { describe, expect, test } from 'bun:test';

import type { PendingRegexScriptMsg } from '../types/messages.js';
import { planCardRegexCleanup, planModuleRegexCleanup } from './regex-cleanup.js';

const desired = [{ script_id: 'new' }] as PendingRegexScriptMsg[];

describe('regex cleanup planning', () => {
  test('never deletes card rows until every replacement is present', () => {
    expect(planCardRegexCleanup([
      { id: 'old', script_id: 'old', scope: 'character', scope_id: 'char' },
    ], 'char', desired)).toEqual({ verified: false, staleIds: [] });
  });

  test('removes only superseded card rows after verification', () => {
    const plan = planCardRegexCleanup([
      { id: 'new-row', script_id: 'new', scope: 'character', scope_id: 'char' },
      { id: 'old-row', script_id: 'old', scope: 'character', scope_id: 'char', metadata: { _risu: { origin: 'character' } } },
      { id: 'old-card-module-row', script_id: 'old-module', scope: 'character', scope_id: 'char', metadata: { _risu: { origin: 'module' } } },
      { id: 'manual-row', script_id: 'manual', scope: 'character', scope_id: 'char' },
      { id: 'module-row', script_id: 'module', scope: 'character', scope_id: 'char', metadata: { _risu: { module_id: 'mod' } } },
      { id: 'import-row', script_id: 'import', scope: 'character', scope_id: 'char', metadata: { _risu: { imported_regex: true } } },
    ], 'char', desired);
    expect(plan).toEqual({ verified: true, staleIds: ['old-row', 'old-card-module-row'] });
  });

  test('module cleanup is isolated by module id', () => {
    const plan = planModuleRegexCleanup([
      { id: 'new-row', script_id: 'new', metadata: { _risu: { module_id: 'mod' } } },
      { id: 'old-row', script_id: 'old', metadata: { _risu: { module_id: 'mod' } } },
      { id: 'foreign', script_id: 'old', metadata: { _risu: { module_id: 'other' } } },
    ], 'mod', desired);
    expect(plan).toEqual({ verified: true, staleIds: ['old-row'] });
  });

  test('verified empty replacements remove only the matching owned lifecycle rows', () => {
    expect(planCardRegexCleanup([
      { id: 'card', script_id: 'old', scope: 'character', scope_id: 'char', metadata: { _risu: { origin: 'character' } } },
      { id: 'manual', script_id: 'manual', scope: 'character', scope_id: 'char' },
    ], 'char', [])).toEqual({ verified: true, staleIds: ['card'] });
    expect(planModuleRegexCleanup([
      { id: 'module', script_id: 'old', metadata: { _risu: { module_id: 'mod' } } },
      { id: 'other', script_id: 'other', metadata: { _risu: { module_id: 'other' } } },
    ], 'mod', [])).toEqual({ verified: true, staleIds: ['module'] });
  });
});
