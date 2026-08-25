import { describe, expect, it, vi } from "vitest";

import { createId, normalizeQWord, parseBinary } from "./model";

describe("domain value helpers", () => {
  it("normalizes QWORD without losing 64-bit precision", () => {
    expect(normalizeQWord("00018446744073709551615")).toBe("18446744073709551615");
    expect(normalizeQWord("18446744073709551616")).toBeUndefined();
    expect(normalizeQWord("1.5")).toBeUndefined();
  });

  it("parses byte-oriented hexadecimal input", () => {
    expect(parseBinary("00, aF ff")).toEqual([0, 175, 255]);
    expect(parseBinary("f")).toBeUndefined();
  });

  it("creates distinct RFC 4122 version 4 identifiers without randomUUID", () => {
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("randomUUID is unavailable outside a secure context");
    });
    const first = createId();
    const second = createId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(randomUuid).not.toHaveBeenCalled();
  });
});
