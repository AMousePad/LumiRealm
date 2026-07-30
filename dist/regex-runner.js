// @bun
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/interpreter/evaluator/scoped.ts
function isTruthy(s) {
  const t = s.trim();
  return t === "true" || t === "1";
}
function trimLines(p1) {
  return p1.split(`
`).map((v) => v.trimStart()).join(`
`).trim();
}
function risuEscape(text) {
  return text.replace(/[{}()]/g, (f) => {
    switch (f) {
      case "{":
        return "\uE9B8";
      case "}":
        return "\uE9B9";
      case "(":
        return "\uE9BA";
      case ")":
        return "\uE9BB";
      default:
        return f;
    }
  });
}
function blockStartMatcher(input, ctx) {
  const p1 = input;
  if (p1.startsWith("#if") || p1.startsWith("#if_pure ")) {
    const statement = p1.split(" ", 2);
    const state = statement[1];
    if (state === "true" || state === "1") {
      return { type: p1.startsWith("#if_pure") ? "ifpure" : "parse" };
    }
    return { type: "ignore" };
  }
  if (p1.startsWith("#when")) {
    if (p1.startsWith("#when ")) {
      const statement = p1.split(" ", 2);
      const state = statement[1];
      return { type: state === "true" || state === "1" ? "newif" : "newif-falsy" };
    } else if (p1.startsWith("#when::")) {
      const statement = p1.split("::").slice(1);
      if (statement.length === 1) {
        const state = statement[0];
        return { type: state === "true" || state === "1" ? "newif" : "newif-falsy" };
      }
      let mode = "normal";
      while (statement.length > 1) {
        const condition = statement.pop();
        const operator = statement.pop();
        switch (operator) {
          case "not":
            statement.push(isTruthy(condition) ? "0" : "1");
            break;
          case "keep":
            mode = "keep";
            statement.push(condition);
            break;
          case "legacy":
            mode = "legacy";
            statement.push(condition);
            break;
          case "and": {
            const c2 = statement.pop();
            statement.push(isTruthy(condition) && isTruthy(c2) ? "1" : "0");
            break;
          }
          case "or": {
            const c2 = statement.pop();
            statement.push(isTruthy(condition) || isTruthy(c2) ? "1" : "0");
            break;
          }
          case "is": {
            const c2 = statement.pop();
            statement.push(condition === c2 ? "1" : "0");
            break;
          }
          case "isnot": {
            const c2 = statement.pop();
            statement.push(condition !== c2 ? "1" : "0");
            break;
          }
          case "var": {
            const v = ctx.vars.get("local", condition);
            statement.push(isTruthy(v) ? "1" : "0");
            break;
          }
          case "toggle": {
            const v = ctx.vars.get("global", "toggle_" + condition);
            statement.push(isTruthy(v) ? "1" : "0");
            break;
          }
          case "vis": {
            const name = statement.pop();
            statement.push(ctx.vars.get("local", name) === condition ? "1" : "0");
            break;
          }
          case "visnot": {
            const name = statement.pop();
            statement.push(ctx.vars.get("local", name) !== condition ? "1" : "0");
            break;
          }
          case "tis": {
            const name = statement.pop();
            statement.push(ctx.vars.get("global", "toggle_" + name) === condition ? "1" : "0");
            break;
          }
          case "tisnot": {
            const name = statement.pop();
            statement.push(ctx.vars.get("global", "toggle_" + name) !== condition ? "1" : "0");
            break;
          }
          case ">": {
            const c2 = statement.pop();
            statement.push(parseFloat(c2) > parseFloat(condition) ? "1" : "0");
            break;
          }
          case "<": {
            const c2 = statement.pop();
            statement.push(parseFloat(c2) < parseFloat(condition) ? "1" : "0");
            break;
          }
          case ">=": {
            const c2 = statement.pop();
            statement.push(parseFloat(c2) >= parseFloat(condition) ? "1" : "0");
            break;
          }
          case "<=": {
            const c2 = statement.pop();
            statement.push(parseFloat(c2) <= parseFloat(condition) ? "1" : "0");
            break;
          }
          default:
            statement.push(isTruthy(condition) ? "1" : "0");
        }
      }
      const finalCondition = statement[0];
      if (isTruthy(finalCondition)) {
        if (mode === "keep")
          return { type: "newif", type2: "keep" };
        if (mode === "legacy")
          return { type: "parse" };
        return { type: "newif" };
      }
      if (mode === "keep")
        return { type: "newif-falsy", type2: "keep" };
      if (mode === "legacy")
        return { type: "ignore" };
      return { type: "newif-falsy" };
    }
    return { type: "newif-falsy" };
  }
  if (p1 === "#pure")
    return { type: "pure" };
  if (p1 === "#pure_display" || p1 === "#puredisplay")
    return { type: "pure-display" };
  if (p1 === "#ignore")
    return { type: "ignore" };
  if (p1 === "#code")
    return { type: "normalize" };
  if (p1.startsWith("#escape")) {
    const t2 = p1.substring(7).trim();
    const mode = t2 === "::keep" ? "keep" : undefined;
    return { type: "escape", ...mode ? { mode } : {} };
  }
  if (p1.startsWith("#each")) {
    let t2 = p1.substring(5).trim();
    let mode;
    if (t2.startsWith("::keep ")) {
      mode = "keep";
      t2 = t2.substring(7).trim();
    }
    if (t2.startsWith("as ")) {
      t2 = t2.substring(3).trim();
    }
    return { type: "each", type2: t2, ...mode ? { mode } : {} };
  }
  if (p1.startsWith("#func")) {
    const statement = p1.split(" ");
    if (statement.length > 1) {
      return { type: "function", funcArg: statement.slice(1) };
    }
  }
  return { type: "nothing" };
}
function blockEndMatcher(p1, type) {
  const p1Trimmed = p1.trim();
  switch (type.type) {
    case "pure":
    case "pure-display":
    case "function":
      return p1Trimmed;
    case "parse":
      return trimLines(p1Trimmed);
    case "each":
      if (type.mode === "keep")
        return p1;
      return trimLines(p1Trimmed);
    case "ifpure":
      return p1;
    case "newif":
    case "newif-falsy": {
      const findElse = (s) => {
        const index = s.indexOf("{{:else}}");
        return { index, len: index === -1 ? 0 : 9 };
      };
      const isElseLine = (v) => {
        return v.trim() === "{{:else}}";
      };
      const lines = p1.split(`
`);
      if (lines.length === 1) {
        const hit = findElse(p1);
        if (hit.index !== -1) {
          if (type.type === "newif")
            return p1.substring(0, hit.index);
          if (type.type === "newif-falsy")
            return p1.substring(hit.index + hit.len);
        } else {
          if (type.type === "newif")
            return p1;
          if (type.type === "newif-falsy")
            return "";
        }
      }
      const elseLine = lines.findIndex(isElseLine);
      if (elseLine !== -1 && type.type === "newif") {
        lines.splice(elseLine);
      }
      if (elseLine !== -1 && type.type === "newif-falsy") {
        lines.splice(0, elseLine + 1);
      }
      if (elseLine === -1 && type.type === "newif-falsy")
        return "";
      if (type.type2 !== "keep") {
        while (lines.length > 0 && lines[0].trim() === "")
          lines.shift();
        while (lines.length > 0 && lines[lines.length - 1].trim() === "")
          lines.pop();
      }
      return lines.join(`
`);
    }
    case "normalize":
      return p1Trimmed.replaceAll(`
`, "").replaceAll("\t", "").replaceAll(/\\u([0-9A-Fa-f]{4})/g, (_m, p) => String.fromCharCode(parseInt(p, 16))).replaceAll(/\\(.)/g, (_m, p) => {
        switch (p) {
          case "n":
            return `
`;
          case "r":
            return "\r";
          case "t":
            return "\t";
          case "b":
            return "\b";
          case "f":
            return "\f";
          case "v":
            return "\v";
          case "a":
            return "\x07";
          case "x":
            return "\x00";
          default:
            return p;
        }
      });
    case "escape":
      return risuEscape(type.mode === "keep" ? p1 : p1Trimmed);
    default:
      return "";
  }
}

// src/interpreter/evaluator/legacy.ts
function legacyBlockMatcher(p1) {
  const bn = p1.indexOf(`
`);
  if (bn === -1)
    return null;
  const logic = p1.substring(0, bn);
  const content = p1.substring(bn + 1);
  const statement = logic.split(" ", 2);
  if (statement[0] === "if") {
    if (["", "0", "-1"].includes(statement[1] ?? ""))
      return "";
    return content.trim();
  }
  return null;
}

// src/interpreter/evaluator/parse-array.ts
function parseArray(p1) {
  try {
    const arr = JSON.parse(p1);
    if (Array.isArray(arr))
      return arr;
    return p1.split("\xA7");
  } catch {
    return p1.split("\xA7");
  }
}

// src/risu-compat/registry.ts
class HandlerRegistry {
  byName = new Map;
  register(reg) {
    if (this.byName.has(reg.name)) {
      throw new Error(`risu-compat: duplicate handler registration for "${reg.name}". ` + `Each macro may be registered by exactly one module.`);
    }
    this.byName.set(reg.name, reg);
  }
  get(name) {
    return this.byName.get(name) ?? null;
  }
  entries() {
    return Array.from(this.byName.values());
  }
  size() {
    return this.byName.size;
  }
}
var registry;
var init_registry = __esm(() => {
  registry = new HandlerRegistry;
});

// src/risu-compat/handlers/trigger-id.ts
var triggerIdHandler = (ctx) => {
  return ctx.triggerId ?? "null";
};
var init_trigger_id = __esm(() => {
  init_registry();
  registry.register({
    name: "trigger_id",
    handler: triggerIdHandler,
    description: 'Returns the ID from the risu-id attribute of the last clicked trigger element, or the literal string "null".',
    category: "Risu / Identity",
    scoped: false
  });
});

// src/util/role-coerce.ts
function lumiRoleToRisu(r) {
  return r === "user" ? "user" : "char";
}
function normalizeRoleToLumi(r) {
  if (r === "user" || r === "assistant" || r === "system")
    return r;
  if (r === "char" || r === "bot")
    return "assistant";
  if (r === "sys")
    return "system";
  return null;
}

// src/risu-compat/handlers/context-reads.ts
function register(name, handler, description) {
  registry.register({
    name,
    handler,
    description,
    category: "Risu / Context",
    scoped: false
  });
}
function recurse(ctx, field) {
  return ctx.evaluate ? ctx.evaluate(field) : field;
}
function formatDuration(ms) {
  let seconds = Math.floor(ms / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);
  seconds = seconds % 60;
  minutes = minutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
function makeArray(arr) {
  return JSON.stringify(arr.map((v) => {
    if (typeof v === "string")
      return v.replaceAll("::", "\\u003A\\u003A");
    return v;
  }));
}
var init_context_reads = __esm(() => {
  init_registry();
  register("description", (ctx) => recurse(ctx, ctx.character.description), "Returns the character description, recursively parsed.");
  register("personality", (ctx) => recurse(ctx, ctx.character.personality), "Returns the character personality field, recursively parsed.");
  register("scenario", (ctx) => recurse(ctx, ctx.character.scenario), "Returns the character scenario field, recursively parsed.");
  register("persona", (ctx) => recurse(ctx, ctx.identity.personaText), "Returns the user persona prompt, recursively parsed.");
  register("exampledialogue", (ctx) => recurse(ctx, ctx.character.exampleDialogue), "Returns the character's example dialogue field, recursively parsed.");
  register("mainprompt", (ctx) => recurse(ctx, ctx.character.mainPrompt), "Returns the system/main prompt configured for the current character, recursively parsed.");
  register("jb", (ctx) => recurse(ctx, ctx.character.jailbreakPrompt), "Returns the jailbreak prompt text, recursively parsed.");
  register("globalnote", (ctx) => recurse(ctx, ctx.character.globalNote), "Returns the global note (system note / ujb), recursively parsed.");
  register("authornote", (ctx) => recurse(ctx, ctx.character.authorsNote), "Returns the author's note for the current chat, recursively parsed.");
  register("model", (ctx) => ctx.aiModel, "Returns the id of the currently selected AI model.");
  register("axmodel", (ctx) => ctx.axModel, "Returns the id of the auxiliary/secondary model.");
  register("role", (ctx) => {
    if (ctx.role !== null)
      return lumiRoleToRisu(ctx.role);
    if (ctx.cbsContext)
      return "null";
    if (ctx.promptRegexLiteralVars)
      return "null";
    if (ctx.isFirstMessage)
      return "char";
    return "null";
  }, "Returns the role of the current message ('user', 'char'/'assistant', 'system').");
  register("isfirstmsg", (ctx) => {
    if (ctx.cbsContext)
      return "0";
    if (ctx.promptRegexLiteralVars)
      return "0";
    if (ctx.currentMessageIndex !== null && ctx.currentMessageIndex !== undefined) {
      return ctx.currentMessageIndex === -1 ? "1" : "0";
    }
    return ctx.isFirstMessage ? "1" : "0";
  }, "Returns '1' if the current context is the first (greeting) message, '0' otherwise.");
  register("unixtime", (ctx) => Math.floor(ctx.clock.now() / 1000).toString(), "Returns the current unix timestamp in seconds.");
  register("time", (ctx) => {
    const d = new Date(ctx.clock.now());
    return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
  }, "Returns the current local time in H:M:S format (unpadded, matching Risu).");
  register("isotime", (ctx) => {
    const d = new Date(ctx.clock.now());
    return `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}`;
  }, "Returns the current UTC time in H:M:S format.");
  register("isodate", (ctx) => {
    const d = new Date(ctx.clock.now());
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  }, "Returns the current UTC date in YYYY-M-D format (month/day not zero-padded, matching Risu).");
  register("messagetime", (ctx) => {
    if (ctx.currentMessageIndex === null)
      return "[Cannot get time]";
    const msgs = ctx.messages.all();
    const msg = msgs[ctx.currentMessageIndex];
    if (!msg)
      return "[Cannot get time]";
    if (!msg.createdAt)
      return "[Cannot get time, message was sent in older version]";
    return new Date(msg.createdAt).toLocaleTimeString();
  }, "Returns the local time the current message was sent.");
  register("messagedate", (ctx) => {
    if (ctx.currentMessageIndex === null)
      return "[Cannot get time]";
    const msgs = ctx.messages.all();
    const msg = msgs[ctx.currentMessageIndex];
    if (!msg)
      return "[Cannot get time]";
    if (!msg.createdAt)
      return "[Cannot get time, message was sent in older version]";
    return new Date(msg.createdAt).toLocaleDateString();
  }, "Returns the local date the current message was sent.");
  register("messageunixtimearray", (ctx) => {
    const arr = ctx.messages.all().map((m) => String(m.createdAt ?? 0));
    return makeArray(arr);
  }, "Returns a JSON-encoded array of all message unix timestamps (milliseconds).");
  register("idleduration", (ctx) => {
    const msgs = ctx.messages.all();
    if (msgs.length === 0)
      return "00:00:00";
    const last = msgs[msgs.length - 1];
    if (!last.createdAt)
      return "[Cannot get time, message was sent in older version]";
    return formatDuration(ctx.clock.now() - last.createdAt);
  }, "Returns HH:MM:SS since the most recent message.");
  register("messageidleduration", (ctx) => {
    if (ctx.currentMessageIndex === null)
      return "[Cannot get time]";
    const msgs = ctx.messages.all();
    let pointer = ctx.currentMessageIndex;
    let message;
    let previous;
    let stage = "findLast";
    while (pointer >= 0) {
      const m = msgs[pointer];
      if (m && m.role === "user") {
        if (stage === "findLast") {
          message = m;
          stage = "findSecondLast";
        } else {
          previous = m;
          break;
        }
      }
      pointer--;
    }
    if (!message)
      return "[No user message found]";
    if (!previous)
      return "[No previous user message found]";
    if (!message.createdAt)
      return "[Cannot get time, message was sent in older version]";
    if (!previous.createdAt)
      return "[Cannot get time, previous message was sent in older version]";
    return formatDuration(message.createdAt - previous.createdAt);
  }, "Returns HH:MM:SS between the current and the previous user message.");
  register("br", () => `
`, "Returns a literal newline character.");
  register("blank", () => "", "Returns an empty string.");
});

// src/risu-compat/risu-helpers.ts
function parseArray2(s) {
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr))
      return arr;
  } catch {}
  return s.split("\xA7");
}
function parseDict(s) {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v))
      return v;
  } catch {}
  return {};
}
function makeArray2(arr) {
  return JSON.stringify(arr.map((v) => {
    if (typeof v === "string")
      return v.replaceAll("::", "\\u003A\\u003A");
    return v;
  }));
}
function sfc32(a, b, c, d) {
  return function() {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
function pickHashRand(cid, word) {
  let hashAddress = 5515;
  const rand = (w) => {
    for (let counter = 0;counter < w.length; counter++) {
      hashAddress = (hashAddress << 5) + hashAddress + w.charCodeAt(counter);
    }
    return hashAddress;
  };
  const randF = sfc32(rand(word), rand(word), rand(word), rand(word));
  const v = cid % 1000;
  for (let i = 0;i < v; i++)
    randF();
  return randF();
}
function dateTimeFormat(main, time = 0) {
  const date = time === 0 ? new Date : new Date(time);
  if (!main)
    return "";
  if (main.startsWith(":"))
    main = main.substring(1);
  if (main.length > 300)
    return "";
  return main.replace(/YYYY/g, date.getFullYear().toString()).replace(/YY/g, date.getFullYear().toString().substring(2)).replace(/MMMM/g, new Intl.DateTimeFormat("en", { month: "long" }).format(date)).replace(/MMM/g, new Intl.DateTimeFormat("en", { month: "short" }).format(date)).replace(/MM/g, (date.getMonth() + 1).toString().padStart(2, "0")).replace(/DDDD/g, Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)).toString()).replace(/DD/g, date.getDate().toString().padStart(2, "0")).replace(/dddd/g, new Intl.DateTimeFormat("en", { weekday: "long" }).format(date)).replace(/ddd/g, new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)).replace(/HH/g, date.getHours().toString().padStart(2, "0")).replace(/hh/g, (date.getHours() % 12 || 12).toString().padStart(2, "0")).replace(/mm/g, date.getMinutes().toString().padStart(2, "0")).replace(/ss/g, date.getSeconds().toString().padStart(2, "0")).replace(/X/g, Math.floor(date.getTime() / 1000).toString()).replace(/x/g, date.getTime().toString()).replace(/A/g, date.getHours() >= 12 ? "PM" : "AM");
}
function calcString(text, readLocal, readGlobal) {
  const depthText = [""];
  for (let i = 0;i < text.length; i++) {
    if (text[i] === "(") {
      depthText.push("");
    } else if (text[i] === ")" && depthText.length > 1) {
      const inner = depthText.pop();
      const result = executeRPN(inner, readLocal, readGlobal);
      depthText[depthText.length - 1] += result;
    } else {
      depthText[depthText.length - 1] += text[i];
    }
  }
  return executeRPN(depthText.join(""), readLocal, readGlobal);
}
function executeRPN(text, readLocal, readGlobal) {
  const substituted = text.replace(/\$([a-zA-Z0-9_]+)/g, (_, p1) => {
    const v = readLocal(p1);
    const parsed = parseFloat(v);
    return isNaN(parsed) ? "0" : parsed.toString();
  }).replace(/@([a-zA-Z0-9_]+)/g, (_, p1) => {
    const v = readGlobal(p1);
    const parsed = parseFloat(v);
    return isNaN(parsed) ? "0" : parsed.toString();
  }).replace(/&&/g, "&").replace(/\|\|/g, "|").replace(/<=/g, "\u2264").replace(/>=/g, "\u2265").replace(/==/g, "=").replace(/!=/g, "\u2260").replace(/null/gi, "0");
  const rpn = toRPN(substituted);
  return calculateRPN(rpn);
}
function toRPN(expression) {
  expression = expression.replace(/\s+/g, "");
  const expr2 = [];
  let lastToken = "";
  for (let i = 0;i < expression.length; i++) {
    const char = expression[i];
    if (char === "-" && (i === 0 || OPERATOR_CHARS.has(expression[i - 1]) || expression[i - 1] === "(")) {
      lastToken += char;
    } else if (OPERATOR_CHARS.has(char)) {
      expr2.push(lastToken !== "" ? lastToken : "0");
      lastToken = "";
      expr2.push(char);
    } else {
      lastToken += char;
    }
  }
  expr2.push(lastToken !== "" ? lastToken : "0");
  let outputQueue = "";
  const operatorStack = [];
  for (const token of expr2) {
    if (parseFloat(token) || token === "0") {
      outputQueue += token + " ";
    } else if (OPERATOR_CHARS.has(token)) {
      while (operatorStack.length > 0) {
        const top = operatorStack[operatorStack.length - 1];
        const op = OPERATORS[token];
        const topOp = OPERATORS[top];
        const drain = op.associativity === "Left" ? op.precedence <= topOp.precedence : op.precedence < topOp.precedence;
        if (!drain)
          break;
        outputQueue += operatorStack.pop() + " ";
      }
      operatorStack.push(token);
    }
  }
  while (operatorStack.length > 0)
    outputQueue += operatorStack.pop() + " ";
  return outputQueue.trim();
}
function calculateRPN(expression) {
  const stack = [];
  for (const token of expression.split(" ")) {
    if (parseFloat(token) || token === "0") {
      stack.push(parseFloat(token));
    } else {
      const b = stack.pop();
      const a = stack.pop();
      switch (token) {
        case "+":
          stack.push(a + b);
          break;
        case "-":
          stack.push(a - b);
          break;
        case "*":
          stack.push(a * b);
          break;
        case "/":
          stack.push(a / b);
          break;
        case "^":
          stack.push(a ** b);
          break;
        case "%":
          stack.push(a % b);
          break;
        case "<":
          stack.push(a < b ? 1 : 0);
          break;
        case ">":
          stack.push(a > b ? 1 : 0);
          break;
        case "|":
          stack.push(a || b);
          break;
        case "&":
          stack.push(a && b);
          break;
        case "\u2264":
          stack.push(a <= b ? 1 : 0);
          break;
        case "\u2265":
          stack.push(a >= b ? 1 : 0);
          break;
        case "=":
          stack.push(a === b ? 1 : 0);
          break;
        case "\u2260":
          stack.push(a !== b ? 1 : 0);
          break;
        case "!":
          stack.push(b ? 0 : 1);
          break;
      }
    }
  }
  return stack.length === 0 ? 0 : stack.pop();
}
var OPERATORS, OPERATOR_CHARS;
var init_risu_helpers = __esm(() => {
  OPERATORS = {
    "+": { precedence: 2, associativity: "Left" },
    "-": { precedence: 2, associativity: "Left" },
    "*": { precedence: 3, associativity: "Left" },
    "/": { precedence: 3, associativity: "Left" },
    "^": { precedence: 4, associativity: "Left" },
    "%": { precedence: 3, associativity: "Left" },
    "<": { precedence: 1, associativity: "Left" },
    ">": { precedence: 1, associativity: "Left" },
    "|": { precedence: 1, associativity: "Left" },
    "&": { precedence: 1, associativity: "Left" },
    "\u2264": { precedence: 1, associativity: "Left" },
    "\u2265": { precedence: 1, associativity: "Left" },
    "=": { precedence: 1, associativity: "Left" },
    "\u2260": { precedence: 1, associativity: "Left" },
    "!": { precedence: 5, associativity: "Right" }
  };
  OPERATOR_CHARS = new Set(Object.keys(OPERATORS));
});

// src/risu-compat/handlers/math.ts
function register2(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Math", scoped: false });
}
var aggSource = (args) => args.length > 1 ? args : parseArray2(args[0] ?? "").map((v) => String(v)), toNum = (s) => {
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};
var init_math = __esm(() => {
  init_registry();
  init_risu_helpers();
  register2("round", (_c, a) => Math.round(Number(a[0])).toString(), "Rounds to nearest integer (half-up).");
  register2("floor", (_c, a) => Math.floor(Number(a[0])).toString(), "Floors (rounds toward negative infinity).");
  register2("ceil", (_c, a) => Math.ceil(Number(a[0])).toString(), "Ceils (rounds toward positive infinity).");
  register2("abs", (_c, a) => Math.abs(Number(a[0])).toString(), "Absolute value.");
  register2("remaind", (_c, a) => (Number(a[0]) % Number(a[1])).toString(), "Returns (a % b) as string.");
  register2("pow", (_c, a) => Math.pow(Number(a[0]), Number(a[1])).toString(), "Returns a^b.");
  register2("min", (_c, a) => Math.min(...aggSource(a).map(toNum)).toString(), "Minimum of the given values (non-numeric treated as 0).");
  register2("max", (_c, a) => Math.max(...aggSource(a).map(toNum)).toString(), "Maximum of the given values.");
  register2("sum", (_c, a) => aggSource(a).map(toNum).reduce((x, y) => x + y, 0).toString(), "Sum of the given values.");
  register2("average", (_c, a) => {
    const src = aggSource(a);
    if (src.length === 0)
      return "NaN";
    return (src.map(toNum).reduce((x, y) => x + y, 0) / src.length).toString();
  }, "Arithmetic mean of the given values.");
  register2("tonumber", (_c, a) => {
    const s = a[0] ?? "";
    let out = "";
    for (const ch of s) {
      if (!isNaN(Number(ch)) || ch === ".")
        out += ch;
    }
    return out;
  }, "Extracts digits (and decimal points) from the input string.");
  register2("fixnum", (_c, a) => Number(a[0]).toFixed(Number(a[1])).toString(), "Rounds to N decimal places via toFixed.");
  register2("calc", (ctx, a) => {
    const expr = a[0] ?? "";
    const n = calcString(expr, (name) => ctx.vars.get("local", name), (name) => ctx.vars.get("global", name));
    return n.toString();
  }, "Evaluates a mathematical expression. Supports + - * / ^ % and comparison operators; $x reads local var, @x reads global var.");
});

