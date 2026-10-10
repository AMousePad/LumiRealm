import { describe, it, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { createVirtualGrid } from '../../src/ui/virtual-grid.js';

let window: Window;
let originalDocument: Document | undefined;

beforeEach(() => {
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
  (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number })
    .requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: (id: number) => void })
    .cancelAnimationFrame = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  // No ResizeObserver in tests, virtual-grid falls back to its rAF path.
  delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
  window?.close();
});

function setHostDimensions(host: HTMLElement, width: number, height: number, scrollTop = 0): void {
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(host, 'scrollTop', { configurable: true, value: scrollTop, writable: true });
}

interface TestItem { id: string }

function makeItems(n: number): TestItem[] {
  const out: TestItem[] = [];
  for (let i = 0; i < n; i++) out.push({ id: `item-${i}` });
  return out;
}

describe('createVirtualGrid', () => {
  test('mounts host + inner with class names', () => {
    const items: TestItem[] = [];
    const grid = createVirtualGrid<TestItem>({
      hostClassName: 'my-host',
      innerClassName: 'my-inner',
      rowHeight: 40,
      getItems: () => items,
      renderItem: (item) => {
        const el = document.createElement('div');
        el.textContent = item.id;
        return el;
      },
    });
    expect(grid.host.className).toBe('my-host');
    expect(grid.inner.className).toBe('my-inner');
    expect(grid.host.contains(grid.inner)).toBe(true);
  });

  test('inner height equals N * rowHeight for single column', () => {
    const items = makeItems(50);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 80,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 300);
    grid.invalidate();
    expect(grid.inner.style.height).toBe('4000px');
  });

  test('mounts only visible window + overscan, not all items', () => {
    const items = makeItems(1000);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 40,
      overscanRows: 2,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 200);
    grid.invalidate();
    expect(grid.inner.children.length).toBeLessThan(20);
    expect(grid.inner.children.length).toBeGreaterThanOrEqual(5);
    const labels = Array.from(grid.inner.children).map((c) => c.textContent);
    expect(labels).toContain('item-0');
    expect(labels).not.toContain('item-500');
  });

  test('scrolling mounts new items and unmounts old ones', () => {
    const items = makeItems(1000);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 40,
      overscanRows: 1,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 200);
    grid.invalidate();
    expect(Array.from(grid.inner.children).map((c) => c.textContent)).toContain('item-0');

    setHostDimensions(grid.host, 400, 200, 20_000);
    grid.invalidate();
    const afterScroll = Array.from(grid.inner.children).map((c) => c.textContent);
    expect(afterScroll).not.toContain('item-0');
    expect(afterScroll.some((t) => /item-49\d/.test(t ?? ''))).toBe(true);
  });

  test('grid layout derives column count from minTileWidth', () => {
    const items = makeItems(8);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 100,
      minTileWidth: 100,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 1000);
    grid.invalidate();
    // 400/100=4 cols, 8/4=2 rows, height=200px.
    expect(grid.inner.style.height).toBe('200px');
    expect(grid.inner.children.length).toBe(8);
    const tile0 = grid.inner.children[0] as HTMLElement;
    const tile3 = grid.inner.children[3] as HTMLElement;
    const tile4 = grid.inner.children[4] as HTMLElement;
    expect(tile0.style.top).toBe('0px');
    expect(tile3.style.top).toBe('0px');
    expect(tile4.style.top).toBe('100px');
    expect(tile0.style.left).toBe('0px');
    expect(tile3.style.left).toBe('300px');
    expect(tile4.style.left).toBe('0px');
  });

  test('pinned indices stay mounted regardless of scroll', () => {
    const items = makeItems(500);
    const pinned = [3];
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 40,
      overscanRows: 1,
      getItems: () => items,
      pinnedIndices: () => pinned,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 200, 0);
    grid.invalidate();
    expect(Array.from(grid.inner.children).map((c) => c.textContent)).toContain('item-3');

    setHostDimensions(grid.host, 400, 200, 19_000);
    grid.invalidate();
    const labels = Array.from(grid.inner.children).map((c) => c.textContent);
    expect(labels).toContain('item-3');
  });

  test('invalidate after items shrink correctly removes nodes', () => {
    let items = makeItems(50);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 40,
      overscanRows: 1,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 200);
    grid.invalidate();
    const before = grid.inner.children.length;
    expect(before).toBeGreaterThan(0);
    items = [];
    grid.invalidate();
    expect(grid.inner.children.length).toBe(0);
    expect(grid.inner.style.height).toBe('0px');
  });

  test('refresh re-mounts visible nodes (drops cached references)', () => {
    let counter = 0;
    const items = makeItems(20);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 40,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.dataset.gen = String(counter++);
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 200);
    grid.invalidate();
    const firstGen = (grid.inner.children[0] as HTMLElement).dataset['gen'];
    grid.refresh();
    const secondGen = (grid.inner.children[0] as HTMLElement).dataset['gen'];
    expect(secondGen).not.toBe(firstGen);
  });

  test('destroy clears children and stops responding to scroll', () => {
    const items = makeItems(50);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 40,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 400, 200);
    grid.invalidate();
    expect(grid.inner.children.length).toBeGreaterThan(0);
    grid.destroy();
    expect(grid.inner.children.length).toBe(0);
  });

  test('handles 10k items without mounting all of them (cleanup-style scale)', () => {
    const items = makeItems(10_000);
    const grid = createVirtualGrid<TestItem>({
      rowHeight: 80,
      overscanRows: 2,
      getItems: () => items,
      renderItem: (it) => {
        const el = document.createElement('div');
        el.textContent = it.id;
        return el;
      },
    });
    document.body.appendChild(grid.host);
    setHostDimensions(grid.host, 800, 600);
    grid.invalidate();
    expect(grid.inner.children.length).toBeLessThan(50);
    expect(grid.inner.style.height).toBe('800000px');
  });
});
