import { describe, expect, it } from "vitest";

import { createDeploymentPackage, createRegistryItem } from "../../domain/workspace/workspace";
import { generatePowerShell } from "../../generators/powershell";
import { extractConfigurationBlock, scriptPreview } from "./outputPreview";

describe("output preview", () => {
  it("extracts only the deterministic Registry entry block", () => {
    const item = createRegistryItem();
    item.registry.keyPath = "SOFTWARE\\Preview";
    item.registry.valueName = "Setting";
    const script = generatePowerShell(
      createDeploymentPackage({ name: "Preview", items: [item] }),
      "Apply",
    );
    const block = extractConfigurationBlock(script);
    expect(block).toContain("$entries = @(");
    expect(block).toContain("SOFTWARE\\Preview");
    expect(block).not.toContain("function Open-RegistryBaseKey");
    expect(scriptPreview(script, "full")).toBe(script);
  });

  it("returns an explicit message for supporting files", () => {
    expect(extractConfigurationBlock("# README\n")).toMatch(/does not contain/);
  });
});
