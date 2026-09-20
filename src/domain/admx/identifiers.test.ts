import { describe, expect, it } from "vitest";
import {
  admxNamespace,
  isAdmxTemplateVersion,
  isAdmxToken,
  isReservedAdmxNamespace,
} from "./identifiers";

describe("ADMX identifiers", () => {
  it("accepts conservative tokens and versions", () => {
    expect(isAdmxToken("Northgate")).toBe(true);
    expect(isAdmxToken("App_1")).toBe(true);
    expect(isAdmxToken("1App")).toBe(false);
    expect(isAdmxToken("app-name")).toBe(false);
    expect(isAdmxToken("")).toBe(false);
    expect(isAdmxTemplateVersion("1.0.0")).toBe(true);
    expect(isAdmxTemplateVersion("1.0")).toBe(false);
  });

  it("rejects Microsoft and Windows namespace prefixes", () => {
    expect(isReservedAdmxNamespace(admxNamespace("Microsoft", "Office"))).toBe(true);
    expect(isReservedAdmxNamespace(admxNamespace("Windows", "Shell"))).toBe(true);
    expect(isReservedAdmxNamespace(admxNamespace("Northgate", "App"))).toBe(false);
  });
});