// src/risu-compat/handlers/logic.ts
function register3(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Logic", scoped: false });
}
var bag = (a) => a.length > 1 ? a : parseArray2(a[0] ?? "").map((v) => String(v));
var init_logic = __esm(() => {
  init_registry();
  init_risu_helpers();
  register3("equal", (_c, a) => a[0] === a[1] ? "1" : "0", "Returns '1' if args[0] === args[1] (string compare), else '0'.");
  register3("notequal", (_c, a) => a[0] !== a[1] ? "1" : "0", "Returns '1' if args[0] !== args[1], else '0'.");
  register3("greater", (_c, a) => Number(a[0]) > Number(a[1]) ? "1" : "0", "Returns '1' if Number(args[0]) > Number(args[1]).");
  register3("less", (_c, a) => Number(a[0]) < Number(a[1]) ? "1" : "0", "Returns '1' if Number(args[0]) < Number(args[1]).");
  register3("greaterequal", (_c, a) => Number(a[0]) >= Number(a[1]) ? "1" : "0", "Returns '1' if Number(args[0]) >= Number(args[1]).");
  register3("lessequal", (_c, a) => Number(a[0]) <= Number(a[1]) ? "1" : "0", "Returns '1' if Number(args[0]) <= Number(args[1]).");
  register3("and", (_c, a) => a[0] === "1" && a[1] === "1" ? "1" : "0", "Boolean AND: returns '1' if both args are the literal string '1'.");
  register3("or", (_c, a) => a[0] === "1" || a[1] === "1" ? "1" : "0", "Boolean OR: returns '1' if either arg is '1'.");
  register3("not", (_c, a) => a[0] === "1" ? "0" : "1", "Boolean NOT of a '1'/'0' value.");
  register3("all", (_c, a) => bag(a).every((f) => f === "1") ? "1" : "0", "Returns '1' if every value is the literal string '1'.");
  register3("any", (_c, a) => bag(a).some((f) => f === "1") ? "1" : "0", "Returns '1' if any value is '1'.");
  register3("startswith", (_c, a) => (a[0] ?? "").startsWith(a[1] ?? "") ? "1" : "0", "Returns '1' if args[0] starts with args[1].");
  register3("endswith", (_c, a) => (a[0] ?? "").endsWith(a[1] ?? "") ? "1" : "0", "Returns '1' if args[0] ends with args[1].");
  register3("contains", (_c, a) => (a[0] ?? "").includes(a[1] ?? "") ? "1" : "0", "Returns '1' if args[0] contains args[1] anywhere.");
  register3("iserror", (_c, a) => (a[0] ?? "").toLocaleLowerCase().startsWith("error:") ? "1" : "0", "Returns '1' if the argument begins with 'error:' (case-insensitive).");
});

// src/risu-compat/handlers/strings.ts
function register4(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Strings", scoped: false });
}
var init_strings = __esm(() => {
  init_registry();
  init_risu_helpers();
  register4("replace", (_c, a) => (a[0] ?? "").replaceAll(a[1] ?? "", a[2] ?? ""), "Replaces all occurrences of needle with replacement.");
  register4("split", (_c, a) => makeArray2((a[0] ?? "").split(a[1] ?? "")), "Splits a string on the delimiter and returns a JSON array.");
  register4("join", (_c, a) => parseArray2(a[0] ?? "").join(a[1] ?? ""), "Joins a JSON array using the given separator.");
  register4("spread", (_c, a) => parseArray2(a[0] ?? "").join("::"), "Joins a JSON array using :: as the separator.");
  register4("trim", (_c, a) => (a[0] ?? "").trim(), "Strips leading/trailing whitespace.");
  register4("length", (_c, a) => (a[0] ?? "").length.toString(), "Returns the character length of a string.");
  register4("lower", (_c, a) => (a[0] ?? "").toLocaleLowerCase(), "Lowercases using locale-aware conversion.");
  register4("upper", (_c, a) => (a[0] ?? "").toLocaleUpperCase(), "Uppercases using locale-aware conversion.");
  register4("capitalize", (_c, a) => {
    const s = a[0] ?? "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, "Uppercases only the first character.");
  register4("reverse", (_c, a) => [...a[0] ?? ""].reverse().join(""), "Reverses a string (code-point safe via iterator).");
});

// src/risu-compat/handlers/arrays.ts
function register5(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Arrays", scoped: false });
}
var init_arrays = __esm(() => {
  init_registry();
  init_risu_helpers();
  register5("arraylength", (_c, a) => parseArray2(a[0] ?? "").length.toString(), "Returns the length of a JSON array.");
  register5("arrayshift", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    arr.shift();
    return makeArray2(arr);
  }, "Removes and discards the first element.");
  register5("arraypop", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    arr.pop();
    return makeArray2(arr);
  }, "Removes and discards the last element.");
  register5("arraypush", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    arr.push(a[1] ?? "");
    return makeArray2(arr);
  }, "Appends a new element.");
  register5("arraysplice", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    arr.splice(Number(a[1]), Number(a[2]), a[3] ?? "");
    return makeArray2(arr);
  }, "Risu-style splice: (array, start, deleteCount, newElement).");
  register5("arrayassert", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    const idx = Number(a[1]);
    if (idx >= arr.length)
      arr[idx] = a[2] ?? "";
    return makeArray2(arr);
  }, "Sets arr[idx] = value if idx is out of bounds; else leaves array unchanged.");
  register5("arrayelement", (_c, a) => {
    const el = parseArray2(a[0] ?? "").at(Number(a[1])) ?? "null";
    return typeof el === "object" ? JSON.stringify(el) : String(el);
  }, "Returns the element at index (JSON-stringifies if object). 'null' if OOB.");
  register5("dictelement", (_c, a) => {
    const el = parseDict(a[0] ?? "")[a[1] ?? ""] ?? "null";
    return typeof el === "object" ? JSON.stringify(el) : String(el);
  }, "Returns dict[key] or 'null'.");
  register5("objectassert", (_c, a) => {
    const d = parseDict(a[0] ?? "");
    if (!d[a[1] ?? ""])
      d[a[1] ?? ""] = a[2] ?? "";
    return JSON.stringify(d);
  }, "Sets obj[key] = value if missing or falsy; returns JSON.");
  register5("element", (_c, a) => {
    try {
      let current = a[0] ?? "";
      for (const step of a.slice(1)) {
        const parsed = JSON.parse(current);
        if (parsed === null || typeof parsed !== "object" && !Array.isArray(parsed))
          return "null";
        current = parsed[step];
        if (!current)
          return "null";
      }
      return String(current);
    } catch {
      return "null";
    }
  }, "Walks a JSON structure by successive keys/indices. Returns 'null' if any step fails.");
  register5("makearray", (_c, a) => makeArray2(a), "Creates a JSON array from the given arguments.");
  register5("makedict", (_c, a) => {
    const d = {};
    for (let i = 0;i + 1 < a.length; i += 2) {
      d[a[i] ?? ""] = a[i + 1] ?? "";
    }
    return JSON.stringify(d);
  }, "Creates a JSON object from interleaved key-value arguments.");
  register5("range", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    const start = arr.length > 1 ? Number(arr[0]) : 0;
    const end = arr.length > 1 ? Number(arr[1]) : Number(arr[0]);
    const step = arr.length > 2 ? Number(arr[2]) : 1;
    const out = [];
    if (step !== 0) {
      for (let i = start;i < end; i += step)
        out.push(i.toString());
    }
    return makeArray2(out);
  }, "Creates a range. [n] \u2192 [0,1,\u2026,n-1]. [a,b] \u2192 [a,\u2026,b-1]. [a,b,s] \u2192 step s.");
  register5("filter", (_c, a) => {
    const arr = parseArray2(a[0] ?? "");
    const mode = ["all", "nonempty", "unique"].indexOf(a[1] ?? "all");
    const filterType = mode === -1 ? 0 : mode;
    return makeArray2(arr.filter((f, i) => {
      switch (filterType) {
        case 0:
          return f !== "" && i === arr.indexOf(f);
        case 1:
          return f !== "";
        case 2:
          return i === arr.indexOf(f);
        default:
          return true;
      }
    }));
  }, "Filters an array. mode='all' (unique + nonempty), 'nonempty', or 'unique'.");
});

// src/risu-compat/handlers/random.ts
function register6(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Random", scoped: false });
}
function randomPickImpl(args, rand) {
  if (args.length === 0)
    return rand.toString();
  let arr;
  if (args.length === 1) {
    const s = args[0] ?? "";
    if (s.startsWith("[") && s.endsWith("]")) {
      arr = parseArray2(s);
    } else {
      arr = s.replace(/\\,/g, "\xA7X").split(/:|,/);
    }
  } else {
    arr = [...args];
  }
  const idx = Math.floor(rand * arr.length);
  const el = arr[idx];
  return typeof el === "string" ? el.replace(/\u00A7X/g, ",") : JSON.stringify(el) ?? "";
}
var init_random = __esm(() => {
  init_registry();
  init_risu_helpers();
  register6("random", (ctx, a) => randomPickImpl(a, ctx.rng.random()), "Random element picker. No args \u2192 returns a random [0,1) number. One arg \u2192 picks from a JSON array or a comma/colon-delimited string. Multiple args \u2192 random one.");
  register6("pick", (ctx, a) => {
    const rand = pickHashRand(ctx.messages.count(), ctx.character.chaId + ctx.chatId);
    return randomPickImpl(a, rand);
  }, "Hash-deterministic pick. Same inputs at the same chat position return the same element.");
  register6("roll", (ctx, a) => {
    if (a.length === 0)
      return "1";
    const notation = (a[0] ?? "").split("d");
    let num = 1;
    let sides = 6;
    if (notation.length === 2) {
      num = Number(notation[0] || 1);
      sides = Number(notation[1] || 6);
    } else if (notation.length === 1) {
      sides = Number(notation[0]);
    }
    if (isNaN(num) || isNaN(sides) || num < 1 || sides < 1)
      return "NaN";
    let total = 0;
    for (let i = 0;i < num; i++)
      total += Math.floor(ctx.rng.random() * sides) + 1;
    return total.toString();
  }, "Dice roll. XdY syntax (default 1d6). Sum of N uniform rolls.");
  register6("rollp", (ctx, a) => {
    if (a.length === 0)
      return "1";
    const notation = (a[0] ?? "").split("d");
    let num = 1;
    let sides = 6;
    if (notation.length === 2) {
      num = Number(notation[0] || 1);
      sides = Number(notation[1] || 6);
    } else if (notation.length === 1) {
      sides = Number(notation[0]);
    }
    if (isNaN(num) || isNaN(sides) || num < 1 || sides < 1)
      return "NaN";
    let total = 0;
    for (let i = 0;i < num; i++) {
      const cid = ctx.messages.count() + i * 15;
      total += Math.floor(pickHashRand(cid, ctx.character.chaId + ctx.chatId) * sides) + 1;
    }
    return total.toString();
  }, "Hash-deterministic dice roll. Same chat position returns the same outcome.");
  register6("dice", (ctx, a) => {
    const notation = (a[0] ?? "").split("d");
    const num = Number(notation[0]);
    const sides = Number(notation[1]);
    if (isNaN(num) || isNaN(sides))
      return "NaN";
    let total = 0;
    for (let i = 0;i < num; i++)
      total += Math.floor(ctx.rng.random() * sides) + 1;
    return total.toString();
  }, "Dice roll via NdS notation. No defaults \u2014 both numbers required.");
  register6("randint", (ctx, a) => {
    const min = Number(a[0]);
    const max = Number(a[1]);
    if (isNaN(min) || isNaN(max))
      return "NaN";
    return (Math.floor(ctx.rng.random() * (max - min + 1)) + min).toString();
  }, "Uniform random integer in [min, max] (inclusive).");
  register6("hash", (_c, a) => {
    const v = pickHashRand(0, a[0] ?? "");
    return (v * 1e7 + 1).toFixed(0).padStart(7, "0");
  }, "Returns a deterministic 7-digit hash of the input string.");
});

// src/risu-compat/handlers/variables.ts
function register7(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Variables", scoped: false });
}
function setvarMode(ctx) {
  if (ctx.rmVar)
    return "hide";
  if (ctx.runVar)
    return "run";
  return "literal";
}
function leaveVarLiteral(ctx) {
  return !ctx.commit || ctx.promptRegexLiteralVars === true;
}
var init_variables = __esm(() => {
  init_registry();
  register7("getvar", (ctx, a) => ctx.vars.get("local", a[0] ?? ""), "Reads a local chat variable. Empty string if unset.");
  register7("setvar", (ctx, a) => {
    const mode = setvarMode(ctx);
    if (mode === "hide")
      return "";
    if (mode === "literal")
      return `{{setvar::${a[0] ?? ""}::${a[1] ?? ""}}}`;
    ctx.vars.set("local", a[0] ?? "", a[1] ?? "");
    return "";
  }, "Sets a local chat variable.");
  register7("addvar", (ctx, a) => {
    const mode = setvarMode(ctx);
    if (mode === "hide")
      return "";
    if (mode === "literal")
      return `{{addvar::${a[0] ?? ""}::${a[1] ?? ""}}}`;
    ctx.vars.add("local", a[0] ?? "", Number(a[1]));
    return "";
  }, "Adds delta to a local chat variable (coerces current value to number).");
  register7("setdefaultvar", (ctx, a) => {
    const mode = setvarMode(ctx);
    if (mode === "hide")
      return "";
    if (mode === "literal")
      return `{{setdefaultvar::${a[0] ?? ""}::${a[1] ?? ""}}}`;
    const name = a[0] ?? "";
    const current = ctx.vars.get("local", name);
    if (!current || current === "null") {
      ctx.vars.set("local", name, a[1] ?? "");
    }
    return "";
  }, "Sets a local chat variable only if its current value is the empty string (Risu falsy check).");
  register7("getglobalvar", (ctx, a) => ctx.vars.get("global", a[0] ?? ""), "Reads a global chat variable.");
  register7("tempvar", (ctx, a) => ctx.vars.get("temp", a[0] ?? ""), "Reads a temporary variable (per-evaluation scope).");
  register7("settempvar", (ctx, a) => {
    ctx.vars.set("temp", a[0] ?? "", a[1] ?? "");
    return "";
  }, "Sets a temporary variable.");
  register7("deletevar", (ctx, a) => {
    if (leaveVarLiteral(ctx))
      return `{{deletevar::${a[0] ?? ""}}}`;
    ctx.vars.delete("local", a[0] ?? "");
    return "";
  }, "Deletes a local chat variable.");
  register7("flushvar", (ctx, a) => {
    if (leaveVarLiteral(ctx))
      return `{{flushvar::${a[0] ?? ""}}}`;
    ctx.vars.delete("local", a[0] ?? "");
    return "";
  }, "Alias of deletevar.");
  register7("getchatvar", (ctx, a) => ctx.vars.get("local", a[0] ?? ""), "Reads a chat-scoped variable (aliased to local in Risu).");
  register7("setchatvar", (ctx, a) => {
    if (leaveVarLiteral(ctx))
      return `{{setchatvar::${a[0] ?? ""}::${a[1] ?? ""}}}`;
    ctx.vars.set("local", a[0] ?? "", a[1] ?? "");
    return "";
  }, "Sets a chat-scoped variable.");
  register7("return", (ctx, a) => {
    ctx.vars.set("temp", "__force_return__", "1");
    ctx.vars.set("temp", "__return__", a[0] ?? "");
    return "";
  }, "Halts further macro resolution, returns the given value as the entire parser output (Risu parity).");
});

// src/util/base64.ts
function base64ToBytes(input) {
  const sextets = [];
  for (let i = 0;i < input.length; i++) {
    const v = DECODE[input.charCodeAt(i)] ?? -1;
    if (v >= 0)
      sextets.push(v);
  }
  const out = new Uint8Array(sextets.length * 6 >> 3);
  let bitBuf = 0;
  let bitCount = 0;
  let o = 0;
  for (const s of sextets) {
    bitBuf = bitBuf << 6 | s;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      out[o++] = bitBuf >> bitCount & 255;
    }
  }
  return out;
}
function base64ToUtf8(input) {
  return new TextDecoder().decode(base64ToBytes(input));
}
function bytesToBase64(bytes) {
  let out = "";
  let i = 0;
  for (;i + 2 < bytes.length; i += 3) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    out += B64_ALPHABET[n >> 18 & 63] + B64_ALPHABET[n >> 12 & 63] + B64_ALPHABET[n >> 6 & 63] + B64_ALPHABET[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[n >> 18 & 63] + B64_ALPHABET[n >> 12 & 63] + "==";
  } else if (rem === 2) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8;
    out += B64_ALPHABET[n >> 18 & 63] + B64_ALPHABET[n >> 12 & 63] + B64_ALPHABET[n >> 6 & 63] + "=";
  }
  return out;
}
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", DECODE;
var init_base64 = __esm(() => {
  DECODE = new Int16Array(256).fill(-1);
  for (let i = 0;i < B64_ALPHABET.length; i++) {
    DECODE[B64_ALPHABET.charCodeAt(i)] = i;
  }
  DECODE[45] = 62;
  DECODE[95] = 63;
});

