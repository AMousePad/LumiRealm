// Tier 2 + Tier 3 lorebook decorator runtime. Tier 2 are pre-activation gates
// (is_greeting, activate_only_after/every, keep/dont_activate_after_match,
// exclude_keys/_all). Tier 3 covers cross-entry merge (inject_lore), slot
// injection (inject_at + replace/prepend modifiers), and pt_* content
// collection for {{position::NAME}}. disable_ui_prompt is a Risu-side no-op.

export interface WorldInfoEntryView {
  readonly id: string;
  readonly disabled: boolean;
  /** Used by inject_lore to find injection targets (matches target.comment). */
  readonly comment: string;
  readonly key: readonly string[];
  /** Secondary keys for sticky-var match scans alongside primary. */
  readonly keysecondary: readonly string[];
  /** Post-decorator-strip entry content. Used as inject_lore base and
   *  surfaces verbatim into the position pt_* macro. */
  readonly content: string;
  /** Order for inject_lore application (sort desc). */
  readonly priority: number;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface WorldInfoMessageView {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
  readonly is_user?: boolean;
  readonly is_greeting?: boolean;
  readonly greeting_index?: number;
}

export interface WorldInfoCtx {
  readonly entries: readonly WorldInfoEntryView[];
  readonly messages: readonly WorldInfoMessageView[];
  readonly chatTurn: number;
  readonly chatMetadata: Readonly<Record<string, unknown>>;
  /** Default scan window for predicate scans. Risu's runtime fallback is 4. */
  readonly defaultScanDepth?: number;
}

const RISU_FALLBACK_SCAN_DEPTH = 4;

export interface DecoratorRecord {
  readonly name: string;
  readonly args: readonly string[];
  readonly fallback?: boolean;
}

export interface DecoratorEvalResult {
  readonly keep: boolean;
  readonly force?: boolean;
  readonly reason?: string;
}

/** Inject shape. Initialized by inject_lore/inject_at, modified by replace/prepend. */
export interface InjectPlan {
  readonly operation: 'append' | 'prepend' | 'replace';
  readonly location: string;
  readonly param: string;
  readonly lore: boolean;
}

/** Mutated-content vote, forwarded as WorldInfoInterceptorResult.mutated. */
export interface MutatedEntry {
  readonly entryId: string;
  readonly content: string;
}

/** Inject-at plan stashed per-chat for the post-assembly mutator. */
export interface InjectAtPlan {
  readonly entryId: string;
  /** Slot identifier: description, persona, authornote, jailbreak, cot, globalNote, main, pt_*. */
  readonly loc: string;
  readonly operation: 'append' | 'prepend' | 'replace';
  readonly content: string;
  /** Search string for `replace` operation. */
  readonly param: string;
}

/** {{position::NAME}} macro substitution data, stashed per-chat. */
export interface PositionPtEntry {
  /** X in pt_X from the entry's `@@position pt_X` decorator. */
  readonly name: string;
  /** Joined content. */
  readonly content: string;
}

export interface InterceptorOutcome {
  readonly disabled: readonly string[];
  readonly forced: readonly string[];
  readonly reasons: Readonly<Record<string, number>>;
  readonly perEntry: ReadonlyArray<{
    readonly entryId: string;
    readonly keep: boolean;
    readonly force?: boolean;
    readonly reason?: string;
  }>;
  readonly stickyWrites: readonly StickyWrite[];
  /** Tier 3 inject_lore: per-target merged content. */
  readonly mutated: readonly MutatedEntry[];
  /** Tier 3 inject_at: per-injector plan. Backend applies post-assembly. */
  readonly injectAt: readonly InjectAtPlan[];
  /** Tier 3 position pt_*: per-NAME joined content. Backend exposes to the
   *  `{{position::NAME}}` macro evaluator. */
  readonly positionPt: readonly PositionPtEntry[];
}

export interface StickyWrite {
  readonly entryId: string;
  readonly varName: string;
  readonly value: '1';
}

export const TIER2_PRE_ACTIVATION_GATES = new Set<string>([
  'is_greeting',
  'activate_only_after',
  'activate_only_every',
  'dont_activate_after_match',
  'keep_activate_after_match',
  'exclude_keys',
  'exclude_keys_all',
]);

/** Decorators that participate in Tier 3 inject/position machinery. */
const INJECT_DECORATOR_NAMES = new Set<string>([
  'inject_lore',
  'inject_at',
  'inject_replace',
  'inject_prepend',
]);

function readDecorators(entry: WorldInfoEntryView): readonly DecoratorRecord[] {
  const raw = entry.extensions['_risu_decorators'];
  if (Array.isArray(raw) && raw.length > 0) {
    const out: DecoratorRecord[] = [];
    for (const d of raw) {
      if (!d || typeof d !== 'object') continue;
      const obj = d as { name?: unknown; args?: unknown; fallback?: unknown };
      if (typeof obj.name !== 'string') continue;
      const args = Array.isArray(obj.args)
        ? obj.args.filter((a): a is string => typeof a === 'string')
        : [];
      out.push({
        name: obj.name,
        args,
        ...(obj.fallback === true ? { fallback: true } : {}),
      });
    }
    return out;
  }
  // Fallback: parse decorators inline from content. Translate-time stash isn't
  // populated for entries authored manually in Lumi's UI or for entries imported
  // before the decorator-aware pipeline shipped. Risu re-parses on every
  // activation (lorebook.svelte.ts:299) so this matches its semantic.
  return parseInlineDecorators(entry.content).decorators;
}

/** Parse a `@@…` decorator block off the top of a content string. Returns the
 *  decorators plus the post-strip body so callers can use the stripped form
 *  (positionPt aggregation, mutated emit) and Lumi's prompt assembly never
 *  sees the raw decorator text. */
function parseInlineDecorators(content: string): {
  readonly decorators: readonly DecoratorRecord[];
  readonly remainingContent: string;
} {
  if (typeof content !== 'string' || content.length === 0 || !content.startsWith('@@')) {
    return { decorators: [], remainingContent: content };
  }
  const lines = content.split('\n');
  const decorators: DecoratorRecord[] = [];
  let cutoffIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] ?? '').trim();
    if (line === '@@@end') line = '@@end';
    if (!line.startsWith('@@')) {
      cutoffIdx = i;
      break;
    }
    cutoffIdx = i + 1;
    const isFallback = line.startsWith('@@@');
    const prefixLen = isFallback ? 3 : 2;
    let spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) spaceIdx = line.length;
    const name = line.slice(prefixLen, spaceIdx);
    if (name === '') continue;
    const argString = line.slice(spaceIdx);
    const args = argString
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    decorators.push({
      name,
      args,
      ...(isFallback ? { fallback: true } : {}),
    });
  }
  const remainingContent = lines.slice(cutoffIdx).join('\n').trim();
  return { decorators, remainingContent };
}

