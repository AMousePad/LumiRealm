// Asset macros. Risu source: parser.svelte.ts.
// `raw` is an alias of `path` registered by the evaluator's catalog alias walk.

import type { CharacterAsset, MacroHandler, RisuRuntimeContext } from "../../core/cbs/index.js";
import { registry } from "../registry.js";
import { pickHashRand } from "../risu-helpers.js";

function register(name: string, handler: MacroHandler, description: string): void {
  registry.register({ name, description, category: "Risu / Assets", scoped: false,
    // Risu's plain parser has no asset callbacks and preserves the original payload.
    handler: (ctx, args, raw) => ctx.cbsContext ? `{{${raw}}}` : handler(ctx, args, raw),
  });
}

/** Risu's assetWidth style string. Empty when the host setting is unavailable. */
const ASSET_WIDTH_STYLE = "";

/** parser.svelte.ts. */
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "avi", "m4p", "m4v"]);

const TRIMMER_EXTS = [
  'webp', 'png', 'jpg', 'jpeg', 'gif',
  'mp4', 'webm', 'avi', 'm4p', 'm4v',
  'mp3', 'wav', 'ogg',
];

function trimAssetKey(s: string): string {
  let out = s;
  for (const e of TRIMMER_EXTS) {
    if (out.endsWith('.' + e)) {
      out = out.substring(0, out.length - e.length - 1);
      break;
    }
  }
  return out.trim().replace(/[_ \-.]/g, '');
}

/** parser.svelte.ts. 1D Int16Array DP table. */
function getDistance(a: string, b: string): number {
  const h = a.length + 1;
  const w = b.length + 1;
  const d = new Int16Array(h * w);
  for (let i = 0; i < h; i++) d[i * w] = i;
  for (let j = 0; j < w; j++) d[j] = j;
  for (let i = 1; i < h; i++) {
    for (let j = 1; j < w; j++) {
      d[i * w + j] = Math.min(
        d[(i - 1) * w + (j - 1)]! + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1),
        d[(i - 1) * w + j]! + 1,
        d[i * w + (j - 1)]! + 1,
      );
    }
  }
  return d[h * w - 1]!;
}

/** database.svelte.ts. Candidates beyond this Levenshtein distance are rejected. */
const ASSET_MAX_DIFFERENCE = 4;

function findAsset(
  ctx: RisuRuntimeContext,
  list: readonly CharacterAsset[],
  name: string,
  legacyMediaFindings: boolean,
): CharacterAsset | null {
  const norm = name.toLowerCase();
  // Collect all exact-name matches; multi-source cards emit one CharacterAsset per imageId.
  let matches: CharacterAsset[] | null = null;
  for (const a of list) {
    if (a.name.toLowerCase() === norm) {
      if (matches === null) matches = [a];
      else matches.push(a);
    }
  }
  if (matches !== null) {
    if (matches.length === 1) return matches[0]!;
    // parser.svelte.ts. Falls back to -1 for greeting frame.
    const chatID = ctx.currentMessageIndex ?? -1;
    const seedWord = (ctx.character.chaId || 'global') + String(chatID);
    const cx = pickHashRand(chatID, seedWord);
    const selIndex = Math.floor(cx * matches.length);
    return matches[selIndex] ?? matches[0]!;
  }
  if (legacyMediaFindings) return null;
  // Fuzzy fallback. O(N * |name|^2) per miss; cache later if profiling shows a hotspot.
  const trimmedName = trimAssetKey(norm);
  if (trimmedName.length === 0) return null;
  let closest: CharacterAsset | null = null;
  let closestDist = Number.MAX_SAFE_INTEGER;
  for (const a of list) {
    const key = trimAssetKey(a.name.toLowerCase());
    const dist = getDistance(trimmedName, key);
    if (dist < closestDist) {
      closest = a;
      closestDist = dist;
      if (dist === 0) break; // can't do better than exact-trimmed match
    }
  }
  if (closestDist > ASSET_MAX_DIFFERENCE) return null;
  return closest;
}