// src/risu-compat/handlers/misc.ts
function register8(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Misc", scoped: false });
}
function escapeButtonLabel(s) {
  return s.replace(BARE_AMP_RE, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var BARE_AMP_RE;
var init_misc = __esm(() => {
  init_registry();
  init_risu_helpers();
  init_base64();
  register8("u", (_c, a) => String.fromCharCode(parseInt(a[0] ?? "0", 16)), "Returns the character for a hex codepoint.");
  register8("ue", (_c, a) => String.fromCharCode(parseInt(a[0] ?? "0", 16)), "Alias for {{u}}.");
  register8("unicodeencode", (_c, a) => (a[0] ?? "").charCodeAt(a[1] ? Number(a[1]) : 0).toString(), "Returns the Unicode code point of a character at the given index (default 0).");
  register8("unicodedecode", (_c, a) => String.fromCharCode(Number(a[0] ?? "0")), "Converts a Unicode code point back to a character.");
  register8("fromhex", (_c, a) => Number.parseInt(a[0] ?? "0", 16).toString(), "Converts a hex string to decimal.");
  register8("tohex", (_c, a) => Number.parseInt(a[0] ?? "0").toString(16), "Converts a decimal number to hex.");
  register8("xor", (_c, a) => {
    const bytes = new TextEncoder().encode(a[0] ?? "");
    for (let i = 0;i < bytes.length; i++)
      bytes[i] ^= 255;
    return bytesToBase64(bytes);
  }, "XOR-encrypts a string with 0xFF and base64-encodes.");
  register8("xordecrypt", (_c, a) => {
    const bytes = base64ToBytes(a[0] ?? "");
    for (let i = 0;i < bytes.length; i++)
      bytes[i] ^= 255;
    return new TextDecoder().decode(bytes);
  }, "Decrypts an XOR-encrypted base64 string.");
  register8("crypt", (_c, a) => {
    let shift = a[1] ? Number(a[1]) : 32768;
    if (isNaN(shift))
      shift = 32768;
    const input = a[0] ?? "";
    let result = "";
    for (let i = 0;i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code > 65535) {
        result += input[i];
        continue;
      }
      let shifted = code + shift;
      if (shifted > 65535)
        shifted -= 65536;
      result += String.fromCharCode(shifted);
    }
    return result;
  }, "Caesar-style Unicode shift cipher (default shift 32768 which self-inverts).");
  register8("date", (ctx, a) => {
    if (a.length === 0) {
      const d = new Date(ctx.clock.now());
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
    const t = a[1] ? Number(a[1]) : 0;
    return dateTimeFormat(a[0] ?? "", isNaN(t) ? 0 : t);
  }, "Formats a date. No args \u2192 YYYY-M-D. First arg is format, optional second arg is unix ms.");
  register8("datetimeformat", (ctx, a) => {
    if (a.length === 0) {
      const d = new Date(ctx.clock.now());
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
    const t = a[1] ? Number(a[1]) : 0;
    return dateTimeFormat(a[0] ?? "", isNaN(t) ? 0 : t);
  }, "Alias of {{date::fmt}}.");
  register8("hiddenkey", () => "", "A key that activates lorebook entries without being sent to the model.");
  register8("comment", (ctx, a) => {
    if (ctx.commit || ctx.cbsContext)
      return "";
    return `<div class="risu-comment x-risu-risu-comment">${a[0] ?? ""}</div>`;
  }, 'Comment macro. Empty at prompt time and in cbs; displays as <div class="risu-comment">\u2026</div> at render time.');
  registry.register({
    name: "//",
    handler: () => "",
    description: "Inline comment. Returns empty string.",
    category: "Risu / Misc",
    scoped: false
  });
  register8("tex", (_c, a) => `$$${a[0] ?? ""}$$`, "LaTeX/math block.");
  register8("ruby", (_c, a) => `<ruby>${a[0] ?? ""}<rp> (</rp><rt>${a[1] ?? ""}</rt><rp>) </rp></ruby>`, "Ruby (furigana) HTML wrapper.");
  register8("codeblock", (_c, a) => {
    const code = (a[a.length - 1] ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (a.length > 1)
      return `<pre-hljs-placeholder lang="${a[0]}">${code}</pre-hljs-placeholder>`;
    return `<pre><code>${code}</code></pre>`;
  }, "Code-block HTML wrapper. One arg \u2192 plain. Two args \u2192 highlighted, first is lang.");
  register8("risu", (_c, a) => {
    const size = a[0] || "45";
    return `<img src="/logo2.png" style="height:${size}px;width:${size}px" />`;
  }, "Embeds the RisuAI logo image.");
  BARE_AMP_RE = /&(?!#x[0-9a-fA-F]+;|#[0-9]+;|[a-zA-Z][a-zA-Z0-9]*;)/g;
  register8("button", (_c, a) => {
    const label = escapeButtonLabel(a[0] ?? "");
    const trigger = (a[1] ?? "").replace(/"/g, "&quot;");
    return `<button class="button-default x-risu-button-default" risu-trigger="${trigger}">${label}</button>`;
  }, "HTML button that fires the named risu-trigger when clicked.");
  register8("screenwidth", (ctx) => String(ctx.screenWidth ?? 0), "Viewport width in pixels. Read from the frontend-reported value; 0 before the first report.");
  register8("screenheight", (ctx) => String(ctx.screenHeight ?? 0), "Viewport height in pixels. Read from the frontend-reported value; 0 before the first report.");
  register8("moduleenabled", (ctx, a) => {
    const ns = a[0] ?? "";
    if (ns.length === 0)
      return "0";
    const map = ctx.modulesByNamespace;
    if (map && map[ns])
      return "1";
    return "0";
  }, "Returns 1 if a module with the specified namespace is attached, 0 otherwise.");
  register8("moduleassetlist", (ctx, a) => {
    const ns = a[0] ?? "";
    if (ns.length === 0)
      return "";
    const map = ctx.modulesByNamespace;
    if (!map)
      return "";
    const list = map[ns];
    if (!list || list.length === 0)
      return "";
    return makeArray2(list);
  }, "Returns a JSON array of asset names for the specified module namespace. Returns empty string if namespace not found.");
  register8("metadata", (ctx, a) => {
    const key = (a[0] ?? "").toLocaleLowerCase();
    switch (key) {
      case "imateapot":
        return "\uD83E\uDED6";
      case "mobile":
      case "local":
      case "node":
        return "0";
      case "risutype":
        return "web";
      case "modelname":
      case "modelshortname":
      case "modelinternalid":
        return ctx.aiModel || "";
      case "version":
        return ctx.appVersion;
      case "majorversion":
      case "majorver":
      case "major":
        return ctx.appVersion.split(".")[0] ?? "";
      case "maxcontext":
        return ctx.maxContext.toString();
      case "language":
      case "locale":
      case "lang":
      case "browserlanguage":
      case "browserlocale":
      case "browserlang":
        return ctx.language;
      default:
        return `Error: ${a[0]} is not a valid metadata key.`;
    }
  }, "Returns host metadata. Subset implemented \u2014 model fields read from ctx.aiModel; platform fields default to non-native; language and browserlanguage collapse to one value.");
  register8("chatindex", (ctx) => {
    const idx = ctx.currentMessageIndex;
    return idx === null ? "" : idx.toString();
  }, "Index of the current message being processed. Risu cbs() default returns -1.");
  register8("firstmsgindex", (ctx) => {
    const idx = ctx.character.selectedAlternateGreetingIndex;
    return String(typeof idx === "number" ? idx : -1);
  }, "Returns chat.fmIndex (selected alternate greeting index). -1 = default firstMessage.");
});

// src/risu-compat/handlers/chat-context.ts
function register9(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Chat", scoped: false });
}
function selectedGreeting(ctx) {
  const character = ctx.character;
  if (character.selectedGreeting !== undefined)
    return character.selectedGreeting;
  return character.selectedAlternateGreetingIndex === -1 ? character.firstMessage : character.alternateGreetings[character.selectedAlternateGreetingIndex] ?? character.firstMessage;
}
function risuRole(r) {
  return r === "assistant" ? "char" : r;
}
function toSerializableMsg(m) {
  const out = {
    role: risuRole(m.role),
    data: m.content,
    time: m.createdAt
  };
  if (m.speaker)
    out.speaker = m.speaker;
  return out;
}
function evalMsg(ctx, m) {
  const data = ctx.evaluate ? ctx.evaluate(m.content) : m.content;
  const out = {
    role: risuRole(m.role),
    data,
    time: m.createdAt
  };
  if (m.speaker)
    out.speaker = m.speaker;
  return out;
}
var init_chat_context = __esm(() => {
  init_registry();
  init_risu_helpers();
  register9("lorebook", (ctx) => {
    return makeArray2(ctx.lorebook.map((e) => JSON.stringify(e)));
  }, "Returns all active lorebook entries as a JSON array (character + chat + module lore concatenated).");
  register9("userhistory", (ctx) => {
    const filtered = ctx.messages.all().filter((m) => m.role === "user").map((m) => JSON.stringify(evalMsg(ctx, m)));
    return makeArray2(filtered);
  }, "Returns all user messages as a JSON array, each .data recursively parsed.");
  register9("charhistory", (ctx) => {
    const filtered = ctx.messages.all().filter((m) => m.role === "assistant").map((m) => JSON.stringify(evalMsg(ctx, m)));
    return makeArray2(filtered);
  }, "Returns all character (assistant) messages as a JSON array, each .data recursively parsed.");
  register9("history", (ctx, a) => {
    const msgs = ctx.messages.all();
    if (a.length === 0) {
      const fm = selectedGreeting(ctx);
      const head = [{
        role: "char",
        data: ctx.evaluate ? ctx.evaluate(fm) : fm,
        time: 0
      }];
      return makeArray2([
        ...head,
        ...msgs.map((m) => ({
          ...toSerializableMsg(m),
          data: ctx.evaluate ? ctx.evaluate(m.content) : m.content
        }))
      ].map((v) => JSON.stringify(v)));
    }
    const withRole = a.includes("role");
    return makeArray2(msgs.map((m) => withRole ? `${risuRole(m.role)}: ${m.content}` : m.content));
  }, "No args \u2192 full JSON history with first-greeting at index 0. With 'role' arg \u2192 array of 'role: data' strings.");
  register9("previouschatlog", (ctx, a) => {
    const idx = Number(a[0]);
    const msgs = ctx.messages.all();
    return msgs[idx]?.content ?? "Out of range";
  }, "Returns message[N].content, or 'Out of range' if index invalid.");
  register9("previouscharchat", (ctx) => {
    const msgs = ctx.messages.all();
    const start = ctx.cbsContext ? msgs.length - 1 : ctx.currentMessageIndex !== null ? ctx.currentMessageIndex - 1 : msgs.length - 1;
    for (let i = start;i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === "assistant")
        return m.content;
    }
    return selectedGreeting(ctx);
  }, "Last character (assistant) message; cbs walks from chat-end, others from currentMessageIndex-1.");
  register9("previoususerchat", (ctx) => {
    if (ctx.cbsContext)
      return "";
    if (ctx.currentMessageIndex === null)
      return "";
    const msgs = ctx.messages.all();
    for (let i = ctx.currentMessageIndex - 1;i >= 0; i--) {
      const m = msgs[i];
      if (m && m.role === "user")
        return m.content;
    }
    return selectedGreeting(ctx);
  }, "Last user message; '' in cbs (chatID=-1 short-circuit), else walks back from currentMessageIndex-1.");
  register9("lastmessage", (ctx) => {
    const last = ctx.messages.last();
    return last?.content ?? "";
  }, "Content of the most recent message, regardless of role.");
  register9("lastmessageid", (ctx) => {
    const n = ctx.messages.count();
    return Math.max(-1, n - 1).toString();
  }, "Index of the last message in Risu's greeting-excluded frame. Returns -1 when no messages (matches Risu cbs.ts (n-1).toString()).");
  register9("lastusermessage", (ctx) => {
    const m = ctx.messages.lastOf("user");
    return m?.content ?? "";
  }, "Alias-style shortcut for the most recent user message. '' if none.");
  register9("lastcharmessage", (ctx) => {
    const m = ctx.messages.lastOf("assistant");
    return m?.content ?? "";
  }, "Alias-style shortcut for the most recent character (assistant) message.");
  register9("jbtoggled", (ctx) => ctx.jailbreakToggle ? "1" : "0", "Returns '1' when the global jailbreak toggle is on.");
  register9("maxcontext", (ctx) => ctx.maxContext.toString(), "Returns the configured max-context length as a string.");
  register9("messagecount", (ctx) => ctx.messages.count().toString(), "Returns the total number of messages in the chat.");
});

// src/risu-compat/handlers/display.ts
function register10(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Display", scoped: false });
}
var DOC_ONLY;
var init_display = __esm(() => {
  init_registry();
  register10("decbo", () => "\uE9B8", "Displays as { without being re-lexed by the parser (PUA sentinel).");
  register10("decbc", () => "\uE9B9", "Displays as } without being re-lexed.");
  register10("bo", () => "\uE9B8\uE9B8", "Displays as {{ without being re-lexed.");
  register10("bc", () => "\uE9B9\uE9B9", "Displays as }} without being re-lexed.");
  register10("displayescapedbracketopen", () => "\uE9BA", "Displays as ( (PUA sentinel).");
  register10("displayescapedbracketclose", () => "\uE9BB", "Displays as ).");
  register10("displayescapedanglebracketopen", () => "\uE9BC", "Displays as < (PUA sentinel).");
  register10("displayescapedanglebracketclose", () => "\uE9BD", "Displays as >.");
  register10("displayescapedcolon", () => "\uE9BE", "Displays as : without being parsed as a CBS separator.");
  register10("displayescapedsemicolon", () => "\uE9BF", "Displays as ;.");
  register10("cbr", (_c, a) => {
    if (a.length === 0)
      return "\\n";
    const n = Math.max(1, Number(a[0] ?? "1"));
    return "\\n".repeat(n);
  }, "Returns a literal '\\n'. With numeric arg, repeats that many times.");
  register10("position", (ctx, args, raw) => {
    if (ctx.cbsContext) {
      const source = raw || `position::${args.join("::")}`;
      return `{{${source}}}`;
    }
    const name = args[0];
    if (typeof name !== "string" || name.length === 0)
      return "";
    const map = ctx.positionPt;
    if (!map)
      return "";
    return map[name] ?? "";
  }, "Risu {{position::NAME}}: joined content of active entries with @@position pt_<NAME>.");
  DOC_ONLY = [
    ["slot", "{{slot::VAR}} inside a scoped block. Resolved by #each/#func/call handlers."]
  ];
  for (const [name, desc] of DOC_ONLY) {
    register10(name, () => "", desc);
  }
  register10("bkspc", () => "", "Removes the last word from the parser output buffer.");
  register10("erase", () => "", "Removes the last sentence from the parser output buffer.");
});

// src/risu-compat/handlers/metadata.ts
function register11(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Metadata", scoped: false });
}
var init_metadata = __esm(() => {
  init_registry();
  init_risu_helpers();
  init_base64();
  register11("declare", (ctx, a) => {
    ctx.vars.set("temp", `__declared_${a[0] ?? ""}__`, "1");
    return "";
  }, "Declares a marker; {{declared::NAME}} reads it. Backed by the temp-scope store.");
  register11("declared", (ctx, a) => {
    return ctx.vars.get("temp", `__declared_${a[0] ?? ""}__`) === "1" ? "1" : "0";
  }, "Reads a declaration marker set by {{declare::NAME}}.");
  register11("emotionlist", (ctx) => {
    return makeArray2(ctx.character.emotionImages.map((e) => e.name));
  }, "JSON array of emotion image names for the current character.");
  register11("assetlist", (ctx) => {
    if (ctx.character.type === "group")
      return "";
    return makeArray2(ctx.character.additionalAssets.map((a) => a.name));
  }, "JSON array of additional asset names. '' for group characters.");
  register11("prefillsupported", (ctx) => {
    return ctx.aiModel.startsWith("claude") ? "1" : "0";
  }, "'1' if the current AI model id starts with 'claude' (Claude supports prefill).");
  register11("file", (ctx, a) => {
    const decode = ctx.cbsContext || ctx.commit;
    if (!decode)
      return `<br><div class="x-risu-risu-file">${a[0] ?? ""}</div><br>`;
    const content = a[1] ?? "";
    try {
      return base64ToUtf8(content);
    } catch {
      return "";
    }
  }, 'Decodes base64 file content to UTF-8 (prompt and cbs paths); renders <div class="risu-file">\u2026</div> in display path.');
  register11("chardisplayasset", (ctx) => {
    if (!ctx.character.prebuiltAssetCommand)
      return makeArray2([]);
    const excludes = ctx.character.prebuiltAssetExclude;
    const list = ctx.character.additionalAssets.filter((a) => !excludes.includes(a.src)).map((a) => a.name);
    return makeArray2(list);
  }, "JSON array of character display assets, minus the excluded set. Empty array if prebuiltAssetCommand is off.");
});

// src/risu-compat/handlers/assets.ts
function register12(name, handler, description) {
  registry.register({ name, handler, description, category: "Risu / Assets", scoped: false });
}
function trimAssetKey(s) {
  let out = s;
  for (const e of TRIMMER_EXTS) {
    if (out.endsWith("." + e)) {
      out = out.substring(0, out.length - e.length - 1);
      break;
    }
  }
  return out.trim().replace(/[_ \-.]/g, "");
}
function getDistance(a, b) {
  const h = a.length + 1;
  const w = b.length + 1;
  const d = new Int16Array(h * w);
  for (let i = 0;i < h; i++)
    d[i * w] = i;
  for (let j = 0;j < w; j++)
    d[j] = j;
  for (let i = 1;i < h; i++) {
    for (let j = 1;j < w; j++) {
      d[i * w + j] = Math.min(d[(i - 1) * w + (j - 1)] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1), d[(i - 1) * w + j] + 1, d[i * w + (j - 1)] + 1);
    }
  }
  return d[h * w - 1];
}
function findAsset(ctx, list, name, legacyMediaFindings) {
  const norm = name.toLowerCase();
  let matches = null;
  for (const a of list) {
    if (a.name.toLowerCase() === norm) {
      if (matches === null)
        matches = [a];
      else
        matches.push(a);
    }
  }
  if (matches !== null) {
    if (matches.length === 1)
      return matches[0];
    const chatID = ctx.currentMessageIndex ?? -1;
    const seedWord = (ctx.character.chaId || "global") + String(chatID);
    const cx = pickHashRand(chatID, seedWord);
    const selIndex = Math.floor(cx * matches.length);
    return matches[selIndex] ?? matches[0];
  }
  if (legacyMediaFindings)
    return null;
  const trimmedName = trimAssetKey(norm);
  if (trimmedName.length === 0)
    return null;
  let closest = null;
  let closestDist = Number.MAX_SAFE_INTEGER;
  for (const a of list) {
    const key = trimAssetKey(a.name.toLowerCase());
    const dist = getDistance(trimmedName, key);
    if (dist < closestDist) {
      closest = a;
      closestDist = dist;
      if (dist === 0)
        break;
    }
  }
  if (closestDist > ASSET_MAX_DIFFERENCE)
    return null;
  return closest;
}
function imgTag(src) {
  return `<img src="${src}" alt="${src}" style="${ASSET_WIDTH_STYLE} "/>`;
}
function videoTag(src, opts) {
  const controls = opts.controls ? "controls " : "";
  const muted = opts.muted ? "muted " : "";
  return `<video ${controls}${muted}autoplay loop><source src="${src}" type="video/mp4"></video>
`;
}
function literal(name, args) {
  return `{{${name}${args.length > 0 ? "::" + args.join("::") : ""}}}`;
}
var ASSET_WIDTH_STYLE = "", VIDEO_EXTENSIONS, TRIMMER_EXTS, ASSET_MAX_DIFFERENCE = 4;
var init_assets = __esm(() => {
  init_registry();
  init_risu_helpers();
  VIDEO_EXTENSIONS = new Set(["mp4", "webm", "avi", "m4p", "m4v"]);
  TRIMMER_EXTS = [
    "webp",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "mp4",
    "webm",
    "avi",
    "m4p",
    "m4v",
    "mp3",
    "wav",
    "ogg"
  ];
  register12("path", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("path", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    return hit?.src ?? "";
  }, "Asset URL by name, plain string (for src=/url()). parser.svelte.ts.");
  register12("img", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("img", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return imgTag(hit.src);
  }, "Inline <img> for a named asset. parser.svelte.ts.");
  register12("image", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("image", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return `<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="${hit.src}" alt="${hit.src}" style="${ASSET_WIDTH_STYLE}"/></div>
`;
  }, "Inlay image wrapper. parser.svelte.ts.");
  register12("emotion", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("emotion", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.emotionImages, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return imgTag(hit.src);
  }, "Emotion image by name. parser.svelte.ts.");
  register12("asset", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("asset", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    if (hit.ext && VIDEO_EXTENSIONS.has(hit.ext.toLowerCase())) {
      return videoTag(hit.src, { controls: false, muted: true });
    }
    return `${imgTag(hit.src)}
`;
  }, "Asset by name \u2014 img or video depending on extension. parser.svelte.ts.");
  register12("bg", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("bg", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return `<div style="width:100%;height:100%;background: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.8)),url(${hit.src}); background-size: cover;"></div>`;
  }, "Background panel. parser.svelte.ts.");
  register12("video", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("video", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return videoTag(hit.src, { controls: true, muted: false });
  }, "Full-featured video. parser.svelte.ts.");
  register12("video-img", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("video-img", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return videoTag(hit.src, { controls: false, muted: true });
  }, "Muted autoplay video (image-substitute). parser.svelte.ts.");
  register12("audio", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("audio", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return `<audio controls autoplay loop><source src="${hit.src}" type="audio/mpeg"></audio>
`;
  }, "Audio player. parser.svelte.ts.");
  register12("bgm", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("bgm", args);
    const name = String(args[0] ?? "");
    if (!name)
      return "";
    const hit = findAsset(ctx, ctx.character.additionalAssets, name, ctx.legacyMediaFindings);
    if (!hit)
      return "";
    return `<div risu-ctrl="bgm___auto___${hit.src}" style="display:none;"></div>
`;
  }, "BGM control marker. parser.svelte.ts. Lumi has no engine to act on it.");
  register12("inlay", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("inlay", args);
    const id = String(args[0] ?? "");
    if (!id)
      return "";
    return `<img src="/api/v1/images/${id}"/>`;
  }, "Bare inlay image (no wrapper). Risu parser.svelte.ts.");
  register12("inlayed", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("inlayed", args);
    const id = String(args[0] ?? "");
    if (!id)
      return "";
    return `<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/${id}"/></div>

`;
  }, "Wrapped inlay image. Risu parser.svelte.ts + 688.");
  register12("inlayeddata", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("inlayeddata", args);
    const id = String(args[0] ?? "");
    if (!id)
      return "";
    return `<div class="risu-inlay-image x-risu-risu-inlay-image"><img src="/api/v1/images/${id}"/></div>

`;
  }, "Wrapped inlay image (data variant). Risu parser.svelte.ts + 688.");
  register12("source", (ctx, args) => {
    if (ctx.cbsContext)
      return literal("source", args);
    const kind = String(args[0] ?? "").toLowerCase();
    if (kind === "char")
      return ctx.character.image;
    if (kind === "user")
      return ctx.identity.personaImage;
    return "";
  }, "{{source::char}} / {{source::user}} avatar URLs. parser.svelte.ts. Empty string when no avatar uploaded.");
});

// src/risu-compat/handlers/index.ts
var init_handlers = __esm(() => {
  init_trigger_id();
  init_context_reads();
  init_math();
  init_logic();
  init_strings();
  init_arrays();
  init_random();
  init_variables();
  init_misc();
  init_chat_context();
  init_display();
  init_metadata();
  init_assets();
});
// src/core/cbs/parser.ts
function normalizeMacroName(raw) {
  let out = "";
  for (let i = 0;i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 32 || c === 95 || c === 45)
      continue;
    if (c >= 65 && c <= 90)
      out += String.fromCharCode(c + 32);
    else
      out += raw[i];
  }
  return out;
}
var OPAQUE_KINDS;
var init_parser = __esm(() => {
  OPAQUE_KINDS = new Set([
    "pure",
    "pure_display",
    "ignore",
    "escape",
    "each",
    "func",
    "code"
  ]);
});
// node_modules/zod/v3/helpers/util.js
var util, objectUtil, ZodParsedType, getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};
var init_util = __esm(() => {
  (function(util2) {
    util2.assertEqual = (_) => {};
    function assertIs(_arg) {}
    util2.assertIs = assertIs;
    function assertNever(_x) {
      throw new Error;
    }
    util2.assertNever = assertNever;
    util2.arrayToEnum = (items) => {
      const obj = {};
      for (const item of items) {
        obj[item] = item;
      }
      return obj;
    };
    util2.getValidEnumValues = (obj) => {
      const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
      const filtered = {};
      for (const k of validKeys) {
        filtered[k] = obj[k];
      }
      return util2.objectValues(filtered);
    };
    util2.objectValues = (obj) => {
      return util2.objectKeys(obj).map(function(e) {
        return obj[e];
      });
    };
    util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
      const keys = [];
      for (const key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) {
          keys.push(key);
        }
      }
      return keys;
    };
    util2.find = (arr, checker) => {
      for (const item of arr) {
        if (checker(item))
          return item;
      }
      return;
    };
    util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
    function joinValues(array, separator = " | ") {
      return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
    }
    util2.joinValues = joinValues;
    util2.jsonStringifyReplacer = (_, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    };
  })(util || (util = {}));
  (function(objectUtil2) {
    objectUtil2.mergeShapes = (first, second) => {
      return {
        ...first,
        ...second
      };
    };
  })(objectUtil || (objectUtil = {}));
  ZodParsedType = util.arrayToEnum([
    "string",
    "nan",
    "number",
    "integer",
    "float",
    "boolean",
    "date",
    "bigint",
    "symbol",
    "function",
    "undefined",
    "null",
    "array",
    "object",
    "unknown",
    "promise",
    "void",
    "never",
    "map",
    "set"
  ]);
});

// node_modules/zod/v3/ZodError.js
var ZodIssueCode, quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
}, ZodError;
var init_ZodError = __esm(() => {
  init_util();
  ZodIssueCode = util.arrayToEnum([
    "invalid_type",
    "invalid_literal",
    "custom",
    "invalid_union",
    "invalid_union_discriminator",
    "invalid_enum_value",
    "unrecognized_keys",
    "invalid_arguments",
    "invalid_return_type",
    "invalid_date",
    "invalid_string",
    "too_small",
    "too_big",
    "invalid_intersection_types",
    "not_multiple_of",
    "not_finite"
  ]);
  ZodError = class ZodError extends Error {
    get errors() {
      return this.issues;
    }
    constructor(issues) {
      super();
      this.issues = [];
      this.addIssue = (sub) => {
        this.issues = [...this.issues, sub];
      };
      this.addIssues = (subs = []) => {
        this.issues = [...this.issues, ...subs];
      };
      const actualProto = new.target.prototype;
      if (Object.setPrototypeOf) {
        Object.setPrototypeOf(this, actualProto);
      } else {
        this.__proto__ = actualProto;
      }
      this.name = "ZodError";
      this.issues = issues;
    }
    format(_mapper) {
      const mapper = _mapper || function(issue) {
        return issue.message;
      };
      const fieldErrors = { _errors: [] };
      const processError = (error) => {
        for (const issue of error.issues) {
          if (issue.code === "invalid_union") {
            issue.unionErrors.map(processError);
          } else if (issue.code === "invalid_return_type") {
            processError(issue.returnTypeError);
          } else if (issue.code === "invalid_arguments") {
            processError(issue.argumentsError);
          } else if (issue.path.length === 0) {
            fieldErrors._errors.push(mapper(issue));
          } else {
            let curr = fieldErrors;
            let i = 0;
            while (i < issue.path.length) {
              const el = issue.path[i];
              const terminal = i === issue.path.length - 1;
              if (!terminal) {
                curr[el] = curr[el] || { _errors: [] };
              } else {
                curr[el] = curr[el] || { _errors: [] };
                curr[el]._errors.push(mapper(issue));
              }
              curr = curr[el];
              i++;
            }
          }
        }
      };
      processError(this);
      return fieldErrors;
    }
    static assert(value) {
      if (!(value instanceof ZodError)) {
        throw new Error(`Not a ZodError: ${value}`);
      }
    }
    toString() {
      return this.message;
    }
    get message() {
      return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
    }
    get isEmpty() {
      return this.issues.length === 0;
    }
    flatten(mapper = (issue) => issue.message) {
      const fieldErrors = {};
      const formErrors = [];
      for (const sub of this.issues) {
        if (sub.path.length > 0) {
          const firstEl = sub.path[0];
          fieldErrors[firstEl] = fieldErrors[firstEl] || [];
          fieldErrors[firstEl].push(mapper(sub));
        } else {
          formErrors.push(mapper(sub));
        }
      }
      return { formErrors, fieldErrors };
    }
    get formErrors() {
      return this.flatten();
    }
  };
  ZodError.create = (issues) => {
    const error = new ZodError(issues);
    return error;
  };
});

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
}, en_default;
var init_en = __esm(() => {
  init_ZodError();
  init_util();
  en_default = errorMap;
});

// node_modules/zod/v3/errors.js
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var overrideErrorMap;
var init_errors = __esm(() => {
  init_en();
  overrideErrorMap = en_default;
});

// node_modules/zod/v3/helpers/parseUtil.js
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
}, EMPTY_PATH, INVALID, DIRTY = (value) => ({ status: "dirty", value }), OK = (value) => ({ status: "valid", value }), isAborted = (x) => x.status === "aborted", isDirty = (x) => x.status === "dirty", isValid = (x) => x.status === "valid", isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
var init_parseUtil = __esm(() => {
  init_errors();
  init_en();
  EMPTY_PATH = [];
  INVALID = Object.freeze({
    status: "aborted"
  });
});

// node_modules/zod/v3/helpers/typeAliases.js
var init_typeAliases = () => {};

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
var init_errorUtil = __esm(() => {
  (function(errorUtil2) {
    errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
    errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
  })(errorUtil || (errorUtil = {}));
});

