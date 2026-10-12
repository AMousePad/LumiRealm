#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";

import { runPipeline } from "../src/interpreter/evaluator/pipeline.js";

interface ParserCheck { passed: boolean; reason: string }

// Risu cbs.ts callbacks for bkspc/erase mutate the parser buffer; declare uses matcherArg.var.
const PARSER_CASES = [
  { name: 'bkspc', reason: 'scanner output-buffer rewind', cases: [
    ['hello world {{bkspc}} user', 'hello user'], ['single{{bkspc}}replacement', 'replacement'],
  ] },
  { name: 'erase', reason: 'scanner output-buffer rewind', cases: [
    ["hello world. unfinished {{erase}} next", 'hello world. next'], ['unfinished{{erase}}replacement', 'replacement'],
  ] },
  { name: 'declare', reason: 'literal preservation without a caller variable map; supplied declaration maps are outside this check', cases: [
    ['{{declare::x}}', '{{declare::x}}'], ['{{declare::{{upper::x}}}}', '{{declare::X}}'],
    ['{{declare::x}}|{{tempvar::__declared_x__}}', '{{declare::x}}|'],
    ['{{#if 0}}{{declare::x}}{{/if}}end', 'end'],
  ] },
] as const;

export function checkParserMacros(evaluate: (template: string) => string = template => runPipeline({
  template, phase: 'display', chatId: '', userName: 'User', charName: 'Character',
  character: {}, chat: {}, variables: {}, reparseMacroResults: false,
})): ReadonlyMap<string, ParserCheck> {
  return new Map<string, ParserCheck>(PARSER_CASES.map(({ name, reason, cases }) => {
    try {
      for (const [template, expected] of cases) {
        const actual = evaluate(template);
        if (actual !== expected) return [name, { passed: false, reason: `${reason}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` }];
      }
      return [name, { passed: true, reason }];
    } catch (error) {
      return [name, { passed: false, reason: `${reason}: ${String(error)}` }];
    }
  }));
}

const HANDLERS_DIR = "src/risu-compat/handlers";

interface RisuMacro {
  name: string;
  aliases: readonly string[];
  body: string;
  startLine: number;
  endLine: number;
}

interface OurHandler {
  name: string;
  body: string;
  filePath: string;
  startLine: number;
}

