import { describe, test, expect, beforeEach } from "bun:test";
import {
  imageUrlFromId,
  setActiveCharacterImage,
  getActiveCharacterImage,
  clearActiveCharacterImage,
  setActivePersonaImage,
  getActivePersonaImage,
} from "../../src/interpreter/image-cache.js";

describe("imageUrlFromId", () => {
  test("returns Lumi image URL for non-empty string id", () => {
    expect(imageUrlFromId("abc-123")).toBe("/api/v1/images/abc-123");
  });

  test("returns '' for null", () => {
    expect(imageUrlFromId(null)).toBe("");
  });

  test("returns '' for undefined", () => {
    expect(imageUrlFromId(undefined)).toBe("");
  });

  test("returns '' for empty string", () => {
    expect(imageUrlFromId("")).toBe("");
  });

  test("returns '' for non-string (defensive)", () => {
    expect(imageUrlFromId(123 as unknown as string)).toBe("");
    expect(imageUrlFromId({} as unknown as string)).toBe("");
  });
});

describe("character image cache", () => {
  // Module state — clear between tests so cross-test isolation holds.
  beforeEach(() => {
    clearActiveCharacterImage("chat-A");
    clearActiveCharacterImage("chat-B");
  });

  test("set / get round-trip", () => {
    setActiveCharacterImage("chat-A", "/api/v1/images/img-1");
    expect(getActiveCharacterImage("chat-A")).toBe("/api/v1/images/img-1");
  });

  test("get returns '' for unset chat", () => {
    expect(getActiveCharacterImage("chat-never-set")).toBe("");
  });

  test("clear removes entry", () => {
    setActiveCharacterImage("chat-A", "/api/v1/images/img-1");
    clearActiveCharacterImage("chat-A");
    expect(getActiveCharacterImage("chat-A")).toBe("");
  });

  test("clear is idempotent for missing chat", () => {
    expect(() => clearActiveCharacterImage("chat-missing")).not.toThrow();
  });

  test("multiple chats independent", () => {
    setActiveCharacterImage("chat-A", "/api/v1/images/img-A");
    setActiveCharacterImage("chat-B", "/api/v1/images/img-B");
    expect(getActiveCharacterImage("chat-A")).toBe("/api/v1/images/img-A");
    expect(getActiveCharacterImage("chat-B")).toBe("/api/v1/images/img-B");
  });

  test("setting empty string is allowed (Risu parity for missing avatar)", () => {
    setActiveCharacterImage("chat-A", "");
    expect(getActiveCharacterImage("chat-A")).toBe("");
  });
});

describe("persona image cache", () => {
  test("set / get round-trip", () => {
    setActivePersonaImage("user-1", "/api/v1/images/persona-1");
    expect(getActivePersonaImage("user-1")).toBe("/api/v1/images/persona-1");
  });

  test("get with undefined userId returns ''", () => {
    expect(getActivePersonaImage(undefined)).toBe("");
  });

  test("get returns '' for unset user", () => {
    expect(getActivePersonaImage("user-never-set")).toBe("");
  });

  test("multiple users independent", () => {
    setActivePersonaImage("user-A", "/api/v1/images/A");
    setActivePersonaImage("user-B", "/api/v1/images/B");
    expect(getActivePersonaImage("user-A")).toBe("/api/v1/images/A");
    expect(getActivePersonaImage("user-B")).toBe("/api/v1/images/B");
  });
});
