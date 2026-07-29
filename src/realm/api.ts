import type { RealmCard, RealmSort } from './messages.js';
import { REALM_HUB_API_URL, REALM_DOWNLOAD_URL } from './messages.js';

const APP_VER = '0.1.0';
const CLIENT_TAG = 'web';

export interface RealmSearchArg {
  readonly search: string;
  readonly page: number;
  readonly nsfw: boolean;
  readonly sort: RealmSort;
}

export interface RealmSearchResult {
  readonly cards: readonly RealmCard[];
  readonly additionalHTML?: string;
}

export async function searchRealm(arg: RealmSearchArg): Promise<RealmSearchResult> {
  const search = (arg.search ?? '') + ' __shared';
  const stringArg =
    `search==${search}&&page==${arg.page}&&nsfw==${arg.nsfw}&&sort==${arg.sort}&&web==${CLIENT_TAG}`;
  const url = `${REALM_HUB_API_URL}/realm/${encodeURIComponent(stringArg)}?cache=30`;
  const res = await fetch(url, {
    headers: {
      'x-risuai-info': `${APP_VER};lumirealm`,
    },
  });
  if (res.status !== 200) {
    return { cards: [] };
  }
  const jso = (await res.json()) as unknown;
  if (Array.isArray(jso)) {
    return { cards: jso as readonly RealmCard[] };
  }
  const obj = jso as { cards?: readonly RealmCard[]; additionalHTML?: string };
  return {
    cards: obj.cards ?? [],
    ...(obj.additionalHTML !== undefined ? { additionalHTML: obj.additionalHTML } : {}),
  };
}

export async function getRealmInfo(realmPath: string): Promise<RealmCard> {
  const url = `${REALM_HUB_API_URL}/hub/info/${encodeURIComponent(realmPath)}`;
  const res = await fetch(url);
  if (res.status !== 200) {
    throw new Error(`realm info HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as RealmCard;
}

export interface RealmDownload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
}

export async function downloadRealmCard(id: string): Promise<RealmDownload> {
  const url = `${REALM_DOWNLOAD_URL}/api/v1/download/dynamic/${encodeURIComponent(id)}?cors=true`;
  const res = await fetch(url, {
    headers: { 'x-risu-api-version': '4' },
  });
  if (res.status !== 200) {
    throw new Error(`realm download HTTP ${res.status}: ${await res.text()}`);
  }
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let ext = 'charx';
  if (ct.includes('png')) ext = 'png';
  else if (ct.includes('zip') && !ct.includes('charx')) ext = 'zip';
  const fileName = `realm-${id}.${ext}`;
  return { bytes, contentType: ct, fileName };
}

export function extractRealmId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const realm = url.searchParams.get('realm') ?? url.searchParams.get('code');
      if (realm) return realm;
      const last = trimmed.split(/[/?#]/).filter(Boolean).pop();
      return last ?? null;
    } catch {
      return null;
    }
  }
  const tail = trimmed.split('?').pop();
  return tail && tail.length > 0 ? tail : trimmed;
}
