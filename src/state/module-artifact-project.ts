// Pure shape-conversion: Risu module body → Lumi world_book / regex_script wire shapes.
// Lifted from backend.ts for unit-testability. Synchronous + side-effect-free.

import type {
  ModuleLorebookEntry,
  PendingRegexScriptMsg,
} from '../types/messages.js';
import { unprefixHtmlClasses, normalizeIncompleteHtmlEntities, unprefixCssInStyleBlocks } from '../bghtml/rewriter.js';
import { normaliseRisuFlag, pickSubstituteMacroMode } from '../core/mappers/regex.js';

export function projectModuleLorebookEntries(
  moduleId: string,
  raw: readonly unknown[] | undefined,
): readonly ModuleLorebookEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ModuleLorebookEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const eo = e as Record<string, unknown>;
    const content = typeof eo['content'] === 'string' ? eo['content'] : '';
    const keyRaw = eo['key'];
    const key = Array.isArray(keyRaw)
      ? keyRaw.filter((x): x is string => typeof x === 'string')
      : typeof keyRaw === 'string'
        ? [keyRaw]
        : [];
    if (key.length === 0 && content.length === 0) continue;
    // Risu native shape uses alwaysActive + mode='constant' for the
    // constant flag and mode='folder' for display headers. See
    // mappers/lorebook.ts mapMode(). Also accept the CCSv3 shape
    // (`constant: bool`) for FE-shaped inputs / re-installs.
    const isConstant =
      eo['constant'] === true ||
      eo['alwaysActive'] === true ||
      eo['mode'] === 'constant';
    const isFolder = eo['mode'] === 'folder';
    const disabled = isFolder
      ? true
      : typeof eo['disabled'] === 'boolean'
        ? eo['disabled']
        : undefined;
    const orderRaw = typeof eo['insertorder'] === 'number'
      ? eo['insertorder']
      : typeof eo['order'] === 'number'
        ? eo['order']
        : undefined;
    const secondaryKeys = Array.isArray(eo['secondary_keys'])
      ? eo['secondary_keys'].filter((x): x is string => typeof x === 'string')
      : typeof eo['secondkey'] === 'string' && eo['secondkey'].length > 0
        ? eo['secondkey'].split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        : undefined;
    const entry: ModuleLorebookEntry = {
      key,
      content,
      ...(typeof eo['comment'] === 'string' ? { comment: eo['comment'] } : {}),
      ...(isConstant ? { constant: true } : isFolder ? { constant: false } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
      ...(typeof eo['position'] === 'string' ? { position: eo['position'] } : {}),
      ...(typeof eo['priority'] === 'number' ? { priority: eo['priority'] } : {}),
      ...(orderRaw !== undefined ? { order: orderRaw } : {}),
      ...(secondaryKeys ? { secondary_keys: secondaryKeys } : {}),
      ...(typeof eo['selective'] === 'boolean' ? { selective: eo['selective'] } : {}),
      metadata: { _risu: { module_id: moduleId } },
    };
    out.push(entry);
  }
  return out;
}

