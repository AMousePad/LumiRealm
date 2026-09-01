import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decodeRisum, encodeRisum, RISUM_MAGIC, RISUM_VERSION } from "../../src/core/risum/codec.js";
import { TranslationError } from "../../src/core/errors.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "local_library", "derived", "risum");

function listFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".risum"))
    .map((f) => join(FIXTURES_DIR, f));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe("risum codec — corpus", () => {
  const fixtures = listFixtures();

  if (fixtures.length === 0) {
    test.skip("no fixtures present — run tests/setup/extract-fixtures.ts first", () => {});
    return;
  }

  for (const path of fixtures) {
    const name = path.split(/[\\/]/).pop()!;

    test(`decodes: ${name}`, () => {
      const raw = new Uint8Array(readFileSync(path));
      const env = decodeRisum(raw);
      expect(env.version).toBe(RISUM_VERSION);
      expect(typeof env.module).toBe("object");
      expect(env.module).not.toBeNull();
      // Every corpus module has a `name`.
      const mod = env.module as Record<string, unknown>;
      expect(typeof mod["name"]).toBe("string");
    });

    test(`decode→encode round-trips byte-identical (payloadText): ${name}`, () => {
      const raw = new Uint8Array(readFileSync(path));
      const env = decodeRisum(raw);
      // Use the verbatim payloadText so round-trip is provable for any valid
      // input regardless of which JSON formatter produced the original.
      const reencoded = encodeRisum({ payloadText: env.payloadText, assets: env.assets });
      expect(bytesEqual(reencoded, raw)).toBe(true);
    });
  }
});

describe("risum codec — payload formatting distribution", () => {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    test.skip("no fixtures", () => {});
  } else {
    test("tally of JSON indentation styles across corpus", () => {
      const styles = { compact: 0, indent2: 0, indent4: 0, other: 0 } as Record<string, number>;
      for (const path of fixtures) {
        const raw = new Uint8Array(readFileSync(path));
        const env = decodeRisum(raw);
        const t = env.payloadText;
        // Inspect the opening: '{' then either non-whitespace (compact) or
        // newline + N spaces (pretty).
        if (t.length < 3) { styles["other"]!++; continue; }
        if (t[1] !== "\n") { styles["compact"]!++; continue; }
        let i = 2;
        while (i < t.length && t[i] === " ") i++;
        const spaces = i - 2;
        if (spaces === 2) styles["indent2"]!++;
        else if (spaces === 4) styles["indent4"]!++;
        else styles["other"]!++;
      }
      console.log("[corpus] payload JSON formatting:", styles);
      // Every fixture must be classified.
      const total = Object.values(styles).reduce((a, b) => a + b, 0);
      expect(total).toBe(fixtures.length);
    });
  }
});

describe("risum codec — error handling", () => {
  test("rejects wrong magic", () => {
    const bad = new Uint8Array([0x00, 0x00, 0, 0, 0, 0, 0x00]);
    expect(() => decodeRisum(bad)).toThrow(TranslationError);
    try { decodeRisum(bad); } catch (e) {
      expect((e as TranslationError).kind).toBe("risum/bad_magic");
    }
  });

  test("rejects unsupported version", () => {
    const bad = new Uint8Array([RISUM_MAGIC, 0x99, 0, 0, 0, 0, 0x00]);
    expect(() => decodeRisum(bad)).toThrow(TranslationError);
    try { decodeRisum(bad); } catch (e) {
      expect((e as TranslationError).kind).toBe("risum/unsupported_version");
    }
  });

  test("rejects truncated header", () => {
    expect(() => decodeRisum(new Uint8Array([RISUM_MAGIC]))).toThrow(TranslationError);
    try { decodeRisum(new Uint8Array([RISUM_MAGIC])); } catch (e) {
      expect((e as TranslationError).kind).toBe("risum/truncated");
    }
  });

  test("rejects declared payload length beyond buffer", () => {
    // magic, version, length=0xFFFFFFFF, no payload
    const bad = new Uint8Array([RISUM_MAGIC, RISUM_VERSION, 0xff, 0xff, 0xff, 0xff]);
    try { decodeRisum(bad); } catch (e) {
      // Either payload_too_large or truncated depending on limit.
      expect(["risum/payload_too_large", "risum/truncated"]).toContain((e as TranslationError).kind);
    }
  });

  test("rejects payload with invalid JSON after RPack decode", () => {
    // Build a valid-framed but semantically broken payload:
    // take the RPack-encoded bytes of '{not json' and wrap them.
    // We rely on encodeRisum to produce the frame, but with a payload that
    // decodes to invalid JSON we bypass encodeRisum and hand-build.
    // Simpler: use encodeRisum with an object, mangle the payload mid-buffer.
    const valid = encodeRisum({ module: { name: "x", description: "", id: "1" } });
    const tampered = new Uint8Array(valid);
    // Corrupt a byte in the payload (offset 6 = first payload byte).
    tampered[6] = tampered[6]! ^ 0xff;
    tampered[7] = tampered[7]! ^ 0xff;
    tampered[8] = tampered[8]! ^ 0xff;
    try {
      decodeRisum(tampered);
      throw new Error("expected decodeRisum to throw");
    } catch (e) {
      if (!(e instanceof TranslationError)) throw e;
      // Corrupting bytes may produce invalid UTF-8 OR invalid JSON OR bad wrapper.
      expect([
        "risum/invalid_json",
        "risum/invalid_utf8",
        "risum/bad_wrapper",
      ]).toContain(e.kind);
    }
  });

  test("rejects missing end marker / bad asset mark", () => {
    // Build valid envelope, then overwrite the trailing end-marker byte.
    const valid = encodeRisum({ module: { name: "x", description: "", id: "1" } });
    const bad = new Uint8Array(valid);
    bad[bad.length - 1] = 0x99;
    try {
      decodeRisum(bad);
      throw new Error("expected throw");
    } catch (e) {
      if (!(e instanceof TranslationError)) throw e;
      expect(e.kind).toBe("risum/bad_mark");
    }
  });

  test("enforces maxPayloadBytes", () => {
    const valid = encodeRisum({ module: { name: "x", description: "", id: "1" } });
    expect(() => decodeRisum(valid, { maxPayloadBytes: 1 })).toThrow(TranslationError);
  });
});

describe("risum codec — encode round-trip with assets", () => {
  test("decode(encode(x)) === x for module + assets", () => {
    const module = {
      name: "test",
      description: "hello",
      id: "abc",
      lorebook: [{ key: "foo", content: "bar" }],
    };
    const assets = [
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array(1024), // zeros
      new Uint8Array([255, 0, 255, 0, 255]),
    ];
    const encoded = encodeRisum({ module, assets });
    const decoded = decodeRisum(encoded);
    expect(decoded.module).toEqual(module);
    expect(decoded.assets.length).toBe(3);
    for (let i = 0; i < assets.length; i++) {
      expect(Array.from(decoded.assets[i]!)).toEqual(Array.from(assets[i]!));
    }
  });

  test("encode→decode→encode is idempotent", () => {
    const module = { name: "n", description: "d", id: "i" };
    const e1 = encodeRisum({ module });
    const d1 = decodeRisum(e1);
    const e2 = encodeRisum({ module: d1.module, assets: d1.assets });
    expect(Array.from(e1)).toEqual(Array.from(e2));
  });
});