/** Returns the entry's content with any inline decorator block stripped. Used
 *  for positionPt aggregation + mutated emits so Lumi never sees the raw `@@`
 *  text in the prompt. Idempotent on entries whose translate-time strip
 *  already ran. */
function getStrippedContent(entry: WorldInfoEntryView): string {
  // If the translate-time pipeline already stripped (the stash is populated
  // and content lacks a leading `@@`), return as-is.
  const stash = entry.extensions['_risu_decorators'];
  if (Array.isArray(stash) && stash.length > 0) return entry.content;
  return parseInlineDecorators(entry.content).remainingContent;
}

function getStickyState(
  metadata: Readonly<Record<string, unknown>>,
  prefix: 'ka' | 'da',
  entryId: string,
): boolean {
  const cv = metadata['chat_variables'];
  if (!cv || typeof cv !== 'object') return false;
  const key = `__internal_${prefix}_${entryId}`;
  const v = (cv as Record<string, unknown>)[key];
  return v === 'true' || v === '1' || v === true;
}

function buildScanWindow(
  messages: readonly WorldInfoMessageView[],
  scanDepth: number,
): readonly string[] {
  const start = Math.max(0, messages.length - Math.max(0, scanDepth));
  const out: string[] = [];
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    out.push(m.content);
  }
  return out;
}

