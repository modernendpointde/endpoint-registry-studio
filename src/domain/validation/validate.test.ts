import { describe, expect, it } from "vitest";

import type { RegistryDefinition } from "../registry/model";
import { createRegistryItem, type RegistryItem } from "../workspace/workspace";
import { validateRegistryItem } from "./validate";

function createItem(
  registry: Partial<RegistryDefinition> = {},
  item: Partial<Pick<RegistryItem, "id" | "enabled">> = {},
): RegistryItem {
  const base = createRegistryItem();
  return { ...base, ...item, registry: { ...base.registry, ...registry } };
}

describe("Registry entry validation", () => {
  it("warns for recursive deletion without validating its unused desired value", () => {
    const entry = createItem({
      desiredState: "Absent",
      deletionMode: "KeyRecursive",
      value: { type: "DWord", data: 4_294_967_296 },
    });
    const issues = validateRegistryItem(entry, "Remediation");

    expect(issues.map((item) => item.code)).toContain("recursive-delete");
    expect(issues.map((item) => item.code)).not.toContain("invalid-dword");
  });

  it("validates exact Present values and explicit Revert values separately", () => {
    const desired = createItem({ value: { type: "DWord", data: 4_294_967_296 } });
    expect(validateRegistryItem(desired, "Remediation")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-dword" })]),
    );

    const revert = createItem({
      rollbackMode: "SetDefinedRollbackValue",
      rollbackValue: { type: "QWord", data: "018446744073709551615" },
    });
    expect(validateRegistryItem(revert, "Win32App")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-rollback-qword" })]),
    );
  });

  it("derives method and Revert warnings without a project adapter", () => {
    const entry = createItem({ desiredState: "Absent", rollbackMode: "None" });
    const platform = validateRegistryItem(entry, "PlatformScript");
    expect(platform.map((item) => item.code)).toContain("platform-once");
    const win32 = validateRegistryItem(entry, "Win32App");
    expect(win32.map((item) => item.code)).toContain("win32-no-uninstall");
  });

  it("distinguishes Auto host behavior from explicit Registry views", () => {
    const auto = createItem({ keyPath: "SOFTWARE\\WOW6432Node\\Contoso" }, { id: "auto" });
    const explicit = createItem({ view: "Registry64" }, { id: "explicit" });

    expect(validateRegistryItem(auto, "Remediation")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "auto-view-wow-risk", itemId: "auto" }),
      ]),
    );
    expect(
      validateRegistryItem(explicit, "Remediation").some((item) =>
        item.code.startsWith("auto-view"),
      ),
    ).toBe(false);
  });

  it("rejects embedded NUL characters in effective Registry target names", () => {
    expect(
      validateRegistryItem(createItem({ keyPath: "Software\\Con\0toso" }), "Remediation"),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-key-path" })]));
    expect(validateRegistryItem(createItem({ valueName: "Set\0ting" }), "Remediation")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-value-name" })]),
    );

    const recursive = createItem({
      desiredState: "Absent",
      deletionMode: "KeyRecursive",
      valueName: "Inactive\0Draft",
    });
    expect(validateRegistryItem(recursive, "Remediation").map((item) => item.code)).not.toContain(
      "invalid-value-name",
    );
  });
});
