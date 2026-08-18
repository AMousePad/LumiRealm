import type { ActiveCard } from '../interpreter/dispatch.js';
import type { BackendToFrontend } from '../types/messages.js';

const STYLE_RE_SOURCE = '<style\\b[^>]*>([\\s\\S]*?)<\\/style\\s*>';
const CAPTURE_REF_RE = /\$\d|\$&|\$<[a-zA-Z_]/;

// Depth-zero (unconditional) style block extractor used as fallback when CBS resolve fails.
function extractStyleBlocksTopLevelFallback(template: string): string[] {
  if (!template || template.indexOf('<style') < 0) return [];
  const STYLE_RE = new RegExp(STYLE_RE_SOURCE, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = STYLE_RE.exec(template)) !== null) {
    let opens = 0, closes = 0, i = 0;
    while (i < m.index - 2) {
      if (template.charCodeAt(i) === 0x7b && template.charCodeAt(i + 1) === 0x7b) {
        const ch = template.charCodeAt(i + 2);
        if (ch === 0x23) { opens++; i += 3; continue; }
        if (ch === 0x2f) { closes++; i += 3; continue; }
      }
      i++;
    }
    if (opens !== closes) continue;
    const inner = (m[1] ?? '').trim();
    if (inner.length === 0) continue;
    if (CAPTURE_REF_RE.test(inner)) continue;
    out.push(inner);
  }
  return out;
}

// Source of truth for cross-rule CSS: returns enabled, character-scoped,
// non-module rows from Lumi with their current replace_string.
export type ListLiveCharacterCrossRuleRules = (
  characterId: string,
  userId: string,
) => Promise<readonly { replace_string: string }[]>;

export interface BgHtmlRefresherDeps {
  readonly resolveReadonly: (
    template: string,
    chatId: string,
    characterId: string,
    userId: string | undefined,
    opts?: { cbsContext?: boolean },
  ) => Promise<string>;
  readonly lastSentBgHtmlByChat: Map<string, string>;
  readonly send: (msg: BackendToFrontend, userId: string | undefined) => void;
  readonly listLiveCharacterCrossRuleRules: ListLiveCharacterCrossRuleRules;
  readonly log: {
    readonly info: (m: string) => void;
    readonly warn: (m: string) => void;
    readonly error: (m: string) => void;
    readonly debug: (m: string) => void;
  };
  readonly errMsg: (e: unknown) => string;
}

