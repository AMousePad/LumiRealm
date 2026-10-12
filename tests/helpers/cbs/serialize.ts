import type { CbsNode, CbsTemplate } from "./ast.js";

export function serialize(t: CbsTemplate): string {
  let out = "";
  for (const n of t.nodes) out += serializeNode(n);
  return out;
}

export function serializeNode(n: CbsNode): string {
  switch (n.type) {
    case "text":
      return n.value;
    case "macro":
      return `{{${n.raw}}}`;
    case "legacy":
      return `{#${n.raw}#}`;
    case "block": {
      const header = `{{#${n.headerRaw}}}`;
      const close = n.closeRaw === "" ? "" : `{{${n.closeRaw}}}`;
      if (n.bodyRaw !== undefined) {
        return `${header}${n.bodyRaw}${close}`;
      }
      let body = "";
      for (const c of n.children ?? []) body += serializeNode(c);
      if (n.elseChildren) {
        body += `{{:else}}`;
        for (const c of n.elseChildren) body += serializeNode(c);
      }
      return `${header}${body}${close}`;
    }
  }
}
