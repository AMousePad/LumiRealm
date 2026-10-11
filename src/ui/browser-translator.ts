import { hostCall } from '../host-services/client.js';
// Wraps Chrome 138+ Built-in AI APIs (Translator + LanguageDetector).
// Display-only, never persisted from here.

import { makeFrontendLogger } from '../log/frontend-log.js';

const flog = makeFrontendLogger('translator');

export interface TranslatorHandle {
  translateOne(text: string, srcHint?: string): Promise<string>;
}

const TARGET = 'en';

interface ChromeTranslatorCtor {
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<{
    translate(text: string): Promise<string>;
  }>;
  availability?(opts: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}

interface ChromeLanguageDetectorCtor {
  create(): Promise<{
    detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  }>;
  availability?(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}

let translatorByPair: Map<string, Promise<{ translate(t: string): Promise<string> } | null>> | null = null;
let detectorPromise: Promise<{ detect(t: string): Promise<Array<{ detectedLanguage: string }>> } | null> | null = null;
const resultCache = new Map<string, string>();
let unavailableLogged = false;

let fallbackDisabled = false;
const fallbackDisabledSubscribers = new Set<(reason: string) => void>();

export function subscribeFallbackDisabled(cb: (reason: string) => void): () => void {
  fallbackDisabledSubscribers.add(cb);
  return () => fallbackDisabledSubscribers.delete(cb);
}

function disableFallback(reason: string): void {
  if (fallbackDisabled) return;
  fallbackDisabled = true;
  flog.warn(`google-translate fallback disabled: ${reason}`);
  for (const cb of fallbackDisabledSubscribers) {
    try { cb(reason); } catch { /* swallow */ }
  }
}

function chromeTranslator(): ChromeTranslatorCtor | null {
  const tr = (globalThis as { Translator?: unknown }).Translator;
  if (tr && typeof (tr as ChromeTranslatorCtor).create === 'function') {
    return tr as ChromeTranslatorCtor;
  }
  return null;
}

function chromeLanguageDetector(): ChromeLanguageDetectorCtor | null {
  const d = (globalThis as { LanguageDetector?: unknown }).LanguageDetector;
  if (d && typeof (d as ChromeLanguageDetectorCtor).create === 'function') {
    return d as ChromeLanguageDetectorCtor;
  }
  return null;
}

async function getDetector(): Promise<{ detect(t: string): Promise<Array<{ detectedLanguage: string }>> } | null> {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    const ctor = chromeLanguageDetector();
    if (!ctor) return null;
    try {
      const avail = ctor.availability ? await ctor.availability() : 'available';
      if (avail === 'unavailable') return null;
      return await ctor.create();
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

async function getTranslatorForPair(
  src: string,
  tgt: string,
): Promise<{ translate(t: string): Promise<string> } | null> {
  if (!translatorByPair) translatorByPair = new Map();
  const key = `${src}|${tgt}`;
  const existing = translatorByPair.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const ctor = chromeTranslator();
    if (!ctor) return null;
    try {
      if (ctor.availability) {
        const avail = await ctor.availability({ sourceLanguage: src, targetLanguage: tgt });
        flog.debug(`translator ${src}->${tgt} availability=${avail}`);
        // 'downloadable' or 'downloading' need a user gesture to trigger
        // create(), we're called from paint code so let the fallback handle.
        if (avail !== 'available') return null;
      }
      const inst = await ctor.create({ sourceLanguage: src, targetLanguage: tgt });
      flog.debug(`translator ${src}->${tgt} created`);
      return inst;
    } catch (err) {
      flog.warn(`translator ${src}->${tgt} create failed:`, err);
      return null;
    }
  })();
  translatorByPair.set(key, promise);
  return promise;
}

export function isTranslationAvailable(): boolean {
  if (chromeTranslator() !== null) return true;
  return !fallbackDisabled;
}

export function isUsingFallback(): boolean {
  return chromeTranslator() === null && !fallbackDisabled;
}

// Unofficial gtx endpoint, no auth. 429 disables and surfaces to UI.
async function googleTranslateFallback(text: string, src: string): Promise<string | null> {
  let res: { status: number; body: string };
  try {
    res = await hostCall('translation', { text, source: src });
  } catch (err) {
    flog.warn('google-translate fetch failed:', err);
    return null;
  }
  if (res.status === 429) {
    disableFallback('rate limited (429)');
    return null;
  }
  if (res.status < 200 || res.status >= 300) {
    flog.warn(`google-translate http ${res.status}`);
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  let out = '';
  for (const seg of data[0] as unknown[]) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') out += seg[0];
  }
  return out;
}

export function getTranslator(): TranslatorHandle | null {
  const haveLocal = chromeTranslator() !== null;
  if (!haveLocal && fallbackDisabled) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      flog.debug('browser Translator API unavailable and fallback disabled');
    }
    return null;
  }
  return {
    translateOne: async (text, srcHint) => {
      const trimmed = (text ?? '').trim();
      if (trimmed.length === 0) return text;
      const src = srcHint ?? (await detectLang(trimmed)) ?? 'ko';
      if (src === TARGET) return text;
      const cacheKey = `${src}|${TARGET}|${text}`;
      const cached = resultCache.get(cacheKey);
      if (cached !== undefined) return cached;
      if (haveLocal) {
        const tr = await getTranslatorForPair(src, TARGET);
        if (tr) {
          try {
            const out = await tr.translate(text);
            resultCache.set(cacheKey, out);
            return out;
          } catch {
            // Translate threw, fall through to remote fallback.
          }
        }
      }
      if (fallbackDisabled) {
        resultCache.set(cacheKey, text);
        return text;
      }
      const out = await googleTranslateFallback(text, src);
      if (out === null) {
        resultCache.set(cacheKey, text);
        return text;
      }
      resultCache.set(cacheKey, out);
      return out;
    },
  };
}

async function detectLang(text: string): Promise<string | null> {
  const script = scriptLangFromText(text);
  if (script !== null) return script;
  try {
    const det = await getDetector();
    if (!det) return null;
    const results = await det.detect(text);
    if (results.length === 0) return null;
    const best = results[0]!.detectedLanguage;
    if (best === 'und' || best === 'unknown' || best === TARGET) return null;
    return best;
  } catch {
    return null;
  }
}

// Hangul beats kana beats Han in priority since Hangul + kana are unambiguous.
export function scriptLangFromText(text: string): string | null {
  const counts = countForeignScript(text);
  if (counts.hangul > 0) return 'ko';
  if (counts.kana > 0) return 'ja';
  if (counts.han > 0) return 'zh';
  return null;
}

// Aggregate counts across many strings, used to classify a whole card.
export function dominantScriptLang(texts: readonly string[]): string | null {
  let hangul = 0, kana = 0, han = 0;
  for (const t of texts) {
    const c = countForeignScript(t);
    hangul += c.hangul;
    kana += c.kana;
    han += c.han;
  }
  if (hangul > 0) return 'ko';
  if (kana > 0) return 'ja';
  if (han > 0) return 'zh';
  return null;
}

function countForeignScript(text: string): { hangul: number; kana: number; han: number } {
  let hangul = 0, kana = 0, han = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0xa960 && code <= 0xa97f) ||
      (code >= 0xd7b0 && code <= 0xd7ff)
    ) hangul++;
    else if (
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0x31f0 && code <= 0x31ff)
    ) kana++;
    else if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf)
    ) han++;
  }
  return { hangul, kana, han };
}
