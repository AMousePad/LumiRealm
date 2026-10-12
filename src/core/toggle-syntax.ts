// Direct port of Risu parseToggleSyntax.

export interface SidebarToggleGroup {
  readonly key?: string;
  readonly value?: string;
  readonly type: 'group';
  readonly children: SidebarToggle[];
}

export interface SidebarToggleGroupEnd {
  readonly key?: string;
  readonly value?: string;
  readonly type: 'groupEnd';
}

export interface SidebarToggleCaption {
  readonly key?: string;
  readonly value?: string;
  readonly type: 'caption';
}

export interface SidebarToggleDivider {
  readonly key?: string;
  readonly value?: string;
  readonly type: 'divider';
}

export interface SidebarToggleSelect {
  readonly key: string;
  readonly value: string;
  readonly type: 'select';
  readonly options: readonly string[];
}

export interface SidebarToggleInput {
  readonly key: string;
  readonly value: string;
  readonly type: 'text' | 'textarea' | undefined;
  readonly options?: readonly string[];
}

export type SidebarToggle =
  | SidebarToggleGroup
  | SidebarToggleGroupEnd
  | SidebarToggleCaption
  | SidebarToggleDivider
  | SidebarToggleSelect
  | SidebarToggleInput;

export function parseToggleSyntax(template: string | null | undefined): SidebarToggle[] {
  try {
    if (!template) return [];

    const out: SidebarToggle[] = [];
    const lines = template.split('\n');
    for (const line of lines) {
      const [keyRaw, valueRaw, typeRaw, optionRaw] = line.split('=');
      const key = keyRaw ?? '';
      const value = valueRaw ?? '';
      const type = typeRaw ?? '';

      if (type === 'group') {
        out.push({
          ...(key !== '' ? { key } : {}),
          ...(value !== '' ? { value } : {}),
          type: 'group',
          children: [],
        });
      } else if (type === 'groupEnd') {
        out.push({
          ...(key !== '' ? { key } : {}),
          ...(value !== '' ? { value } : {}),
          type: 'groupEnd',
        });
      } else if (type === 'divider') {
        out.push({
          ...(key !== '' ? { key } : {}),
          ...(value !== '' ? { value } : {}),
          type: 'divider',
        });
      } else if (type === 'caption' && value !== '') {
        out.push({
          ...(key !== '' ? { key } : {}),
          value,
          type: 'caption',
        });
      } else if (key !== '' && value !== '') {
        if (type === 'select') {
          out.push({
            key,
            value,
            type: 'select',
            options: optionRaw !== undefined && optionRaw !== '' ? optionRaw.split(',') : [],
          });
        } else if (type === 'text' || type === 'textarea') {
          out.push({
            key,
            value,
            type,
            options: optionRaw !== undefined && optionRaw !== '' ? optionRaw.split(',') : [],
          });
        } else {
          out.push({
            key,
            value,
            type: undefined,
            options: optionRaw !== undefined && optionRaw !== '' ? optionRaw.split(',') : [],
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function extractToggleKeys(flat: readonly SidebarToggle[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of flat) {
    if (t.type === 'group' || t.type === 'groupEnd' || t.type === 'caption' || t.type === 'divider') {
      continue;
    }
    if (t.key && !seen.has(t.key)) {
      seen.add(t.key);
      out.push(t.key);
    }
  }
  return out;
}
