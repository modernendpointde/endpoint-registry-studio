import { describe, expect, it } from "vitest";

import { parseReg } from "../../serialization/registryFileDecoder";
import { isSuggestedPackageName, itemFromImport, packageOutputLabel } from "./presentation";

describe("package header presentation", () => {
  it("marks the suggested name and every numbered suggestion", () => {
    expect(isSuggestedPackageName("Untitled Deployment Package")).toBe(true);
    expect(isSuggestedPackageName("  Untitled Deployment Package 7 ")).toBe(true);
    expect(isSuggestedPackageName("Northgate rollout")).toBe(false);
    expect(isSuggestedPackageName("")).toBe(false);
    expect(isSuggestedPackageName("Untitled Deployment Package extra")).toBe(false);
  });

  it("names the scripts a delivery method produces", () => {
    expect(packageOutputLabel("Remediation")).toContain("DryRun.ps1");
    expect(packageOutputLabel("PlatformScript")).toBe("Apply.ps1 and DryRun.ps1");
    expect(packageOutputLabel("Win32App")).toBe(
      "Install.ps1, Detect.ps1, and Uninstall.ps1 where defined",
    );
  });
});

describe("Registry import presentation boundary", () => {
  it("commits a parsed candidate as a Registry Item without an Entry adapter", () => {
    const result = parseReg(
      'Windows Registry Editor Version 5.00\n\n[HKLM\\Software\\Northgate]\n"Enabled"=dword:00000001',
    );
    const candidate = result.candidates[0];
    expect(candidate).toBeDefined();

    const item = itemFromImport(candidate!);

    expect(candidate!.description).toBe("");
    expect(item).toEqual({
      id: candidate!.id,
      enabled: true,
      registry: candidate!.registry,
      userHive: { includeDefaultUser: false },
      description: "",
    });
    expect(item).not.toHaveProperty("notes");
  });
});
