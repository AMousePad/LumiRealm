import {
  createSearchableSelect,
  type SearchableSelectHandle,
  type SearchableSelectItem,
} from './searchable-select.js';

export interface ChipMultiSelectItem extends SearchableSelectItem {
  readonly danger?: boolean;
}

export interface ChipMultiSelectOptions {
  readonly items: readonly ChipMultiSelectItem[];
  readonly selectedValues?: readonly string[];
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly emptySearchMessage?: string;
  readonly emptySelectionMessage?: string;
  readonly className?: string;
  readonly showBulkActions?: boolean;
  readonly collapsedChipLimit?: number;
  readonly onChange: (values: readonly string[]) => void;
}

export interface ChipMultiSelectHandle {
  readonly root: HTMLElement;
  getSelectedValues(): readonly string[];
  setSelectedValues(values: readonly string[]): void;
  setItems(items: readonly ChipMultiSelectItem[]): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

/** Searchable multi-select composed from the shared single-select and the
 * removable chip idiom first used by module attachments. Large selections
 * collapse to a bounded chip preview until explicitly expanded. */
export function createChipMultiSelect(opts: ChipMultiSelectOptions): ChipMultiSelectHandle {
  let items = opts.items.slice();
  let selected = new Set(opts.selectedValues ?? []);
  let disabled = false;
  let expanded = false;
  let destroyed = false;
  const collapsedLimit = Math.max(1, opts.collapsedChipLimit ?? 8);

  const root = document.createElement('div');
  root.className = 'lr-chip-select' + (opts.className ? ` ${opts.className}` : '');

  const chips = document.createElement('div');
  chips.className = 'lr-chip-select-chips';
  root.appendChild(chips);

  const toolbar = document.createElement('div');
  toolbar.className = 'lr-chip-select-toolbar';
  root.appendChild(toolbar);

  const count = document.createElement('span');
  count.className = 'lr-chip-select-count';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'lr-chip-select-action';
  selectAllBtn.textContent = 'Select all';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'lr-chip-select-action';
  clearBtn.textContent = 'Clear';

  let selector: SearchableSelectHandle;

  function selectedValues(): readonly string[] {
    return [...selected];
  }

  function itemByValue(): ReadonlyMap<string, ChipMultiSelectItem> {
    return new Map(items.map((item) => [item.value, item]));
  }

  function searchableItems(): readonly SearchableSelectItem[] {
    return items.map((item) => {
      if (!selected.has(item.value)) return item;
      const selectedHint = 'Selected - choose to remove';
      return {
        ...item,
        secondary: item.secondary ? `${item.secondary} · ${selectedHint}` : selectedHint,
      };
    });
  }

  function emitChange(): void {
    opts.onChange(selectedValues());
  }

  function toggleValue(value: string): void {
    const item = items.find((candidate) => candidate.value === value);
    if (!item || item.disabled || disabled) return;
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    sync();
    emitChange();
  }

  selector = createSearchableSelect({
    items: searchableItems(),
    placeholder: opts.placeholder ?? 'Search and select…',
    searchPlaceholder: opts.searchPlaceholder ?? 'Search…',
    emptyMessage: opts.emptySearchMessage ?? 'No matches',
    className: 'lr-chip-select-trigger',
    onChange(value) {
      if (value !== null) toggleValue(value);
    },
  });
  toolbar.appendChild(selector.root);
  toolbar.appendChild(count);
  if (opts.showBulkActions !== false) {
    toolbar.appendChild(selectAllBtn);
    toolbar.appendChild(clearBtn);
  }

  function makeChip(value: string, item: ChipMultiSelectItem | undefined): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'lr-chip-select-chip';
    chip.setAttribute('data-value', value);
    if (!item || item.danger) chip.classList.add('lr-chip-select-chip-missing');

    const label = document.createElement('span');
    label.className = 'lr-chip-select-chip-label';
    label.textContent = item?.label ?? value;
    label.title = item?.title ?? item?.label ?? value;
    chip.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'lr-chip-select-chip-x';
    remove.textContent = '×';
    remove.title = `Remove ${label.textContent}`;
    remove.disabled = disabled;
    remove.addEventListener('click', () => {
      if (disabled) return;
      selected.delete(value);
      sync();
      emitChange();
    });
    chip.appendChild(remove);
    return chip;
  }

  function renderChips(): void {
    chips.replaceChildren();
    const values = selectedValues();
    if (values.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'lr-chip-select-empty';
      empty.textContent = opts.emptySelectionMessage ?? 'None selected';
      chips.appendChild(empty);
      chips.classList.remove('lr-chip-select-chips-expanded');
      return;
    }

    const byValue = itemByValue();
    const visible = expanded ? values : values.slice(0, collapsedLimit);
    for (const value of visible) chips.appendChild(makeChip(value, byValue.get(value)));

    if (values.length > collapsedLimit) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'lr-chip-select-more';
      toggle.textContent = expanded ? 'Show less' : `+${values.length - collapsedLimit} more`;
      toggle.disabled = disabled;
      toggle.addEventListener('click', () => {
        expanded = !expanded;
        renderChips();
      });
      chips.appendChild(toggle);
    }
    chips.classList.toggle('lr-chip-select-chips-expanded', expanded);
  }

  function sync(): void {
    selector.setItems(searchableItems());
    selector.setValue(null);
    selector.setDisabled(disabled || items.length === 0);
    const selectable = items.filter((item) => !item.disabled);
    const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.value));
    selectAllBtn.disabled = disabled || selectable.length === 0 || allSelected;
    clearBtn.disabled = disabled || selected.size === 0;
    count.textContent = `${selected.size} selected`;
    renderChips();
  }

  selectAllBtn.addEventListener('click', () => {
    if (disabled) return;
    for (const item of items) {
      if (!item.disabled) selected.add(item.value);
    }
    sync();
    emitChange();
  });

  clearBtn.addEventListener('click', () => {
    if (disabled || selected.size === 0) return;
    selected.clear();
    expanded = false;
    sync();
    emitChange();
  });

  sync();

  return {
    root,
    getSelectedValues: selectedValues,
    setSelectedValues(values) {
      selected = new Set(values);
      if (selected.size <= collapsedLimit) expanded = false;
      sync();
    },
    setItems(next) {
      items = next.slice();
      sync();
    },
    setDisabled(next) {
      disabled = next;
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      selector.destroy();
      root.replaceChildren();
    },
  };
}