function parseRisuMacros(risuDir: string): RisuMacro[] {
  const src = fs.readFileSync(path.join(risuDir, "src/ts/cbs.ts"), "utf-8");
  const lines = src.split("\n");
  const out: RisuMacro[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*name:\s*['"]([^'"]+)['"]/.exec(lines[i]!);
    if (!m) continue;
    const name = m[1]!;
    const start = Math.max(0, i - 2);
    let end = i + 1;
    let depth = 0;
    let inBody = false;
    for (let j = i; j < lines.length && j < i + 200; j++) {
      const line = lines[j]!;
      for (const ch of line) {
        if (ch === "{") {
          depth++;
          inBody = true;
        } else if (ch === "}") {
          depth--;
          if (inBody && depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (inBody && depth === 0) {
        end = j;
        break;
      }
    }
    const body = lines.slice(start, end + 1).join("\n");
    const aliasMatch = /alias:\s*\[([^\]]*)\]/.exec(body);
    const aliases = aliasMatch
      ? [...aliasMatch[1]!.matchAll(/['"]([^'"]+)['"]/g)].map((mm) => mm[1]!)
      : [];
    out.push({ name, aliases, body, startLine: start + 1, endLine: end + 1 });
  }
  return out;
}

function parseOurHandlers(): OurHandler[] {
  const out: OurHandler[] = [];
  const files = fs.readdirSync(HANDLERS_DIR).filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    const fp = path.join(HANDLERS_DIR, f);
    const src = fs.readFileSync(fp, "utf-8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*register\(\s*['"]([^'"]+)['"]/.exec(lines[i]!);
      if (!m) continue;
      const name = m[1]!;
      let depth = 0;
      let started = false;
      let end = i;
      for (let j = i; j < lines.length && j < i + 200; j++) {
        const line = lines[j]!;
        for (const ch of line) {
          if (ch === "(") {
            depth++;
            started = true;
          } else if (ch === ")") {
            depth--;
            if (started && depth === 0) {
              end = j;
              break;
            }
          }
        }
        if (started && depth === 0) {
          end = j;
          break;
        }
      }
      const body = lines.slice(i, end + 1).join("\n");
      out.push({ name, body, filePath: fp, startLine: i + 1 });
    }
  }
  return out;
}

export function classify(
  handler: OurHandler,
  risu: RisuMacro | null,
  parserChecks: ReadonlyMap<string, ParserCheck> = new Map(),
): { tier: string; reason: string } {
  const parserCheck = parserChecks.get(handler.name.toLowerCase());
  if (risu && parserCheck?.passed) return { tier: "OK", reason: parserCheck.reason };
  const body = handler.body;
  const codeOnly = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const fnMatch = codeOnly.match(/=>\s*([\s\S]*?)(?:,\s*['"]|;|$)/);
  const fnBody = fnMatch ? fnMatch[1]!.trim() : "";
  const isLiteralEmpty = /^['"]['"]$/.test(fnBody);
  const isLiteralZero = /^['"][01]['"]$/.test(fnBody);
  const isLiteralNull = /^['"]null['"]$/.test(fnBody);

  if (risu) {
    const risuBodyCondensed = risu.body.replace(/\s+/g, " ");
    const risuJustReturnsEmpty = /callback:[^{]*\{\s*return\s*['"]\s*['"]\s*\}/.test(risuBodyCondensed);
    if (isLiteralEmpty && risuJustReturnsEmpty) return { tier: "OK", reason: "matches Risu literal-empty" };
  }

  if (/Known deviation|known deviation|documented limitation/i.test(body)) {
    return { tier: "OK", reason: "documented deviation" };
  }

  if (isLiteralEmpty || isLiteralZero || isLiteralNull) {
    return { tier: "STUB", reason: `body=${fnBody}` };
  }
  const stubComments = [
    /always returns?/i,
    /always empty/i,
    /No\s+module state/i,
    /not implemented/i,
    /\bstub\b/i,
    /not yet/i,
    /TODO\b.*implement/i,
  ];
  for (const re of stubComments) {
    if (re.test(body)) return { tier: "SUSPECT", reason: `comment matches /${re.source}/` };
  }
  if (/\bunsupported\(/.test(body)) return { tier: "SUSPECT", reason: "calls unsupported(...)" };
  if (fnBody.length < 30 && /return ['"]/.test(fnBody)) {
    return { tier: "SUSPECT", reason: `short literal return: ${fnBody.slice(0, 60)}` };
  }
  return { tier: "OK", reason: "" };
}

function main() {
  const risuDir = process.env['RISUAI_DIR'];
  if (!risuDir || !fs.existsSync(risuDir)) {
    console.error("audit-handler-parity: set RISUAI_DIR to a RisuAI checkout to run this gate.");
    process.exit(1);
  }
  const risu = parseRisuMacros(risuDir);
  const parserChecks = checkParserMacros();
  const ours = parseOurHandlers();

  const risuByName = new Map<string, RisuMacro>();
  for (const m of risu) {
    risuByName.set(m.name.toLowerCase(), m);
    for (const a of m.aliases) risuByName.set(a.toLowerCase(), m);
  }

  const ourByName = new Map<string, OurHandler>();
  for (const h of ours) ourByName.set(h.name.toLowerCase(), h);

  const stubs: Array<{ handler: OurHandler; risu: RisuMacro | null; reason: string }> = [];
  const suspects: Array<{ handler: OurHandler; risu: RisuMacro | null; reason: string }> = [];
  const ok: number[] = [];
  const missingFromOurs: string[] = [];
  const extraInOurs: string[] = [];

  for (const h of ours) {
    const r = risuByName.get(h.name.toLowerCase()) ?? null;
    const c = classify(h, r, parserChecks);
    if (c.tier === "STUB") stubs.push({ handler: h, risu: r, reason: c.reason });
    else if (c.tier === "SUSPECT") suspects.push({ handler: h, risu: r, reason: c.reason });
    else ok.push(1);
    if (!r) extraInOurs.push(h.name);
  }

  const lumiNatives = new Set<string>([
    "or", "trim", "reverse", "pick", "getglobalvar", "deletevar", "flushvar",
    "datetimeformat", "//", "lastcharmessage", "lastusermessage",
    "lastmessageid", "maxcontext", "messagecount", "isotime", "isodate",
    "idleduration", "idle_duration", "newline", "jailbreak",
    "char", "user", "personality", "description", "scenario", "persona",
    "time", "model", "lastmessage", "getvar", "calc", "addvar", "setvar",
    "greater", "and", "not", "replace", "split", "join", "length", "lower",
    "upper", "capitalize", "round", "floor", "ceil", "abs", "date",
    "min", "max", "random", "roll", "comment", "?",
    "#if", "#if_pure", "#when", ":else", "#pure", "#puredisplay", "#escape",
    "#each", "slot", "position",
    "trigger_id", "placeholder model", "__",
  ]);

  for (const m of risu) {
    const nameLc = m.name.toLowerCase();
    if (lumiNatives.has(nameLc) || parserChecks.get(nameLc)?.passed) continue;
    if (ourByName.has(nameLc)) continue;
    let aliasFound = false;
    for (const a of m.aliases) {
      if (ourByName.has(a.toLowerCase())) {
        aliasFound = true;
        break;
      }
    }
    if (!aliasFound) missingFromOurs.push(m.name);
  }

  console.log(`=== HANDLER PARITY AUDIT ===`);
  console.log(`Risu macros: ${risu.length}`);
  console.log(`Our handlers: ${ours.length}`);
  console.log(`OK: ${ok.length}`);
  console.log(`STUBS: ${stubs.length}`);
  console.log(`SUSPECTS: ${suspects.length}`);
  console.log(`Missing from ours: ${missingFromOurs.length}`);
  console.log(`Extra in ours (not in Risu): ${extraInOurs.length}`);
  console.log();

  console.log('=== PARSER BEHAVIOR CHECKS (current caller scope) ===');
  for (const [name, check] of parserChecks) {
    console.log(`- ${name}: ${check.passed ? 'PASS' : 'FAIL'}: ${check.reason}`);
  }
  console.log();

  if (stubs.length > 0) {
    console.log(`=== STUBS (registered, return literal placeholder) ===`);
    for (const s of stubs) {
      console.log(`- ${s.handler.name}  (${path.basename(s.handler.filePath)}:${s.handler.startLine}): ${s.reason}`);
      if (s.risu) {
        const peek = s.risu.body.split("\n").slice(0, 4).join(" / ").replace(/\s+/g, " ").slice(0, 200);
        console.log(`    risu cbs.ts:${s.risu.startLine}: ${peek}`);
      } else {
        console.log(`    NO RISU SOURCE FOUND for "${s.handler.name}"`);
      }
    }
    console.log();
  }

  if (suspects.length > 0) {
    console.log(`=== SUSPECTS (short body, "always" comment, unsupported) ===`);
    for (const s of suspects) {
      console.log(`- ${s.handler.name}  (${path.basename(s.handler.filePath)}:${s.handler.startLine}): ${s.reason}`);
      if (s.risu) {
        const peek = s.risu.body.split("\n").slice(0, 4).join(" / ").replace(/\s+/g, " ").slice(0, 200);
        console.log(`    risu cbs.ts:${s.risu.startLine}: ${peek}`);
      }
    }
    console.log();
  }

  if (missingFromOurs.length > 0) {
    console.log(`=== MISSING (in Risu, not registered in ours) ===`);
    for (const n of missingFromOurs) console.log(`- ${n}`);
    console.log();
  }

  if (extraInOurs.length > 0) {
    console.log(`=== EXTRA (in ours, not found in Risu cbs.ts by name or alias) ===`);
    for (const n of extraInOurs) console.log(`- ${n}`);
  }

  process.exit(stubs.length > 0 || missingFromOurs.length > 0 || [...parserChecks.values()].some(check => !check.passed) ? 1 : 0);
}

if (import.meta.main) main();