export interface BgHtmlRefresher {
  readonly refresh: (
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  readonly extractCrossRuleStyleParts: (
    rules: readonly { replace_string?: string }[] | undefined,
    atActions: readonly unknown[] | undefined,
    chatId: string,
    characterId: string,
    userId: string | undefined,
  ) => Promise<readonly string[]>;
}

export function createBgHtmlRefresher(deps: BgHtmlRefresherDeps): BgHtmlRefresher {
  const { resolveReadonly, lastSentBgHtmlByChat, send, log, errMsg } = deps;

  async function extractCrossRuleStyleParts(
    rules: readonly { replace_string?: string }[] | undefined,
    atActions: readonly unknown[] | undefined,
    chatId: string,
    characterId: string,
    userId: string | undefined,
  ): Promise<readonly string[]> {
    const candidates: string[] = [];
    if (rules) {
      for (const r of rules) {
        const t = r.replace_string ?? '';
        if (t.indexOf('<style') < 0) continue;
        candidates.push(t);
      }
    }
    if (atActions) {
      for (const a of atActions) {
        const action = a as { out?: unknown; script?: { out?: unknown } };
        const t = typeof action?.out === 'string'
          ? action.out
          : typeof action?.script?.out === 'string'
            ? action.script.out
            : '';
        if (t.indexOf('<style') >= 0) candidates.push(t);
      }
    }
    if (candidates.length === 0) return [];

    const SEP = '\n__RISU_TEMPLATE_SEP_a3f9b__\n';
    const joined = candidates.join(SEP);
    let resolved: string;
    try {
      resolved = await resolveReadonly(joined, chatId, characterId, userId);
    } catch (err) {
      log.warn(
        `extractCrossRuleStyleParts: resolve failed (${errMsg(err)}). ` +
          `Falling back to top-level-only heuristic for ${candidates.length} candidate(s).`,
      );
      const out: string[] = [];
      for (const t of candidates) out.push(...extractStyleBlocksTopLevelFallback(t));
      return out;
    }

    const STYLE_RE = new RegExp(STYLE_RE_SOURCE, 'gi');
    const parts = resolved.split(SEP);
    const out: string[] = [];
    for (const p of parts) {
      STYLE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = STYLE_RE.exec(p)) !== null) {
        const inner = (m[1] ?? '').trim();
        if (inner.length === 0) continue;
        // Skip rules with capture-group refs ($1, $&, $<name>) which resolve per-match later.
        if (CAPTURE_REF_RE.test(inner)) continue;
        out.push(inner);
      }
    }
    return out;
  }

  async function refresh(
    active: ActiveCard,
    chatId: string,
    userId: string | undefined,
    isCurrent?: () => boolean,
  ): Promise<void> {
    const bgRaw = active.card.risuPayload.background_html;
    const moduleBg = active.card.risuPayload.module_background_embedding ?? '';
    const bgCombined = (bgRaw ?? '') + (moduleBg.length > 0 ? '\n' + moduleBg : '');
    const characterId = active.card.character_id;

    log.debug(
      `refreshBgHtml: START chatId=${chatId} bgRaw_len=${bgRaw?.length ?? 0} ` +
        `moduleBg_len=${moduleBg.length} bgCombined_len=${bgCombined.length}`,
    );

    const tResolve = Date.now();
    if (userId === undefined) {
      log.warn(`refreshBgHtml: userId not captured for chatId=${chatId}, skipping`);
      return;
    }
    let resolvedBg = '';
    let crossRuleStyles: readonly string[] = [];
    try {
      const [bgOut, charRules] = await Promise.all([
        bgCombined.length > 0
          ? resolveReadonly(bgCombined, chatId, characterId, userId)
          : Promise.resolve(''),
        deps.listLiveCharacterCrossRuleRules(characterId, userId),
      ]);
      resolvedBg = bgOut;
      crossRuleStyles = await extractCrossRuleStyleParts(
        charRules,
        active.card.risuPayload.at_actions,
        chatId,
        characterId,
        userId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`refreshBgHtml: resolve failed chatId=${chatId}: ${msg}`);
      return;
    }
    if (isCurrent?.() === false) return;
    const elapsed = Date.now() - tResolve;

    if (resolvedBg.length === 0 && crossRuleStyles.length === 0) {
      log.debug(`refreshBgHtml: no bg_html and no cross-rule styles, sending clear_bg_html`);
      try {
        send({ type: 'clear_bg_html', chatId }, userId);
      } catch (err) {
        log.warn(`refreshBgHtml: clear send failed: ${(err as Error).message}`);
      }
      return;
    }

    log.debug(
      `refreshBgHtml: resolved chatId=${chatId} bg_in=${bgCombined.length} ` +
        `bg_out=${resolvedBg.length} crossRuleParts=${crossRuleStyles.length} ` +
        `crossRule_total=${crossRuleStyles.reduce((a, p) => a + p.length, 0)} ` +
        `elapsed=${elapsed}ms`,
    );
    // Sentinel separator unlikely to appear in CSS, used to dedupe redundant per-chat sends.
    const sig = resolvedBg + '\x1f' + crossRuleStyles.join('\x1e');
    const prior = lastSentBgHtmlByChat.get(chatId);
    if (prior === sig) {
      log.debug(
        `refreshBgHtml: skip redundant send chatId=${chatId} (signature matches prior) ` +
          `bg_out=${resolvedBg.length} crossRule_total=${crossRuleStyles.reduce((a, p) => a + p.length, 0)}`,
      );
      return;
    }
    lastSentBgHtmlByChat.set(chatId, sig);
    try {
      send({
        type: 'render_bg_html',
        chatId,
        bgHtml: resolvedBg,
        ...(crossRuleStyles.length > 0 ? { crossRuleStyles } : {}),
      } as never, userId);
      log.debug(`refreshBgHtml: sendToFrontend render_bg_html OK chatId=${chatId}`);
    } catch (err) {
      log.warn(`refreshBgHtml: send failed: ${(err as Error).message}`);
    }
  }

  return { refresh, extractCrossRuleStyleParts };
}
