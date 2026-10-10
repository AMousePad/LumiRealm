import { regexRowTargetsDisplay } from './regex-row.js';

type Row = Readonly<Record<string, unknown>>;
function sourceKey(metadata: Row): string | null {
  if (typeof metadata['module_id'] === 'string' && Number.isInteger(metadata['source_index'])) {
    return `module:${metadata['module_id']}:${metadata['source_index']}:${metadata['source_row_index']}`;
  }
  return Number.isInteger(metadata['order_index'])
    ? `${metadata['origin'] ?? 'character'}:${metadata['order_index']}` : null;
}

export function unicodeRegexPatch(row: Row, sources: readonly Row[]): Record<string, unknown> | null {
  if (!regexRowTargetsDisplay(row['target'])) return null;
  const metadata = row['metadata'] as Row | undefined;
  const risu = metadata?.['_risu'] as Row | undefined;
  if (!risu || risu['imported_regex'] === true || risu['unicode_flags'] !== undefined) return null;
  const key = sourceKey(risu);
  if (key === null) return null;
  const matches = sources.filter(source => {
    const sourceMetadata = (source['metadata'] as Row | undefined)?.['_risu'] as Row | undefined;
    return sourceMetadata && sourceKey(sourceMetadata) === key && regexRowTargetsDisplay(source['target']);
  });
  if (matches.length !== 1) return null;
  const source = matches[0]!;
  const sourceRisu = (source['metadata'] as Row)['_risu'] as Row;
  const flags = sourceRisu['unicode_flags'];
  if (typeof flags !== 'string' || row['find_regex'] !== source['find_regex'] || row['flags'] !== source['flags']
    || JSON.stringify(risu['flag_actions']) !== JSON.stringify(sourceRisu['flag_actions'])) return null;
  return { metadata: { ...metadata, _risu: { ...risu, unicode_flags: flags } } };
}
