import { describe, expect, test } from "bun:test";
import { risuRoleToLumi, lumiRoleToRisu } from "../../src/util/role-coerce.js";

describe("risuRoleToLumi", () => {
  test("user → user", () => {
    expect(risuRoleToLumi("user")).toBe("user");
  });

  test("char → assistant", () => {
    expect(risuRoleToLumi("char")).toBe("assistant");
  });

  test("bot (Risu LLM-payload alias for char) → assistant", () => {
    expect(risuRoleToLumi("bot")).toBe("assistant");
  });

  // Risu's `chat.message[]` doesn't carry system messages — `addChat`/`setChatRole`
  // coerce non-user input to `'char'`. We mirror that exactly.
  test("sys → assistant (Risu chat.message[] parity)", () => {
    expect(risuRoleToLumi("sys")).toBe("assistant");
  });

  test("system → assistant (Risu chat.message[] parity)", () => {
    expect(risuRoleToLumi("system")).toBe("assistant");
  });

  test("assistant (Lumi shape passthrough) → assistant", () => {
    expect(risuRoleToLumi("assistant")).toBe("assistant");
  });

  test("empty string → assistant", () => {
    expect(risuRoleToLumi("")).toBe("assistant");
  });

  test("garbage → assistant", () => {
    expect(risuRoleToLumi("CHARACTER")).toBe("assistant");
  });
});

describe("lumiRoleToRisu", () => {
  test("user → user", () => {
    expect(lumiRoleToRisu("user")).toBe("user");
  });

  test("assistant → char", () => {
    expect(lumiRoleToRisu("assistant")).toBe("char");
  });

  // Risu's chat.message[] has no system role; cards expect user|char.
  // System messages from Lumi must surface as char to keep `==="char"` gates working.
  test("system → char (Risu chat.message[] parity)", () => {
    expect(lumiRoleToRisu("system")).toBe("char");
  });

  test("empty string → char", () => {
    expect(lumiRoleToRisu("")).toBe("char");
  });
});

describe("round-trip", () => {
  test("user round-trips", () => {
    expect(risuRoleToLumi(lumiRoleToRisu("user"))).toBe("user");
    expect(lumiRoleToRisu(risuRoleToLumi("user"))).toBe("user");
  });

  test("char/assistant round-trips through both shapes", () => {
    expect(risuRoleToLumi(lumiRoleToRisu("assistant"))).toBe("assistant");
    expect(lumiRoleToRisu(risuRoleToLumi("char"))).toBe("char");
  });

  // System collapses to char/assistant — by-design Risu parity, not bidirectional.
  test("system collapses to char on the way out (acknowledged lossy)", () => {
    const round = risuRoleToLumi(lumiRoleToRisu("system"));
    expect(round).toBe("assistant");
  });
});
