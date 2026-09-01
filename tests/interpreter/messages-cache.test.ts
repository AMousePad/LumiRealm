import { describe, test, expect, beforeEach } from "bun:test";
import {
  getCachedMessages,
  setCachedMessages,
  invalidateCachedMessages,
  clearMessagesCache,
  _debugCacheSize,
} from "../../src/interpreter/messages-cache.js";

beforeEach(() => clearMessagesCache());

describe("messages-cache — basic semantics", () => {
  test("get returns null for unknown chat", () => {
    expect(getCachedMessages("missing")).toBeNull();
  });
  test("set then get returns the same array", () => {
    const msgs = [
      { role: "user" as const, content: "hi", createdAt: 1 },
      { role: "assistant" as const, content: "hello", createdAt: 2 },
    ];
    setCachedMessages("c1", msgs);
    expect(getCachedMessages("c1")).toBe(msgs);
  });
  test("set replaces prior value (no merge)", () => {
    setCachedMessages("c1", [{ role: "user", content: "first", createdAt: 1 }]);
    setCachedMessages("c1", [{ role: "assistant", content: "second", createdAt: 2 }]);
    expect(getCachedMessages("c1")).toEqual([{ role: "assistant", content: "second", createdAt: 2 }]);
  });
  test("invalidate drops only the requested chat", () => {
    setCachedMessages("c1", [{ role: "user", content: "a", createdAt: 1 }]);
    setCachedMessages("c2", [{ role: "user", content: "b", createdAt: 2 }]);
    invalidateCachedMessages("c1");
    expect(getCachedMessages("c1")).toBeNull();
    expect(getCachedMessages("c2")).not.toBeNull();
  });
  test("clearMessagesCache drops all", () => {
    setCachedMessages("c1", [{ role: "user", content: "a", createdAt: 1 }]);
    setCachedMessages("c2", [{ role: "user", content: "b", createdAt: 2 }]);
    expect(_debugCacheSize()).toBe(2);
    clearMessagesCache();
    expect(_debugCacheSize()).toBe(0);
  });
  test("empty chatId is rejected for set / get / invalidate", () => {
    setCachedMessages("", [{ role: "user", content: "x", createdAt: 1 }]);
    expect(_debugCacheSize()).toBe(0);
    expect(getCachedMessages("")).toBeNull();
    invalidateCachedMessages("");
  });
});
