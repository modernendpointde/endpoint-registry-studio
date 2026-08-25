import { describe, expect, it } from "vitest";

import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig } from "./runtimeConfig";

describe("runtime configuration", () => {
  it("accepts allowlisted branding and feature settings", () => {
    expect(
      parseRuntimeConfig({
        applicationName: "Registry Studio",
        organizationName: "Example",
        logo: "branding/logo.svg",
        accentColor: "#123ABC",
        defaultTheme: "dark",
        showImport: false,
      }),
    ).toMatchObject({
      applicationName: "Registry Studio",
      logo: "branding/logo.svg",
      accentColor: "#123ABC",
      defaultTheme: "dark",
      showImport: false,
    });
  });

  it("rejects injection, external assets, and invalid values", () => {
    const config = parseRuntimeConfig({
      applicationName: 42,
      logo: "javascript:alert(1)",
      accentColor: "red; background:url(evil)",
      defaultTheme: "neon",
    });
    expect(config).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it("ignores unknown configuration keys", () => {
    expect(
      parseRuntimeConfig({
        unsupportedSetting: "not part of the runtime contract",
      }),
    ).toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});

describe("runtime footer configuration", () => {
  it("accepts the four allowed kinds with https and relative links", () => {
    const parsed = parseRuntimeConfig({
      footer: {
        items: [
          { kind: "legalNotice", label: "Legal notice", url: "./legal-notice/" },
          { kind: "privacy", label: "Privacy", url: "/privacy" },
          {
            kind: "github",
            label: "GitHub",
            url: "https://github.com/modernendpointde/endpoint-registry-studio",
          },
          { kind: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/in/example" },
        ],
      },
    });
    expect(parsed.footer.items).toHaveLength(4);
    expect(parsed.footer.items[0]).toEqual({
      kind: "legalNotice",
      label: "Legal notice",
      url: "./legal-notice/",
    });
    expect(parsed.footer.items[2]?.kind).toBe("github");
  });

  it("supports Unicode labels and ignores unknown top-level keys", () => {
    const parsed = parseRuntimeConfig({
      footer: {
        items: [
          { kind: "privacy", label: "Datenschutz „mit Anführungszeichen“", url: "./datenschutz" },
        ],
      },
      unknownKey: true,
    });
    expect(parsed.footer.items).toHaveLength(1);
  });

  it.each([
    ["javascript:alert(1)", "javascript:"],
    ["data:text/html;base64,xx", "data:"],
    ["blob:https://example/x", "blob:"],
    ["http://example.org/privacy", "http:"],
    ["//evil.example/privacy", "protocol-relative"],
    ["../private", "parent traversal"],
    ["https://user:pass@example.org/privacy", "credentials"],
    ["\\host\\privacy", "backslash"],
  ])("rejects %s (%s)", (url) => {
    const parsed = parseRuntimeConfig({
      footer: { items: [{ kind: "privacy", label: "Privacy", url }] },
    });
    expect(parsed.footer.items).toHaveLength(0);
  });

  it("rejects malformed https URLs and non-string kind/label/url values", () => {
    const parsed = parseRuntimeConfig({
      footer: {
        items: [
          { kind: "privacy", label: "P", url: "https://" },
          { kind: 42, label: "P", url: "./x" },
          { kind: "privacy", label: { nested: true }, url: "./x" },
          { kind: "privacy", label: "P", url: { nested: true } },
        ],
      },
    });
    expect(parsed.footer.items).toHaveLength(0);
  });

  it("rejects invalid kinds, empty or oversized labels, oversize urls and more than six items", () => {
    const parsed = parseRuntimeConfig({
      footer: {
        items: [
          { kind: "custom", label: "X", url: "./x" },
          { kind: "privacy", label: "   ", url: "./x" },
          { kind: "privacy", label: "x".repeat(81), url: "./x" },
          { kind: "privacy", label: "P", url: "https://example.org/" + "a".repeat(2048) },
          { kind: "github", label: "1", url: "./1" },
          { kind: "github", label: "2", url: "./2" },
          { kind: "github", label: "3", url: "./3" },
          { kind: "github", label: "4", url: "./4" },
          { kind: "github", label: "5", url: "./5" },
          { kind: "github", label: "6", url: "./6" },
          { kind: "github", label: "7", url: "./7" },
        ],
      },
    });
    expect(parsed.footer.items).toHaveLength(6);
    expect(parsed.footer.items[0]?.kind).toBe("github");
  });

  it("keeps an empty footer by default and never parses HTML out of labels", () => {
    expect(DEFAULT_RUNTIME_CONFIG.footer.items).toEqual([]);
    const parsed = parseRuntimeConfig({
      footer: { items: [{ kind: "privacy", label: "<b>Privacy</b>", url: "./privacy" }] },
    });
    expect(parsed.footer.items[0]?.label).toBe("<b>Privacy</b>");
  });
});
