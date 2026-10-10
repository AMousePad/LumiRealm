/**
 * M17 — full-pipeline mode flag tests. Exercises the three modes through
 * `translateCharx` and asserts the bundle shape reflects each mode's
 * intended scope.
 */

import { describe, test, expect } from "bun:test";
import { translateCharx } from "../../src/core/pipeline/translate.js";

// Minimal synthetic charx with every surface present: regex, trigger,
// @@action, bg-html, CBS-ish text.
function makeCharx(): Uint8Array {
  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "M17 Fixture",
      description: "{{user}} meets {{char}}",
      personality: "",
      scenario: "",
      first_mes: "hi",
      mes_example: "",
      creator: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      tags: [],
      alternate_greetings: [],
      extensions: {
        risuai: {
          customScripts: [
            { comment: "echo-regex", in: "smile", out: "SMILE", type: "editoutput" },
            { comment: "emo-handler", in: "smile", out: "@@emo happy", type: "editoutput" },
          ],
          triggerscript: [
            {
              comment: "greet trigger",
              type: "input",
              conditions: [],
              effect: [
                { type: "setvar", var: "seen", operator: "=", value: "1" },
              ],
            },
          ],
          backgroundHTML: "<div>{mood}</div>",
        },
      },
    },
  };
  const json = JSON.stringify(card);
  const files: { name: string; content: Uint8Array }[] = [
    { name: "card.json", content: new TextEncoder().encode(json) },
  ];
  return buildMinimalZip(files);
}

// Minimal deflate-less ZIP builder for tests.
function buildMinimalZip(files: { name: string; content: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const entries: { name: string; offset: number; size: number }[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const header = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true);       // signature
    dv.setUint16(4, 20, true);                // version
    dv.setUint16(6, 0, true);                 // flags
    dv.setUint16(8, 0, true);                 // method: store
    dv.setUint16(10, 0, true);                // time
    dv.setUint16(12, 0, true);                // date
    dv.setUint32(14, crc32(f.content), true); // crc32
    dv.setUint32(18, f.content.length, true); // compressed size
    dv.setUint32(22, f.content.length, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true); // name length
    dv.setUint16(28, 0, true);                // extra length
    header.set(nameBytes, 30);
    parts.push(header);
    parts.push(f.content);
    entries.push({ name: f.name, offset, size: f.content.length });
    offset += header.length + f.content.length;
  }
  const centralDir: Uint8Array[] = [];
  const cdStart = offset;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const cd = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, crc32(files.find(f => f.name === e.name)!.content), true);
    dv.setUint32(20, e.size, true);
    dv.setUint32(24, e.size, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, e.offset, true);
    cd.set(nameBytes, 46);
    centralDir.push(cd);
    offset += cd.length;
  }
  const cdSize = offset - cdStart;
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdStart, true);
  dv.setUint16(20, 0, true);
  parts.push(...centralDir, eocd);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe("M17 — mode flag", () => {
  test("mode=walking-skeleton emits only character + lorebook; no scripts, no regex", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, { mode: "walking-skeleton" });
    expect(bundle.scripts).toHaveLength(0);
    expect(bundle.regexScripts).toHaveLength(0);
  });

  test("mode=full emits all surfaces: regex + triggers + @@actions + bg-html", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, { mode: "full" });
    const triggers = bundle.scripts.filter(s => s.type === "trigger");
    expect(triggers.length).toBeGreaterThanOrEqual(3);
    expect(bundle.regexScripts.length).toBe(1);
    expect(bundle.regexScripts[0]!.name).toBe("echo-regex");
  });

  test("mode=diagnostic emits all surfaces and preserves raw CBS in text", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, { mode: "diagnostic" });
    // Raw CBS preserved (no rewrite) — original `{{user}}` survives.
    expect(bundle.character.description).toBe("{{user}} meets {{char}}");
    // But scripts are still emitted.
    expect(bundle.scripts.length).toBeGreaterThan(0);
  });

  test("mode=full preserves raw CBS", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, { mode: "full" });
    expect(bundle.scripts.length).toBeGreaterThan(0);
    expect(bundle.character.description).toBe("{{user}} meets {{char}}");
  });

  test("emitRegex:false suppresses regex even in full mode", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, {
      mode: "full", emitRegex: false,
    });
    expect(bundle.regexScripts).toHaveLength(0);
  });

  test("emitTriggers:false suppresses trigger + @@action scripts", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, {
      mode: "full", emitTriggers: false,
    });
    const triggers = bundle.scripts.filter(s => s.type === "trigger");
    // Only the BG-HTML trigger should remain.
    expect(triggers.every(t => t.name === "risu-bg-html")).toBe(true);
  });

  test("emitBgHtml:false suppresses BG-HTML trigger", () => {
    const charx = makeCharx();
    const bundle = translateCharx(charx, {
      mode: "full", emitBgHtml: false,
    });
    expect(bundle.scripts.some(s => s.name === "risu-bg-html")).toBe(false);
  });

  test("walking-skeleton mode omits risuPayload", () => {
    const bundle = translateCharx(makeCharx(), { mode: "walking-skeleton" });
    expect(bundle.risuPayload).toBeNull();
  });

  test("full mode emits risuPayload with triggers + bg-html + at_actions + extras", () => {
    const bundle = translateCharx(makeCharx(), {
      mode: "full",
    });
    const payload = bundle.risuPayload;
    expect(payload).not.toBeNull();
    // The synthetic card has 1 trigger (input/setvar), 1 @@action (emo), 1 bg-html.
    expect(payload!.triggers.length).toBe(1);
    expect(payload!.at_actions.length).toBe(1);
    expect(payload!.background_html).toBe("<div>{mood}</div>");
    // No triggerlua → empty string entry parallel to the one trigger.
    expect(payload!.lua_scripts).toEqual([""]);
    expect(payload!.utility_bot).toBe(false);
    expect(payload!.requires.lua).toBe(false);
    expect(typeof payload!.translator_version).toBe("string");
    expect(payload!.risu_spec_version).toBe("risu-1");
  });
});
