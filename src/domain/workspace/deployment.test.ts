import { describe, expect, it } from "vitest";

import { PRIMARY_DEPLOYMENT_TARGETS, deploymentTargetDefinition } from "./deployment";

describe("deployment targets", () => {
  it("defines every supported target with its user-facing label", () => {
    expect(PRIMARY_DEPLOYMENT_TARGETS).toEqual(["Remediation", "PlatformScript", "Win32App"]);
    expect(deploymentTargetDefinition("Win32App")).toEqual({ id: "Win32App", label: "Win32 App" });
  });
});
