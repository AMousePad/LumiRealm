
/** Lumiverse Character, from [Lumiverse src/types/character.ts]. */
export interface LumiCharacter {
  id: string;
  name: string;
  avatar_path: string | null;
  image_id: string | null;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  alternate_greetings: string[];
  extensions: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}


/** Lumiverse WorldBook header, from [Lumiverse src/types/world-book.ts]. */
export interface LumiWorldBook {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export type LumiVectorIndexStatus = "not_enabled" | "pending" | "indexed" | "error";

export interface LumiWorldBookEntry {
  id: string;
  world_book_id: string;
  uid: string;
  key: string[];
  keysecondary: string[];
  content: string;
  comment: string;
  position: number;
  depth: number;
  role: string | null;
  order_value: number;
  selective: boolean;
  constant: boolean;
  disabled: boolean;
  group_name: string;
  group_override: boolean;
  group_weight: number;
  probability: number;
  scan_depth: number | null;
  exclude_greeting: boolean;
  case_sensitive: boolean;
  match_whole_words: boolean;
  automation_id: string | null;
  use_regex: boolean;
  prevent_recursion: boolean;
  exclude_recursion: boolean;
  delay_until_recursion: boolean;
  priority: number;
  sticky: number;
  cooldown: number;
  delay: number;
  selective_logic: number;
  use_probability: boolean;
  vectorized: boolean;
  vector_index_status: LumiVectorIndexStatus;
  vector_indexed_at: number | null;
  vector_index_error: string | null;
  extensions: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}


export type LumiRegexTarget = "display" | "prompt" | "response";

/** Lumiverse placement axis — matches [Lumiverse src/types/regex-script.ts]. */
export type LumiRegexPlacement = "user_input" | "ai_output" | "world_info" | "reasoning";

/** Scope of a regex script — matches [Lumiverse src/types/regex-script.ts]. */
export type LumiRegexScope = "global" | "character" | "chat";

/** Macro-substitution mode — matches [Lumiverse src/types/regex-script.ts]. */
export type LumiRegexMacroMode = "none" | "raw" | "escaped" | "after";

// Lumiverse src/types/regex-script.ts
export interface LumiRegexScript {
  id: string;
  user_id: string;
  name: string;
  script_id: string;
  find_regex: string;
  replace_string: string;
  flags: string;
  placement: readonly LumiRegexPlacement[];
  scope: LumiRegexScope;
  scope_id: string | null;
  target: LumiRegexTarget;
  min_depth: number | null;
  max_depth: number | null;
  trim_strings: readonly string[];
  run_on_edit: boolean;
  substitute_macros: LumiRegexMacroMode;
  disabled: boolean;
  sort_order: number;
  description: string;
  folder: string;
  pack_id: string | null;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}
