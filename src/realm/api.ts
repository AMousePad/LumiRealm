import type { RealmCard, RealmSort } from './messages.js';
import { REALM_HUB_API_URL, REALM_DOWNLOAD_URL } from './messages.js';
import type { SpindleAPI, SpindleFileRef } from 'lumiverse-spindle-types';

declare const spindle: SpindleAPI;

export class RealmRequestError extends Error {
  override readonly name = 'RealmRequestError';
}

async function requestJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const response = await spindle.cors(url, { responseType: 'text', ...(headers ? { headers } : {}) }) as { status: number; body: string };
  if (response.status !== 200) throw new RealmRequestError(`Realm request failed: HTTP ${response.status}`);
  return JSON.parse(response.body);
}

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
  const jso = await requestJson(url, { 'x-risuai-info': `${APP_VER};lumirealm` });
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
  return await requestJson(url) as RealmCard;
}

export interface RealmDownload {
  readonly file: SpindleFileRef;
  readonly contentType: string;
  readonly fileName: string;
}

export async function downloadRealmCard(id: string, userId: string): Promise<RealmDownload> {
  const url = `${REALM_DOWNLOAD_URL}/api/v1/download/dynamic/${encodeURIComponent(id)}?cors=true`;
  const file = await spindle.files.fetch(url, {
    userId, fileName: 'realm-download', maxBytes: 10 * 1024 ** 3,
    headers: { 'x-risu-api-version': '4' },
  });
  const ct = file.mimeType.toLowerCase();
  let ext = 'charx';
  if (ct.includes('png')) ext = 'png';
  else if (ct.includes('zip') && !ct.includes('charx')) ext = 'zip';
  const fileName = `realm-${id}.${ext}`;
  return { file, contentType: ct, fileName };
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
