// Lumiverse host-version check. Ported from Hone's `version-check.ts`.

export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const core = v.split(/[-+]/)[0] ?? v;
    return core.split('.').map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

export interface HostVersionCheckResult {
  readonly needsUpdate: boolean;
  readonly hostVersion: string;
  readonly minimum: string;
  readonly message: string;
}

export interface RuntimeVersionInfo {
  readonly extensionVersion: string;
  readonly minimumLumiverseVersion: string;
  readonly hostVersion: string;
}

export function readRuntimeVersionInfo(source: {
  readonly manifest: {
    readonly version: string;
    readonly minimum_lumiverse_version?: string;
  };
  readonly host: { readonly lumiverseVersion: string };
}): RuntimeVersionInfo {
  const minimumLumiverseVersion = source.manifest.minimum_lumiverse_version?.trim();
  if (!minimumLumiverseVersion) {
    throw new Error('LumiRealm requires a non-empty spindle.manifest.minimum_lumiverse_version');
  }
  return {
    extensionVersion: source.manifest.version,
    minimumLumiverseVersion,
    hostVersion: source.host.lumiverseVersion,
  };
}

export function checkHostVersion(
  hostVersion: string,
  minimum: string,
): HostVersionCheckResult {
  const cmp = compareVersions(hostVersion, minimum);
  if (cmp >= 0) {
    return {
      needsUpdate: false,
      hostVersion,
      minimum,
      message: `Lumiverse ${hostVersion} satisfies LumiRealm's minimum of ${minimum}`,
    };
  }
  return {
    needsUpdate: true,
    hostVersion,
    minimum,
    message:
      `LumiRealm requires Lumiverse ${minimum} or newer, but this host is running ${hostVersion}. ` +
      `Some features may fail or behave unexpectedly. Update Lumiverse for the intended experience.`,
  };
}
