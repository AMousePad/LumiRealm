import { V1_EMITTERS } from "./v1.js";
import { V2_EMITTERS } from "./v2.js";
import type { EmitFn } from "../types.js";

export const EMITTERS: Readonly<Record<string, EmitFn>> = {
  ...V1_EMITTERS,
  ...V2_EMITTERS,
};

export { V1_EMITTERS, V2_EMITTERS };
export type { EmitFn } from "../types.js";