// node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
}, cuidRegex, cuid2Regex, ulidRegex, uuidRegex, nanoidRegex, jwtRegex, durationRegex, emailRegex, _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`, emojiRegex, ipv4Regex, ipv4CidrRegex, ipv6Regex, ipv6CidrRegex, base64Regex, base64urlRegex, dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`, dateRegex, ZodString, ZodNumber, ZodBigInt, ZodBoolean, ZodDate, ZodSymbol, ZodUndefined, ZodNull, ZodAny, ZodUnknown, ZodNever, ZodVoid, ZodArray, ZodObject, ZodUnion, getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
}, ZodDiscriminatedUnion, ZodIntersection, ZodTuple, ZodRecord, ZodMap, ZodSet, ZodFunction, ZodLazy, ZodLiteral, ZodEnum, ZodNativeEnum, ZodPromise, ZodEffects, ZodOptional, ZodNullable, ZodDefault, ZodCatch, ZodNaN, BRAND, ZodBranded, ZodPipeline, ZodReadonly, late, ZodFirstPartyTypeKind, instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params), stringType, numberType, nanType, bigIntType, booleanType, dateType, symbolType, undefinedType, nullType, anyType, unknownType, neverType, voidType, arrayType, objectType, strictObjectType, unionType, discriminatedUnionType, intersectionType, tupleType, recordType, mapType, setType, functionType, lazyType, literalType, enumType, nativeEnumType, promiseType, effectsType, optionalType, nullableType, preprocessType, pipelineType, ostring = () => stringType().optional(), onumber = () => numberType().optional(), oboolean = () => booleanType().optional(), coerce, NEVER;
var init_types = __esm(() => {
  init_ZodError();
  init_errors();
  init_errorUtil();
  init_parseUtil();
  init_util();
  cuidRegex = /^c[^\s-]{8,}$/i;
  cuid2Regex = /^[0-9a-z]+$/;
  ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
  uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
  nanoidRegex = /^[a-z0-9_-]{21}$/i;
  jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
  durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
  emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
  ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
  ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
  ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
  base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
  base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
  dateRegex = new RegExp(`^${dateRegexSource}$`);
  ZodString = class ZodString extends ZodType {
    _parse(input) {
      if (this._def.coerce) {
        input.data = String(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.string) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.string,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      const status = new ParseStatus;
      let ctx = undefined;
      for (const check of this._def.checks) {
        if (check.kind === "min") {
          if (input.data.length < check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          if (input.data.length > check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "length") {
          const tooBig = input.data.length > check.value;
          const tooSmall = input.data.length < check.value;
          if (tooBig || tooSmall) {
            ctx = this._getOrReturnCtx(input, ctx);
            if (tooBig) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_big,
                maximum: check.value,
                type: "string",
                inclusive: true,
                exact: true,
                message: check.message
              });
            } else if (tooSmall) {
              addIssueToContext(ctx, {
                code: ZodIssueCode.too_small,
                minimum: check.value,
                type: "string",
                inclusive: true,
                exact: true,
                message: check.message
              });
            }
            status.dirty();
          }
        } else if (check.kind === "email") {
          if (!emailRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "email",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "emoji") {
          if (!emojiRegex) {
            emojiRegex = new RegExp(_emojiRegex, "u");
          }
          if (!emojiRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "emoji",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "uuid") {
          if (!uuidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "uuid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "nanoid") {
          if (!nanoidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "nanoid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "cuid") {
          if (!cuidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "cuid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "cuid2") {
          if (!cuid2Regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "cuid2",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "ulid") {
          if (!ulidRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "ulid",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "url") {
          try {
            new URL(input.data);
          } catch {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "url",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "regex") {
          check.regex.lastIndex = 0;
          const testResult = check.regex.test(input.data);
          if (!testResult) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "regex",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "trim") {
          input.data = input.data.trim();
        } else if (check.kind === "includes") {
          if (!input.data.includes(check.value, check.position)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: { includes: check.value, position: check.position },
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "toLowerCase") {
          input.data = input.data.toLowerCase();
        } else if (check.kind === "toUpperCase") {
          input.data = input.data.toUpperCase();
        } else if (check.kind === "startsWith") {
          if (!input.data.startsWith(check.value)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: { startsWith: check.value },
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "endsWith") {
          if (!input.data.endsWith(check.value)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: { endsWith: check.value },
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "datetime") {
          const regex = datetimeRegex(check);
          if (!regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: "datetime",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "date") {
          const regex = dateRegex;
          if (!regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: "date",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "time") {
          const regex = timeRegex(check);
          if (!regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_string,
              validation: "time",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "duration") {
          if (!durationRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "duration",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "ip") {
          if (!isValidIP(input.data, check.version)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "ip",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "jwt") {
          if (!isValidJWT(input.data, check.alg)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "jwt",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "cidr") {
          if (!isValidCidr(input.data, check.version)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "cidr",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "base64") {
          if (!base64Regex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "base64",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "base64url") {
          if (!base64urlRegex.test(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              validation: "base64url",
              code: ZodIssueCode.invalid_string,
              message: check.message
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return { status: status.value, value: input.data };
    }
    _regex(regex, validation, message) {
      return this.refinement((data) => regex.test(data), {
        validation,
        code: ZodIssueCode.invalid_string,
        ...errorUtil.errToObj(message)
      });
    }
    _addCheck(check) {
      return new ZodString({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    email(message) {
      return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
    }
    url(message) {
      return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
    }
    emoji(message) {
      return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
    }
    uuid(message) {
      return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
    }
    nanoid(message) {
      return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
    }
    cuid(message) {
      return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
    }
    cuid2(message) {
      return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
    }
    ulid(message) {
      return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
    }
    base64(message) {
      return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
    }
    base64url(message) {
      return this._addCheck({
        kind: "base64url",
        ...errorUtil.errToObj(message)
      });
    }
    jwt(options) {
      return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
    }
    ip(options) {
      return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
    }
    cidr(options) {
      return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
    }
    datetime(options) {
      if (typeof options === "string") {
        return this._addCheck({
          kind: "datetime",
          precision: null,
          offset: false,
          local: false,
          message: options
        });
      }
      return this._addCheck({
        kind: "datetime",
        precision: typeof options?.precision === "undefined" ? null : options?.precision,
        offset: options?.offset ?? false,
        local: options?.local ?? false,
        ...errorUtil.errToObj(options?.message)
      });
    }
    date(message) {
      return this._addCheck({ kind: "date", message });
    }
    time(options) {
      if (typeof options === "string") {
        return this._addCheck({
          kind: "time",
          precision: null,
          message: options
        });
      }
      return this._addCheck({
        kind: "time",
        precision: typeof options?.precision === "undefined" ? null : options?.precision,
        ...errorUtil.errToObj(options?.message)
      });
    }
    duration(message) {
      return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
    }
    regex(regex, message) {
      return this._addCheck({
        kind: "regex",
        regex,
        ...errorUtil.errToObj(message)
      });
    }
    includes(value, options) {
      return this._addCheck({
        kind: "includes",
        value,
        position: options?.position,
        ...errorUtil.errToObj(options?.message)
      });
    }
    startsWith(value, message) {
      return this._addCheck({
        kind: "startsWith",
        value,
        ...errorUtil.errToObj(message)
      });
    }
    endsWith(value, message) {
      return this._addCheck({
        kind: "endsWith",
        value,
        ...errorUtil.errToObj(message)
      });
    }
    min(minLength, message) {
      return this._addCheck({
        kind: "min",
        value: minLength,
        ...errorUtil.errToObj(message)
      });
    }
    max(maxLength, message) {
      return this._addCheck({
        kind: "max",
        value: maxLength,
        ...errorUtil.errToObj(message)
      });
    }
    length(len, message) {
      return this._addCheck({
        kind: "length",
        value: len,
        ...errorUtil.errToObj(message)
      });
    }
    nonempty(message) {
      return this.min(1, errorUtil.errToObj(message));
    }
    trim() {
      return new ZodString({
        ...this._def,
        checks: [...this._def.checks, { kind: "trim" }]
      });
    }
    toLowerCase() {
      return new ZodString({
        ...this._def,
        checks: [...this._def.checks, { kind: "toLowerCase" }]
      });
    }
    toUpperCase() {
      return new ZodString({
        ...this._def,
        checks: [...this._def.checks, { kind: "toUpperCase" }]
      });
    }
    get isDatetime() {
      return !!this._def.checks.find((ch) => ch.kind === "datetime");
    }
    get isDate() {
      return !!this._def.checks.find((ch) => ch.kind === "date");
    }
    get isTime() {
      return !!this._def.checks.find((ch) => ch.kind === "time");
    }
    get isDuration() {
      return !!this._def.checks.find((ch) => ch.kind === "duration");
    }
    get isEmail() {
      return !!this._def.checks.find((ch) => ch.kind === "email");
    }
    get isURL() {
      return !!this._def.checks.find((ch) => ch.kind === "url");
    }
    get isEmoji() {
      return !!this._def.checks.find((ch) => ch.kind === "emoji");
    }
    get isUUID() {
      return !!this._def.checks.find((ch) => ch.kind === "uuid");
    }
    get isNANOID() {
      return !!this._def.checks.find((ch) => ch.kind === "nanoid");
    }
    get isCUID() {
      return !!this._def.checks.find((ch) => ch.kind === "cuid");
    }
    get isCUID2() {
      return !!this._def.checks.find((ch) => ch.kind === "cuid2");
    }
    get isULID() {
      return !!this._def.checks.find((ch) => ch.kind === "ulid");
    }
    get isIP() {
      return !!this._def.checks.find((ch) => ch.kind === "ip");
    }
    get isCIDR() {
      return !!this._def.checks.find((ch) => ch.kind === "cidr");
    }
    get isBase64() {
      return !!this._def.checks.find((ch) => ch.kind === "base64");
    }
    get isBase64url() {
      return !!this._def.checks.find((ch) => ch.kind === "base64url");
    }
    get minLength() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min;
    }
    get maxLength() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max;
    }
  };
  ZodString.create = (params) => {
    return new ZodString({
      checks: [],
      typeName: ZodFirstPartyTypeKind.ZodString,
      coerce: params?.coerce ?? false,
      ...processCreateParams(params)
    });
  };
  ZodNumber = class ZodNumber extends ZodType {
    constructor() {
      super(...arguments);
      this.min = this.gte;
      this.max = this.lte;
      this.step = this.multipleOf;
    }
    _parse(input) {
      if (this._def.coerce) {
        input.data = Number(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.number) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.number,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      let ctx = undefined;
      const status = new ParseStatus;
      for (const check of this._def.checks) {
        if (check.kind === "int") {
          if (!util.isInteger(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.invalid_type,
              expected: "integer",
              received: "float",
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "min") {
          const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
          if (tooSmall) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "number",
              inclusive: check.inclusive,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
          if (tooBig) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "number",
              inclusive: check.inclusive,
              exact: false,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "multipleOf") {
          if (floatSafeRemainder(input.data, check.value) !== 0) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.not_multiple_of,
              multipleOf: check.value,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "finite") {
          if (!Number.isFinite(input.data)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.not_finite,
              message: check.message
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return { status: status.value, value: input.data };
    }
    gte(value, message) {
      return this.setLimit("min", value, true, errorUtil.toString(message));
    }
    gt(value, message) {
      return this.setLimit("min", value, false, errorUtil.toString(message));
    }
    lte(value, message) {
      return this.setLimit("max", value, true, errorUtil.toString(message));
    }
    lt(value, message) {
      return this.setLimit("max", value, false, errorUtil.toString(message));
    }
    setLimit(kind, value, inclusive, message) {
      return new ZodNumber({
        ...this._def,
        checks: [
          ...this._def.checks,
          {
            kind,
            value,
            inclusive,
            message: errorUtil.toString(message)
          }
        ]
      });
    }
    _addCheck(check) {
      return new ZodNumber({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    int(message) {
      return this._addCheck({
        kind: "int",
        message: errorUtil.toString(message)
      });
    }
    positive(message) {
      return this._addCheck({
        kind: "min",
        value: 0,
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    negative(message) {
      return this._addCheck({
        kind: "max",
        value: 0,
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    nonpositive(message) {
      return this._addCheck({
        kind: "max",
        value: 0,
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    nonnegative(message) {
      return this._addCheck({
        kind: "min",
        value: 0,
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    multipleOf(value, message) {
      return this._addCheck({
        kind: "multipleOf",
        value,
        message: errorUtil.toString(message)
      });
    }
    finite(message) {
      return this._addCheck({
        kind: "finite",
        message: errorUtil.toString(message)
      });
    }
    safe(message) {
      return this._addCheck({
        kind: "min",
        inclusive: true,
        value: Number.MIN_SAFE_INTEGER,
        message: errorUtil.toString(message)
      })._addCheck({
        kind: "max",
        inclusive: true,
        value: Number.MAX_SAFE_INTEGER,
        message: errorUtil.toString(message)
      });
    }
    get minValue() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min;
    }
    get maxValue() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max;
    }
    get isInt() {
      return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
    }
    get isFinite() {
      let max = null;
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
          return true;
        } else if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        } else if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return Number.isFinite(min) && Number.isFinite(max);
    }
  };
  ZodNumber.create = (params) => {
    return new ZodNumber({
      checks: [],
      typeName: ZodFirstPartyTypeKind.ZodNumber,
      coerce: params?.coerce || false,
      ...processCreateParams(params)
    });
  };
  ZodBigInt = class ZodBigInt extends ZodType {
    constructor() {
      super(...arguments);
      this.min = this.gte;
      this.max = this.lte;
    }
    _parse(input) {
      if (this._def.coerce) {
        try {
          input.data = BigInt(input.data);
        } catch {
          return this._getInvalidInput(input);
        }
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.bigint) {
        return this._getInvalidInput(input);
      }
      let ctx = undefined;
      const status = new ParseStatus;
      for (const check of this._def.checks) {
        if (check.kind === "min") {
          const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
          if (tooSmall) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              type: "bigint",
              minimum: check.value,
              inclusive: check.inclusive,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
          if (tooBig) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              type: "bigint",
              maximum: check.value,
              inclusive: check.inclusive,
              message: check.message
            });
            status.dirty();
          }
        } else if (check.kind === "multipleOf") {
          if (input.data % check.value !== BigInt(0)) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.not_multiple_of,
              multipleOf: check.value,
              message: check.message
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return { status: status.value, value: input.data };
    }
    _getInvalidInput(input) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.bigint,
        received: ctx.parsedType
      });
      return INVALID;
    }
    gte(value, message) {
      return this.setLimit("min", value, true, errorUtil.toString(message));
    }
    gt(value, message) {
      return this.setLimit("min", value, false, errorUtil.toString(message));
    }
    lte(value, message) {
      return this.setLimit("max", value, true, errorUtil.toString(message));
    }
    lt(value, message) {
      return this.setLimit("max", value, false, errorUtil.toString(message));
    }
    setLimit(kind, value, inclusive, message) {
      return new ZodBigInt({
        ...this._def,
        checks: [
          ...this._def.checks,
          {
            kind,
            value,
            inclusive,
            message: errorUtil.toString(message)
          }
        ]
      });
    }
    _addCheck(check) {
      return new ZodBigInt({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    positive(message) {
      return this._addCheck({
        kind: "min",
        value: BigInt(0),
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    negative(message) {
      return this._addCheck({
        kind: "max",
        value: BigInt(0),
        inclusive: false,
        message: errorUtil.toString(message)
      });
    }
    nonpositive(message) {
      return this._addCheck({
        kind: "max",
        value: BigInt(0),
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    nonnegative(message) {
      return this._addCheck({
        kind: "min",
        value: BigInt(0),
        inclusive: true,
        message: errorUtil.toString(message)
      });
    }
    multipleOf(value, message) {
      return this._addCheck({
        kind: "multipleOf",
        value,
        message: errorUtil.toString(message)
      });
    }
    get minValue() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min;
    }
    get maxValue() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max;
    }
  };
  ZodBigInt.create = (params) => {
    return new ZodBigInt({
      checks: [],
      typeName: ZodFirstPartyTypeKind.ZodBigInt,
      coerce: params?.coerce ?? false,
      ...processCreateParams(params)
    });
  };
  ZodBoolean = class ZodBoolean extends ZodType {
    _parse(input) {
      if (this._def.coerce) {
        input.data = Boolean(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.boolean) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.boolean,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodBoolean.create = (params) => {
    return new ZodBoolean({
      typeName: ZodFirstPartyTypeKind.ZodBoolean,
      coerce: params?.coerce || false,
      ...processCreateParams(params)
    });
  };
  ZodDate = class ZodDate extends ZodType {
    _parse(input) {
      if (this._def.coerce) {
        input.data = new Date(input.data);
      }
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.date) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.date,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      if (Number.isNaN(input.data.getTime())) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_date
        });
        return INVALID;
      }
      const status = new ParseStatus;
      let ctx = undefined;
      for (const check of this._def.checks) {
        if (check.kind === "min") {
          if (input.data.getTime() < check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              message: check.message,
              inclusive: true,
              exact: false,
              minimum: check.value,
              type: "date"
            });
            status.dirty();
          }
        } else if (check.kind === "max") {
          if (input.data.getTime() > check.value) {
            ctx = this._getOrReturnCtx(input, ctx);
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              message: check.message,
              inclusive: true,
              exact: false,
              maximum: check.value,
              type: "date"
            });
            status.dirty();
          }
        } else {
          util.assertNever(check);
        }
      }
      return {
        status: status.value,
        value: new Date(input.data.getTime())
      };
    }
    _addCheck(check) {
      return new ZodDate({
        ...this._def,
        checks: [...this._def.checks, check]
      });
    }
    min(minDate, message) {
      return this._addCheck({
        kind: "min",
        value: minDate.getTime(),
        message: errorUtil.toString(message)
      });
    }
    max(maxDate, message) {
      return this._addCheck({
        kind: "max",
        value: maxDate.getTime(),
        message: errorUtil.toString(message)
      });
    }
    get minDate() {
      let min = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "min") {
          if (min === null || ch.value > min)
            min = ch.value;
        }
      }
      return min != null ? new Date(min) : null;
    }
    get maxDate() {
      let max = null;
      for (const ch of this._def.checks) {
        if (ch.kind === "max") {
          if (max === null || ch.value < max)
            max = ch.value;
        }
      }
      return max != null ? new Date(max) : null;
    }
  };
  ZodDate.create = (params) => {
    return new ZodDate({
      checks: [],
      coerce: params?.coerce || false,
      typeName: ZodFirstPartyTypeKind.ZodDate,
      ...processCreateParams(params)
    });
  };
  ZodSymbol = class ZodSymbol extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.symbol) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.symbol,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodSymbol.create = (params) => {
    return new ZodSymbol({
      typeName: ZodFirstPartyTypeKind.ZodSymbol,
      ...processCreateParams(params)
    });
  };
  ZodUndefined = class ZodUndefined extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.undefined) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.undefined,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodUndefined.create = (params) => {
    return new ZodUndefined({
      typeName: ZodFirstPartyTypeKind.ZodUndefined,
      ...processCreateParams(params)
    });
  };
  ZodNull = class ZodNull extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.null) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.null,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodNull.create = (params) => {
    return new ZodNull({
      typeName: ZodFirstPartyTypeKind.ZodNull,
      ...processCreateParams(params)
    });
  };
  ZodAny = class ZodAny extends ZodType {
    constructor() {
      super(...arguments);
      this._any = true;
    }
    _parse(input) {
      return OK(input.data);
    }
  };
  ZodAny.create = (params) => {
    return new ZodAny({
      typeName: ZodFirstPartyTypeKind.ZodAny,
      ...processCreateParams(params)
    });
  };
  ZodUnknown = class ZodUnknown extends ZodType {
    constructor() {
      super(...arguments);
      this._unknown = true;
    }
    _parse(input) {
      return OK(input.data);
    }
  };
  ZodUnknown.create = (params) => {
    return new ZodUnknown({
      typeName: ZodFirstPartyTypeKind.ZodUnknown,
      ...processCreateParams(params)
    });
  };
  ZodNever = class ZodNever extends ZodType {
    _parse(input) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.never,
        received: ctx.parsedType
      });
      return INVALID;
    }
  };
  ZodNever.create = (params) => {
    return new ZodNever({
      typeName: ZodFirstPartyTypeKind.ZodNever,
      ...processCreateParams(params)
    });
  };
  ZodVoid = class ZodVoid extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.undefined) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.void,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return OK(input.data);
    }
  };
  ZodVoid.create = (params) => {
    return new ZodVoid({
      typeName: ZodFirstPartyTypeKind.ZodVoid,
      ...processCreateParams(params)
    });
  };
  ZodArray = class ZodArray extends ZodType {
    _parse(input) {
      const { ctx, status } = this._processInputParams(input);
      const def = this._def;
      if (ctx.parsedType !== ZodParsedType.array) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.array,
          received: ctx.parsedType
        });
        return INVALID;
      }
      if (def.exactLength !== null) {
        const tooBig = ctx.data.length > def.exactLength.value;
        const tooSmall = ctx.data.length < def.exactLength.value;
        if (tooBig || tooSmall) {
          addIssueToContext(ctx, {
            code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
            minimum: tooSmall ? def.exactLength.value : undefined,
            maximum: tooBig ? def.exactLength.value : undefined,
            type: "array",
            inclusive: true,
            exact: true,
            message: def.exactLength.message
          });
          status.dirty();
        }
      }
      if (def.minLength !== null) {
        if (ctx.data.length < def.minLength.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: def.minLength.value,
            type: "array",
            inclusive: true,
            exact: false,
            message: def.minLength.message
          });
          status.dirty();
        }
      }
      if (def.maxLength !== null) {
        if (ctx.data.length > def.maxLength.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: def.maxLength.value,
            type: "array",
            inclusive: true,
            exact: false,
            message: def.maxLength.message
          });
          status.dirty();
        }
      }
      if (ctx.common.async) {
        return Promise.all([...ctx.data].map((item, i) => {
          return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
        })).then((result2) => {
          return ParseStatus.mergeArray(status, result2);
        });
      }
      const result = [...ctx.data].map((item, i) => {
        return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      });
      return ParseStatus.mergeArray(status, result);
    }
    get element() {
      return this._def.type;
    }
    min(minLength, message) {
      return new ZodArray({
        ...this._def,
        minLength: { value: minLength, message: errorUtil.toString(message) }
      });
    }
    max(maxLength, message) {
      return new ZodArray({
        ...this._def,
        maxLength: { value: maxLength, message: errorUtil.toString(message) }
      });
    }
    length(len, message) {
      return new ZodArray({
        ...this._def,
        exactLength: { value: len, message: errorUtil.toString(message) }
      });
    }
    nonempty(message) {
      return this.min(1, message);
    }
  };
  ZodArray.create = (schema, params) => {
    return new ZodArray({
      type: schema,
      minLength: null,
      maxLength: null,
      exactLength: null,
      typeName: ZodFirstPartyTypeKind.ZodArray,
      ...processCreateParams(params)
    });
  };
  ZodObject = class ZodObject extends ZodType {
    constructor() {
      super(...arguments);
      this._cached = null;
      this.nonstrict = this.passthrough;
      this.augment = this.extend;
    }
    _getCached() {
      if (this._cached !== null)
        return this._cached;
      const shape = this._def.shape();
      const keys = util.objectKeys(shape);
      this._cached = { shape, keys };
      return this._cached;
    }
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.object) {
        const ctx2 = this._getOrReturnCtx(input);
        addIssueToContext(ctx2, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.object,
          received: ctx2.parsedType
        });
        return INVALID;
      }
      const { status, ctx } = this._processInputParams(input);
      const { shape, keys: shapeKeys } = this._getCached();
      const extraKeys = [];
      if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
        for (const key in ctx.data) {
          if (!shapeKeys.includes(key)) {
            extraKeys.push(key);
          }
        }
      }
      const pairs = [];
      for (const key of shapeKeys) {
        const keyValidator = shape[key];
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
      if (this._def.catchall instanceof ZodNever) {
        const unknownKeys = this._def.unknownKeys;
        if (unknownKeys === "passthrough") {
          for (const key of extraKeys) {
            pairs.push({
              key: { status: "valid", value: key },
              value: { status: "valid", value: ctx.data[key] }
            });
          }
        } else if (unknownKeys === "strict") {
          if (extraKeys.length > 0) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.unrecognized_keys,
              keys: extraKeys
            });
            status.dirty();
          }
        } else if (unknownKeys === "strip") {} else {
          throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
        }
      } else {
        const catchall = this._def.catchall;
        for (const key of extraKeys) {
          const value = ctx.data[key];
          pairs.push({
            key: { status: "valid", value: key },
            value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
            alwaysSet: key in ctx.data
          });
        }
      }
      if (ctx.common.async) {
        return Promise.resolve().then(async () => {
          const syncPairs = [];
          for (const pair of pairs) {
            const key = await pair.key;
            const value = await pair.value;
            syncPairs.push({
              key,
              value,
              alwaysSet: pair.alwaysSet
            });
          }
          return syncPairs;
        }).then((syncPairs) => {
          return ParseStatus.mergeObjectSync(status, syncPairs);
        });
      } else {
        return ParseStatus.mergeObjectSync(status, pairs);
      }
    }
    get shape() {
      return this._def.shape();
    }
    strict(message) {
      errorUtil.errToObj;
      return new ZodObject({
        ...this._def,
        unknownKeys: "strict",
        ...message !== undefined ? {
          errorMap: (issue, ctx) => {
            const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
            if (issue.code === "unrecognized_keys")
              return {
                message: errorUtil.errToObj(message).message ?? defaultError
              };
            return {
              message: defaultError
            };
          }
        } : {}
      });
    }
    strip() {
      return new ZodObject({
        ...this._def,
        unknownKeys: "strip"
      });
    }
    passthrough() {
      return new ZodObject({
        ...this._def,
        unknownKeys: "passthrough"
      });
    }
    extend(augmentation) {
      return new ZodObject({
        ...this._def,
        shape: () => ({
          ...this._def.shape(),
          ...augmentation
        })
      });
    }
    merge(merging) {
      const merged = new ZodObject({
        unknownKeys: merging._def.unknownKeys,
        catchall: merging._def.catchall,
        shape: () => ({
          ...this._def.shape(),
          ...merging._def.shape()
        }),
        typeName: ZodFirstPartyTypeKind.ZodObject
      });
      return merged;
    }
    setKey(key, schema) {
      return this.augment({ [key]: schema });
    }
    catchall(index) {
      return new ZodObject({
        ...this._def,
        catchall: index
      });
    }
    pick(mask) {
      const shape = {};
      for (const key of util.objectKeys(mask)) {
        if (mask[key] && this.shape[key]) {
          shape[key] = this.shape[key];
        }
      }
      return new ZodObject({
        ...this._def,
        shape: () => shape
      });
    }
    omit(mask) {
      const shape = {};
      for (const key of util.objectKeys(this.shape)) {
        if (!mask[key]) {
          shape[key] = this.shape[key];
        }
      }
      return new ZodObject({
        ...this._def,
        shape: () => shape
      });
    }
    deepPartial() {
      return deepPartialify(this);
    }
    partial(mask) {
      const newShape = {};
      for (const key of util.objectKeys(this.shape)) {
        const fieldSchema = this.shape[key];
        if (mask && !mask[key]) {
          newShape[key] = fieldSchema;
        } else {
          newShape[key] = fieldSchema.optional();
        }
      }
      return new ZodObject({
        ...this._def,
        shape: () => newShape
      });
    }
    required(mask) {
      const newShape = {};
      for (const key of util.objectKeys(this.shape)) {
        if (mask && !mask[key]) {
          newShape[key] = this.shape[key];
        } else {
          const fieldSchema = this.shape[key];
          let newField = fieldSchema;
          while (newField instanceof ZodOptional) {
            newField = newField._def.innerType;
          }
          newShape[key] = newField;
        }
      }
      return new ZodObject({
        ...this._def,
        shape: () => newShape
      });
    }
    keyof() {
      return createZodEnum(util.objectKeys(this.shape));
    }
  };
  ZodObject.create = (shape, params) => {
    return new ZodObject({
      shape: () => shape,
      unknownKeys: "strip",
      catchall: ZodNever.create(),
      typeName: ZodFirstPartyTypeKind.ZodObject,
      ...processCreateParams(params)
    });
  };
  ZodObject.strictCreate = (shape, params) => {
    return new ZodObject({
      shape: () => shape,
      unknownKeys: "strict",
      catchall: ZodNever.create(),
      typeName: ZodFirstPartyTypeKind.ZodObject,
      ...processCreateParams(params)
    });
  };
  ZodObject.lazycreate = (shape, params) => {
    return new ZodObject({
      shape,
      unknownKeys: "strip",
      catchall: ZodNever.create(),
      typeName: ZodFirstPartyTypeKind.ZodObject,
      ...processCreateParams(params)
    });
  };
  ZodUnion = class ZodUnion extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const options = this._def.options;
      function handleResults(results) {
        for (const result of results) {
          if (result.result.status === "valid") {
            return result.result;
          }
        }
        for (const result of results) {
          if (result.result.status === "dirty") {
            ctx.common.issues.push(...result.ctx.common.issues);
            return result.result;
          }
        }
        const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_union,
          unionErrors
        });
        return INVALID;
      }
      if (ctx.common.async) {
        return Promise.all(options.map(async (option) => {
          const childCtx = {
            ...ctx,
            common: {
              ...ctx.common,
              issues: []
            },
            parent: null
          };
          return {
            result: await option._parseAsync({
              data: ctx.data,
              path: ctx.path,
              parent: childCtx
            }),
            ctx: childCtx
          };
        })).then(handleResults);
      } else {
        let dirty = undefined;
        const issues = [];
        for (const option of options) {
          const childCtx = {
            ...ctx,
            common: {
              ...ctx.common,
              issues: []
            },
            parent: null
          };
          const result = option._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          });
          if (result.status === "valid") {
            return result;
          } else if (result.status === "dirty" && !dirty) {
            dirty = { result, ctx: childCtx };
          }
          if (childCtx.common.issues.length) {
            issues.push(childCtx.common.issues);
          }
        }
        if (dirty) {
          ctx.common.issues.push(...dirty.ctx.common.issues);
          return dirty.result;
        }
        const unionErrors = issues.map((issues2) => new ZodError(issues2));
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_union,
          unionErrors
        });
        return INVALID;
      }
    }
    get options() {
      return this._def.options;
    }
  };
  ZodUnion.create = (types, params) => {
    return new ZodUnion({
      options: types,
      typeName: ZodFirstPartyTypeKind.ZodUnion,
      ...processCreateParams(params)
    });
  };
  ZodDiscriminatedUnion = class ZodDiscriminatedUnion extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.object) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.object,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const discriminator = this.discriminator;
      const discriminatorValue = ctx.data[discriminator];
      const option = this.optionsMap.get(discriminatorValue);
      if (!option) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_union_discriminator,
          options: Array.from(this.optionsMap.keys()),
          path: [discriminator]
        });
        return INVALID;
      }
      if (ctx.common.async) {
        return option._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
      } else {
        return option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
      }
    }
    get discriminator() {
      return this._def.discriminator;
    }
    get options() {
      return this._def.options;
    }
    get optionsMap() {
      return this._def.optionsMap;
    }
    static create(discriminator, options, params) {
      const optionsMap = new Map;
      for (const type of options) {
        const discriminatorValues = getDiscriminator(type.shape[discriminator]);
        if (!discriminatorValues.length) {
          throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
        }
        for (const value of discriminatorValues) {
          if (optionsMap.has(value)) {
            throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
          }
          optionsMap.set(value, type);
        }
      }
      return new ZodDiscriminatedUnion({
        typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
        discriminator,
        options,
        optionsMap,
        ...processCreateParams(params)
      });
    }
  };
  ZodIntersection = class ZodIntersection extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      const handleParsed = (parsedLeft, parsedRight) => {
        if (isAborted(parsedLeft) || isAborted(parsedRight)) {
          return INVALID;
        }
        const merged = mergeValues(parsedLeft.value, parsedRight.value);
        if (!merged.valid) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_intersection_types
          });
          return INVALID;
        }
        if (isDirty(parsedLeft) || isDirty(parsedRight)) {
          status.dirty();
        }
        return { status: status.value, value: merged.data };
      };
      if (ctx.common.async) {
        return Promise.all([
          this._def.left._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          }),
          this._def.right._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          })
        ]).then(([left, right]) => handleParsed(left, right));
      } else {
        return handleParsed(this._def.left._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }), this._def.right._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }));
      }
    }
  };
  ZodIntersection.create = (left, right, params) => {
    return new ZodIntersection({
      left,
      right,
      typeName: ZodFirstPartyTypeKind.ZodIntersection,
      ...processCreateParams(params)
    });
  };
  ZodTuple = class ZodTuple extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.array) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.array,
          received: ctx.parsedType
        });
        return INVALID;
      }
      if (ctx.data.length < this._def.items.length) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: this._def.items.length,
          inclusive: true,
          exact: false,
          type: "array"
        });
        return INVALID;
      }
      const rest = this._def.rest;
      if (!rest && ctx.data.length > this._def.items.length) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: this._def.items.length,
          inclusive: true,
          exact: false,
          type: "array"
        });
        status.dirty();
      }
      const items = [...ctx.data].map((item, itemIndex) => {
        const schema = this._def.items[itemIndex] || this._def.rest;
        if (!schema)
          return null;
        return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
      }).filter((x) => !!x);
      if (ctx.common.async) {
        return Promise.all(items).then((results) => {
          return ParseStatus.mergeArray(status, results);
        });
      } else {
        return ParseStatus.mergeArray(status, items);
      }
    }
    get items() {
      return this._def.items;
    }
    rest(rest) {
      return new ZodTuple({
        ...this._def,
        rest
      });
    }
  };
  ZodTuple.create = (schemas, params) => {
    if (!Array.isArray(schemas)) {
      throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
    }
    return new ZodTuple({
      items: schemas,
      typeName: ZodFirstPartyTypeKind.ZodTuple,
      rest: null,
      ...processCreateParams(params)
    });
  };
  ZodRecord = class ZodRecord extends ZodType {
    get keySchema() {
      return this._def.keyType;
    }
    get valueSchema() {
      return this._def.valueType;
    }
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.object) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.object,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const pairs = [];
      const keyType = this._def.keyType;
      const valueType = this._def.valueType;
      for (const key in ctx.data) {
        pairs.push({
          key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
          value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
      if (ctx.common.async) {
        return ParseStatus.mergeObjectAsync(status, pairs);
      } else {
        return ParseStatus.mergeObjectSync(status, pairs);
      }
    }
    get element() {
      return this._def.valueType;
    }
    static create(first, second, third) {
      if (second instanceof ZodType) {
        return new ZodRecord({
          keyType: first,
          valueType: second,
          typeName: ZodFirstPartyTypeKind.ZodRecord,
          ...processCreateParams(third)
        });
      }
      return new ZodRecord({
        keyType: ZodString.create(),
        valueType: first,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(second)
      });
    }
  };
  ZodMap = class ZodMap extends ZodType {
    get keySchema() {
      return this._def.keyType;
    }
    get valueSchema() {
      return this._def.valueType;
    }
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.map) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.map,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const keyType = this._def.keyType;
      const valueType = this._def.valueType;
      const pairs = [...ctx.data.entries()].map(([key, value], index) => {
        return {
          key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
          value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
        };
      });
      if (ctx.common.async) {
        const finalMap = new Map;
        return Promise.resolve().then(async () => {
          for (const pair of pairs) {
            const key = await pair.key;
            const value = await pair.value;
            if (key.status === "aborted" || value.status === "aborted") {
              return INVALID;
            }
            if (key.status === "dirty" || value.status === "dirty") {
              status.dirty();
            }
            finalMap.set(key.value, value.value);
          }
          return { status: status.value, value: finalMap };
        });
      } else {
        const finalMap = new Map;
        for (const pair of pairs) {
          const key = pair.key;
          const value = pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      }
    }
  };
  ZodMap.create = (keyType, valueType, params) => {
    return new ZodMap({
      valueType,
      keyType,
      typeName: ZodFirstPartyTypeKind.ZodMap,
      ...processCreateParams(params)
    });
  };
  ZodSet = class ZodSet extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.set) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.set,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const def = this._def;
      if (def.minSize !== null) {
        if (ctx.data.size < def.minSize.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: def.minSize.value,
            type: "set",
            inclusive: true,
            exact: false,
            message: def.minSize.message
          });
          status.dirty();
        }
      }
      if (def.maxSize !== null) {
        if (ctx.data.size > def.maxSize.value) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: def.maxSize.value,
            type: "set",
            inclusive: true,
            exact: false,
            message: def.maxSize.message
          });
          status.dirty();
        }
      }
      const valueType = this._def.valueType;
      function finalizeSet(elements2) {
        const parsedSet = new Set;
        for (const element of elements2) {
          if (element.status === "aborted")
            return INVALID;
          if (element.status === "dirty")
            status.dirty();
          parsedSet.add(element.value);
        }
        return { status: status.value, value: parsedSet };
      }
      const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
      if (ctx.common.async) {
        return Promise.all(elements).then((elements2) => finalizeSet(elements2));
      } else {
        return finalizeSet(elements);
      }
    }
    min(minSize, message) {
      return new ZodSet({
        ...this._def,
        minSize: { value: minSize, message: errorUtil.toString(message) }
      });
    }
    max(maxSize, message) {
      return new ZodSet({
        ...this._def,
        maxSize: { value: maxSize, message: errorUtil.toString(message) }
      });
    }
    size(size, message) {
      return this.min(size, message).max(size, message);
    }
    nonempty(message) {
      return this.min(1, message);
    }
  };
  ZodSet.create = (valueType, params) => {
    return new ZodSet({
      valueType,
      minSize: null,
      maxSize: null,
      typeName: ZodFirstPartyTypeKind.ZodSet,
      ...processCreateParams(params)
    });
  };
  ZodFunction = class ZodFunction extends ZodType {
    constructor() {
      super(...arguments);
      this.validate = this.implement;
    }
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.function) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.function,
          received: ctx.parsedType
        });
        return INVALID;
      }
      function makeArgsIssue(args, error) {
        return makeIssue({
          data: args,
          path: ctx.path,
          errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
          issueData: {
            code: ZodIssueCode.invalid_arguments,
            argumentsError: error
          }
        });
      }
      function makeReturnsIssue(returns, error) {
        return makeIssue({
          data: returns,
          path: ctx.path,
          errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
          issueData: {
            code: ZodIssueCode.invalid_return_type,
            returnTypeError: error
          }
        });
      }
      const params = { errorMap: ctx.common.contextualErrorMap };
      const fn = ctx.data;
      if (this._def.returns instanceof ZodPromise) {
        const me = this;
        return OK(async function(...args) {
          const error = new ZodError([]);
          const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
            error.addIssue(makeArgsIssue(args, e));
            throw error;
          });
          const result = await Reflect.apply(fn, this, parsedArgs);
          const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
            error.addIssue(makeReturnsIssue(result, e));
            throw error;
          });
          return parsedReturns;
        });
      } else {
        const me = this;
        return OK(function(...args) {
          const parsedArgs = me._def.args.safeParse(args, params);
          if (!parsedArgs.success) {
            throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
          }
          const result = Reflect.apply(fn, this, parsedArgs.data);
          const parsedReturns = me._def.returns.safeParse(result, params);
          if (!parsedReturns.success) {
            throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
          }
          return parsedReturns.data;
        });
      }
    }
    parameters() {
      return this._def.args;
    }
    returnType() {
      return this._def.returns;
    }
    args(...items) {
      return new ZodFunction({
        ...this._def,
        args: ZodTuple.create(items).rest(ZodUnknown.create())
      });
    }
    returns(returnType) {
      return new ZodFunction({
        ...this._def,
        returns: returnType
      });
    }
    implement(func) {
      const validatedFunc = this.parse(func);
      return validatedFunc;
    }
    strictImplement(func) {
      const validatedFunc = this.parse(func);
      return validatedFunc;
    }
    static create(args, returns, params) {
      return new ZodFunction({
        args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
        returns: returns || ZodUnknown.create(),
        typeName: ZodFirstPartyTypeKind.ZodFunction,
        ...processCreateParams(params)
      });
    }
  };
  ZodLazy = class ZodLazy extends ZodType {
    get schema() {
      return this._def.getter();
    }
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const lazySchema = this._def.getter();
      return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
    }
  };
  ZodLazy.create = (getter, params) => {
    return new ZodLazy({
      getter,
      typeName: ZodFirstPartyTypeKind.ZodLazy,
      ...processCreateParams(params)
    });
  };
  ZodLiteral = class ZodLiteral extends ZodType {
    _parse(input) {
      if (input.data !== this._def.value) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          received: ctx.data,
          code: ZodIssueCode.invalid_literal,
          expected: this._def.value
        });
        return INVALID;
      }
      return { status: "valid", value: input.data };
    }
    get value() {
      return this._def.value;
    }
  };
  ZodLiteral.create = (value, params) => {
    return new ZodLiteral({
      value,
      typeName: ZodFirstPartyTypeKind.ZodLiteral,
      ...processCreateParams(params)
    });
  };
  ZodEnum = class ZodEnum extends ZodType {
    _parse(input) {
      if (typeof input.data !== "string") {
        const ctx = this._getOrReturnCtx(input);
        const expectedValues = this._def.values;
        addIssueToContext(ctx, {
          expected: util.joinValues(expectedValues),
          received: ctx.parsedType,
          code: ZodIssueCode.invalid_type
        });
        return INVALID;
      }
      if (!this._cache) {
        this._cache = new Set(this._def.values);
      }
      if (!this._cache.has(input.data)) {
        const ctx = this._getOrReturnCtx(input);
        const expectedValues = this._def.values;
        addIssueToContext(ctx, {
          received: ctx.data,
          code: ZodIssueCode.invalid_enum_value,
          options: expectedValues
        });
        return INVALID;
      }
      return OK(input.data);
    }
    get options() {
      return this._def.values;
    }
    get enum() {
      const enumValues = {};
      for (const val of this._def.values) {
        enumValues[val] = val;
      }
      return enumValues;
    }
    get Values() {
      const enumValues = {};
      for (const val of this._def.values) {
        enumValues[val] = val;
      }
      return enumValues;
    }
    get Enum() {
      const enumValues = {};
      for (const val of this._def.values) {
        enumValues[val] = val;
      }
      return enumValues;
    }
    extract(values, newDef = this._def) {
      return ZodEnum.create(values, {
        ...this._def,
        ...newDef
      });
    }
    exclude(values, newDef = this._def) {
      return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
        ...this._def,
        ...newDef
      });
    }
  };
  ZodEnum.create = createZodEnum;
  ZodNativeEnum = class ZodNativeEnum extends ZodType {
    _parse(input) {
      const nativeEnumValues = util.getValidEnumValues(this._def.values);
      const ctx = this._getOrReturnCtx(input);
      if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
        const expectedValues = util.objectValues(nativeEnumValues);
        addIssueToContext(ctx, {
          expected: util.joinValues(expectedValues),
          received: ctx.parsedType,
          code: ZodIssueCode.invalid_type
        });
        return INVALID;
      }
      if (!this._cache) {
        this._cache = new Set(util.getValidEnumValues(this._def.values));
      }
      if (!this._cache.has(input.data)) {
        const expectedValues = util.objectValues(nativeEnumValues);
        addIssueToContext(ctx, {
          received: ctx.data,
          code: ZodIssueCode.invalid_enum_value,
          options: expectedValues
        });
        return INVALID;
      }
      return OK(input.data);
    }
    get enum() {
      return this._def.values;
    }
  };
  ZodNativeEnum.create = (values, params) => {
    return new ZodNativeEnum({
      values,
      typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
      ...processCreateParams(params)
    });
  };
  ZodPromise = class ZodPromise extends ZodType {
    unwrap() {
      return this._def.type;
    }
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.promise,
          received: ctx.parsedType
        });
        return INVALID;
      }
      const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
      return OK(promisified.then((data) => {
        return this._def.type.parseAsync(data, {
          path: ctx.path,
          errorMap: ctx.common.contextualErrorMap
        });
      }));
    }
  };
  ZodPromise.create = (schema, params) => {
    return new ZodPromise({
      type: schema,
      typeName: ZodFirstPartyTypeKind.ZodPromise,
      ...processCreateParams(params)
    });
  };
  ZodEffects = class ZodEffects extends ZodType {
    innerType() {
      return this._def.schema;
    }
    sourceType() {
      return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
    }
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      const effect = this._def.effect || null;
      const checkCtx = {
        addIssue: (arg) => {
          addIssueToContext(ctx, arg);
          if (arg.fatal) {
            status.abort();
          } else {
            status.dirty();
          }
        },
        get path() {
          return ctx.path;
        }
      };
      checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
      if (effect.type === "preprocess") {
        const processed = effect.transform(ctx.data, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(processed).then(async (processed2) => {
            if (status.value === "aborted")
              return INVALID;
            const result = await this._def.schema._parseAsync({
              data: processed2,
              path: ctx.path,
              parent: ctx
            });
            if (result.status === "aborted")
              return INVALID;
            if (result.status === "dirty")
              return DIRTY(result.value);
            if (status.value === "dirty")
              return DIRTY(result.value);
            return result;
          });
        } else {
          if (status.value === "aborted")
            return INVALID;
          const result = this._def.schema._parseSync({
            data: processed,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        }
      }
      if (effect.type === "refinement") {
        const executeRefinement = (acc) => {
          const result = effect.refinement(acc, checkCtx);
          if (ctx.common.async) {
            return Promise.resolve(result);
          }
          if (result instanceof Promise) {
            throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
          }
          return acc;
        };
        if (ctx.common.async === false) {
          const inner = this._def.schema._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          executeRefinement(inner.value);
          return { status: status.value, value: inner.value };
        } else {
          return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
            if (inner.status === "aborted")
              return INVALID;
            if (inner.status === "dirty")
              status.dirty();
            return executeRefinement(inner.value).then(() => {
              return { status: status.value, value: inner.value };
            });
          });
        }
      }
      if (effect.type === "transform") {
        if (ctx.common.async === false) {
          const base = this._def.schema._parseSync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (!isValid(base))
            return INVALID;
          const result = effect.transform(base.value, checkCtx);
          if (result instanceof Promise) {
            throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
          }
          return { status: status.value, value: result };
        } else {
          return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
            if (!isValid(base))
              return INVALID;
            return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
              status: status.value,
              value: result
            }));
          });
        }
      }
      util.assertNever(effect);
    }
  };
  ZodEffects.create = (schema, effect, params) => {
    return new ZodEffects({
      schema,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect,
      ...processCreateParams(params)
    });
  };
  ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
    return new ZodEffects({
      schema,
      effect: { type: "preprocess", transform: preprocess },
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      ...processCreateParams(params)
    });
  };
  ZodOptional = class ZodOptional extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType === ZodParsedType.undefined) {
        return OK(undefined);
      }
      return this._def.innerType._parse(input);
    }
    unwrap() {
      return this._def.innerType;
    }
  };
  ZodOptional.create = (type, params) => {
    return new ZodOptional({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodOptional,
      ...processCreateParams(params)
    });
  };
  ZodNullable = class ZodNullable extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType === ZodParsedType.null) {
        return OK(null);
      }
      return this._def.innerType._parse(input);
    }
    unwrap() {
      return this._def.innerType;
    }
  };
  ZodNullable.create = (type, params) => {
    return new ZodNullable({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodNullable,
      ...processCreateParams(params)
    });
  };
  ZodDefault = class ZodDefault extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      let data = ctx.data;
      if (ctx.parsedType === ZodParsedType.undefined) {
        data = this._def.defaultValue();
      }
      return this._def.innerType._parse({
        data,
        path: ctx.path,
        parent: ctx
      });
    }
    removeDefault() {
      return this._def.innerType;
    }
  };
  ZodDefault.create = (type, params) => {
    return new ZodDefault({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodDefault,
      defaultValue: typeof params.default === "function" ? params.default : () => params.default,
      ...processCreateParams(params)
    });
  };
  ZodCatch = class ZodCatch extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const newCtx = {
        ...ctx,
        common: {
          ...ctx.common,
          issues: []
        }
      };
      const result = this._def.innerType._parse({
        data: newCtx.data,
        path: newCtx.path,
        parent: {
          ...newCtx
        }
      });
      if (isAsync(result)) {
        return result.then((result2) => {
          return {
            status: "valid",
            value: result2.status === "valid" ? result2.value : this._def.catchValue({
              get error() {
                return new ZodError(newCtx.common.issues);
              },
              input: newCtx.data
            })
          };
        });
      } else {
        return {
          status: "valid",
          value: result.status === "valid" ? result.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      }
    }
    removeCatch() {
      return this._def.innerType;
    }
  };
  ZodCatch.create = (type, params) => {
    return new ZodCatch({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodCatch,
      catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
      ...processCreateParams(params)
    });
  };
  ZodNaN = class ZodNaN extends ZodType {
    _parse(input) {
      const parsedType = this._getType(input);
      if (parsedType !== ZodParsedType.nan) {
        const ctx = this._getOrReturnCtx(input);
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_type,
          expected: ZodParsedType.nan,
          received: ctx.parsedType
        });
        return INVALID;
      }
      return { status: "valid", value: input.data };
    }
  };
  ZodNaN.create = (params) => {
    return new ZodNaN({
      typeName: ZodFirstPartyTypeKind.ZodNaN,
      ...processCreateParams(params)
    });
  };
  BRAND = Symbol("zod_brand");
  ZodBranded = class ZodBranded extends ZodType {
    _parse(input) {
      const { ctx } = this._processInputParams(input);
      const data = ctx.data;
      return this._def.type._parse({
        data,
        path: ctx.path,
        parent: ctx
      });
    }
    unwrap() {
      return this._def.type;
    }
  };
  ZodPipeline = class ZodPipeline extends ZodType {
    _parse(input) {
      const { status, ctx } = this._processInputParams(input);
      if (ctx.common.async) {
        const handleAsync = async () => {
          const inResult = await this._def.in._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: ctx
          });
          if (inResult.status === "aborted")
            return INVALID;
          if (inResult.status === "dirty") {
            status.dirty();
            return DIRTY(inResult.value);
          } else {
            return this._def.out._parseAsync({
              data: inResult.value,
              path: ctx.path,
              parent: ctx
            });
          }
        };
        return handleAsync();
      } else {
        const inResult = this._def.in._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return {
            status: "dirty",
            value: inResult.value
          };
        } else {
          return this._def.out._parseSync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      }
    }
    static create(a, b) {
      return new ZodPipeline({
        in: a,
        out: b,
        typeName: ZodFirstPartyTypeKind.ZodPipeline
      });
    }
  };
  ZodReadonly = class ZodReadonly extends ZodType {
    _parse(input) {
      const result = this._def.innerType._parse(input);
      const freeze = (data) => {
        if (isValid(data)) {
          data.value = Object.freeze(data.value);
        }
        return data;
      };
      return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
    }
    unwrap() {
      return this._def.innerType;
    }
  };
  ZodReadonly.create = (type, params) => {
    return new ZodReadonly({
      innerType: type,
      typeName: ZodFirstPartyTypeKind.ZodReadonly,
      ...processCreateParams(params)
    });
  };
  late = {
    object: ZodObject.lazycreate
  };
  (function(ZodFirstPartyTypeKind2) {
    ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
    ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
    ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
    ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
    ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
    ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
    ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
    ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
    ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
    ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
    ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
    ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
    ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
    ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
    ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
    ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
    ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
    ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
    ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
    ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
    ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
    ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
    ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
    ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
    ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
    ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
    ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
    ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
    ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
    ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
    ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
    ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
    ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
    ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
    ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
    ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
  })(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
  stringType = ZodString.create;
  numberType = ZodNumber.create;
  nanType = ZodNaN.create;
  bigIntType = ZodBigInt.create;
  booleanType = ZodBoolean.create;
  dateType = ZodDate.create;
  symbolType = ZodSymbol.create;
  undefinedType = ZodUndefined.create;
  nullType = ZodNull.create;
  anyType = ZodAny.create;
  unknownType = ZodUnknown.create;
  neverType = ZodNever.create;
  voidType = ZodVoid.create;
  arrayType = ZodArray.create;
  objectType = ZodObject.create;
  strictObjectType = ZodObject.strictCreate;
  unionType = ZodUnion.create;
  discriminatedUnionType = ZodDiscriminatedUnion.create;
  intersectionType = ZodIntersection.create;
  tupleType = ZodTuple.create;
  recordType = ZodRecord.create;
  mapType = ZodMap.create;
  setType = ZodSet.create;
  functionType = ZodFunction.create;
  lazyType = ZodLazy.create;
  literalType = ZodLiteral.create;
  enumType = ZodEnum.create;
  nativeEnumType = ZodNativeEnum.create;
  promiseType = ZodPromise.create;
  effectsType = ZodEffects.create;
  optionalType = ZodOptional.create;
  nullableType = ZodNullable.create;
  preprocessType = ZodEffects.createWithPreprocess;
  pipelineType = ZodPipeline.create;
  coerce = {
    string: (arg) => ZodString.create({ ...arg, coerce: true }),
    number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
    boolean: (arg) => ZodBoolean.create({
      ...arg,
      coerce: true
    }),
    bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
    date: (arg) => ZodDate.create({ ...arg, coerce: true })
  };
  NEVER = INVALID;
});

