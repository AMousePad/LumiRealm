import { describe, expect, test } from 'bun:test';
import { resolveAttachedHandlesByIdOrNamespace } from '../../src/state/modules-store.js';

// Direct port of Risu's `getModuleByIds` filter. Matches by EITHER
// `module.id` OR `module.namespace` and dedup's by id, with direct id
// matches preserving attach-list order and namespace fallback running second.

interface FakeEnv {
  readonly id: string;
  readonly module?: { readonly namespace?: string };
}

const env = (id: string, namespace?: string): FakeEnv =>
  namespace !== undefined ? { id, module: { namespace } } : { id };

describe('resolveAttachedHandlesByIdOrNamespace', () => {
  test('no handles → empty result', () => {
    const lib = [env('a'), env('b')];
    expect(resolveAttachedHandlesByIdOrNamespace([], lib)).toEqual([]);
  });

  test('direct id match preserves attach order', () => {
    const lib = [env('z'), env('y'), env('x')];
    const out = resolveAttachedHandlesByIdOrNamespace(['x', 'z'], lib);
    expect(out.map((e) => e.id)).toEqual(['x', 'z']);
  });

  test('handle missing from library → silently dropped (no throw)', () => {
    const lib = [env('a')];
    expect(resolveAttachedHandlesByIdOrNamespace(['ghost'], lib)).toEqual([]);
  });

  test('namespace fallback: handle matches a library entry\'s namespace', () => {
    const lib = [
      env('mod-A-v2-uuid', 'mod-A-v1-uuid'), // v2 declares v1's id as its namespace
    ];
    const out = resolveAttachedHandlesByIdOrNamespace(['mod-A-v1-uuid'], lib);
    expect(out.map((e) => e.id)).toEqual(['mod-A-v2-uuid']);
  });

  test('id wins over namespace match: when both routes hit the same library entry, id-pass picks it once (no dup)', () => {
    const lib = [
      env('m1', 'alias'),
    ];
    // Handle "m1" matches by id; "alias" would also match by namespace
    // — but the same library entry can only appear once (dedup by id).
    const out = resolveAttachedHandlesByIdOrNamespace(['m1', 'alias'], lib);
    expect(out.map((e) => e.id)).toEqual(['m1']);
  });

  test('two different modules, one matches by id and the other by namespace, both included', () => {
    const lib = [
      env('m1'),
      env('m2-uuid', 'replaced-m2'),
    ];
    const out = resolveAttachedHandlesByIdOrNamespace(['m1', 'replaced-m2'], lib);
    expect(out.map((e) => e.id)).toEqual(['m1', 'm2-uuid']);
  });

  test('multiple library modules sharing namespace: all matching ones included (Risu union semantics)', () => {
    // Risu's getModuleByIds returns all modules where id|namespace
    // matches, then dedupes by id. Two modules declaring the same
    // namespace BOTH come through if the namespace is in the handle
    // set — they have different ids so dedup-by-id keeps both.
    const lib = [
      env('uuid-A', 'common-ns'),
      env('uuid-B', 'common-ns'),
    ];
    const out = resolveAttachedHandlesByIdOrNamespace(['common-ns'], lib);
    expect(out.map((e) => e.id).sort()).toEqual(['uuid-A', 'uuid-B']);
  });

  test('empty namespace string is ignored (does not match any handle including empty string)', () => {
    const lib = [env('m1', '')];
    expect(resolveAttachedHandlesByIdOrNamespace([''], lib)).toEqual([]);
  });

  test('missing module entry (no `module` field at all) does not throw', () => {
    const lib = [{ id: 'm1' } as FakeEnv]; // no .module field
    const out = resolveAttachedHandlesByIdOrNamespace(['m1'], lib);
    expect(out.map((e) => e.id)).toEqual(['m1']);
  });

  test('attach list order: direct hits BEFORE namespace fallback hits', () => {
    const lib = [
      env('uuid-A', 'ns-handle'),
      env('uuid-B'),
    ];
    // Both 'ns-handle' (namespace match) and 'uuid-B' (direct match) in handles.
    // Result: direct hits first (uuid-B), then namespace fallback (uuid-A).
    const out = resolveAttachedHandlesByIdOrNamespace(['ns-handle', 'uuid-B'], lib);
    expect(out.map((e) => e.id)).toEqual(['uuid-B', 'uuid-A']);
  });

  test('duplicate handles dedup by resolved id (not by handle string)', () => {
    const lib = [env('m1', 'alias')];
    // 'm1' resolves directly; 'alias' would resolve via namespace — same module.
    const out = resolveAttachedHandlesByIdOrNamespace(['m1', 'alias', 'm1'], lib);
    expect(out.map((e) => e.id)).toEqual(['m1']);
  });
});
