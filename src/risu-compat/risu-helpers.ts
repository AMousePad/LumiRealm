// Risu source: parser.svelte.ts (parseArray) and 1128-1134 (makeArray).

export function parseArray(s: string): unknown[] {
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr;
  } catch { /* fall through */ }
  return s.split("§");
}

export function parseDict(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch { /* fall through */ }
  return {};
}

export function makeArray(arr: readonly unknown[]): string {
  return JSON.stringify(arr.map((v) => {
    if (typeof v === "string") return v.replaceAll("::", "\\u003A\\u003A");
    return v;
  }));
}

// Risu source: util.ts (sfc32) and 1101-1115 (pickHashRand).

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = ((a + b) | 0) + d | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function pickHashRand(cid: number, word: string): number {
  let hashAddress = 5515;
  const rand = (w: string): number => {
    for (let counter = 0; counter < w.length; counter++) {
      hashAddress = ((hashAddress << 5) + hashAddress) + w.charCodeAt(counter);
    }
    return hashAddress;
  };
  const randF = sfc32(rand(word), rand(word), rand(word), rand(word));
  const v = cid % 1000;
  for (let i = 0; i < v; i++) randF();
  return randF();
}

// Risu source: parser.svelte.ts.

export function dateTimeFormat(main: string, time = 0): string {
  const date = time === 0 ? new Date() : new Date(time);
  if (!main) return "";
  if (main.startsWith(":")) main = main.substring(1);
  if (main.length > 300) return "";
  return main
    .replace(/YYYY/g, date.getFullYear().toString())
    .replace(/YY/g, date.getFullYear().toString().substring(2))
    .replace(/MMMM/g, new Intl.DateTimeFormat("en", { month: "long" }).format(date))
    .replace(/MMM/g, new Intl.DateTimeFormat("en", { month: "short" }).format(date))
    .replace(/MM/g, (date.getMonth() + 1).toString().padStart(2, "0"))
    .replace(/DDDD/g, Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)).toString())
    .replace(/DD/g, date.getDate().toString().padStart(2, "0"))
    .replace(/dddd/g, new Intl.DateTimeFormat("en", { weekday: "long" }).format(date))
    .replace(/ddd/g, new Intl.DateTimeFormat("en", { weekday: "short" }).format(date))
    .replace(/HH/g, date.getHours().toString().padStart(2, "0"))
    .replace(/hh/g, (date.getHours() % 12 || 12).toString().padStart(2, "0"))
    .replace(/mm/g, date.getMinutes().toString().padStart(2, "0"))
    .replace(/ss/g, date.getSeconds().toString().padStart(2, "0"))
    .replace(/X/g, Math.floor(date.getTime() / 1000).toString())
    .replace(/x/g, date.getTime().toString())
    .replace(/A/g, date.getHours() >= 12 ? "PM" : "AM");
}

// Risu source: process/infunctions.ts (toRPN + calculateRPN + executeRPNCalculation + calcString).

type VarReader = (name: string) => string;

export function calcString(text: string, readLocal: VarReader, readGlobal: VarReader): number {
  const depthText: string[] = [""];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") {
      depthText.push("");
    } else if (text[i] === ")" && depthText.length > 1) {
      const inner = depthText.pop()!;
      const result = executeRPN(inner, readLocal, readGlobal);
      depthText[depthText.length - 1]! += result;
    } else {
      depthText[depthText.length - 1]! += text[i];
    }
  }
  return executeRPN(depthText.join(""), readLocal, readGlobal);
}

function executeRPN(text: string, readLocal: VarReader, readGlobal: VarReader): number {
  const substituted = text
    .replace(/\$([a-zA-Z0-9_]+)/g, (_, p1: string) => {
      const v = readLocal(p1);
      const parsed = parseFloat(v);
      return isNaN(parsed) ? "0" : parsed.toString();
    })
    .replace(/@([a-zA-Z0-9_]+)/g, (_, p1: string) => {
      const v = readGlobal(p1);
      const parsed = parseFloat(v);
      return isNaN(parsed) ? "0" : parsed.toString();
    })
    .replace(/&&/g, "&")
    .replace(/\|\|/g, "|")
    .replace(/<=/g, "\u2264")
    .replace(/>=/g, "\u2265")
    .replace(/==/g, "=")
    .replace(/!=/g, "\u2260")
    .replace(/null/gi, "0");
  const rpn = toRPN(substituted);
  return calculateRPN(rpn);
}

const OPERATORS: Record<string, { precedence: number; associativity: "Left" | "Right" }> = {
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
  "!": { precedence: 5, associativity: "Right" },
};
const OPERATOR_CHARS = new Set(Object.keys(OPERATORS));

function toRPN(expression: string): string {
  expression = expression.replace(/\s+/g, "");
  const expr2: string[] = [];
  let lastToken = "";
  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]!;
    if (char === "-" && (i === 0 || OPERATOR_CHARS.has(expression[i - 1]!) || expression[i - 1] === "(")) {
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
  const operatorStack: string[] = [];
  for (const token of expr2) {
    if (parseFloat(token) || token === "0") {
      outputQueue += token + " ";
    } else if (OPERATOR_CHARS.has(token)) {
      while (operatorStack.length > 0) {
        const top = operatorStack[operatorStack.length - 1]!;
        const op = OPERATORS[token]!;
        const topOp = OPERATORS[top]!;
        const drain = op.associativity === "Left"
          ? op.precedence <= topOp.precedence
          : op.precedence < topOp.precedence;
        if (!drain) break;
        outputQueue += operatorStack.pop() + " ";
      }
      operatorStack.push(token);
    }
  }
  while (operatorStack.length > 0) outputQueue += operatorStack.pop() + " ";
  return outputQueue.trim();
}

function calculateRPN(expression: string): number {
  const stack: number[] = [];
  for (const token of expression.split(" ")) {
    if (parseFloat(token) || token === "0") {
      stack.push(parseFloat(token));
    } else {
      const b = stack.pop()!;
      const a = stack.pop()!;
      switch (token) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
        case "^": stack.push(a ** b); break;
        case "%": stack.push(a % b); break;
        case "<": stack.push(a < b ? 1 : 0); break;
        case ">": stack.push(a > b ? 1 : 0); break;
        case "|": stack.push(a || b); break;
        case "&": stack.push(a && b); break;
        case "\u2264": stack.push(a <= b ? 1 : 0); break;
        case "\u2265": stack.push(a >= b ? 1 : 0); break;
        case "=": stack.push(a === b ? 1 : 0); break;
        case "\u2260": stack.push(a !== b ? 1 : 0); break;
        case "!": stack.push(b ? 0 : 1); break;
      }
    }
  }
  return stack.length === 0 ? 0 : stack.pop()!;
}