/** parser.svelte.ts. */
function imgTag(src: string): string {
  return `<img src="${src}" alt="${src}" style="${ASSET_WIDTH_STYLE} "/>`;
}

/** parser.svelte.ts/564. */
function videoTag(src: string, opts: { controls: boolean; muted: boolean }): string {
  const controls = opts.controls ? "controls " : "";
  const muted = opts.muted ? "muted " : "";
  return `<video ${controls}${muted}autoplay loop><source src="${src}" type="video/mp4"></video>\n`;
}


// parser.svelte.ts. Bare URL (canonical; `raw` is an alias).
register("path", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  return hit?.src ?? "";
}, "Asset URL by name, plain string (for src=/url()). parser.svelte.ts.");

register("img", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return imgTag(hit.src);
}, "Inline <img> for a named asset. parser.svelte.ts.");

register("image", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  // Preserve both authored and Risu-prefixed class selectors.
  return `<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="${hit.src}" alt="${hit.src}" style="${ASSET_WIDTH_STYLE}"/></div>\n`;
}, "Inlay image wrapper. parser.svelte.ts.");

register("emotion", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.emotionImages, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return imgTag(hit.src);
}, "Emotion image by name. parser.svelte.ts.");

register("asset", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  if (hit.ext && VIDEO_EXTENSIONS.has(hit.ext.toLowerCase())) {
    return videoTag(hit.src, { controls: false, muted: true });
  }
  return `${imgTag(hit.src)}\n`;
}, "Asset by name — img or video depending on extension. parser.svelte.ts.");

// parser.svelte.ts. Risu emits only in "back" mode; this handler always emits the back-mode div.
register("bg", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return `<div style="width:100%;height:100%;background: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.8)),url(${hit.src}); background-size: cover;"></div>`;
}, "Background panel. parser.svelte.ts.");

register("video", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return videoTag(hit.src, { controls: true, muted: false });
}, "Full-featured video. parser.svelte.ts.");

register("video-img", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return videoTag(hit.src, { controls: false, muted: true });
}, "Muted autoplay video (image-substitute). parser.svelte.ts.");

register("audio", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return `<audio controls autoplay loop><source src="${hit.src}" type="audio/mpeg"></audio>\n`;
}, "Audio player. parser.svelte.ts.");

// Lumi has no BGM engine; the div sits hidden. Preserving the shape means a future hook works without card changes.
register("bgm", (ctx, args) => {
  const name = String(args[0] ?? "");
  if (!name) return "";
  const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
  if (!hit) return "";
  return `<div risu-ctrl="bgm___auto___${hit.src}" style="display:none;"></div>\n`;
}, "BGM control marker. parser.svelte.ts. Lumi has no engine to act on it.");

// parser.svelte.ts. `<id>` is a Lumi image UUID; `/api/v1/images/<id>` serves the bytes.
// All three handlers assume image; audio/video inlays are a known gap.
register("inlay", (ctx, args) => {
  const id = String(args[0] ?? "");
  if (!id) return "";
  return `<img src="/api/v1/images/${id}"/>`;
}, "Bare inlay image (no wrapper). Risu parser.svelte.ts.");

register("inlayed", (ctx, args) => {
  const id = String(args[0] ?? "");
  if (!id) return "";
  return `<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/${id}"/></div>\n\n`;
}, "Wrapped inlay image. Risu parser.svelte.ts + 688.");

register("inlayeddata", (ctx, args) => {
  const id = String(args[0] ?? "");
  if (!id) return "";
  return `<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/${id}"/></div>\n\n`;
}, "Wrapped inlay image (data variant). Risu parser.svelte.ts + 688.");

// parser.svelte.ts. Returns stable `/api/v1/images/<id>` URLs.
register("source", (ctx, args) => {
  const kind = String(args[0] ?? "").toLowerCase();
  if (kind === "char") return ctx.character.image;
  if (kind === "user") return ctx.identity.personaImage;
  return "";
}, "{{source::char}} / {{source::user}} avatar URLs. parser.svelte.ts. Empty string when no avatar uploaded.");