function scanKeysMatch(
  windowMessages: readonly string[],
  keys: readonly string[],
  all: boolean,
): boolean {
  const trimmedKeys = keys.map((k) => k.trim()).filter((k) => k.length > 0);
  if (trimmedKeys.length === 0) return false;
  const lowered = trimmedKeys.map((k) => k.toLocaleLowerCase().replace(/ /g, ''));
  if (all) {
    for (const key of lowered) {
      let hit = false;
      for (const msg of windowMessages) {
        const m = msg.toLocaleLowerCase().replace(/ /g, '');
        if (m.includes(key)) { hit = true; break; }
      }
      if (!hit) return false;
    }
    return true;
  }
  for (const msg of windowMessages) {
    const m = msg.toLocaleLowerCase().replace(/ /g, '');
    for (const key of lowered) {
      if (m.includes(key)) return true;
    }
  }
  return false;
}

function chatLengthRisuFrame(messages: readonly WorldInfoMessageView[]): number {
  if (messages.length === 0) return 0;
  const first = messages[0]!;
  const firstIsGreeting = first.is_greeting === true || (first.is_greeting === undefined && first.role !== 'user');
  if (firstIsGreeting) return Math.max(0, messages.length - 1);
  return messages.length;
}

export function isGreetingPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
): DecoratorEvalResult {
  const wantRaw = args[0];
  if (wantRaw === undefined) return { keep: true };
  const want = parseInt(wantRaw, 10);
  if (!Number.isFinite(want)) return { keep: true };
  const greeting = ctx.messages.find((m) => m.is_greeting === true);
  if (!greeting) {
    const first = ctx.messages[0];
    const fallbackIsGreetingTurn =
      ctx.messages.length === 1 && first !== undefined && first.role !== 'user';
    if (!fallbackIsGreetingTurn) return { keep: false, reason: 'is_greeting:no_greeting' };
    if (want === 0) return { keep: true };
    return { keep: false, reason: `is_greeting:swipe_unknown(want=${want})` };
  }
  const idx = greeting.greeting_index ?? 0;
  if (idx === want) return { keep: true };
  return { keep: false, reason: `is_greeting:greeting_index=${idx}!=${want}` };
}

export function activateOnlyAfterPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
): DecoratorEvalResult {
  const minRaw = args[0];
  if (minRaw === undefined) return { keep: true };
  const min = parseInt(minRaw, 10);
  if (!Number.isFinite(min)) return { keep: true };
  const len = chatLengthRisuFrame(ctx.messages);
  if (len >= min) return { keep: true };
  return { keep: false, reason: `activate_only_after:${len}<${min}` };
}

export function activateOnlyEveryPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
): DecoratorEvalResult {
  const everyRaw = args[0];
  if (everyRaw === undefined) return { keep: true };
  const every = parseInt(everyRaw, 10);
  if (!Number.isFinite(every) || every <= 0) return { keep: true };
  const len = chatLengthRisuFrame(ctx.messages);
  if (len % every === 0) return { keep: true };
  return { keep: false, reason: `activate_only_every:${len}%${every}!=0` };
}

export function dontActivateAfterMatchPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
  entryId: string,
): DecoratorEvalResult {
  void args;
  const sticky = getStickyState(ctx.chatMetadata, 'da', entryId);
  if (sticky) return { keep: false, reason: 'dont_activate_after_match:sticky' };
  return { keep: true };
}

export function keepActivateAfterMatchPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
  entryId: string,
): DecoratorEvalResult {
  void args;
  const sticky = getStickyState(ctx.chatMetadata, 'ka', entryId);
  if (sticky) return { keep: true, force: true, reason: 'keep_activate_after_match:sticky' };
  return { keep: true };
}

export function excludeKeysPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
): DecoratorEvalResult {
  if (args.length === 0) return { keep: true };
  const scanDepth = ctx.defaultScanDepth ?? RISU_FALLBACK_SCAN_DEPTH;
  const win = buildScanWindow(ctx.messages, scanDepth);
  const matched = scanKeysMatch(win, args, /* all */ false);
  if (matched) return { keep: false, reason: `exclude_keys:matched` };
  return { keep: true };
}

export function excludeKeysAllPredicate(
  args: readonly string[],
  ctx: WorldInfoCtx,
): DecoratorEvalResult {
  if (args.length === 0) return { keep: true };
  const scanDepth = ctx.defaultScanDepth ?? RISU_FALLBACK_SCAN_DEPTH;
  const win = buildScanWindow(ctx.messages, scanDepth);
  const matched = scanKeysMatch(win, args, /* all */ true);
  if (matched) return { keep: false, reason: `exclude_keys_all:all_matched` };
  return { keep: true };
}

