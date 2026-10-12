import type { SidebarToggle, SidebarToggleGroup } from '../../src/core/toggle-syntax.js';
export function groupToggles(flat: readonly SidebarToggle[]): SidebarToggle[] {
  const out: SidebarToggle[] = [];
  let openGroup: SidebarToggleGroup | null = null;
  for (const t of flat) {
    if (t.type === 'group') {
      // Risu Toggles.svelte:60-62: nested group replaces the open group.
      const fresh: SidebarToggleGroup = {
        ...(t.key !== undefined ? { key: t.key } : {}),
        ...(t.value !== undefined ? { value: t.value } : {}),
        type: 'group',
        children: [],
      };
      out.push(fresh);
      openGroup = fresh;
      continue;
    }
    if (t.type === 'groupEnd') {
      openGroup = null;
      continue;
    }
    if (openGroup) {
      (openGroup.children as SidebarToggle[]).push(t);
    } else {
      out.push(t);
    }
  }
  return out;
}

export function collectModuleToggleDsl(
  modules: readonly { customModuleToggle?: string | null | undefined }[],
): string {
  let out = '';
  for (const m of modules) {
    const dsl = m.customModuleToggle;
    if (typeof dsl === 'string' && dsl.length > 0) {
      out += '\n' + dsl + '\n';
    }
  }
  return out;
}

