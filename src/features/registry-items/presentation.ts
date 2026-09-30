import { displayValue } from "../../domain/registry/model";
import { effectiveDesiredMutation } from "../../domain/effectiveBehavior";
import {
  defaultUserHive,
  UNTITLED_PACKAGE_NAME,
  type DeploymentPackage,
  type RegistryItem,
} from "../../domain/workspace/workspace";
import { deploymentTargetDefinition } from "../../domain/workspace/deployment";
import type { ParsedRegistryCandidate } from "../../serialization/registryFileDecoder";

export function itemFromImport(candidate: ParsedRegistryCandidate): RegistryItem {
  return {
    id: candidate.id,
    enabled: candidate.enabled,
    registry: candidate.registry,
    userHive: defaultUserHive(),
    description: "",
  };
}

export function technicalType(item: RegistryItem): string {
  const labels: Record<RegistryItem["registry"]["value"]["type"], string> = {
    String: "SZ",
    ExpandString: "EXPAND_SZ",
    MultiString: "MULTI_SZ",
    Binary: "BINARY",
    DWord: "DWORD",
    QWord: "QWORD",
  };
  return labels[item.registry.value.type];
}

export function shortHive(item: RegistryItem): string {
  return item.registry.hive === "HKEY_LOCAL_MACHINE" ? "HKLM" : "HKCU";
}

export function itemValue(item: RegistryItem): string {
  const desired = effectiveDesiredMutation(item);
  switch (desired.kind) {
    case "SetValue":
      return displayValue(desired.value) || "Empty value";
    case "DeleteValue":
      return "Delete value";
    case "DeleteValueAndEmptyKey":
      return "Delete value + empty key";
    case "DeleteKeyRecursive":
      return "Delete key tree";
  }
}

export function packageMethod(pkg: DeploymentPackage): string {
  return deploymentTargetDefinition(pkg.deployment.method).label;
}

/** What the generator produces for a delivery method, so the choice names its result. */
export function packageOutputLabel(method: DeploymentPackage["deployment"]["method"]): string {
  if (method === "Remediation") return "Detect.ps1, Remediate.ps1, and DryRun.ps1";
  if (method === "PlatformScript") return "Apply.ps1 and DryRun.ps1";
  return "Install.ps1, Detect.ps1, and Uninstall.ps1 where defined";
}

/**
 * True while the name is still the suggestion the product made. The header draws such a name muted, so
 * an untouched package reads as not yet named instead of as a name someone chose.
 */
export function isSuggestedPackageName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === UNTITLED_PACKAGE_NAME) return true;
  // The suggestion carries a number when the plain name is taken, so only that suffix is allowed.
  const suffix = trimmed.slice(UNTITLED_PACKAGE_NAME.length);
  return suffix.startsWith(" ") && /^\d+$/.test(suffix.slice(1));
}

export function runContext(pkg: DeploymentPackage): string {
  return pkg.deployment.runContext === "System" ? "SYSTEM" : "Logged-on user";
}