export function entryMatchedScanWindow(
  entry: WorldInfoEntryView,
  ctx: WorldInfoCtx,
): boolean {
  const allKeys = [...entry.key, ...entry.keysecondary];
  if (allKeys.length === 0) return false;
  const scanDepth = ctx.defaultScanDepth ?? RISU_FALLBACK_SCAN_DEPTH;
  const win = buildScanWindow(ctx.messages, scanDepth);
  return scanKeysMatch(win, allKeys, /* all */ false);
}

export function evaluatePreActivationGates(
  entry: WorldInfoEntryView,
  ctx: WorldInfoCtx,
  verbose?: (msg: string) => void,
): DecoratorEvalResult {
  const decorators = readDecorators(entry);
  if (decorators.length === 0) return { keep: true };

  let force = false;
  for (const dec of decorators) {
    if (!TIER2_PRE_ACTIVATION_GATES.has(dec.name)) continue;
    let result: DecoratorEvalResult;
    switch (dec.name) {
      case 'is_greeting':
        result = isGreetingPredicate(dec.args, ctx);
        break;
      case 'activate_only_after':
        result = activateOnlyAfterPredicate(dec.args, ctx);
        break;
      case 'activate_only_every':
        result = activateOnlyEveryPredicate(dec.args, ctx);
        break;
      case 'dont_activate_after_match':
        result = dontActivateAfterMatchPredicate(dec.args, ctx, entry.id);
        break;
      case 'keep_activate_after_match':
        result = keepActivateAfterMatchPredicate(dec.args, ctx, entry.id);
        break;
      case 'exclude_keys':
        result = excludeKeysPredicate(dec.args, ctx);
        break;
      case 'exclude_keys_all':
        result = excludeKeysAllPredicate(dec.args, ctx);
        break;
      default:
        result = { keep: true };
    }
    if (verbose) {
      verbose(
        `entry=${entry.id} dec=${dec.name}(${dec.args.join(',')}) keep=${result.keep}` +
          (result.force ? ' force=true' : '') +
          (result.reason ? ` reason=${result.reason}` : ''),
      );
    }
    if (!result.keep) return result;
    if (result.force) force = true;
  }

  return force ? { keep: true, force: true, reason: 'keep_activate_after_match:sticky' } : { keep: true };
}

function computeStickyWrites(
  entry: WorldInfoEntryView,
  ctx: WorldInfoCtx,
): readonly StickyWrite[] {
  const decorators = readDecorators(entry);
  if (decorators.length === 0) return [];
  const wantsKa = decorators.some((d) => d.name === 'keep_activate_after_match');
  const wantsDa = decorators.some((d) => d.name === 'dont_activate_after_match');
  if (!wantsKa && !wantsDa) return [];

  const kaSet = wantsKa ? getStickyState(ctx.chatMetadata, 'ka', entry.id) : true;
  const daSet = wantsDa ? getStickyState(ctx.chatMetadata, 'da', entry.id) : true;
  if (kaSet && daSet) return [];

  const matched = entryMatchedScanWindow(entry, ctx);
  if (!matched) return [];

  const out: StickyWrite[] = [];
  if (wantsKa && !kaSet) {
    out.push({ entryId: entry.id, varName: `__internal_ka_${entry.id}`, value: '1' });
  }
  if (wantsDa && !daSet) {
    out.push({ entryId: entry.id, varName: `__internal_da_${entry.id}`, value: '1' });
  }
  return out;
}

/**
 * Build an InjectPlan from inject_* decorators in declaration order.
 * inject_lore/inject_at initialize, replace/prepend modify operation+param.
 * Returns null when no inject_* decorators are present.
 */
