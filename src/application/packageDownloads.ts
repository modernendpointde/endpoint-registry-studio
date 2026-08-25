import type { DeploymentPackage } from "../domain/workspace/workspace";
import { EMPTY_PACKAGE_REASON } from "../shared/ui/packageReadiness";
import { countLabel } from "../shared/ui/grammar";
import { validatePackageForDownload } from "../domain/validation/packageOutputValidation";

export type DownloadAuthorization =
  | { allowed: true; confirmation?: string }
  | { allowed: false; tone: "info" | "error"; message: string };

export function authorizePackageDownload(
  packages: readonly DeploymentPackage[],
  bulk = false,
): DownloadAuthorization {
  if (packages.length === 0)
    return { allowed: false, tone: "info", message: "Select at least one Deployment Package." };
  if (packages.some((pkg) => pkg.items.length === 0))
    return { allowed: false, tone: "info", message: EMPTY_PACKAGE_REASON };

  const issues = packages.flatMap(validatePackageForDownload);
  const errors = issues.filter((issue) => issue.severity === "Error");
  if (errors.length)
    return {
      allowed: false,
      tone: "error",
      message: `Resolve ${countLabel(errors.length, "blocking error")} before downloading.`,
    };

  const warnings = issues.filter((issue) => issue.severity === "Warning");
  if (!bulk && warnings.length === 0) return { allowed: true };
  const summary = bulk
    ? `${countLabel(packages.length, "Deployment Package")} will be downloaded in separate folders. Workspace JSON and a manifest are included.`
    : "One Deployment Package will be downloaded.";
  const warningText = warnings.length
    ? `\n\nReview and accept ${countLabel(warnings.length, "warning")}:\n${warnings.map((warning) => `• ${warning.message}`).join("\n")}`
    : "";
  return { allowed: true, confirmation: `${summary}${warningText}` };
}
