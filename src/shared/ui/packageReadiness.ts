import type { DeploymentPackage } from "../../domain/workspace/workspace";
import type { PackageValidationIssue } from "../../domain/validation/workspaceValidation";
import { countLabel } from "./grammar";

export const EMPTY_PACKAGE_REASON = "Add at least one Registry Item.";

export interface PackageReadiness {
  label: string;
  tone: "incomplete" | "error" | "warning" | "ready";
  reason?: string;
  downloadable: boolean;
}

export function packageReadiness(
  pkg: DeploymentPackage,
  issues: readonly PackageValidationIssue[],
): PackageReadiness {
  if (pkg.items.length === 0) {
    return {
      label: "Incomplete",
      tone: "incomplete",
      reason: EMPTY_PACKAGE_REASON,
      downloadable: false,
    };
  }

  const errors = issues.filter((issue) => issue.severity === "Error");
  if (errors.length > 0) {
    return {
      label: countLabel(errors.length, "error"),
      tone: "error",
      reason: errors[0]!.message,
      downloadable: false,
    };
  }

  const warnings = issues.filter((issue) => issue.severity === "Warning");
  if (warnings.length > 0) {
    return {
      label: countLabel(warnings.length, "warning"),
      tone: "warning",
      reason: warnings[0]!.message,
      downloadable: true,
    };
  }

  return { label: "Ready", tone: "ready", downloadable: true };
}