export function parseInjectPlan(decorators: readonly DecoratorRecord[]): InjectPlan | null {
  let operation: 'append' | 'prepend' | 'replace' | null = null;
  let location: string | null = null;
  let param = '';
  let lore: boolean | null = null;

  for (const dec of decorators) {
    if (!INJECT_DECORATOR_NAMES.has(dec.name)) continue;
    switch (dec.name) {
      case 'inject_lore':
        // ??= initializes only if unset, so a prior replace/prepend keeps
        // its operation when inject_lore runs.
        if (operation === null) operation = 'append';
        location = dec.args.join(' ');
        lore = true;
        break;
      case 'inject_at':
        if (operation === null) operation = 'append';
        location = dec.args.join(' ');
        lore = false;
        break;
      case 'inject_replace':
        if (operation === null) operation = 'replace';
        else operation = 'replace';
        if (lore === null) lore = false;
        if (location === null) location = '';
        param = dec.args.join(' ');
        break;
      case 'inject_prepend':
        if (operation === null) operation = 'prepend';
        else operation = 'prepend';
        if (lore === null) lore = false;
        if (location === null) location = '';
        param = dec.args.join(' ');
        break;
    }
  }

  if (operation === null || lore === null || location === null) return null;
  return { operation, location, param, lore };
}

/**
 * Apply a single inject_lore mutation. append/prepend join with space,
 * replace uses JS String.replace (first occurrence only).
 */
export function applyInjectMerge(
  targetContent: string,
  injectorContent: string,
  operation: 'append' | 'prepend' | 'replace',
  param: string,
): string {
  switch (operation) {
    case 'append':
      return `${targetContent} ${injectorContent}`;
    case 'prepend':
      return `${injectorContent} ${targetContent}`;
    case 'replace':
      // First-occurrence replace (string arg semantics).
      return targetContent.replace(param, injectorContent);
  }
}

/** Read the `position pt_<NAME>` decorator. Returns NAME (no prefix) or null. */
export function readPositionPtName(decorators: readonly DecoratorRecord[]): string | null {
  for (const dec of decorators) {
    if (dec.name !== 'position') continue;
    const v = dec.args[0];
    if (typeof v === 'string' && v.startsWith('pt_')) {
      return v.slice('pt_'.length);
    }
  }
  return null;
}

/**
 * Compute Tier 3 inject + position outputs for survivors. Sorts by priority
 * desc (closest Lumi analog to Risu's order desc). Successive injectors stack
 * (second sees first's mutation). Inject_lore and inject_at injectors are
 * filtered out of "activates" and are not eligible as targets.
 */
export function computeInjectAndPositionPlans(
  entries: readonly WorldInfoEntryView[],
  /** Disabled entry ids, not eligible as inject_lore targets. */
  disabledIds: ReadonlySet<string>,
): {
  readonly mutated: readonly MutatedEntry[];
  readonly injectAt: readonly InjectAtPlan[];
  readonly positionPt: readonly PositionPtEntry[];
  /** Entry IDs to add to the disabled vote (injectors of either kind). */
  readonly addDisabled: readonly string[];
} {
  const mutated: MutatedEntry[] = [];
  const injectAt: InjectAtPlan[] = [];
  const positionPtByName: Map<string, string[]> = new Map();
  const addDisabled: string[] = [];

  const survivors = entries.filter((e) => !e.disabled && !disabledIds.has(e.id));

  // Sort by priority desc, tie-break by id for deterministic order.
  const sorted = [...survivors].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  // First pass: classify each survivor by inject plan.
  type Classified = {
    entry: WorldInfoEntryView;
    plan: InjectPlan | null;
    posPt: string | null;
  };
  const classified: Classified[] = sorted.map((entry) => {
    const decorators = readDecorators(entry);
    return {
      entry,
      plan: parseInjectPlan(decorators),
      posPt: readPositionPtName(decorators),
    };
  });

  // Targets pool: non-injector entries. Working content map so injectors stack.
  // getStrippedContent returns the post-decorator body for entries with empty
  // stash; pass-through for properly-stashed entries.
  const targetContent: Map<string, string> = new Map();
  for (const c of classified) {
    if (c.plan === null) {
      targetContent.set(c.entry.id, getStrippedContent(c.entry));
    }
  }

  // Process inject_lore in priority desc, BEFORE pt_* aggregation. A pt_X
  // entry that's also an inject_lore target must surface mutated content.
  for (const c of classified) {
    if (c.plan === null) continue;
    if (!c.plan.lore) continue;

    // Find target by comment match.
    const target = classified.find(
      (t) => t.plan === null && t.entry.comment === c.plan!.location,
    );
    if (!target) continue;

    const current = targetContent.get(target.entry.id) ?? getStrippedContent(target.entry);
    const merged = applyInjectMerge(
      current,
      getStrippedContent(c.entry),
      c.plan.operation,
      c.plan.param,
    );
    targetContent.set(target.entry.id, merged);
  }

  // pt_*: each pt_<NAME> contributes under NAME. Reads from targetContent
  // so post-merge content surfaces. Injectors carry stripped content.
  for (const c of classified) {
    if (c.posPt === null) continue;
    const content = c.plan === null
      ? (targetContent.get(c.entry.id) ?? getStrippedContent(c.entry))
      : getStrippedContent(c.entry);
    const list = positionPtByName.get(c.posPt) ?? [];
    list.push(content);
    positionPtByName.set(c.posPt, list);
  }

  // inject_at plans, consumed post-assembly by registerInterceptor.
  for (const c of classified) {
    if (c.plan === null) continue;
    if (c.plan.lore) continue;
    injectAt.push({
      entryId: c.entry.id,
      loc: c.plan.location,
      operation: c.plan.operation,
      content: c.entry.content,
      param: c.plan.param,
    });
  }

  // Single-pass disabled-voting: each entry contributes at most one disable
  // vote regardless of how many decorator roles it carries.
  for (const c of classified) {
    const isInjector = c.plan !== null;
    const isSlotFiller = c.posPt !== null;
    if (isInjector || isSlotFiller) {
      addDisabled.push(c.entry.id);
    }
  }

  // Emit mutated entries: non-injector, non-slot-filler whose content changed
  // (typically inject_lore targets).
  for (const c of classified) {
    if (c.plan !== null) continue;
    if (c.posPt !== null) continue;
    const final = targetContent.get(c.entry.id);
    if (final !== undefined && final !== c.entry.content) {
      mutated.push({ entryId: c.entry.id, content: final });
    }
  }

  // Emit positionPt entries, joined with newline.
  const positionPt: PositionPtEntry[] = [];
  for (const [name, parts] of positionPtByName) {
    positionPt.push({ name, content: parts.join('\n') });
  }

  return { mutated, injectAt, positionPt, addDisabled };
}

