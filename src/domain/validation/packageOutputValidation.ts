import type { DeploymentPackage } from "../workspace/workspace";
import { generatePowerShell } from "../../generators/powershell";
import { validateDeploymentPackage, type PackageValidationIssue } from "./workspaceValidation";

export const PLATFORM_SCRIPT_MAX_BYTES = 200 * 1024;

export function validateGeneratedPackageOutput(pkg: DeploymentPackage): PackageValidationIssue[] {
  if (pkg.deployment.method !== "PlatformScript") return [];
  if (validateDeploymentPackage(pkg).some((issue) => issue.severity === "Error")) return [];

  const byteLength = new TextEncoder().encode(generatePowerShell(pkg, "Apply")).length;
  if (byteLength < PLATFORM_SCRIPT_MAX_BYTES) return [];
  return [
    {
      code: "platform-script-size",
      severity: "Error",
      message: `Apply.ps1 is ${byteLength.toLocaleString("en-US")} bytes. Intune Platform Scripts must be smaller than 200 KB; split this configuration into multiple Deployment Packages.`,
      packageId: pkg.id,
      scope: "package",
    },
  ];
}

export function validatePackageForDownload(pkg: DeploymentPackage): PackageValidationIssue[] {
  return [...validateDeploymentPackage(pkg), ...validateGeneratedPackageOutput(pkg)];
}
