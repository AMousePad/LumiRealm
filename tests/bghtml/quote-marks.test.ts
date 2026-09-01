import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import { setupQuoteMarks } from '../../src/bghtml/quote-marks.js';

let window: Window;
let originalDocument: Document | undefined;

const NOOP_FLOG = { warn: () => { /* */ } };

function makeHost(): { host: HTMLElement; shadow: ShadowRoot } {
  const host = window.document.createElement('div') as unknown as HTMLElement;
  (window.document.body as unknown as { appendChild(n: unknown): unknown }).appendChild(host);
  const shadow = (host as unknown as HTMLElement & { attachShadow(init: { mode: 'open' }): ShadowRoot })
    .attachShadow({ mode: 'open' });
  return { host, shadow };
}

beforeEach(() => {
  window = new Window();
  originalDocument = (globalThis as unknown as { document?: Document }).document;
  (globalThis as unknown as { document: Document }).document = window.document as unknown as Document;
  (globalThis as unknown as { window: typeof window }).window = window;
  (globalThis as unknown as { Node: typeof window.Node }).Node = window.Node as unknown as typeof window.Node;
  (globalThis as unknown as { NodeFilter: typeof window.NodeFilter }).NodeFilter =
    window.NodeFilter as unknown as typeof window.NodeFilter;
  (globalThis as unknown as { Element: typeof window.Element }).Element =
    window.Element as unknown as typeof window.Element;
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as unknown as { document?: Document }).document;
  } else {
    (globalThis as unknown as { document: Document }).document = originalDocument;
  }
});

describe('quote-marks — basic wrapping', () => {
  test('double quotes wrap with risu-mark="quote2"', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<p>She said "hello there".</p>';
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p>She said <mark risu-mark="quote2" data-lr-risu-quote="">"hello there"</mark>.</p>',
    );
  });

  test('single quotes wrap with risu-mark="quote1"', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = "<p>The 'Producer' arrived.</p>";
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p>The <mark risu-mark="quote1" data-lr-risu-quote="">\'Producer\'</mark> arrived.</p>',
    );
  });

  test('mixed quotes in one text node', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = `<p>"Hi" and 'bye'</p>`;
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toContain('<mark risu-mark="quote2"');
    expect(shadow.innerHTML).toContain('<mark risu-mark="quote1"');
  });
});

describe('quote-marks — apostrophe heuristic', () => {
  test("don't is not treated as a quote opener", () => {
    const { shadow } = makeHost();
    shadow.innerHTML = "<p>I don't think so.</p>";
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe("<p>I don't think so.</p>");
  });

  test("real single-quoted token after apostrophe still wraps", () => {
    const { shadow } = makeHost();
    shadow.innerHTML = "<p>It's a 'good' day.</p>";
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      "<p>It's a <mark risu-mark=\"quote1\" data-lr-risu-quote=\"\">'good'</mark> day.</p>",
    );
  });
});

describe('quote-marks — skip rules', () => {
  test('skips inside <code>', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<code>"raw"</code>';
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe('<code>"raw"</code>');
  });

  test('skips inside <pre>', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<pre>"raw"</pre>';
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe('<pre>"raw"</pre>');
  });

  test('skips inside <style>', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<style>p::before{content:"x"}</style>';
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe('<style>p::before{content:"x"}</style>');
  });

  test('skips inside <textarea>', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<textarea>"quoted"</textarea>';
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe('<textarea>"quoted"</textarea>');
  });
});

describe('quote-marks — idempotence', () => {
  test('walking twice does not double-wrap', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<p>"once"</p>';
    const qm = setupQuoteMarks(NOOP_FLOG);
    qm.walkShadow(shadow);
    const first = shadow.innerHTML;
    qm.walkShadow(shadow);
    expect(shadow.innerHTML).toBe(first);
  });
});

describe('quote-marks — DOM structure preserved', () => {
  test('text outside quotes survives intact across multiple text nodes', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = '<p>A <em>"quoted"</em> B</p>';
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p>A <em><mark risu-mark="quote2" data-lr-risu-quote="">"quoted"</mark></em> B</p>',
    );
  });

  test('no quote chars at all → no DOM change', () => {
    const { shadow } = makeHost();
    const html = '<p>plain text</p>';
    shadow.innerHTML = html;
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(html);
  });
});

describe('quote-marks — nesting', () => {
  test('single quotes nest INSIDE double quotes', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = `<p>"he said 'hi' to all"</p>`;
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p><mark risu-mark="quote2" data-lr-risu-quote="">"he said <mark risu-mark="quote1" data-lr-risu-quote="">\'hi\'</mark> to all"</mark></p>',
    );
  });

  test('double quotes nest INSIDE single quotes', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = `<p>'she replied "yes" later'</p>`;
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p><mark risu-mark="quote1" data-lr-risu-quote="">\'she replied <mark risu-mark="quote2" data-lr-risu-quote="">"yes"</mark> later\'</mark></p>',
    );
  });

  test('crossing ranges drop the offender, outer survives', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = `<p>"a 'b" c'</p>`;
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p><mark risu-mark="quote2" data-lr-risu-quote="">"a \'b"</mark> c\'</p>',
    );
  });

  test('sibling quotes render as two separate marks', () => {
    const { shadow } = makeHost();
    shadow.innerHTML = `<p>"first" then "second"</p>`;
    setupQuoteMarks(NOOP_FLOG).walkShadow(shadow);
    expect(shadow.innerHTML).toBe(
      '<p><mark risu-mark="quote2" data-lr-risu-quote="">"first"</mark> then <mark risu-mark="quote2" data-lr-risu-quote="">"second"</mark></p>',
    );
  });
});
