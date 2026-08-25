import { describe, expect, it } from "vitest";

import { createDeploymentPackage, createRegistryItem } from "../workspace/workspace";
import { validateGeneratedPackageOutput } from "./packageOutputValidation";

function platformPackage(value: string) {
  const item = createRegistryItem();
  item.registry.keyPath = "Software\\Contoso";
  item.registry.value = { type: "String", data: value };
  return createDeploymentPackage({
    name: "Platform settings",
    deployment: { ...createDeploymentPackage().deployment, method: "PlatformScript" },
    items: [item],
  });
}

describe("generated package output validation", () => {
  it("accepts normal Platform Script output", () => {
    expect(validateGeneratedPackageOutput(platformPackage("enabled"))).toEqual([]);
  });

  it("blocks Platform Script output at the Intune 200 KB boundary", () => {
    expect(validateGeneratedPackageOutput(platformPackage("x".repeat(210_000)))).toEqual([
      expect.objectContaining({ code: "platform-script-size", severity: "Error" }),
    ]);
  });
});
