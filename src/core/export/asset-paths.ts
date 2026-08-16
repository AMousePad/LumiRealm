// Port of Risu's CharX asset path layout (characterCards.ts export branch) plus
// CharXWriter's filename sanitizer. Both dedup independently, so an export must
// run them in the same order Risu writes entries or paths drift.

const TYPE_DIRS: ReadonlySet<string> = new Set([
  "emotion",
  "background",
  "user_icon",
  "icon",
]);

const ITYPE_BY_EXT: Readonly<Record<string, string>> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio",
  mp4: "video", webm: "video", mov: "video", avi: "video", mkv: "video",
  mmd: "model", obj: "model",
  safetensors: "ai", cpkt: "ai", onnx: "ai",
  otf: "fonts", ttf: "fonts", woff: "fonts", woff2: "fonts",
  js: "code", ts: "code", lua: "code",
};

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export interface AssetPathInput {
  readonly type: string;
  readonly name: string;
  readonly ext: string;
}

export interface PlannedAssetPath {
  readonly path: string;
  /** Basename without extension, used for the `x_meta/<name>.json` companion. */
  readonly metaName: string;
}

/** Mirrors CharXWriter's per-archive `#sanitizeZipFilename`. One instance per
 *  archive: the taken-name set spans every entry, not just assets. */
export class ZipNameSanitizer {
  readonly #taken = new Set<string>();

  sanitize(filename: string): string {
    let sanitized = filename.replace(/[<>:"\\|?*\x00-\x1F]/g, "_");
    sanitized = sanitized.replace(/[. ]+$/, "");
    if (RESERVED_NAMES.test(sanitized)) sanitized = "_" + sanitized;
    if (!sanitized || sanitized === "." || sanitized === "..") sanitized = "file";

    const split = sanitized.split(".");
    const baseName = split.slice(0, -1).join(".");
    const extension = split.length > 1 ? "." + split[split.length - 1] : "";
    let counter = 1;
    let unique = baseName + extension;
    while (this.#taken.has(unique)) {
      unique = `${baseName}_${counter}${extension}`;
      counter++;
    }
    this.#taken.add(unique);
    return unique;
  }
}

/** Assigns the `assets/<type>/<itype>/<name>.<ext>` path for one asset.
 *  `seenPaths` must be shared across a single archive. `assetIndex` is the
 *  1-based counter over emitted assets, matching Risu's fallback name. */
export function planAssetPath(
  asset: AssetPathInput,
  assetIndex: number,
  seenPaths: Set<string>,
): PlannedAssetPath {
  let name = asset.name || `asset_${assetIndex}`;
  if (name.length > 100) name = name.substring(0, 100);

  const unknownExt = asset.ext === "unknown" || asset.ext === "";
  const ext = unknownExt ? "png" : asset.ext;
  const type = TYPE_DIRS.has(asset.type) ? asset.type : "other";
  const itype = unknownExt ? "image" : (ITYPE_BY_EXT[asset.ext] ?? "other");
  const baseDir = unknownExt ? `assets/${type}/image` : `assets/${type}/${itype}`;

  let uniqueName = name;
  let suffix = 0;
  while (seenPaths.has(`${baseDir}/${uniqueName}.${ext}`)) {
    suffix++;
    uniqueName = `${name}_${suffix}`;
  }
  const path = `${baseDir}/${uniqueName}.${ext}`;
  seenPaths.add(path);
  return { path, metaName: uniqueName };
}
