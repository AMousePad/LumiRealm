import { describe, expect, test } from "bun:test";
import { migrateRetiredMacroNames } from "../../src/migrations/retired-macro.js";

describe("retired static macro projection migration", () => {
  test("restores generated leaf names without touching surrounding text", () => {
    expect(
      migrateRetiredMacroNames(
        "before {{risu_getvar::phase}} / {{risu_random::a,b}} after",
      ),
    ).toBe("before {{getvar::phase}} / {{random::a,b}} after");
  });

  test("restores nested generated leaf names in arguments", () => {
    expect(
      migrateRetiredMacroNames(
        "{{risu_min::{{risu_calc::1+2}}::{{risu_getvar::limit}}}}",
      ),
    ).toBe("{{min::{{calc::1+2}}::{{getvar::limit}}}}");

    expect(
      migrateRetiredMacroNames("{{compatible::{{risu_abs::-1}}}}"),
    ).toBe("{{compatible::{{abs::-1}}}}");

    expect(
      migrateRetiredMacroNames("{{risu_abs:{{risu_upper::x}}}}"),
    ).toBe("{{abs:{{upper::x}}}}");
  });

  test("restores structural blocks, separators, and close names", () => {
    expect(
      migrateRetiredMacroNames(
        "{{#risu_if::{{risu_equal::x::x}}}}yes{{else}}no{{/risu_if}}",
      ),
    ).toBe("{{#if {{equal::x::x}}}}yes{{:else}}no{{/if}}");

    expect(
      migrateRetiredMacroNames(
        "{{#risu_when::1::and::1}}yes{{/risu_when}}",
      ),
    ).toBe("{{#when::1::and::1}}yes{{/when}}");
  });

  test("restores arbitrary projected block names consistently", () => {
    expect(
      migrateRetiredMacroNames(
        "{{#risu_custom::arg}}body{{/risu_custom}}",
      ),
    ).toBe("{{#custom::arg}}body{{/custom}}");

    expect(
      migrateRetiredMacroNames(
        "{{#risu_custom::arg::arg}}body{{/risu_custom::arg}}",
      ),
    ).toBe("{{#custom::arg}}body{{/custom}}");
  });

  test("converts generated else only for the directly owning conditional", () => {
    expect(
      migrateRetiredMacroNames(
        "{{#risu_if::1}}{{#risu_custom}}A{{else}}B{{/risu_custom}}{{else}}C{{/risu_if}}",
      ),
    ).toBe(
      "{{#if 1}}{{#custom}}A{{else}}B{{/custom}}{{:else}}C{{/if}}",
    );
  });

  test("reconstructs opaque blocks from the retired encoded leaf form", () => {
    const encodedBody =
      "A\uE9B8\uE9B9getvar\uE9BC\uE9BDx\uE9BA\uE9BBB";
    expect(
      migrateRetiredMacroNames(
        `{{risu_each::{{risu_getvar::items}} as item::${encodedBody}}}`,
      ),
    ).toBe(
      "{{#each {{getvar::items}} as item}}A{{getvar::x}}B{{/each}}",
    );
  });

  test("restores keep-mode headers and legacy delimiters", () => {
    expect(
      migrateRetiredMacroNames("{{risu_each::keep a§b as x::body}}"),
    ).toBe("{{#each::keep a§b as x}}body{{/each}}");
    expect(
      migrateRetiredMacroNames("{{risu_escape::keep::  body  }}"),
    ).toBe("{{#escape::keep}}  body  {{/escape}}");
    expect(
      migrateRetiredMacroNames("{{risu_legacy::if 1\nYES}}"),
    ).toBe("{#if 1\nYES#}");
  });

  test("does not reinterpret authored names inside an encoded opaque body", () => {
    const encoded =
      "\uE9B8\uE9B9risu_custom\uE9BC\uE9BDx\uE9BA\uE9BB";
    const once = migrateRetiredMacroNames(`{{risu_pure::${encoded}}}`);
    expect(once).toBe("{{#pure}}{{risu_custom::x}}{{/pure}}");
    expect(migrateRetiredMacroNames(once)).toBe(once);
  });

  test("does not fabricate blocks from malformed projected leaves", () => {
    expect(migrateRetiredMacroNames("{{risu_pure}}")).toBe("{{pure}}");
    expect(migrateRetiredMacroNames("{{risu_abs")).toBe("{{risu_abs");
    expect(migrateRetiredMacroNames("{{#risu_if::1")).toBe(
      "{{#risu_if::1",
    );
  });

  test("does not rewrite plain text, attributes, metadata, or raw CBS", () => {
    const input =
      'risu_getvar data-key="risu_random" _risu_source_hash ' +
      "{{getvar::x}}";
    expect(migrateRetiredMacroNames(input)).toBe(input);
  });

  test("is idempotent", () => {
    const migrated = "{{#if 1}}{{getvar::x}}{{/if}}";
    expect(migrateRetiredMacroNames(migrated)).toBe(migrated);
  });
});