// node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});
var init_external = __esm(() => {
  init_errors();
  init_parseUtil();
  init_typeAliases();
  init_util();
  init_types();
  init_ZodError();
});

// node_modules/zod/index.js
var init_zod = __esm(() => {
  init_external();
  init_external();
});

// src/core/cbs/catalog/schema.ts
function isComplete(entry) {
  if (entry.argShape === "UNCERTAIN")
    return false;
  if (entry.summary.trim().length === 0)
    return false;
  if (!entry.pure && entry.readsState.length === 0 && entry.writesState.length === 0)
    return false;
  return true;
}
var stateReadKindSchema, stateWriteKindSchema, macroCategorySchema, lumiverseCollisionSchema, macroCatalogEntrySchema, macroCatalogSchema;
var init_schema = __esm(() => {
  init_zod();
  stateReadKindSchema = exports_external.enum([
    "none",
    "localVars",
    "globalVars",
    "chatState",
    "characterFields",
    "time",
    "rng",
    "messages"
  ]);
  stateWriteKindSchema = exports_external.enum([
    "none",
    "localVars",
    "globalVars",
    "chatState",
    "messages"
  ]);
  macroCategorySchema = exports_external.enum([
    "identity",
    "character_fields",
    "chat_context",
    "time",
    "variables",
    "math",
    "logic",
    "arrays",
    "strings",
    "random",
    "tokenize",
    "display",
    "escape_markup",
    "control_flow",
    "metadata",
    "flow_control",
    "other"
  ]);
  lumiverseCollisionSchema = exports_external.object({
    name: exports_external.string(),
    compatible: exports_external.boolean(),
    notes: exports_external.string()
  });
  macroCatalogEntrySchema = exports_external.object({
    name: exports_external.string().min(1),
    aliases: exports_external.array(exports_external.string()),
    category: macroCategorySchema,
    argShape: exports_external.string().min(1),
    minArgs: exports_external.number().int().min(0),
    maxArgs: exports_external.number().int().min(-1),
    pure: exports_external.boolean(),
    readsState: exports_external.array(stateReadKindSchema),
    writesState: exports_external.array(stateWriteKindSchema),
    lumiverseCollision: lumiverseCollisionSchema.nullable(),
    risuFile: exports_external.string(),
    risuLine: exports_external.number().int().min(1),
    summary: exports_external.string(),
    notes: exports_external.string()
  });
  macroCatalogSchema = exports_external.array(macroCatalogEntrySchema);
});

// src/core/cbs/catalog/loader.ts
class CatalogIndex {
  entriesByCanonical = new Map;
  entriesByLookup = new Map;
  entries;
  constructor(entries) {
    this.entries = entries;
    for (const e of entries) {
      const canonical = stripBlockMarker(e.name);
      if (this.entriesByCanonical.has(canonical)) {
        throw new Error(`catalog: duplicate canonical name "${canonical}"`);
      }
      this.entriesByCanonical.set(canonical, e);
      const canonicalNorm = normalizeMacroName(canonical);
      this.entriesByLookup.set(canonicalNorm, e);
      for (const alias of e.aliases) {
        const norm = normalizeMacroName(stripBlockMarker(alias));
        if (!this.entriesByLookup.has(norm))
          this.entriesByLookup.set(norm, e);
      }
    }
  }
  find(name) {
    const norm = normalizeMacroName(stripBlockMarker(name));
    return this.entriesByLookup.get(norm) ?? null;
  }
  delegatesToLumiverse(name) {
    const e = this.find(name);
    return !!e && !!e.lumiverseCollision && e.lumiverseCollision.compatible;
  }
  needsRename(name) {
    const e = this.find(name);
    return !!e && !!e.lumiverseCollision && !e.lumiverseCollision.compatible;
  }
  incompatibleNames() {
    const names = [];
    for (const e of this.entries) {
      if (!e.lumiverseCollision || e.lumiverseCollision.compatible)
        continue;
      names.push(e.name);
      if (e.aliases)
        names.push(...e.aliases);
    }
    return names;
  }
  handlerEntries() {
    return this.entries.filter((e) => !e.lumiverseCollision || !e.lumiverseCollision.compatible);
  }
  completeEntries() {
    return this.entries.filter(isComplete);
  }
  skeletonEntries() {
    return this.entries.filter((e) => !isComplete(e));
  }
}
function stripBlockMarker(name) {
  if (name.startsWith("#") || name.startsWith(":"))
    return name.slice(1);
  return name;
}
function parseCatalog(raw) {
  return macroCatalogSchema.parse(raw);
}
var init_loader = __esm(() => {
  init_schema();
  init_parser();
});

// src/core/cbs/catalog/index.ts
var init_catalog = __esm(() => {
  init_schema();
  init_loader();
});
// src/core/cbs/runtime/mock.ts
class MockVariableStore {
  data = {
    local: new Map,
    global: new Map,
    temp: new Map
  };
  get(scope, name) {
    return this.data[scope].get(name) ?? "";
  }
  set(scope, name, value) {
    this.data[scope].set(name, value);
  }
  add(scope, name, delta) {
    this.data[scope].set(name, String(Number(this.data[scope].get(name) ?? "0") + delta));
  }
  has(scope, name) {
    return this.data[scope].has(name);
  }
  delete(scope, name) {
    this.data[scope].delete(name);
  }
}

class MockFunctionRegistry {
  table = new Map;
  define(name, body, argNames) {
    this.table.set(name, { body, argNames });
  }
  get(name) {
    return this.table.get(name) ?? null;
  }
  delete(name) {
    this.table.delete(name);
  }
  has(name) {
    return this.table.has(name);
  }
}
var init_mock = () => {};

// src/core/cbs/runtime/index.ts
var init_runtime = __esm(() => {
  init_mock();
});

// src/core/cbs/index.ts
var init_cbs = __esm(() => {
  init_parser();
  init_catalog();
  init_runtime();
});