export function projectModuleRegexEntries(
  moduleId: string,
  moduleName: string,
  characterId: string,
  raw: readonly unknown[] | undefined,
  idGen: () => string,
): readonly PendingRegexScriptMsg[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingRegexScriptMsg[] = [];
  let sortBase = 0;
  for (let sourceIndex = 0; sourceIndex < raw.length; sourceIndex++) {
    const e = raw[sourceIndex];
    if (!e || typeof e !== 'object') continue;
    const eo = e as Record<string, unknown>;
    const findRegex = typeof eo['in'] === 'string' ? eo['in'] : '';
    let replaceString = typeof eo['out'] === 'string' ? eo['out'] : '';
    const comment = typeof eo['comment'] === 'string' ? eo['comment'] : '';
    if (findRegex.length === 0) {
      if (comment.length === 0) continue;
      out.push({
        name: comment,
        script_id: idGen(),
        find_regex: '(?!)',
        replace_string: '',
        flags: 'g',
        placement: ['ai_output'],
        scope: 'character',
        scope_id: characterId,
        target: 'display',
        min_depth: null,
        max_depth: null,
        trim_strings: [],
        run_on_edit: false,
        substitute_macros: 'none',
        disabled: true,
        sort_order: 1000 + sortBase,
        description: `Divider from .risum module: ${moduleName}`,
        folder: `Module: ${moduleName}`,
        metadata: {
          _risu: {
            module_id: moduleId,
            source_type: 'divider',
            source_index: sourceIndex,
            source_row_index: sortBase,
          },
        },
      });
      sortBase += 1;
      continue;
    }
    const ruleType = typeof eo['type'] === 'string' ? eo['type'] : 'editdisplay';
    const { placement, target, disabled } = riskCustomScriptTypeToLumi(ruleType);
    if (target === 'display' && replaceString.length > 0) {
      replaceString = unprefixHtmlClasses(replaceString);
      replaceString = unprefixCssInStyleBlocks(replaceString);
      replaceString = normalizeIncompleteHtmlEntities(replaceString);
    }
    const ableFlagRaw = eo['ableFlag'];
    const ableFlag = ableFlagRaw === undefined || ableFlagRaw === null
      ? true
      : !!ableFlagRaw;
    const rawFlag = typeof eo['flag'] === 'string' ? eo['flag'] : undefined;
    const normalisedFlag = normaliseRisuFlag(rawFlag, ableFlag);
    let flags = normalisedFlag.flag;
    const findHasCbs = findRegex.indexOf('{{') >= 0;
    if (findHasCbs) flags = flags.replace(/u/g, '');
    if (flags.length === 0) flags = 'g';
    const ruleNameRaw = comment.length > 0 ? comment : `rule_${sortBase + 1}`;
    out.push({
      name: ruleNameRaw,
      script_id: idGen(),
      find_regex: findRegex,
      replace_string: replaceString,
      flags,
      placement,
      scope: 'character',
      scope_id: characterId,
      target,
      min_depth: null,
      max_depth: target === 'prompt' && ruleType === 'editinput' ? 0 : null,
      trim_strings: [],
      run_on_edit: false,
      substitute_macros: pickSubstituteMacroMode(replaceString, findHasCbs),
      disabled,
      // Risu sorts <order N> descending, Lumi reads sort_order ASC: negate.
      sort_order: 1000 + sortBase - (normalisedFlag.order ?? 0) * 100000,
      description: `From .risum module: ${moduleName}`,
      folder: `Module: ${moduleName}`,
      metadata: {
        _risu: {
          module_id: moduleId,
          source_type: ruleType,
          phase: ruleType,
          source_index: sourceIndex,
          source_row_index: sortBase,
          ...(normalisedFlag.order !== undefined ? { order_flag: normalisedFlag.order } : {}),
          ...(normalisedFlag.actions.length > 0
            ? { flag_actions: normalisedFlag.actions }
            : {}),
        },
      },
    });
    sortBase += 1;
  }
  return out;
}

// Mirrors RISU_PHASE_MAP from the character regex mapper. editinput max_depth=0
// is enforced at the call site, not here.
export function riskCustomScriptTypeToLumi(t: string): {
  placement: readonly string[];
  target: 'prompt' | 'response' | 'display';
  disabled: boolean;
} {
  switch (t) {
    case 'editinput':
      return { placement: ['user_input'], target: 'prompt', disabled: false };
    case 'editprocess':
      // Chat history loop only, never world_info.
      return {
        placement: ['user_input', 'ai_output'],
        target: 'prompt',
        disabled: false,
      };
    case 'editoutput':
      return { placement: ['ai_output'], target: 'response', disabled: false };
    case 'edittrans':
      // Lumi has no translation pipeline that fans through regex_scripts.
      return { placement: ['ai_output', 'user_input'], target: 'display', disabled: true };
    case 'disabled':
      return { placement: ['ai_output', 'user_input'], target: 'display', disabled: true };
    case 'editdisplay':
    default:
      // Risu runs editdisplay on every rendered message regardless of role.
      return { placement: ['ai_output', 'user_input'], target: 'display', disabled: false };
  }
}
