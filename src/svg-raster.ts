// SVG rasterizer: Lumi's richHtmlSanitizer (dbda8a7) blocks inline SVG, so card SVGs are
// rasterized to PNG at import time. blob-URL -> <img> -> canvas.drawImage -> POST /api/v1/images.
// Theme vars are snapshotted once per batch; colors are frozen to import-time theme.
// Animated SVGs render first-frame only. Templated SVGs are excluded by the backend.

import type {
  BackendToFrontend,
  FrontendToBackend,
} from "./types/messages.js";

interface RasterLog {
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

// Clamp raster size; guards against pathological cards and keeps PNGs small.
const MAX_RASTER_DIMENSION = 512;

interface ThemeContext {
  readonly color: string;
  readonly accent: string;
  readonly text: string;
}

function snapshotTheme(): ThemeContext {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    color: cs.color || "#000",
    accent: cs.getPropertyValue("--lumiverse-primary").trim(),
    text: cs.getPropertyValue("--lumiverse-text").trim(),
  };
}

function prepareSvgForRaster(
  svg: string,
  classification: "simple" | "theme-reactive" | "animated",
  theme: ThemeContext,
): string {
  if (classification !== "theme-reactive") return svg;
  const declarations = [
    `color:${theme.color}`,
    ...(theme.accent ? [`--lumiverse-primary:${theme.accent}`] : []),
    ...(theme.text ? [`--lumiverse-text:${theme.text}`] : []),
  ].join(";");
  if (!declarations) return svg;
  const styleAttrRe = /(<svg\b[^>]*\sstyle\s*=\s*)(["'])([^"']*)(["'])/i;
  if (styleAttrRe.test(svg)) {
    return svg.replace(
      styleAttrRe,
      (_full, head: string, q: string, value: string, q2: string) =>
        `${head}${q}${declarations};${value}${q2}`,
    );
  }
  return svg.replace(/<svg\b/i, `<svg style="${declarations}"`);
}

async function rasterizeOne(
  svg: string,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
    });

    // Prefer naturalWidth/Height; fall back to declared dims for SVGs with no viewBox.
    const w = Math.min(
      MAX_RASTER_DIMENSION,
      Math.max(1, Math.round(img.naturalWidth || width || 32)),
    );
    const h = Math.min(
      MAX_RASTER_DIMENSION,
      Math.max(1, Math.round(img.naturalHeight || height || 32)),
    );

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, w, h);
      const blobOut = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      if (!blobOut) return null;
      const buf = await blobOut.arrayBuffer();
      return new Uint8Array(buf);
    } finally {
      // Zeroing releases the backing store now instead of at GC time.
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Field name must be "image", not "file". // Workaround: Lumi /api/v1/images quirk
async function uploadPng(
  png: Uint8Array,
  filename: string,
): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.set("image", new Blob([png as BlobPart], { type: "image/png" }), filename);
    const resp = await fetch("/api/v1/images", {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (!resp.ok) return null;
    const js = (await resp.json()) as { id?: string };
    return typeof js?.id === "string" && js.id.length > 0 ? js.id : null;
  } catch {
    return null;
  }
}

interface SvgRasterPlayerHandle {
  handleRasterizeSvgsMessage(
    msg: Extract<BackendToFrontend, { type: "rasterize_svgs" }>,
  ): void;
}

export interface SetupSvgRasterizerOptions {
  readonly log: RasterLog;
  readonly sendToBackend: (msg: FrontendToBackend) => void;
}

export function setupSvgRasterizer(
  opts: SetupSvgRasterizerOptions,
): SvgRasterPlayerHandle {
  const { log, sendToBackend } = opts;

  async function rasterizeBatch(
    msg: Extract<BackendToFrontend, { type: "rasterize_svgs" }>,
  ): Promise<void> {
    const tStart = performance.now();
    const total = msg.svgs.length;
    if (total === 0) {
      // Backend should filter empty batches, but send ack defensively.
      sendToBackend({
        type: "register_svg_raster_index",
        characterId: msg.characterId,
        imageIdByMarker: {},
      });
      return;
    }
    log.info(
      `svg-raster: starting char=${msg.characterId} name=${msg.characterName} ` +
        `count=${total}`,
    );

    const theme = snapshotTheme();
    log.info(
      `svg-raster: theme snapshot color=${theme.color} ` +
        `accent=${theme.accent || "<unset>"} text=${theme.text || "<unset>"}`,
    );

    // Bounded concurrency = 6 (matches asset-upload pool).
    const CONCURRENCY = 6;
    const queue = [...msg.svgs];
    const imageIdByMarker: Record<string, string | null> = {};
    let done = 0;
    let failed = 0;

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) break;

        const prepared = prepareSvgForRaster(task.svg, task.classification, theme);
        const png = await rasterizeOne(prepared, task.width, task.height);
        if (!png) {
          imageIdByMarker[String(task.markerN)] = null;
          failed += 1;
          done += 1;
          log.warn(
            `svg-raster: rasterizeOne failed markerN=${task.markerN} ` +
              `class=${task.classification} svg_len=${task.svg.length}`,
          );
          continue;
        }
        const fname = `svg-raster-${task.markerN}.png`;
        const imageId = await uploadPng(png, fname);
        if (!imageId) {
          imageIdByMarker[String(task.markerN)] = null;
          failed += 1;
          log.warn(
            `svg-raster: uploadPng failed markerN=${task.markerN} ` +
              `bytes=${png.byteLength}`,
          );
        } else {
          imageIdByMarker[String(task.markerN)] = imageId;
        }
        done += 1;
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, total) },
      () => worker(),
    );
    await Promise.all(workers);

    log.info(
      `svg-raster: done char=${msg.characterId} total=${total} ` +
        `successful=${done - failed} failed=${failed} ` +
        `elapsed=${Math.round(performance.now() - tStart)}ms`,
    );

    sendToBackend({
      type: "register_svg_raster_index",
      characterId: msg.characterId,
      imageIdByMarker,
    });
  }

  // Mass re-translate dispatches one batch per character. Running them
  // concurrently stacked hundreds of canvases and crashed the tab, so batches
  // run strictly one at a time through this chain.
  let batchChain: Promise<void> = Promise.resolve();

  return {
    handleRasterizeSvgsMessage(msg): void {
      batchChain = batchChain.then(() =>
        rasterizeBatch(msg).catch((err) => {
          log.error(
            `svg-raster: rasterizeBatch threw char=${msg.characterId}: ${(err as Error).message}`,
          );
          // Send empty index so backend clears the svg-pending flag and finalizes the import.
          sendToBackend({
            type: "register_svg_raster_index",
            characterId: msg.characterId,
            imageIdByMarker: {},
          });
        }),
      );
    },
  };
}
