type Row = Readonly<Record<string, unknown>>;

const FIELDS = [
  'name', 'find_regex', 'replace_string', 'flags', 'scope', 'scope_id',
  'min_depth', 'max_depth', 'run_on_edit', 'substitute_macros', 'disabled',
  'sort_order', 'description', 'folder',
] as const;

export function embeddedSourceScriptId(row: Row): string {
  return typeof row['script_id'] === 'string'
    ? row['script_id'].toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '')
    : '';
}

export function isCharacterSource(row: Row): boolean {
  const risu = (row['metadata'] as Row | undefined)?.['_risu'] as Row | undefined;
  return row['scope'] === 'character' && typeof row['scope_id'] === 'string'
    && risu?.['origin'] === 'character' && !risu['module_id'] && !risu['imported_regex'];
}

function sameArray(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createEmbeddedSourceRetirementPatch(sources: readonly Row[]) {
  const byId = new Map<string, Row | null>();
  for (const source of sources) {
    const id = embeddedSourceScriptId(source);
    if (!id) continue;
    byId.set(id, byId.has(id) ? null : source);
  }
  return (row: Row): { disabled: true } | null => {
    if (row['disabled'] !== false || row['can_mutate'] === false || !isCharacterSource(row)) return null;
    const source = byId.get(embeddedSourceScriptId(row));
    if (!source || !isCharacterSource(source)) return null;
    if (Array.isArray(row['actions']) && row['actions'].length > 0) return null;
    if (!FIELDS.every((field) => row[field] === source[field])) return null;
    const target = Array.isArray(row['target']) ? row['target'] : [row['target']];
    const sourceTarget = Array.isArray(source['target']) ? source['target'] : [source['target']];
    if (!sameArray(target, sourceTarget)
      || !sameArray(row['placement'], source['placement'])
      || !sameArray(row['trim_strings'], source['trim_strings'])) return null;
    // Only the small projection metadata is serialized; large regex text is compared directly.
    if (JSON.stringify(row['metadata']) !== JSON.stringify(source['metadata'])) return null;
    return { disabled: true };
  };
}
