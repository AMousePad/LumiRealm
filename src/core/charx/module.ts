import { base64ToBytes } from "../../util/base64.js";
import { TranslationError } from "../errors.js";
import { readCharx, type CharxBundle } from "./reader.js";

export interface ModuleCharxIcon {
  readonly data: Uint8Array;
  readonly ext: string;
}

// Asset bytes stay positional with module.assets for the shared upload path.
export interface DecodedModuleCharx {
  readonly module: unknown;
  readonly assets: readonly Uint8Array[];
  readonly icon?: ModuleCharxIcon;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function decodeDataUri(uri: string): Uint8Array | null {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const header = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  try {
    return header.includes(";base64")
      ? base64ToBytes(body)
      : new TextEncoder().encode(decodeURIComponent(body));
  } catch {
    return null;
  }
}

function resolveEmbeddedAsset(
  uri: string,
  assets: ReadonlyMap<string, Uint8Array>,
): Uint8Array | null {
  let path: string | null = null;
  if (uri.startsWith("embeded://")) {
    path = uri.slice("embeded://".length);
  } else if (uri.startsWith("__asset:")) {
    path = uri.slice("__asset:".length);
  }
  if (path !== null) {
    const found = assets.get(path);
    if (!found) {
      // A missing embedded dictionary key makes the module archive invalid.
      throw new TranslationError(
        "module_charx/missing_asset",
        `referenced CharX asset "${path}" is missing`,
      );
    }
    return new Uint8Array(found);
  }
  if (uri.startsWith("data:")) {
    const decoded = decodeDataUri(uri);
    // Risu skips data URIs at or above 50 MiB.
    return decoded && decoded.byteLength < 50 * 1024 * 1024 ? decoded : null;
  }
  return null;
}

export function convertCharacterBook(raw: unknown): unknown[] {
  const charbook = record(raw);
  const entries = charbook ? array(charbook["entries"]) : [];
  const lorebook: unknown[] = [];

  for (const rawEntry of entries) {
    // Extension migration deletes consumed keys, so each source entry is cloned.
    const source = structuredClone(record(rawEntry) ?? {});
    const keys = array(source["keys"]);
    const secondaryKeys = array(source["secondary_keys"]);
    let content = string(source["content"]);
    let useRegex = source["use_regex"] ?? false;
    let selective = source["selective"] ?? false;

    if (
      useRegex &&
      !(typeof keys[0] === "string" && keys[0].startsWith("/"))
    ) {
      useRegex = false;
    }

    const extensions = structuredClone(record(source["extensions"]) ?? {});
    if (
      extensions["useProbability"] &&
      extensions["probability"] !== undefined &&
      extensions["probability"] !== 100
    ) {
      content = `@@probability ${String(extensions["probability"])}\n${content}`;
      delete extensions["useProbability"];
      delete extensions["probability"];
    }
    if (
      extensions["position"] === 4 &&
      typeof extensions["depth"] === "number" &&
      typeof extensions["role"] === "number"
    ) {
      const role = ["system", "user", "assistant"][extensions["role"]];
      content = `@@depth ${extensions["depth"]}\n@@role ${String(role)}\n${content}`;
      delete extensions["position"];
      delete extensions["depth"];
      delete extensions["role"];
    }
    if (typeof extensions["selectiveLogic"] === "number" && secondaryKeys.length > 0) {
      switch (extensions["selectiveLogic"]) {
        case 0:
          if (secondaryKeys.length === 0) selective = false;
          break;
        case 1:
          selective = false;
          content = `@@exclude_keys_all ${secondaryKeys.join(",")}\n${content}`;
          break;
        case 2:
          selective = false;
          for (const key of secondaryKeys) {
            content = `@@exclude_keys ${key}\n${content}`;
          }
          break;
        case 3:
          selective = false;
          for (const key of secondaryKeys) {
            content = `@@additional_keys ${key}\n${content}`;
          }
          break;
      }
    }
    if (typeof extensions["delay"] === "number" && extensions["delay"] > 0) {
      content = `@@activate_only_after ${extensions["delay"]}\n${content}`;
      delete extensions["delay"];
    }
    if (extensions["match_whole_words"] === true) {
      content = `@@match_full_word\n${content}`;
      delete extensions["match_whole_words"];
    }
    if (extensions["match_whole_words"] === false) {
      content = `@@match_partial_word\n${content}`;
      delete extensions["match_whole_words"];
    }

    lorebook.push({
      key: keys.join(", "),
      secondkey: secondaryKeys.join(", "),
      insertorder: typeof source["insertion_order"] === "number"
        ? source["insertion_order"]
        : 0,
      comment: typeof source["name"] === "string"
        ? source["name"]
        : source["name"] ?? source["comment"] ?? "",
      content,
      mode: source["mode"] ?? "normal",
      alwaysActive: source["constant"] ?? false,
      selective,
      extentions: {
        ...extensions,
        risu_case_sensitive: source["case_sensitive"],
      },
      activationPercent: extensions["risu_activationPercent"],
      loreCache: extensions["risu_loreCache"] ?? null,
      useRegex,
      folder: source["folder"],
    });
  }

  return lorebook;
}

function indicatorLore(data: UnknownRecord): unknown[] {
  const out: unknown[] = [];
  const description = string(data["description"]);
  if (description) {
    out.push({
      key: "",
      secondkey: "",
      insertorder: 0,
      comment: "From Character Description",
      content: `@@indicator character_desc\n\n${description}`,
      mode: "constant",
      alwaysActive: true,
      selective: false,
    });
  }

  const firstMessage = string(data["first_mes"]);
  const alternateGreetings = array(data["alternate_greetings"])
    .filter((v): v is string => typeof v === "string");
  if (firstMessage || alternateGreetings.length > 0) {
    let firstMessages = `<FM>\n${firstMessage}\n</FM>`;
    for (const greeting of alternateGreetings) {
      firstMessages += `\n<FM_alt>\n${greeting}\n</FM_alt>`;
    }
    out.push({
      key: "",
      secondkey: "",
      insertorder: 0,
      comment: "From First Messages",
      content: `@@indicator character_first_message\n\n${firstMessages}`,
      mode: "constant",
      alwaysActive: false,
      selective: false,
    });
  }

  // Intentional current-Risu quirk: CCv3 import stores
  // post_history_instructions in replaceGlobalNote, while
  // convertCharacterToModule reads postHistoryInstructions. It therefore does
  // not create an @@indicator phi entry here.
  return out;
}

/** Restores a module from our own archive. The sidecar holds the RisuModule
 *  verbatim, so this skips the CCSv3 conversion entirely: no indicator-lore
 *  re-append, no field-by-field remap, and `cjs` / `namespace` / `mcp` survive
 *  (Risu's own module-to-charx conversion drops them). */
function restoreModuleFromSidecar(bundle: CharxBundle): DecodedModuleCharx | null {
  const sidecar = bundle.sidecar;
  if (!sidecar || sidecar.kind !== "module" || !sidecar.module) return null;
  const payload = sidecar.module;
  const module = record(payload.module);
  if (!module) {
    throw new TranslationError(
      "module_charx/bad_sidecar",
      "lumirealm.json module payload is not an object",
    );
  }

  const assetBytes: Uint8Array[] = [];
  const kept: [string, string, string][] = [];
  for (const ref of payload.assets ?? []) {
    const bytes = bundle.assets.get(ref.path);
    if (!bytes) {
      // The manifest and the archive disagree; better to fail than to silently
      // import a module whose asset names no longer line up with its bytes.
      throw new TranslationError(
        "module_charx/missing_asset",
        `sidecar references "${ref.path}" but the archive has no such entry`,
      );
    }
    kept.push([ref.name, "", ref.ext ?? ""]);
    assetBytes.push(new Uint8Array(bytes));
  }

  let icon: ModuleCharxIcon | undefined;
  const iconRef = payload.icon;
  if (iconRef) {
    const bytes = bundle.assets.get(iconRef.path);
    if (bytes) icon = { data: new Uint8Array(bytes), ext: iconRef.ext ?? "png" };
  }

  return {
    module: structuredClone({ ...module, assets: kept, icon: "" }),
    assets: assetBytes,
    ...(icon ? { icon } : {}),
  };
}

export function convertModuleCharxBundle(bundle: CharxBundle): DecodedModuleCharx {
  const restored = restoreModuleFromSidecar(bundle);
  if (restored) return restored;

  const card = record(bundle.card);
  if (!card) {
    throw new TranslationError(
      "module_charx/missing_card",
      "module CharX does not contain a readable card.json",
    );
  }
  if (card["spec"] !== "chara_card_v3") {
    throw new TranslationError(
      "module_charx/bad_spec",
      `module CharX must contain a chara_card_v3 card, got ${String(card["spec"])}`,
    );
  }
  const data = record(card["data"]);
  if (!data) {
    throw new TranslationError(
      "module_charx/missing_data",
      "module CharX card.json is missing its data object",
    );
  }
  if (bundle.moduleBytes && !bundle.moduleEnvelope) {
    throw new TranslationError(
      "module_charx/bad_embedded_module",
      "module CharX contains module.risum but it could not be decoded",
    );
  }

  const extensions = record(data["extensions"]) ?? {};
  const risu = record(extensions["risuai"]) ?? {};
  const embedded = bundle.moduleEnvelope
    ? record(bundle.moduleEnvelope.module)
    : null;
  if (bundle.moduleEnvelope && !embedded) {
    throw new TranslationError(
      "module_charx/bad_embedded_module",
      "module CharX module.risum payload is not an object",
    );
  }

  let lorebook: unknown = convertCharacterBook(data["character_book"]);
  let regex: unknown = risu["customScripts"] ?? [];
  let trigger: unknown = risu["triggerscript"] ?? [];
  if (embedded) {
    regex = embedded["regex"] ?? [];
    trigger = embedded["trigger"] ?? [];
    // An embedded empty lore array is authoritative.
    if (embedded["lorebook"]) {
      lorebook = structuredClone(embedded["lorebook"]);
    }
  }
  if (!Array.isArray(lorebook)) {
    throw new TranslationError(
      "module_charx/bad_lorebook",
      "module CharX lorebook is not an array",
    );
  }
  lorebook.push(...indicatorLore(data));

  const moduleAssets: [string, string, string][] = [];
  const assetBytes: Uint8Array[] = [];
  let icon: ModuleCharxIcon | undefined;
  for (const rawAsset of array(data["assets"])) {
    const asset = record(rawAsset);
    if (!asset) continue;
    const type = string(asset["type"]);
    const name = string(asset["name"]);
    const uri = string(asset["uri"]);
    const ext = typeof asset["ext"] === "string" ? asset["ext"] : "unknown";
    if (type !== "x-risu-asset" && !(type === "icon" && name === "main")) {
      continue;
    }
    const bytes = resolveEmbeddedAsset(uri, bundle.assets);
    if (!bytes) continue;
    if (type === "x-risu-asset") {
      moduleAssets.push([name, "", ext]);
      assetBytes.push(bytes);
    } else {
      // Last icon/main wins, matching Risu's asset iteration.
      icon = { data: bytes, ext };
    }
  }

  const sourceId = embedded && typeof embedded["id"] === "string" && embedded["id"].length > 0
    ? embedded["id"]
    : "charx-import";
  const toggles = typeof risu["toggles"] === "string" ? risu["toggles"] : "";
  const module = structuredClone({
    name: string(data["name"]),
    description: string(data["creator_notes"]),
    lorebook,
    regex,
    trigger,
    lowLevelAccess: risu["lowLevelAccess"] ?? false,
    // Risu's CCv3 character importer does not restore hideChatIcon.
    hideIcon: undefined,
    backgroundEmbedding: risu["backgroundHTML"] ?? "",
    assets: moduleAssets,
    customModuleToggle: toggles,
    id: sourceId,
    // The uploader replaces this with the persisted image id after upload.
    icon: "",
  });

  return {
    module,
    assets: assetBytes,
    ...(icon ? { icon } : {}),
  };
}

export function decodeModuleCharx(bytes: Uint8Array): DecodedModuleCharx {
  return convertModuleCharxBundle(readCharx(bytes));
}