export function runWorldInfoInterceptor(
  ctx: WorldInfoCtx,
  verbose?: (msg: string) => void,
): InterceptorOutcome {
  const disabled: string[] = [];
  const forced: string[] = [];
  const reasonCounts: Record<string, number> = {};
  const perEntry: { entryId: string; keep: boolean; force?: boolean; reason?: string }[] = [];
  const stickyWrites: StickyWrite[] = [];

  // Pass 1: pre-activation gates (Tier 2). Disabled votes win first.
  for (const entry of ctx.entries) {
    if (entry.disabled) {
      perEntry.push({ entryId: entry.id, keep: false, reason: 'already_disabled' });
      continue;
    }
    const result = evaluatePreActivationGates(entry, ctx, verbose);
    perEntry.push({
      entryId: entry.id,
      keep: result.keep,
      ...(result.force ? { force: true } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
    });
    if (!result.keep) {
      disabled.push(entry.id);
      const decoratorName = (result.reason ?? '').split(':')[0] ?? 'unknown';
      reasonCounts[decoratorName] = (reasonCounts[decoratorName] ?? 0) + 1;
    } else if (result.force) {
      forced.push(entry.id);
    }
    const writes = computeStickyWrites(entry, ctx);
    if (writes.length > 0) stickyWrites.push(...writes);
  }

  // Pass 2: Tier 3 inject + position over Tier-2 survivors only.
  const disabledSet = new Set<string>(disabled);
  const t3 = computeInjectAndPositionPlans(ctx.entries, disabledSet);
  for (const id of t3.addDisabled) {
    if (!disabledSet.has(id)) {
      disabled.push(id);
      disabledSet.add(id);
      reasonCounts['inject'] = (reasonCounts['inject'] ?? 0) + 1;
    }
  }

  return {
    disabled,
    forced,
    reasons: reasonCounts,
    perEntry,
    stickyWrites,
    mutated: t3.mutated,
    injectAt: t3.injectAt,
    positionPt: t3.positionPt,
  };
}

// ─── Tier 3 inject_at apply (post-assembly) ──────────────────────────────────

export interface ApplyInjectAtMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ApplyInjectAtResult {
  readonly messages: readonly ApplyInjectAtMessage[];
  readonly mutationCount: number;
  /** Plans that synthesized a new system message when the anchor was missing. */
  readonly synthesizedCount: number;
  /** replace plans whose param wasn't found, fell back to append-with-space. */
  readonly fallbackAppendCount: number;
  /** Per-plan outcome string for diagnostics. */
  readonly perPlan: ReadonlyArray<{
    readonly entryId: string;
    readonly outcome:
      | 'mutated'
      | 'synthesized:unknown_loc'
      | 'synthesized:anchor_missing'
      | 'fallback_append'
      | 'noop';
  }>;
}

/** {{slot}} and {{original}} are template markers for the slot's actual text.
 *  Empty param is bucketed with them because replace('', X) at index 0 is
 *  closer to author intent as anchor-text-prepend than a literal match. */
const RISU_SLOT_TOKENS: ReadonlySet<string> = new Set(['{{slot}}', '{{original}}', '']);

/**
 * Apply Tier 3 inject_at plans to an assembled message array. Pure.
 * Anchor present: append/prepend/replace. replace with {{slot}}/{{original}}/
 * empty replaces the anchor text. Literal-param replace falls back to append
 * when the param isn't found. Anchor missing or loc unknown: synthesize a
 * new system message at end with [<loc>] prefix.
 */
export function applyInjectAtToMessages(
  messages: readonly ApplyInjectAtMessage[],
  plans: readonly InjectAtPlan[],
  slotText: Readonly<Record<string, string>>,
): ApplyInjectAtResult {
  const out: ApplyInjectAtMessage[] = messages.slice();
  let mutationCount = 0;
  let synthesizedCount = 0;
  let fallbackAppendCount = 0;
  const perPlan: ApplyInjectAtResult['perPlan'][number][] = [];

  for (const plan of plans) {
    const anchor = slotText[plan.loc];

    // Unknown loc: synthesize at end.
    if (!anchor) {
      const synthBody =
        plan.operation === 'prepend'
          ? `${plan.content}\n[${plan.loc}]`
          : `[${plan.loc}]\n${plan.content}`;
      out.push({ role: 'system', content: synthBody });
      synthesizedCount += 1;
      perPlan.push({ entryId: plan.entryId, outcome: 'synthesized:unknown_loc' });
      continue;
    }

    // Locate first system message containing the anchor.
    let targetIdx = -1;
    for (let i = 0; i < out.length; i++) {
      const m = out[i];
      if (!m || m.role !== 'system') continue;
      if (m.content.includes(anchor)) { targetIdx = i; break; }
    }

    // Anchor known but not present, synthesize as unknown-loc.
    if (targetIdx < 0) {
      out.push({ role: 'system', content: `[${plan.loc}]\n${plan.content}` });
      synthesizedCount += 1;
      perPlan.push({ entryId: plan.entryId, outcome: 'synthesized:anchor_missing' });
      continue;
    }

    const before = out[targetIdx]!.content;
    let after: string;
    let isFallbackAppend = false;
    switch (plan.operation) {
      case 'append':
        after = `${before} ${plan.content}`;
        break;
      case 'prepend':
        after = `${plan.content} ${before}`;
        break;
      case 'replace': {
        // Tier A: Risu's slot-replacement idiom. Replace the anchor text
        // (the actual slot content we identified) with the injector content.
        if (RISU_SLOT_TOKENS.has(plan.param)) {
          after = before.replace(anchor, plan.content);
          break;
        }
        // Literal-text replace. param-not-present triggers fallback append.
        // Identity (X to X) is a legitimate noop.
        if (!before.includes(plan.param)) {
          after = `${before} ${plan.content}`;
          isFallbackAppend = true;
        } else {
          after = before.replace(plan.param, plan.content);
        }
        break;
      }
    }
    if (after !== before) {
      out[targetIdx] = { ...out[targetIdx]!, content: after };
      mutationCount += 1;
      if (isFallbackAppend) {
        fallbackAppendCount += 1;
        perPlan.push({ entryId: plan.entryId, outcome: 'fallback_append' });
      } else {
        perPlan.push({ entryId: plan.entryId, outcome: 'mutated' });
      }
    } else {
      perPlan.push({ entryId: plan.entryId, outcome: 'noop' });
    }
  }

  return { messages: out, mutationCount, synthesizedCount, fallbackAppendCount, perPlan };
}