// src/core/cbs/catalog/risu-macros.json
var risu_macros_default;
var init_risu_macros = __esm(() => {
  risu_macros_default = [
    {
      name: "#each",
      aliases: [
        ":each"
      ],
      category: "control_flow",
      argShape: "[::keep ]ARRAY as VAR + body",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1388,
      summary: "Iterates over a JSON or \xA7-delimited array, substituting {{slot::VAR}} inside the body per iteration.",
      notes: "Known deviation: inner macros are not re-evaluated per iteration; remaining {{\u2026}} in output appear literal."
    },
    {
      name: "#code",
      aliases: [
        "#normalize"
      ],
      category: "control_flow",
      argShape: "body",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1486,
      summary: "Normalizes a code body: trims, strips newlines and tabs, processes backslash escape sequences (\\n, \\r, \\t, \\uXXXX, \\x, etc).",
      notes: "Often used to inline machine-generated JSON into a prompt."
    },
    {
      name: "#ignore",
      aliases: [],
      category: "control_flow",
      argShape: "body",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1517,
      summary: "Discards the block body and returns empty string. Inner macros are not evaluated.",
      notes: "Typical use: disabling a section of a card without deleting it."
    },
    {
      name: "#escape",
      aliases: [],
      category: "control_flow",
      argShape: "[::keep] + body",
      minArgs: 0,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1514,
      summary: "Replaces { } ( ) in the body with Private Use Area chars so they don't parse as macro/function syntax.",
      notes: "Body is trimmed unless mode=keep. Inner macros are not evaluated (opaque block)."
    },
    {
      name: "#if",
      aliases: [],
      category: "control_flow",
      argShape: "cond + body",
      minArgs: 1,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1138,
      summary: 'Conditional block. Returns body if condition is truthy ("true" or "1"), else empty (or {{:else}} branch if present).',
      notes: "DEPRECATED. Use #when instead. Risu short-circuits body evaluation for the untaken branch; Lumiverse does not."
    },
    {
      name: "#if_pure",
      aliases: [],
      category: "control_flow",
      argShape: "cond + body",
      minArgs: 1,
      maxArgs: 2,
      pure: false,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1143,
      summary: "Conditional block variant that preserves interior whitespace. DEPRECATED; use #when::keep::cond instead.",
      notes: "DEPRECATED."
    },
    {
      name: "#pure",
      aliases: [],
      category: "control_flow",
      argShape: "body",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1420,
      summary: "Returns the block body as literal text without evaluating inner CBS macros.",
      notes: "Body is trimmed. Inner macros are preserved verbatim (opaque block)."
    },
    {
      name: "#puredisplay",
      aliases: [
        "pure_display",
        "pure-display"
      ],
      category: "control_flow",
      argShape: "body",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1722,
      summary: "Returns the trimmed block body with {{ and }} backslash-escaped so downstream parsers leave them alone.",
      notes: "Like #pure, but additionally escapes brace pairs to prevent any further macro parsing."
    },
    {
      name: "#when",
      aliases: [],
      category: "control_flow",
      argShape: "[op::]cond[::op::cond::\u2026] + body",
      minArgs: 1,
      maxArgs: -1,
      pure: false,
      readsState: [
        "localVars",
        "globalVars"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1150,
      summary: "Conditional block with operator chain. Supports and/or/is/isnot/not/var/vis/visnot/toggle/tis/tisnot/>/</>=/<= plus whitespace modes keep and legacy.",
      notes: "Known deviation: body eager-evaluates in Lumiverse regardless of condition; side effects in the untaken branch still fire."
    },
    {
      name: "//",
      aliases: [],
      category: "other",
      argShape: "TEXT",
      minArgs: 0,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2257,
      summary: "Inline comment \u2014 always returns ''.",
      notes: ""
    },
    {
      name: ":else",
      aliases: [],
      category: "other",
      argShape: "UNCERTAIN",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2442,
      summary: "Else statement for CBS. Must be used inside {{#when}}. if {{#when}} is multiline",
      notes: ""
    },
    {
      name: "?",
      aliases: [],
      category: "other",
      argShape: "UNCERTAIN",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2264,
      summary: "Runs math operations on numbers. Supports +, -, *, /, %, ^ (exponentiation), % (",
      notes: ""
    },
    {
      name: "__",
      aliases: [],
      category: "other",
      argShape: "UNCERTAIN",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2271,
      summary: "**INTERNAL FUNCTION - DO NOT USE**",
      notes: ""
    },
    {
      name: "abs",
      aliases: [],
      category: "math",
      argShape: "N",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "abs",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1128,
      summary: "Returns the absolute value of a number.",
      notes: ""
    },
    {
      name: "addvar",
      aliases: [],
      category: "variables",
      argShape: "NAME::DELTA",
      minArgs: 2,
      maxArgs: 2,
      pure: false,
      readsState: [
        "localVars"
      ],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: {
        name: "addvar",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 810,
      summary: "Adds DELTA to the current numeric value of NAME.",
      notes: ""
    },
    {
      name: "all",
      aliases: [],
      category: "other",
      argShape: "ARR or F1::F2::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1667,
      summary: "Returns '1' iff every value is the literal '1'. Accepts a JSON array or multiple args.",
      notes: ""
    },
    {
      name: "and",
      aliases: [],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "and",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 943,
      summary: "Boolean AND: returns '1' iff both args are the literal '1'.",
      notes: ""
    },
    {
      name: "any",
      aliases: [],
      category: "other",
      argShape: "ARR or F1::F2::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1680,
      summary: "Returns '1' if any value is the literal '1'.",
      notes: ""
    },
    {
      name: "arrayassert",
      aliases: [
        "arrayassert"
      ],
      category: "arrays",
      argShape: "JSON_ARR::INDEX::VALUE",
      minArgs: 3,
      maxArgs: 3,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1280,
      summary: "Sets arr[INDEX]=VALUE only if INDEX is out of bounds (extends the array).",
      notes: ""
    },
    {
      name: "arrayelement",
      aliases: [
        "arrayelement"
      ],
      category: "arrays",
      argShape: "JSON_ARR::INDEX",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1178,
      summary: "Returns arr[INDEX] (JSON-stringified if object). 'null' if OOB.",
      notes: ""
    },
    {
      name: "arraylength",
      aliases: [
        "arraylength"
      ],
      category: "arrays",
      argShape: "JSON_ARR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1065,
      summary: "Length of a JSON array.",
      notes: ""
    },
    {
      name: "arraypop",
      aliases: [
        "arraypop"
      ],
      category: "arrays",
      argShape: "JSON_ARR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1247,
      summary: "Removes and discards the last element.",
      notes: ""
    },
    {
      name: "arraypush",
      aliases: [
        "arraypush"
      ],
      category: "arrays",
      argShape: "JSON_ARR::ELEM",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1258,
      summary: "Appends an element to the array.",
      notes: ""
    },
    {
      name: "arrayshift",
      aliases: [
        "arrayshift"
      ],
      category: "arrays",
      argShape: "JSON_ARR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1236,
      summary: "Removes and discards the first element; returns the modified JSON array.",
      notes: ""
    },
    {
      name: "arraysplice",
      aliases: [
        "arraysplice"
      ],
      category: "arrays",
      argShape: "JSON_ARR::START::DELETE_COUNT::NEW_ELEM",
      minArgs: 4,
      maxArgs: 4,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1269,
      summary: "Risu-style splice: (arr, start, deleteCount, newElement).",
      notes: ""
    },
    {
      name: "asset",
      aliases: [],
      category: "display",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2282,
      summary: "doc_only \u2014 stripped at prompt stage; rendered as character asset element at display.",
      notes: "Shim returns '' at prompt stage. Display-time HTML injection belongs to a Lumiverse renderer extension."
    },
    {
      name: "assetlist",
      aliases: [],
      category: "display",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1340,
      summary: "JSON array of additional asset names. '' for group characters.",
      notes: ""
    },
    {
      name: "audio",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2296,
      summary: "doc_only \u2014 audio asset NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "authornote",
      aliases: [
        "author_note"
      ],
      category: "logic",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 393,
      summary: "Returns the author's note for the current chat.",
      notes: ""
    },
    {
      name: "average",
      aliases: [],
      category: "other",
      argShape: "ARR or N1::N2::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1741,
      summary: "Arithmetic mean. Returns NaN on empty input.",
      notes: ""
    },
    {
      name: "axmodel",
      aliases: [],
      category: "identity",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 660,
      summary: "Returns the id of the auxiliary model.",
      notes: ""
    },
    {
      name: "bg",
      aliases: [],
      category: "display",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2303,
      summary: "doc_only \u2014 background image NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "bgm",
      aliases: [],
      category: "display",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2310,
      summary: "doc_only \u2014 background music NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "bkspc",
      aliases: [],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [
        "chatState"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2179,
      summary: "Risu rewinds the generated buffer by one word. No buffer in risu-compat \u2014 shim '' (deviation).",
      notes: ""
    },
    {
      name: "blank",
      aliases: [
        "none"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 435,
      summary: "Returns an empty string.",
      notes: ""
    },
    {
      name: "bo",
      aliases: [
        "ddecbo",
        "doubledisplayescapedcurlybracketopen"
      ],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1415,
      summary: "Displays as {{ (two PUA sentinels).",
      notes: ""
    },
    {
      name: "br",
      aliases: [
        "newline"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 641,
      summary: "Returns a literal newline character.",
      notes: ""
    },
    {
      name: "button",
      aliases: [],
      category: "other",
      argShape: "LABEL::TRIGGER",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 869,
      summary: 'HTML button with risu-trigger="TRIGGER" that fires the named manual trigger when clicked.',
      notes: ""
    },
    {
      name: "calc",
      aliases: [],
      category: "math",
      argShape: "EXPR",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "localVars",
        "globalVars"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "calc",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 801,
      summary: "Evaluates a math expression. Supports +, -, *, /, ^, %, and comparisons. $var reads a local chat var; @var reads a global chat var.",
      notes: ""
    },
    {
      name: "capitalize",
      aliases: [],
      category: "strings",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "capitalize",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1092,
      summary: "Uppercases only the first character of STR.",
      notes: ""
    },
    {
      name: "cbr",
      aliases: [
        "cnl",
        "cnewline"
      ],
      category: "other",
      argShape: "[N]",
      minArgs: 0,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1384,
      summary: "Emits literal '\\n' (backslash+n). Optional N repeats the sequence.",
      notes: ""
    },
    {
      name: "ceil",
      aliases: [],
      category: "math",
      argShape: "N",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "ceil",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1119,
      summary: "Rounds toward positive infinity (ceil).",
      notes: ""
    },
    {
      name: "char",
      aliases: [
        "bot"
      ],
      category: "character_fields",
      argShape: "UNCERTAIN",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "char",
        compatible: true,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 146,
      summary: "Returns the name or nickname of the current character/bot. In consistent charact",
      notes: ""
    },
    {
      name: "chardisplayasset",
      aliases: [],
      category: "character_fields",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1487,
      summary: "JSON array of display assets filtered by prebuiltAssetExclude. Empty when prebuiltAssetCommand is off.",
      notes: ""
    },
    {
      name: "charhistory",
      aliases: [
        "charmessages",
        "char_history"
      ],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 354,
      summary: "JSON array of all assistant/character messages. role normalized to Risu's 'char'.",
      notes: ""
    },
    {
      name: "chatindex",
      aliases: [
        "chat_index"
      ],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 415,
      summary: "Index of the current message being processed. Empty string outside a message context.",
      notes: ""
    },
    {
      name: "codeblock",
      aliases: [],
      category: "other",
      argShape: "[LANG::]CODE",
      minArgs: 1,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2159,
      summary: "Emits <pre><code>...</code></pre> or a highlight-ready placeholder when LANG is provided.",
      notes: ""
    },
    {
      name: "comment",
      aliases: [],
      category: "other",
      argShape: "TEXT",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "comment",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 2129,
      summary: "Emits '' in model prompt; renders as a <div> on display. Our runtime never hits display mode, so always returns ''.",
      notes: ""
    },
    {
      name: "contains",
      aliases: [],
      category: "other",
      argShape: "STR::NEEDLE",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1001,
      summary: "Returns '1' if STR contains NEEDLE anywhere.",
      notes: ""
    },
    {
      name: "crypt",
      aliases: [
        "crypto",
        "caesar",
        "encrypt",
        "decrypt"
      ],
      category: "other",
      argShape: "STR[::SHIFT]",
      minArgs: 1,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1973,
      summary: "Caesar-style Unicode shift cipher. Default SHIFT = 32768 (self-inverting over 16-bit code points).",
      notes: ""
    },
    {
      name: "date",
      aliases: [
        "datetimeformat"
      ],
      category: "time",
      argShape: "[FMT[::UNIX_MS]]",
      minArgs: 0,
      maxArgs: 2,
      pure: false,
      readsState: [
        "time"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "date",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1563,
      summary: "No args \u2192 YYYY-M-D. First arg = format string. Second arg = unix ms.",
      notes: ""
    },
    {
      name: "decbo",
      aliases: [
        "displayescapedcurlybracketopen"
      ],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1397,
      summary: "Displays as { without re-parsing (PUA sentinel \\uE9B8).",
      notes: ""
    },
    {
      name: "declare",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2247,
      summary: "Sets a __declared_NAME__ marker in the temp scope (writable from later {{declared::NAME}} reads).",
      notes: ""
    },
    {
      name: "description",
      aliases: [
        "chardesc"
      ],
      category: "character_fields",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "description",
        compatible: true,
        notes: "Both return the equivalent character field; semantics match."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 252,
      summary: "Returns the description field of the current character. The text is processed th",
      notes: ""
    },
    {
      name: "dice",
      aliases: [],
      category: "random",
      argShape: "NdS",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "rng"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1826,
      summary: "Dice roll via NdS notation. Both numbers required \u2014 returns NaN otherwise.",
      notes: ""
    },
    {
      name: "dictelement",
      aliases: [
        "dictelement",
        "objectelement"
      ],
      category: "arrays",
      argShape: "JSON_OBJ::KEY",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1188,
      summary: "Returns dict[KEY] or 'null' if missing.",
      notes: ""
    },
    {
      name: "displayescapedanglebracketclose",
      aliases: [
        "deabc",
        ">"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1460,
      summary: "Displays as > (PUA \\uE9BD).",
      notes: ""
    },
    {
      name: "displayescapedanglebracketopen",
      aliases: [
        "deabo",
        "<"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1451,
      summary: "Displays as < (PUA \\uE9BC).",
      notes: ""
    },
    {
      name: "displayescapedbracketclose",
      aliases: [
        "debc",
        ")"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1442,
      summary: "Displays as ) (PUA \\uE9BB).",
      notes: ""
    },
    {
      name: "displayescapedbracketopen",
      aliases: [
        "debo",
        "("
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1433,
      summary: "Displays as ( (PUA \\uE9BA).",
      notes: ""
    },
    {
      name: "displayescapedcolon",
      aliases: [
        "dec",
        ":"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1469,
      summary: "Displays as : without being parsed as a CBS separator (PUA \\uE9BE).",
      notes: ""
    },
    {
      name: "displayescapedsemicolon",
      aliases: [
        ";"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1478,
      summary: "Displays as ; (PUA \\uE9BF).",
      notes: ""
    },
    {
      name: "element",
      aliases: [
        "ele"
      ],
      category: "arrays",
      argShape: "JSON::KEY1[::KEY2\u2026]",
      minArgs: 2,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1211,
      summary: "Walks a JSON structure by successive keys/indices; returns 'null' if any step fails.",
      notes: ""
    },
    {
      name: "emotion",
      aliases: [],
      category: "display",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2289,
      summary: "doc_only \u2014 emotion image NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "emotionlist",
      aliases: [],
      category: "display",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1324,
      summary: "JSON array of emotion image names for the current character.",
      notes: ""
    },
    {
      name: "endswith",
      aliases: [],
      category: "other",
      argShape: "STR::SUFFIX",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 992,
      summary: "Returns '1' if STR ends with SUFFIX.",
      notes: ""
    },
    {
      name: "equal",
      aliases: [],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 889,
      summary: "Returns '1' if A === B (string compare), else '0'.",
      notes: ""
    },
    {
      name: "erase",
      aliases: [],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [
        "chatState"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2211,
      summary: "Risu rewinds the generated buffer by one sentence. Shim '' (deviation).",
      notes: ""
    },
    {
      name: "exampledialogue",
      aliases: [
        "examplemessage",
        "example_dialogue"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 283,
      summary: "Returns the example dialogue/message field of the current character.",
      notes: ""
    },
    {
      name: "file",
      aliases: [],
      category: "other",
      argShape: "NAME::BASE64",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 970,
      summary: "Decodes base64 file content to UTF-8 for inclusion in the model prompt. (Risu's display mode returns an HTML div; renderer-only \u2014 not ported.)",
      notes: ""
    },
    {
      name: "filter",
      aliases: [],
      category: "other",
      argShape: "JSON_ARR::MODE",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1639,
      summary: "Filters a JSON array. MODE = 'all' (unique + non-empty), 'nonempty', or 'unique'.",
      notes: ""
    },
    {
      name: "firstmsgindex",
      aliases: [
        "firstmessageindex",
        "first_msg_index"
      ],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 424,
      summary: "Index of the selected first-message/alternate-greeting. Always '0' in our model.",
      notes: ""
    },
    {
      name: "fixnum",
      aliases: [
        "fixnum",
        "fixnumber"
      ],
      category: "other",
      argShape: "N::DIGITS",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1758,
      summary: "Rounds N to DIGITS decimal places (via toFixed).",
      notes: ""
    },
    {
      name: "floor",
      aliases: [],
      category: "math",
      argShape: "N",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "floor",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1110,
      summary: "Rounds toward negative infinity (floor).",
      notes: ""
    },
    {
      name: "fromhex",
      aliases: [],
      category: "escape_markup",
      argShape: "HEX",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1845,
      summary: "Converts a hex string to its decimal representation.",
      notes: ""
    },
    {
      name: "getglobalvar",
      aliases: [],
      category: "variables",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "globalVars"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 860,
      summary: "Reads a global (cross-chat) variable.",
      notes: ""
    },
    {
      name: "getvar",
      aliases: [],
      category: "variables",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "localVars"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "getvar",
        compatible: true,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 792,
      summary: "Reads a chat-scoped variable. Empty string if unset.",
      notes: ""
    },
    {
      name: "globalnote",
      aliases: [
        "globalnote",
        "systemnote",
        "ujb"
      ],
      category: "logic",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 383,
      summary: "Returns the global note / system note / ujb appended to prompts.",
      notes: ""
    },
    {
      name: "greater",
      aliases: [],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "greater",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 907,
      summary: "Returns '1' if Number(A) > Number(B).",
      notes: ""
    },
    {
      name: "greaterequal",
      aliases: [
        "greater_equal"
      ],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 925,
      summary: "Returns '1' if Number(A) >= Number(B).",
      notes: ""
    },
    {
      name: "hash",
      aliases: [],
      category: "other",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1803,
      summary: "Deterministic 7-digit hash of the input string.",
      notes: ""
    },
    {
      name: "hiddenkey",
      aliases: [],
      category: "other",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2111,
      summary: "Activates lorebook entries by keyword but emits nothing \u2014 returns the empty string.",
      notes: ""
    },
    {
      name: "history",
      aliases: [
        "messages"
      ],
      category: "chat_context",
      argShape: "[role]",
      minArgs: 0,
      maxArgs: 1,
      pure: false,
      readsState: [
        "messages",
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1511,
      summary: "No args \u2192 full JSON history with first-greeting prepended. Arg 'role' \u2192 array of 'role: data' strings.",
      notes: ""
    },
    {
      name: "idleduration",
      aliases: [
        "idle_duration"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages",
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 604,
      summary: "HH:MM:SS since the last message.",
      notes: ""
    },
    {
      name: "image",
      aliases: [],
      category: "display",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2331,
      summary: "doc_only \u2014 image asset NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "img",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2338,
      summary: "doc_only \u2014 unstyled image asset NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "inlay",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2352,
      summary: "doc_only \u2014 unstyled inlay NAME (not sent to model). Stripped at prompt.",
      notes: ""
    },
    {
      name: "inlayed",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2359,
      summary: "doc_only \u2014 styled inlay NAME (not sent to model). Stripped at prompt.",
      notes: ""
    },
    {
      name: "inlayeddata",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2366,
      summary: "doc_only \u2014 styled inlay NAME (included in model request). Stripped at prompt in risu-compat.",
      notes: "Risu's implementation DOES include this in the model prompt. Our shim drops it; enable only when a display-adapter is wired."
    },
    {
      name: "iserror",
      aliases: [],
      category: "logic",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1937,
      summary: "Returns '1' if STR begins with 'error:' (case-insensitive).",
      notes: ""
    },
    {
      name: "isfirstmsg",
      aliases: [
        "isfirstmsg",
        "isfirstmessage"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 690,
      summary: "Returns 1 if the current context is the first greeting message, 0 otherwise.",
      notes: ""
    },
    {
      name: "isodate",
      aliases: [],
      category: "time",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 536,
      summary: "Returns the current UTC date in YYYY-M-D format (unpadded).",
      notes: ""
    },
    {
      name: "isotime",
      aliases: [],
      category: "time",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 526,
      summary: "Returns the current UTC time in H:M:S format.",
      notes: ""
    },
    {
      name: "jb",
      aliases: [
        "jailbreak"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 373,
      summary: "Returns the jailbreak prompt text.",
      notes: ""
    },
    {
      name: "jbtoggled",
      aliases: [],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 702,
      summary: "'1' iff the global jailbreak toggle is on.",
      notes: ""
    },
    {
      name: "join",
      aliases: [],
      category: "other",
      argShape: "JSON_ARR::DELIM",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "join",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1028,
      summary: "Joins a JSON array with DELIM.",
      notes: ""
    },
    {
      name: "lastmessage",
      aliases: [],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "lastmessage",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 722,
      summary: "Content of the most recent message in the chat (any role). '' if empty.",
      notes: ""
    },
    {
      name: "lastmessageid",
      aliases: [
        "lastmessageindex"
      ],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "lastmessageid",
        compatible: false,
        notes: "Risu: chat.message[].length - 1 (greeting excluded) \u2192 -1 on greeting-only. Lumi: messages.length - 1 (greeting included as msg 0) \u2192 0 on greeting-only. Card-level literal comparisons like {{equal::lastmessageid::-1}} require the compatibility evaluator's Risu-frame handler."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 737,
      summary: "Index of the last message (count-1) or '' if empty.",
      notes: ""
    },
    {
      name: "length",
      aliases: [],
      category: "other",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "length",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1055,
      summary: "Returns the character length of STR.",
      notes: ""
    },
    {
      name: "less",
      aliases: [],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 916,
      summary: "Returns '1' if Number(A) < Number(B).",
      notes: ""
    },
    {
      name: "lessequal",
      aliases: [
        "less_equal"
      ],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 934,
      summary: "Returns '1' if Number(A) <= Number(B).",
      notes: ""
    },
    {
      name: "lorebook",
      aliases: [
        "worldinfo"
      ],
      category: "logic",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 317,
      summary: "JSON array of all active lorebook entries (character + chat + module lore).",
      notes: ""
    },
    {
      name: "lower",
      aliases: [],
      category: "strings",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "lower",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1074,
      summary: "Locale-aware lowercase.",
      notes: ""
    },
    {
      name: "mainprompt",
      aliases: [
        "systemprompt",
        "main_prompt"
      ],
      category: "other",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 308,
      summary: "Returns the system/main prompt for the current character.",
      notes: ""
    },
    {
      name: "makearray",
      aliases: [
        "array",
        "a",
        "makearray"
      ],
      category: "arrays",
      argShape: "E1::E2::\u2026",
      minArgs: 0,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1294,
      summary: "Creates a JSON array from the given arguments.",
      notes: ""
    },
    {
      name: "makedict",
      aliases: [
        "dict",
        "d",
        "makedict",
        "makeobject",
        "object",
        "o"
      ],
      category: "other",
      argShape: "K1::V1[::K2::V2\u2026]",
      minArgs: 0,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1303,
      summary: "Creates a JSON object from interleaved key-value arguments. Note: Risu's built-in parses 'key=value' strings; our port accepts separate args \u2014 behavior documented.",
      notes: "Risu's upstream makedict parses each arg as 'key=value'. Our port accepts alternating key/value args (pair-wise), which matches the risu-compat handler."
    },
    {
      name: "max",
      aliases: [],
      category: "math",
      argShape: "ARR or N1::N2::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "max",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1709,
      summary: "Largest numeric value. Accepts a JSON array or multiple args.",
      notes: ""
    },
    {
      name: "maxcontext",
      aliases: [],
      category: "math",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 712,
      summary: "Max context token limit for the active model, as a decimal string.",
      notes: ""
    },
    {
      name: "messagedate",
      aliases: [
        "message_date"
      ],
      category: "chat_context",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages",
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 469,
      summary: "Local date the current message was sent.",
      notes: ""
    },
    {
      name: "messageidleduration",
      aliases: [
        "message_idle_duration"
      ],
      category: "chat_context",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages",
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 547,
      summary: "HH:MM:SS between the current and previous user message.",
      notes: ""
    },
    {
      name: "messagetime",
      aliases: [
        "message_time"
      ],
      category: "chat_context",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages",
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 445,
      summary: "Local time the current message was sent.",
      notes: ""
    },
    {
      name: "messageunixtimearray",
      aliases: [
        "message_unixtime_array"
      ],
      category: "chat_context",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 492,
      summary: "JSON array of all message unix timestamps.",
      notes: ""
    },
    {
      name: "metadata",
      aliases: [],
      category: "other",
      argShape: "KEY",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1863,
      summary: "Host metadata. Supported: imateapot, mobile/local/node, risutype, modelname/modelshortname/modelinternalid, version, majorversion/majorver/major, maxcontext, language/locale/lang, browserlanguage/browserlocale/browserlang. Unsupported (still error): modelformat, modelprovider, modeltokenizer.",
      notes: ""
    },
    {
      name: "min",
      aliases: [],
      category: "math",
      argShape: "ARR or N1::N2::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "min",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1693,
      summary: "Smallest numeric value. Accepts a JSON array or multiple args; non-numeric values treated as 0.",
      notes: ""
    },
    {
      name: "model",
      aliases: [],
      category: "identity",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "model",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 650,
      summary: "Returns the id of the currently selected AI model.",
      notes: ""
    },
    {
      name: "moduleassetlist",
      aliases: [
        "module_assetlist"
      ],
      category: "display",
      argShape: "NAMESPACE",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1622,
      summary: "JSON array of module asset names for NAMESPACE. Empty without module state.",
      notes: ""
    },
    {
      name: "moduleenabled",
      aliases: [
        "module_enabled"
      ],
      category: "other",
      argShape: "NAMESPACE",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1607,
      summary: "Returns '1' if module NAMESPACE is loaded, else '0'. Our ctx has no module state \u2014 always '0'.",
      notes: ""
    },
    {
      name: "not",
      aliases: [],
      category: "logic",
      argShape: "A",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "not",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 961,
      summary: "Boolean NOT: '1' \u2192 '0'; any other value \u2192 '1'.",
      notes: ""
    },
    {
      name: "notequal",
      aliases: [
        "not_equal"
      ],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 898,
      summary: "Returns '1' if A !== B, else '0'.",
      notes: ""
    },
    {
      name: "objectassert",
      aliases: [
        "dictassert",
        "object_assert"
      ],
      category: "other",
      argShape: "JSON_OBJ::KEY::VALUE",
      minArgs: 3,
      maxArgs: 3,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1198,
      summary: "Sets obj[KEY]=VALUE only if KEY is missing/falsy.",
      notes: ""
    },
    {
      name: "or",
      aliases: [],
      category: "logic",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 952,
      summary: "Boolean OR: returns '1' if either arg is '1'.",
      notes: ""
    },
    {
      name: "path",
      aliases: [
        "raw"
      ],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2345,
      summary: "doc_only \u2014 asset URL lookup. Shim returns ''.",
      notes: ""
    },
    {
      name: "persona",
      aliases: [
        "userpersona"
      ],
      category: "character_fields",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "persona",
        compatible: true,
        notes: "Both return the equivalent character field; semantics match."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 298,
      summary: "Returns the user persona prompt text. The text is processed through the chat par",
      notes: ""
    },
    {
      name: "personality",
      aliases: [
        "charpersona"
      ],
      category: "character_fields",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "personality",
        compatible: true,
        notes: "Both return the equivalent character field; semantics match."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 237,
      summary: "Returns the personality field of the current character. The text is processed th",
      notes: ""
    },
    {
      name: "pick",
      aliases: [],
      category: "random",
      argShape: "[ARR or E1::E2::\u2026]",
      minArgs: 0,
      maxArgs: -1,
      pure: false,
      readsState: [
        "rng",
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2033,
      summary: "Hash-deterministic pick seeded by message count + character name. Same inputs at same chat position return the same element.",
      notes: ""
    },
    {
      name: "position",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2497,
      summary: "doc_only \u2014 @@position decorator marker. Shim returns ''.",
      notes: ""
    },
    {
      name: "pow",
      aliases: [],
      category: "math",
      argShape: "BASE::EXP",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1169,
      summary: "Returns BASE raised to EXP (Math.pow).",
      notes: ""
    },
    {
      name: "prefillsupported",
      aliases: [
        "prefill_supported",
        "prefill"
      ],
      category: "logic",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1356,
      summary: "'1' if the active model id starts with 'claude', else '0'.",
      notes: ""
    },
    {
      name: "previouscharchat",
      aliases: [
        "previouscharchat",
        "lastcharmessage"
      ],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages",
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 194,
      summary: "Last assistant message prior to currentMessageIndex; first-greeting fallback.",
      notes: ""
    },
    {
      name: "previouschatlog",
      aliases: [
        "previous_chat_log"
      ],
      category: "chat_context",
      argShape: "INDEX",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1146,
      summary: "Returns message[INDEX].content or 'Out of range' if invalid.",
      notes: ""
    },
    {
      name: "previoususerchat",
      aliases: [
        "previoususerchat",
        "lastusermessage"
      ],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages",
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 213,
      summary: "Last user message prior to currentMessageIndex. '' if currentMessageIndex=null.",
      notes: ""
    },
    {
      name: "randint",
      aliases: [],
      category: "logic",
      argShape: "MIN::MAX",
      minArgs: 2,
      maxArgs: 2,
      pure: false,
      readsState: [
        "rng"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1812,
      summary: "Uniform random integer in [MIN, MAX] inclusive.",
      notes: ""
    },
    {
      name: "random",
      aliases: [],
      category: "logic",
      argShape: "[ARR or E1::E2::\u2026]",
      minArgs: 0,
      maxArgs: -1,
      pure: false,
      readsState: [
        "rng"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "random",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 2024,
      summary: "No args \u2192 random [0,1). One array arg \u2192 picks a random element. Multiple args \u2192 picks one.",
      notes: ""
    },
    {
      name: "range",
      aliases: [],
      category: "other",
      argShape: "JSON_ARR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1544,
      summary: "Creates a range. [N] \u2192 [0..N-1]. [A,B] \u2192 [A..B-1]. [A,B,S] \u2192 step S.",
      notes: ""
    },
    {
      name: "remaind",
      aliases: [],
      category: "other",
      argShape: "A::B",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1137,
      summary: "Returns A mod B (JavaScript % operator).",
      notes: ""
    },
    {
      name: "replace",
      aliases: [],
      category: "strings",
      argShape: "STR::NEEDLE::REPL",
      minArgs: 3,
      maxArgs: 3,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "replace",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1010,
      summary: "Replaces all occurrences of NEEDLE in STR with REPL (case-sensitive, global).",
      notes: ""
    },
    {
      name: "return",
      aliases: [],
      category: "flow_control",
      argShape: "VALUE",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 778,
      summary: "Risu sets __force_return__ to halt parsing and returns VALUE. Our port emits VALUE in place; known deviation.",
      notes: ""
    },
    {
      name: "reverse",
      aliases: [],
      category: "other",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2120,
      summary: "Reverses a string (code-point safe via spread/join).",
      notes: ""
    },
    {
      name: "risu",
      aliases: [],
      category: "other",
      argShape: "[SIZE]",
      minArgs: 0,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 878,
      summary: "Embeds the RisuAI logo <img> at SIZE px (default 45).",
      notes: ""
    },
    {
      name: "role",
      aliases: [],
      category: "identity",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 670,
      summary: "Returns the role of the current message (user, char, system), or literal null when unknown.",
      notes: ""
    },
    {
      name: "roll",
      aliases: [],
      category: "random",
      argShape: "[NdS|S]",
      minArgs: 0,
      maxArgs: 1,
      pure: false,
      readsState: [
        "rng"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "roll",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 2047,
      summary: "Dice roll. 'XdY' syntax; default 1d6 when no arg. Returns NaN on invalid notation.",
      notes: ""
    },
    {
      name: "rollp",
      aliases: [
        "rollpick"
      ],
      category: "random",
      argShape: "[NdS|S]",
      minArgs: 0,
      maxArgs: 1,
      pure: false,
      readsState: [
        "rng",
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2076,
      summary: "Hash-deterministic dice roll. Same chat position returns the same outcome.",
      notes: ""
    },
    {
      name: "round",
      aliases: [],
      category: "math",
      argShape: "N",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "round",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1101,
      summary: "Rounds a decimal number to the nearest integer (half-up).",
      notes: ""
    },
    {
      name: "ruby",
      aliases: [
        "furigana"
      ],
      category: "other",
      argShape: "BASE::READING",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2150,
      summary: "Emits <ruby>...<rt>...</rt></ruby> furigana HTML.",
      notes: ""
    },
    {
      name: "scenario",
      aliases: [],
      category: "character_fields",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "characterFields"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "scenario",
        compatible: true,
        notes: "Both return the equivalent character field; semantics match."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 267,
      summary: "Returns the scenario field of the current character. The text is processed throu",
      notes: ""
    },
    {
      name: "screenheight",
      aliases: [
        "screen_height"
      ],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1375,
      summary: "Window height in pixels. No host introspection \u2014 always '0'.",
      notes: ""
    },
    {
      name: "screenwidth",
      aliases: [
        "screen_width"
      ],
      category: "other",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1366,
      summary: "Window width in pixels. No host introspection in risu-compat \u2014 always '0' (known deviation).",
      notes: ""
    },
    {
      name: "setdefaultvar",
      aliases: [],
      category: "variables",
      argShape: "NAME::VALUE",
      minArgs: 2,
      maxArgs: 2,
      pure: false,
      readsState: [
        "localVars"
      ],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 842,
      summary: "Sets NAME=VALUE only if NAME is currently unset or empty.",
      notes: ""
    },
    {
      name: "settempvar",
      aliases: [],
      category: "variables",
      argShape: "NAME::VALUE",
      minArgs: 2,
      maxArgs: 2,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 765,
      summary: "Sets a per-evaluation temporary variable.",
      notes: ""
    },
    {
      name: "setvar",
      aliases: [],
      category: "variables",
      argShape: "NAME::VALUE",
      minArgs: 2,
      maxArgs: 2,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: {
        name: "setvar",
        compatible: true,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 826,
      summary: "Sets a chat-scoped variable.",
      notes: ""
    },
    {
      name: "slot",
      aliases: [],
      category: "other",
      argShape: "VAR",
      minArgs: 0,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2490,
      summary: "Iteration/func slot reference. Resolved inside each/call block handlers via string substitution.",
      notes: ""
    },
    {
      name: "source",
      aliases: [],
      category: "other",
      argShape: "user|char",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2373,
      summary: "doc_only \u2014 avatar URL for 'user' or 'char'. Shim returns ''.",
      notes: ""
    },
    {
      name: "split",
      aliases: [],
      category: "other",
      argShape: "STR::DELIM",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "split",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1019,
      summary: "Splits STR by DELIM; returns a JSON array.",
      notes: ""
    },
    {
      name: "spread",
      aliases: [],
      category: "other",
      argShape: "JSON_ARR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1037,
      summary: "Joins a JSON array with '::' (CBS argument separator).",
      notes: ""
    },
    {
      name: "startswith",
      aliases: [],
      category: "other",
      argShape: "STR::PREFIX",
      minArgs: 2,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 983,
      summary: "Returns '1' if STR starts with PREFIX (case-sensitive).",
      notes: ""
    },
    {
      name: "sum",
      aliases: [],
      category: "math",
      argShape: "ARR or N1::N2::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1725,
      summary: "Sum of numeric values. Accepts a JSON array or multiple args.",
      notes: ""
    },
    {
      name: "tempvar",
      aliases: [
        "gettempvar"
      ],
      category: "variables",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "localVars"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 753,
      summary: "Reads a per-evaluation temporary variable.",
      notes: "Risu stores temp vars in a `vars` dict that lives for a single parser pass. Our context implements them as the 'temp' scope of ctx.vars."
    },
    {
      name: "tex",
      aliases: [
        "latex",
        "katex"
      ],
      category: "other",
      argShape: "EXPR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2141,
      summary: "Wraps EXPR in $$...$$ for KaTeX rendering.",
      notes: ""
    },
    {
      name: "time",
      aliases: [],
      category: "time",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "time"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "time",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 516,
      summary: "Returns the current local time in H:M:S format (unpadded).",
      notes: ""
    },
    {
      name: "tohex",
      aliases: [],
      category: "escape_markup",
      argShape: "N",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1854,
      summary: "Converts a decimal number to a hex string.",
      notes: ""
    },
    {
      name: "tonumber",
      aliases: [],
      category: "other",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1158,
      summary: "Extracts digits and decimal points from a string (drops everything else).",
      notes: ""
    },
    {
      name: "trigger_id",
      aliases: [
        "triggerid"
      ],
      category: "identity",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 184,
      summary: "Returns the ID value from the risu-id attribute of the clicked element that trig",
      notes: ""
    },
    {
      name: "trim",
      aliases: [],
      category: "strings",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1046,
      summary: "Removes leading and trailing whitespace.",
      notes: ""
    },
    {
      name: "u",
      aliases: [
        "unicodedecodefromhex"
      ],
      category: "other",
      argShape: "HEX",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1785,
      summary: "Returns the character for a hex Unicode code point.",
      notes: ""
    },
    {
      name: "ue",
      aliases: [
        "unicodeencodefromhex"
      ],
      category: "other",
      argShape: "HEX",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1794,
      summary: "Alias of {{u}}.",
      notes: ""
    },
    {
      name: "unicodedecode",
      aliases: [
        "unicode_decode"
      ],
      category: "escape_markup",
      argShape: "CODE",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1776,
      summary: "Converts a decimal Unicode code point to its character.",
      notes: ""
    },
    {
      name: "unicodeencode",
      aliases: [
        "unicode_encode"
      ],
      category: "escape_markup",
      argShape: "STR[::INDEX]",
      minArgs: 1,
      maxArgs: 2,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1767,
      summary: "Returns the Unicode code point of STR[INDEX] (default 0) as decimal.",
      notes: ""
    },
    {
      name: "unixtime",
      aliases: [],
      category: "time",
      argShape: "no args",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "time"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 506,
      summary: "Returns the current unix timestamp in seconds.",
      notes: ""
    },
    {
      name: "upper",
      aliases: [],
      category: "strings",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "upper",
        compatible: false,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 1083,
      summary: "Locale-aware uppercase.",
      notes: ""
    },
    {
      name: "user",
      aliases: [],
      category: "identity",
      argShape: "UNCERTAIN",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [],
      writesState: [],
      lumiverseCollision: {
        name: "user",
        compatible: true,
        notes: ""
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 172,
      summary: "Returns the current user\\",
      notes: ""
    },
    {
      name: "userhistory",
      aliases: [
        "usermessages",
        "user_history"
      ],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 336,
      summary: "JSON array of all user messages with role='user'.",
      notes: ""
    },
    {
      name: "video",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2317,
      summary: "doc_only \u2014 video asset NAME. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "video-img",
      aliases: [],
      category: "other",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2324,
      summary: "doc_only \u2014 video rendered as image. Stripped at prompt stage.",
      notes: ""
    },
    {
      name: "xor",
      aliases: [
        "xorencrypt",
        "xorencode",
        "xore"
      ],
      category: "logic",
      argShape: "STR",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1947,
      summary: "XOR-encrypts STR with 0xFF and base64-encodes the result.",
      notes: ""
    },
    {
      name: "xordecrypt",
      aliases: [
        "xordecode",
        "xord"
      ],
      category: "logic",
      argShape: "B64",
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1960,
      summary: "Inverse of {{xor}} \u2014 decodes base64 + XOR with 0xFF.",
      notes: ""
    },
    {
      name: "#func",
      aliases: [
        "#function"
      ],
      category: "control_flow",
      argShape: "funcName arg0 arg1 ... + body",
      minArgs: 1,
      maxArgs: -1,
      pure: false,
      readsState: [],
      writesState: [
        "chatState"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1400,
      summary: "Defines a named function. The body is stored and invoked later via {{call::funcName::\u2026}}.",
      notes: "Deviation: function table is Lumiscript-session scoped, not per-evaluation pass like Risu."
    },
    {
      name: "call",
      aliases: [],
      category: "flow_control",
      argShape: "funcName::arg0::arg1::\u2026",
      minArgs: 1,
      maxArgs: -1,
      pure: false,
      readsState: [
        "chatState"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1737,
      summary: "Invokes a function previously defined by #func. Arguments are passed as additional :: tokens; referenced inside the function body as {{arg::0}}, {{arg::1}}, etc.",
      notes: "Known deviation: inner macros in the function body are not re-evaluated after substitution."
    },
    {
      name: "legacy",
      aliases: [],
      category: "control_flow",
      argShape: `{#if cond
content#} expression`,
      minArgs: 1,
      maxArgs: 1,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/parser/parser.svelte.ts",
      risuLine: 1082,
      summary: `Legacy {#if cond
content#} form. Returns trimmed content if cond is not the empty string, 0, or -1.`,
      notes: "Deprecated Risu form; preserved for compatibility."
    },
    {
      name: "deletevar",
      aliases: [],
      category: "variables",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/process/triggers.ts",
      risuLine: 1,
      summary: "Deletes a chat-scoped variable. Exposed via Risu's editCharVar trigger op \u2014 shim in risu-compat.",
      notes: "Not a cbs.ts registerFunction; exists as a trigger effect in Risu. Added so triggers that compile into {{deletevar::X}} macro calls survive the discipline gate."
    },
    {
      name: "flushvar",
      aliases: [],
      category: "variables",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: null,
      risuFile: "src/ts/process/triggers.ts",
      risuLine: 1,
      summary: "Alias of deletevar. Name matches older Risu trigger-compiler output.",
      notes: "Synthetic alias; see deletevar."
    },
    {
      name: "getchatvar",
      aliases: [],
      category: "variables",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "localVars"
      ],
      writesState: [],
      lumiverseCollision: {
        name: "getchatvar",
        compatible: false,
        notes: "Lumiverse getchatvar uses a distinct chat scope; Risu only has one chat scope so our shim aliases to local."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 792,
      summary: "Reads a chat-scoped variable. Aliased to getvar in Risu's single-chat-scope model.",
      notes: "Synthetic; Risu has no separate chat-scope. Provided for parity with Lumiverse's getchatvar."
    },
    {
      name: "setchatvar",
      aliases: [],
      category: "variables",
      argShape: "NAME::VALUE",
      minArgs: 2,
      maxArgs: 2,
      pure: false,
      readsState: [],
      writesState: [
        "localVars"
      ],
      lumiverseCollision: {
        name: "setchatvar",
        compatible: false,
        notes: "See getchatvar."
      },
      risuFile: "src/ts/cbs.ts",
      risuLine: 826,
      summary: "Sets a chat-scoped variable. Aliased to setvar.",
      notes: "Synthetic; see getchatvar."
    },
    {
      name: "bc",
      aliases: [
        "ddecbc",
        "doubledisplayescapedcurlybracketclose"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1424,
      summary: "Displays as }} without being re-parsed (two PUA sentinels).",
      notes: ""
    },
    {
      name: "decbc",
      aliases: [
        "displayescapedcurlybracketclose"
      ],
      category: "escape_markup",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: true,
      readsState: [],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1406,
      summary: "Displays as } without being re-parsed (PUA \\uE9B9).",
      notes: ""
    },
    {
      name: "messagecount",
      aliases: [],
      category: "chat_context",
      argShape: "(no args)",
      minArgs: 0,
      maxArgs: 0,
      pure: false,
      readsState: [
        "messages"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 1,
      summary: "Total number of messages in the chat as a string. Frequently synthesized in CBS templates.",
      notes: "Not registered in Risu's cbs.ts as a named function; many cards use it via script."
    },
    {
      name: "declared",
      aliases: [],
      category: "metadata",
      argShape: "NAME",
      minArgs: 1,
      maxArgs: 1,
      pure: false,
      readsState: [
        "localVars"
      ],
      writesState: [],
      lumiverseCollision: null,
      risuFile: "src/ts/cbs.ts",
      risuLine: 2247,
      summary: "Reads a declaration marker set by {{declare::NAME}}; returns '1' if declared else '0'.",
      notes: "Risu implements this implicitly via var checks; we expose it as a dedicated handler for clarity."
    }
  ];
});

// src/interpreter/evaluator/builtins.ts
function parseUTCOffset(s) {
  const m = /^UTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(s.trim());
  if (!m)
    return null;
  const sign = m[1] === "-" ? -1 : 1;
  const h = parseInt(m[2], 10);
  const mm = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (h + mm / 60);
}
function registerBuiltins(register13) {
  register13("bot", (ctx) => ctx.identity.charName, false);
  register13("user", (ctx) => ctx.identity.userName, false);
  register13("char", (ctx) => ctx.identity.charName, false);
  register13("charname", (ctx) => ctx.identity.charName, false);
  register13("notchar", (ctx) => ctx.identity.userName, false);
  register13("not_char", (ctx) => ctx.identity.userName, false);
  register13("newline", () => `
`, false);
  register13("nl", () => `
`, false);
  register13("n", () => `
`, false);
  register13("space", () => " ", false);
  register13("noop", () => "", false);
  register13("//", () => "", false);
  register13("comment", () => "", false);
  register13("note", () => "", false);
  register13("upper", (_ctx, a) => (a[0] ?? "").toUpperCase(), false);
  register13("uppercase", (_ctx, a) => (a[0] ?? "").toUpperCase(), false);
  register13("toupper", (_ctx, a) => (a[0] ?? "").toUpperCase(), false);
  register13("lower", (_ctx, a) => (a[0] ?? "").toLowerCase(), false);
  register13("lowercase", (_ctx, a) => (a[0] ?? "").toLowerCase(), false);
  register13("tolower", (_ctx, a) => (a[0] ?? "").toLowerCase(), false);
  register13("random", (ctx, a) => {
    if (a.length === 0)
      return String(Math.round(ctx.rng.random()));
    const allNumeric = a.length <= 2 && a.every((x) => x.trim() !== "" && !isNaN(Number(x)));
    if (allNumeric) {
      const min = parseInt(a[0] ?? "", 10) || 0;
      const max = parseInt(a[1] ?? "", 10) || 1;
      if (max < min)
        return String(min);
      return String(Math.floor(ctx.rng.random() * (max - min + 1)) + min);
    }
    const idx = Math.floor(ctx.rng.random() * a.length);
    return a[idx] ?? "";
  }, false);
  register13("roll", (ctx, a) => {
    const notation = a[0] ?? "1d6";
    const match = /^(\d+)d(\d+)$/i.exec(notation);
    if (!match)
      return "0";
    const count = Math.min(parseInt(match[1], 10), 100);
    const sides = parseInt(match[2], 10);
    if (sides < 1 || count < 1)
      return "0";
    let total = 0;
    for (let i = 0;i < count; i++)
      total += Math.floor(ctx.rng.random() * sides) + 1;
    return String(total);
  }, false);
  register13("time", (ctx, a) => {
    const offset = a[0];
    const now = new Date(ctx.clock.now());
    if (offset) {
      const parsed = parseUTCOffset(offset);
      if (parsed !== null) {
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const shifted = new Date(utc + parsed * 3600000);
        return shifted.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      }
    }
    return now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }, false);
  register13("jailbreak", (ctx) => ctx.character.jailbreakPrompt ?? "", false);
  register13("charjailbreak", (ctx) => ctx.character.jailbreakPrompt ?? "", false);
}

// src/interpreter/evaluator/dispatch.ts
function strip(name) {
  return normalizeMacroName(name);
}
function registerInto(name, handler, scoped) {
  const key = strip(name);
  if (!key)
    return;
  if (!table.has(key)) {
    table.set(key, { handler, scoped, name });
  }
}
function init() {
  if (initialised)
    return;
  initialised = true;
  for (const reg of registry.entries()) {
    registerInto(reg.name, reg.handler, reg.scoped);
  }
  try {
    const catalog2 = new CatalogIndex(parseCatalog(risu_macros_default));
    for (const entry of catalog2.entries) {
      if (!entry.aliases || entry.aliases.length === 0)
        continue;
      const canonicalKey = strip(entry.name);
      const primary = table.get(canonicalKey);
      if (!primary)
        continue;
      for (const alias of entry.aliases) {
        if (typeof alias !== "string" || alias.length === 0)
          continue;
        registerInto(alias, primary.handler, primary.scoped);
      }
    }
  } catch {}
  registerBuiltins((name, handler, scoped) => {
    registerInto(name, handler, scoped);
  });
}
function lookup(name) {
  if (!initialised)
    init();
  return table.get(strip(name)) ?? null;
}
var table, initialised = false;
var init_dispatch = __esm(() => {
  init_handlers();
  init_registry();
  init_cbs();
  init_risu_macros();
  table = new Map;
});

// src/interpreter/evaluator/scanner.ts
var exports_scanner = {};
__export(exports_scanner, {
  risuEscape: () => risuEscape,
  normalizeMacroName: () => normalizeMacroName,
  evaluate: () => evaluate
});
function splitMacroArgs(payload) {
  const colon = payload.indexOf(":");
  let parts;
  if (colon !== -1 && payload[colon + 1] === ":") {
    parts = payload.split("::");
  } else {
    parts = payload.split(":");
  }
  return { name: parts[0] ?? "", args: parts.slice(1) };
}
function tryCalcShortcut(payload, ctx) {
  if (!payload.startsWith("? "))
    return null;
  const expr = payload.substring(2);
  const entry = lookup("calc");
  if (!entry)
    return null;
  try {
    return entry.handler(ctx, [expr], "calc::" + expr);
  } catch {
    return null;
  }
}
function dispatchLeaf(payload, ctx, callStack) {
  const calc = tryCalcShortcut(payload, ctx);
  if (calc !== null)
    return calc;
  const { name, args } = splitMacroArgs(payload);
  const entry = lookup(name);
  if (!entry)
    return null;
  try {
    const result = entry.handler(ctx, args, payload);
    if (typeof result === "string" && result.includes("{{") && result !== `{{${payload}}}`) {
      return evaluate(result, ctx, { callStack });
    }
    return result;
  } catch {
    return null;
  }
}
function rewindLastWord(root) {
  if (!root)
    return root;
  const trimmed = root.trimEnd();
  let trimPointer = trimmed.length - 1;
  for (;trimPointer >= 0; trimPointer--) {
    const char = trimmed[trimPointer];
    if (trimPointer === 0 || char === " " || char === `
` || char === "\t")
      break;
  }
  if (trimPointer === -1)
    trimPointer = 0;
  return trimmed.substring(0, trimPointer).trimEnd();
}
function rewindLastSentence(root) {
  if (!root)
    return root;
  const trimmed = root.trimEnd();
  let trimPointer = trimmed.length - 1;
  let sentenceEndFound = false;
  for (;trimPointer >= 0; trimPointer--) {
    const char = trimmed[trimPointer];
    if (char === "." || char === "!" || char === "?" || char === `
`) {
      sentenceEndFound = true;
      break;
    }
    if (trimPointer === 0)
      break;
  }
  if (trimPointer === -1)
    trimPointer = 0;
  else if (sentenceEndFound)
    trimPointer += 1;
  return trimmed.substring(0, trimPointer).trimEnd();
}
function evaluate(template, ctx, opts = {}) {
  const callStack = (opts.callStack ?? ctx.callStack ?? 0) + 1;
  if (callStack > CALL_STACK_LIMIT) {
    return "ERROR: Call stack limit reached";
  }
  const innerCtx = callStack === ctx.callStack ? ctx : Object.assign(Object.create(Object.getPrototypeOf(ctx) ?? null), ctx, {
    callStack
  });
  let da = template.replace(/<(user|char|bot)>/gi, "{{$1}}");
  let pointer = 0;
  const nested = [""];
  const stackType = new Array(512).fill(0);
  const pureModeNest = new Map;
  const blockNestType = new Map;
  const isPureMode = () => pureModeNest.size > 0;
  while (pointer < da.length) {
    const ch = da[pointer];
    switch (ch) {
      case "{": {
        if (da[pointer + 1] !== "{" && da[pointer + 1] !== "#") {
          nested[0] += ch;
          break;
        }
        pointer++;
        nested.unshift("");
        stackType[nested.length] = 1;
        break;
      }
      case "#": {
        if (da[pointer + 1] !== "}" || nested.length === 1 || stackType[nested.length] !== 1) {
          nested[0] += ch;
          break;
        }
        pointer++;
        const dat = nested.shift();
        const mc = legacyBlockMatcher(dat);
        nested[0] += mc ?? `{#${dat}#}`;
        break;
      }
      case "}": {
        if (da[pointer + 1] !== "}" || nested.length === 1 || stackType[nested.length] !== 1) {
          nested[0] += ch;
          break;
        }
        pointer++;
        const dat = nested.shift();
        if (dat.startsWith("#") || dat.startsWith(":")) {
          if (isPureMode()) {
            nested[0] += `{{${dat}}}`;
            if (dat !== ":else") {
              nested.unshift("");
              stackType[nested.length] = 6;
            }
            break;
          }
          const matchResult = blockStartMatcher(dat, innerCtx);
          if (matchResult.type === "nothing") {
            nested[0] += `{{${dat}}}`;
            break;
          }
          nested.unshift("");
          stackType[nested.length] = 5;
          blockNestType.set(nested.length, matchResult);
          if (matchResult.type === "ignore" || matchResult.type === "pure" || matchResult.type === "each" || matchResult.type === "function" || matchResult.type === "pure-display" || matchResult.type === "escape") {
            pureModeNest.set(nested.length, true);
          }
          break;
        }
        if (dat.startsWith("/") && !dat.startsWith("//")) {
          if (stackType[nested.length] === 5) {
            const blockType = blockNestType.get(nested.length);
            if (blockType.type === "ignore" || blockType.type === "pure" || blockType.type === "each" || blockType.type === "function" || blockType.type === "pure-display" || blockType.type === "escape") {
              pureModeNest.delete(nested.length);
            }
            blockNestType.delete(nested.length);
            const body = nested.shift();
            const matchResult = blockEndMatcher(body, blockType);
            if (blockType.type === "each") {
              const type2 = blockType.type2 ?? "";
              const asIndex = type2.lastIndexOf(" as ");
              let sub;
              let array;
              if (asIndex === -1) {
                const subind = type2.lastIndexOf(" ");
                if (subind === -1) {
                  break;
                }
                sub = type2.substring(subind + 1);
                array = parseArray(type2.substring(0, subind));
              } else {
                sub = type2.substring(asIndex + 4).trim();
                array = parseArray(type2.substring(0, asIndex));
              }
              let added = "";
              for (let i = 0;i < array.length; i++) {
                const v = array[i];
                const valueStr = typeof v === "string" ? v : JSON.stringify(v);
                added += matchResult.replaceAll(`{{slot::${sub}}}`, valueStr);
              }
              const toInsert = blockType.mode === "keep" ? added : added.trim();
              da = da.substring(0, pointer + 1) + toInsert + da.substring(pointer + 1);
              break;
            }
            if (blockType.type === "function") {
              const funcArg = blockType.funcArg ?? [];
              innerCtx.functions.define(funcArg[0] ?? "", matchResult, funcArg.slice(1));
              break;
            }
            if (blockType.type === "ignore") {
              break;
            }
            if (blockType.type === "pure-display") {
              nested[0] += matchResult.replaceAll("{{", "\\{\\{").replaceAll("}}", "\\}\\}");
              break;
            }
            if (matchResult === "")
              break;
            nested[0] += matchResult;
            break;
          }
          if (stackType[nested.length] === 6) {
            const sft = nested.shift();
            nested[0] += sft + `{{${dat}}}`;
            break;
          }
        }
        if (dat.startsWith("call::")) {
          if (callStack > CALL_STACK_LIMIT) {
            nested[0] += "ERROR: Call stack limit reached";
            break;
          }
          const argData = dat.split("::").slice(1);
          const funcName = argData[0] ?? "";
          const func = innerCtx.functions.get(funcName);
          if (func) {
            let data = func.body;
            for (let i = 0;i < argData.length; i++) {
              data = data.replaceAll(`{{arg::${i}}}`, argData[i] ?? "");
            }
            nested[0] += evaluate(data, innerCtx, { callStack });
            break;
          }
        }
        const leafName = normalizeMacroName(splitMacroArgs(dat).name);
        if (!isPureMode() && leafName === "bkspc") {
          nested[0] = rewindLastWord(nested[0] ?? "");
          break;
        }
        if (!isPureMode() && leafName === "erase") {
          nested[0] = rewindLastSentence(nested[0] ?? "");
          break;
        }
        const mc = isPureMode() ? null : dispatchLeaf(dat, innerCtx, callStack);
        if (mc == null) {
          nested[0] += `{{${dat}}}`;
        } else {
          nested[0] += mc;
        }
        if (innerCtx.vars.get("temp", "__force_return__") === "1") {
          const ret = innerCtx.vars.get("temp", "__return__") || "null";
          innerCtx.vars.delete("temp", "__force_return__");
          innerCtx.vars.delete("temp", "__return__");
          return ret;
        }
        break;
      }
      default:
        nested[0] += ch;
    }
    pointer++;
  }
  if (nested.length === 1) {
    return nested[0];
  }
  let result = "";
  while (nested.length > 1) {
    const dat = (stackType[nested.length] === 1 ? "{{" : "<") + nested.shift();
    result = dat + result;
  }
  return nested[0] + result;
}
var CALL_STACK_LIMIT = 20;
var init_scanner = __esm(() => {
  init_dispatch();
  init_cbs();
});

// src/interpreter/evaluator/pipeline.ts
init_scanner();
// spindle.json
var spindle_default = {
  version: "0.8.0",
  name: "LumiRealm",
  identifier: "lumirealm",
  author: "amousepad",
  github: "https://github.com/AMousePad/LumiRealm",
  homepage: "https://github.com/AMousePad/LumiRealm",
  description: "Bringing RisuRealm into Lumiverse",
  permissions: [
    "generation",
    "interceptor",
    "tools",
    "cors_proxy",
    "context_handler",
    "ephemeral_storage",
    "chat_mutation",
    "event_tracking",
    "ui_panels",
    "app_manipulation",
    "oauth",
    "characters",
    "chats",
    "world_books",
    "regex_scripts",
    "databanks",
    "personas",
    "presets",
    "push_notification",
    "image_gen",
    "images",
    "generation_parameters",
    "macro_interceptor",
    "web_search"
  ],
  requested_capabilities: [
    "base64_decode"
  ],
  entry_backend: "dist/backend.js",
  entry_frontend: "dist/frontend.js",
  minimum_lumiverse_version: "1.1.2",
  lumirealm: {
    risu_app_version: "2026.6.215",
    risu_language: "en-US"
  }
};

// src/interpreter/evaluator/context.ts
var RISU_APP_VERSION = spindle_default.lumirealm.risu_app_version;
var RISU_LANGUAGE = spindle_default.lumirealm.risu_language;
var spindleGlobal = typeof spindle !== "undefined" ? spindle : undefined;
function makeFunctionRegistry() {
  const table2 = new Map;
  return {
    define: (name, body, argNames) => {
      table2.set(name, { body, argNames });
    },
    get: (name) => table2.get(name) ?? null,
    delete: (name) => {
      table2.delete(name);
    },
    has: (name) => table2.has(name)
  };
}
var varOverlays = new Map;
var MAX_OVERLAYS = 100;
function getOverlay(chatId) {
  let overlay = varOverlays.get(chatId);
  if (!overlay) {
    if (varOverlays.size >= MAX_OVERLAYS) {
      let oldestKey = null;
      let oldestTouched = Infinity;
      for (const [k, v] of varOverlays) {
        if (v.lastTouched < oldestTouched) {
          oldestTouched = v.lastTouched;
          oldestKey = k;
        }
      }
      if (oldestKey)
        varOverlays.delete(oldestKey);
    }
    overlay = {
      local: new Map,
      global: new Map,
      chat: new Map,
      temp: new Map,
      lastTouched: Date.now()
    };
    varOverlays.set(chatId, overlay);
  }
  overlay.lastTouched = Date.now();
  return overlay;
}
function makeEphemeralOverlay() {
  return {
    local: new Map,
    global: new Map,
    chat: new Map,
    temp: new Map,
    lastTouched: 0
  };
}
var MSG_DEP_KEY = "__msg__";
function indexToCharacterAssets(index) {
  if (!index)
    return [];
  const out = [];
  for (const [name, entry] of Object.entries(index)) {
    for (const imageId of entry.imageIds) {
      out.push({
        name,
        src: `/api/v1/images/${imageId}`,
        ...entry.ext ? { ext: entry.ext } : {}
      });
    }
  }
  return out;
}
function buildEvaluatorContext(input) {
  const { chatId, commit, character: card, chat, variables } = input;
  const persistVars = commit && input.suppressVarPersist !== true;
  const overlay = !commit ? null : input.suppressVarPersist === true ? makeEphemeralOverlay() : chatId ? getOverlay(chatId) : null;
  const tempOverlay = new Map;
  const envLocal = variables.local ?? {};
  const envGlobal = variables.global ?? {};
  const envChat = variables.chat ?? {};
  const defaults = input.scriptstateDefaults ?? {};
  const recorder = input.recorder;
  const recordMessagesDep = () => {
    if (recorder)
      recorder.touched.add(MSG_DEP_KEY);
  };
  const recordRead = recorder ? (scope, name) => {
    if (scope === "temp")
      return;
    if (scope === "global")
      recorder.touched.add(`global:${name}`);
    else {
      recorder.touched.add(`chat:${name}`);
      recorder.touched.add(`local:${name}`);
    }
  } : null;
  const vars = {
    get(scope, name) {
      if (recordRead)
        recordRead(scope, name);
      if (scope === "temp")
        return tempOverlay.get(name) ?? "";
      if (overlay) {
        if (scope === "local" && overlay.local.has(name))
          return overlay.local.get(name);
        if (scope === "global" && overlay.global.has(name))
          return overlay.global.get(name);
        if (scope === "local" && overlay.chat.has(name))
          return overlay.chat.get(name);
      }
      if (scope === "global")
        return envGlobal[name] ?? "null";
      const fromChat = envChat[name];
      if (fromChat !== undefined)
        return fromChat;
      const fromLocal = envLocal[name];
      if (fromLocal !== undefined)
        return fromLocal;
      const fromDefaults = defaults[name];
      if (fromDefaults !== undefined)
        return fromDefaults;
      return "null";
    },
    set(scope, name, value) {
      if (scope === "temp") {
        tempOverlay.set(name, value);
        return;
      }
      if (!commit || !overlay)
        return;
      if (scope === "global") {
        overlay.global.set(name, value);
        if (chatId && spindleGlobal && persistVars) {
          try {
            spindleGlobal.variables.global.set(name, value).catch(() => {});
          } catch {}
        }
        return;
      }
      overlay.chat.set(name, value);
      if (input.localVarSink)
        input.localVarSink(name, value);
    },
    add(scope, name, delta) {
      if (scope !== "temp" && !commit)
        return;
      this.set(scope, name, String(Number(this.get(scope, name)) + delta));
    },
    has(scope, name) {
      if (recordRead)
        recordRead(scope, name);
      if (scope === "temp")
        return tempOverlay.has(name);
      if (overlay) {
        if (scope === "local" && (overlay.local.has(name) || overlay.chat.has(name)))
          return true;
        if (scope === "global" && overlay.global.has(name))
          return true;
      }
      if (scope === "global")
        return Object.prototype.hasOwnProperty.call(envGlobal, name);
      return Object.prototype.hasOwnProperty.call(envChat, name) || Object.prototype.hasOwnProperty.call(envLocal, name) || Object.prototype.hasOwnProperty.call(defaults, name);
    },
    delete(scope, name) {
      if (scope === "temp") {
        tempOverlay.delete(name);
        return;
      }
      if (!commit)
        return;
      if (overlay) {
        if (scope === "global")
          overlay.global.delete(name);
        else {
          overlay.local.delete(name);
          overlay.chat.delete(name);
        }
      }
      if (scope !== "global" && input.localVarSink)
        input.localVarSink(name, null);
      if (scope === "global" && chatId && spindleGlobal && persistVars) {
        try {
          spindleGlobal.variables.global.delete(name).catch(() => {});
        } catch {}
      }
    }
  };
  const messageCount = Math.max(0, Number(chat.messageCount ?? 0) - 1);
  const lastMessage = String(chat.lastMessage ?? "");
  const lastUser = String(chat.lastUserMessage ?? "");
  const lastChar = String(chat.lastCharMessage ?? "");
  const fullMessages = chat.messages;
  const synthesized = [];
  if (lastUser)
    synthesized.push({ role: "user", content: lastUser, createdAt: 0 });
  if (lastChar)
    synthesized.push({ role: "assistant", content: lastChar, createdAt: 0 });
  if (lastMessage && !synthesized.some((m) => m.content === lastMessage)) {
    synthesized.push({ role: "assistant", content: lastMessage, createdAt: 0 });
  }
  const effective = fullMessages ?? synthesized;
  const messages = {
    all: () => {
      recordMessagesDep();
      return effective;
    },
    last: () => {
      recordMessagesDep();
      return effective[effective.length - 1] ?? null;
    },
    lastOf: (role) => {
      recordMessagesDep();
      for (let i = effective.length - 1;i >= 0; i--) {
        const m = effective[i];
        if (m.role === role)
          return m;
      }
      return null;
    },
    count: (role) => {
      recordMessagesDep();
      if (role === undefined) {
        if (fullMessages)
          return effective.length;
        return chat.messageCount != null ? messageCount : synthesized.length;
      }
      let n = 0;
      for (const m of effective)
        if (m.role === role)
          n++;
      return n;
    }
  };
  const identity = {
    charName: input.charName,
    userName: input.userName,
    personaText: input.personaText ?? "",
    personaName: input.userName,
    personaImage: input.personaImage ?? ""
  };
  const character = {
    description: card.description ?? "",
    personality: card.personality ?? "",
    scenario: card.scenario ?? "",
    exampleDialogue: card.exampleDialogue ?? "",
    mainPrompt: card.mainPrompt ?? "",
    postHistoryInstructions: card.postHistoryInstructions ?? "",
    creatorNotes: card.creatorNotes ?? "",
    jailbreakPrompt: card.jailbreakPrompt ?? "",
    globalNote: card.globalNote ?? "",
    authorsNote: card.authorsNote ?? "",
    firstMessage: card.firstMessage ?? "",
    alternateGreetings: card.alternateGreetings ?? [],
    selectedAlternateGreetingIndex: card.selectedAlternateGreetingIndex ?? -1,
    ...card.selectedGreeting !== undefined ? { selectedGreeting: card.selectedGreeting } : {},
    type: "character",
    additionalAssets: indexToCharacterAssets(card.additionalAssets),
    emotionImages: indexToCharacterAssets(card.emotionImages),
    prebuiltAssetCommand: false,
    prebuiltAssetExclude: [],
    chaId: input.characterId ?? "",
    image: card.image ?? ""
  };
  const lorebook = input.lorebook ?? [];
  const functions = makeFunctionRegistry();
  const rng = recorder ? { random: () => {
    recorder.volatile = true;
    return Math.random();
  } } : { random: () => Math.random() };
  const clock = recorder ? { now: () => {
    recorder.volatile = true;
    return Date.now();
  } } : { now: () => Date.now() };
  const out = {
    chatId,
    vars,
    identity,
    character,
    messages,
    rng,
    clock,
    triggerId: null,
    role: input.currentMessageRoleOverride ? normalizeRoleToLumi(input.currentMessageRoleOverride) : null,
    functions,
    aiModel: input.system?.model ?? "",
    axModel: "",
    isFirstMessage: Number(chat.messageCount ?? 0) <= 1,
    currentMessageIndex: input.currentMessageIndexOverride !== undefined ? Math.max(-1, input.currentMessageIndexOverride) : chat.lastMessageId != null ? Math.max(-1, chat.lastMessageId - 1) : null,
    lorebook,
    jailbreakToggle: false,
    maxContext: Number(input.system?.maxContext ?? 0),
    language: RISU_LANGUAGE,
    appVersion: RISU_APP_VERSION,
    screenWidth: Number(input.screenWidth ?? 0),
    screenHeight: Number(input.screenHeight ?? 0),
    commit,
    legacyMediaFindings: input.legacyMediaFindings === true,
    callStack: 0,
    ...input.modulesByNamespace ? { modulesByNamespace: input.modulesByNamespace } : {},
    ...input.positionPt ? { positionPt: input.positionPt } : {},
    ...input.cbsContext ? { cbsContext: true } : {},
    ...input.rmVar ? { rmVar: true } : {},
    ...input.runVar ? { runVar: true } : {},
    ...input.suppressVarPersist ? { promptRegexLiteralVars: true } : {}
  };
  out.evaluate = (text) => {
    if (typeof text !== "string" || text.length === 0)
      return "";
    if (text.indexOf("{{") < 0 && text.indexOf("<") < 0)
      return text;
    const { evaluate: evaluate2 } = (init_scanner(), __toCommonJS(exports_scanner));
    return evaluate2(text, out, out.callStack !== undefined ? { callStack: out.callStack } : {});
  };
  return out;
}

// src/interpreter/evaluator/pipeline.ts
function runPipeline(input, opts) {
  const commit = input.phase === "commit";
  const ctx = buildEvaluatorContext({
    chatId: input.chatId,
    ...opts?.recorder ? { recorder: opts.recorder } : {},
    ...input.userId !== undefined ? { userId: input.userId } : {},
    ...input.characterId !== undefined ? { characterId: input.characterId } : {},
    userName: input.userName,
    charName: input.charName,
    ...input.personaText !== undefined ? { personaText: input.personaText } : {},
    character: input.character,
    chat: input.chat,
    variables: input.variables,
    ...input.scriptstateDefaults ? { scriptstateDefaults: input.scriptstateDefaults } : {},
    ...input.system ? { system: input.system } : {},
    ...input.screenWidth !== undefined ? { screenWidth: input.screenWidth } : {},
    ...input.screenHeight !== undefined ? { screenHeight: input.screenHeight } : {},
    ...input.currentMessageIndexOverride !== undefined ? { currentMessageIndexOverride: input.currentMessageIndexOverride } : {},
    ...input.currentMessageRoleOverride !== undefined ? { currentMessageRoleOverride: input.currentMessageRoleOverride } : {},
    ...input.legacyMediaFindings !== undefined ? { legacyMediaFindings: input.legacyMediaFindings } : {},
    ...input.modulesByNamespace ? { modulesByNamespace: input.modulesByNamespace } : {},
    ...input.lorebook ? { lorebook: input.lorebook } : {},
    ...input.positionPt ? { positionPt: input.positionPt } : {},
    ...input.cbsContext ? { cbsContext: true } : {},
    ...input.rmVar ? { rmVar: true } : {},
    ...input.runVar ? { runVar: true } : {},
    ...input.suppressVarPersist ? { suppressVarPersist: true } : {},
    commit
  });
  return evaluate(input.template, ctx);
}

// src/display/regex-apply.ts
function compileRegex(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
function collectMatches(content, regex) {
  const re = new RegExp(regex.source, regex.flags);
  const matches = [];
  const push = (m) => {
    matches.push({
      fullMatch: m[0],
      index: m.index,
      groups: Array.from(m).slice(1),
      ...m.groups ? { namedGroups: m.groups } : {}
    });
  };
  if (re.global || re.sticky) {
    let m;
    while ((m = re.exec(content)) !== null) {
      push(m);
      if (m[0].length === 0)
        re.lastIndex++;
    }
  } else {
    const m = re.exec(content);
    if (m)
      push(m);
  }
  return matches;
}
function substituteRegexCaptures(template, fullMatch, groups, offset, input, namedGroups) {
  return template.replace(/\$(?:(\$)|(&)|(`)|(')|(\d{1,2})|<([^>]*)>)/g, (token, dollar, amp, backtick, quote, digits, name) => {
    if (dollar !== undefined)
      return "$";
    if (amp !== undefined)
      return fullMatch;
    if (backtick !== undefined)
      return input.slice(0, offset);
    if (quote !== undefined)
      return input.slice(offset + fullMatch.length);
    if (digits !== undefined) {
      const idx = Number.parseInt(digits, 10);
      if (idx >= 1 && idx <= groups.length)
        return groups[idx - 1] ?? "";
      return token;
    }
    if (name !== undefined && namedGroups)
      return namedGroups[name] ?? token;
    return token;
  });
}
function rebuildFromMatches(content, matches, replacements) {
  let out = "";
  let lastIdx = 0;
  for (let i = 0;i < matches.length; i++) {
    out += content.slice(lastIdx, matches[i].index);
    out += replacements[i];
    lastIdx = matches[i].index + matches[i].fullMatch.length;
  }
  out += content.slice(lastIdx);
  return out;
}
function applyTrimStrings(result, trims) {
  let out = result;
  for (const trim of trims) {
    if (!trim)
      continue;
    while (out.includes(trim))
      out = out.replaceAll(trim, "");
  }
  return out;
}

// src/display/regex-core.ts
var LEGACY_NAME_TAG_RE = /<(user|char|bot)>/i;
function hasCbsSyntax(s) {
  return s.includes("{{") || s.includes("{#") || LEGACY_NAME_TAG_RE.test(s);
}
function applyRegexScriptsCore(content, scripts, opts) {
  const { placement, depth, evalTemplate, reResolveAfterRule } = opts;
  let result = content;
  for (const script of scripts) {
    if (script.disabled === true)
      continue;
    if (!script.placement.includes(placement))
      continue;
    if (depth !== undefined) {
      if (script.min_depth !== null && depth < script.min_depth)
        continue;
      if (script.max_depth !== null && depth > script.max_depth)
        continue;
    }
    const before = result;
    let findRegex = script.find_regex;
    if (script.preResolvedFind !== undefined) {
      findRegex = script.preResolvedFind;
    } else if (script.substitute_macros !== "none") {
      findRegex = evalTemplate(findRegex);
    }
    const regex = compileRegex(findRegex, script.flags);
    if (!regex)
      continue;
    try {
      if (script.substitute_macros === "raw") {
        const matches = collectMatches(result, regex);
        if (matches.length > 0) {
          const replacements = matches.map((m) => {
            const withCaptures = substituteRegexCaptures(script.replace_string, m.fullMatch, m.groups, m.index, result, m.namedGroups);
            return evalTemplate(withCaptures);
          });
          result = rebuildFromMatches(result, matches, replacements);
        }
      } else if (script.substitute_macros === "after") {
        const substituted = result.replace(regex, script.replace_string);
        result = evalTemplate(substituted);
      } else {
        let replaceString = script.replace_string;
        if (script.preResolvedReplace !== undefined) {
          replaceString = script.substitute_macros === "escaped" ? script.preResolvedReplace.replace(/\$/g, "$$$$") : script.preResolvedReplace;
        } else if (script.substitute_macros !== "none") {
          const resolved = evalTemplate(replaceString);
          replaceString = script.substitute_macros === "escaped" ? resolved.replace(/\$/g, "$$$$") : resolved;
        }
        result = result.replace(regex, replaceString);
      }
      result = applyTrimStrings(result, script.trim_strings);
      if (reResolveAfterRule && script.substitute_macros !== "after" && script.substitute_macros !== "raw" && result !== before && hasCbsSyntax(result)) {
        result = evalTemplate(result);
      }
    } catch {
      continue;
    }
  }
  return result;
}

// src/interpreter/asset-cache.ts
var byChat = new Map;

// src/interpreter/screen-dims-cache.ts
var byUser = new Map;

// src/interpreter/image-cache.ts
var characterImageByChat = new Map;
var personaImageByUser = new Map;

// src/interpreter/decorator-buffers.ts
var buffersByChat = new Map;

// src/state/lorebook-cache.ts
var byCharacter = new Map;
var chatToCharacter = new Map;

// src/interpreter/messages-cache.ts
var cache = new Map;

// src/interceptors/prompt-regex-apply.ts
function placementForRole(role) {
  if (role === "user")
    return "user_input";
  if (role === "assistant")
    return "ai_output";
  return "world_info";
}
async function applyPromptRegexToArray(messages, prebuilt, scripts) {
  if (scripts.length === 0)
    return { changed: false };
  const hasHistoryFlag = messages.some((m) => m.__isChatHistory === true);
  const isHistory = (m) => hasHistoryFlag ? m.__isChatHistory === true : m.role !== "system";
  const historyIndices = [];
  for (let i = 0;i < messages.length; i++) {
    if (messages[i] && isHistory(messages[i]))
      historyIndices.push(i);
  }
  const depthByIndex = new Map;
  const risuIndexByArrayIndex = new Map;
  for (let pos = 0;pos < historyIndices.length; pos++) {
    depthByIndex.set(historyIndices[pos], historyIndices.length - 1 - pos);
    risuIndexByArrayIndex.set(historyIndices[pos], pos - 1);
  }
  const evalTemplateFor = (msgIndex, role) => (text) => runPipeline({
    ...prebuilt,
    currentMessageIndexOverride: msgIndex,
    ...role !== undefined ? { currentMessageRoleOverride: role } : {},
    template: text
  });
  let changed = false;
  for (let i = 0;i < messages.length; i++) {
    const msg = messages[i];
    const placement = placementForRole(msg.role);
    const depth = depthByIndex.get(i);
    const risuIdx = risuIndexByArrayIndex.has(i) ? risuIndexByArrayIndex.get(i) : -1;
    const evalTemplate = evalTemplateFor(risuIdx, risuIdx >= 0 && msg.role !== "system" ? msg.role : undefined);
    if (typeof msg.content === "string") {
      const next = applyRegexScriptsCore(msg.content, scripts, { placement, depth, evalTemplate, reResolveAfterRule: true });
      if (next !== msg.content) {
        messages[i] = { ...msg, content: next };
        changed = true;
      }
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content;
      let partsChanged = false;
      const nextParts = parts.map((rawPart) => {
        const part = rawPart;
        if (part?.type === "text" && typeof part.text === "string") {
          const next = applyRegexScriptsCore(part.text, scripts, { placement, depth, evalTemplate, reResolveAfterRule: true });
          if (next !== part.text) {
            partsChanged = true;
            return { ...part, text: next };
          }
        }
        return rawPart;
      });
      if (partsChanged) {
        messages[i] = { ...msg, content: nextParts };
        changed = true;
      }
    }
  }
  return { changed };
}

// src/regex-runner.ts
function isRequest(payload) {
  if (!payload || typeof payload !== "object")
    return false;
  const p = payload;
  return typeof p.requestId === "string" && Array.isArray(p.messages) && Array.isArray(p.scripts) && p.prebuilt !== null && typeof p.prebuilt === "object";
}
async function runRegexRequest(req) {
  try {
    const messages = req.messages.slice();
    const { changed } = await applyPromptRegexToArray(messages, req.prebuilt, req.scripts);
    return { requestId: req.requestId, ok: true, changed, messages };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { requestId: req.requestId, ok: false, error: message };
  }
}
var HEARTBEAT_INTERVAL_MS = 2000;
function regexRunner(ctx) {
  const timer = setInterval(() => {
    ctx.heartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  ctx.onMessage((payload) => {
    if (!isRequest(payload)) {
      ctx.fail("regex-runner received a malformed request payload");
      return;
    }
    const req = payload;
    runRegexRequest(req).then((reply) => {
      ctx.send(reply);
    });
  });
  ctx.onStop(() => {
    clearInterval(timer);
    ctx.complete();
  });
  ctx.ready();
  return () => {
    clearInterval(timer);
  };
}
export {
  runRegexRequest,
  regexRunner as default
};
