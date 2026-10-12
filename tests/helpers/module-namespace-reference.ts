export function resolveAttachedHandlesByIdOrNamespace<
  T extends { readonly id: string; readonly module?: { readonly namespace?: unknown } | undefined },
>(handles: readonly string[], library: readonly T[]): readonly T[] {
  if (handles.length === 0) return [];
  const handleSet = new Set(handles);
  const out: T[] = [];
  const seenIds = new Set<string>();

  // Pass 1: direct id matches in attach order.
  for (const h of handles) {
    const env = library.find((e) => e.id === h);
    if (env && !seenIds.has(env.id)) {
      out.push(env);
      seenIds.add(env.id);
    }
  }

  // Pass 2: namespace fallback for handles that didn't resolve by id.
  for (const env of library) {
    if (seenIds.has(env.id)) continue;
    const ns = env.module?.namespace;
    if (typeof ns === 'string' && ns.length > 0 && handleSet.has(ns)) {
      out.push(env);
      seenIds.add(env.id);
    }
  }

  return out;
}

