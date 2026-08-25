import { displayValue } from "../../domain/registry/model";
import { effectiveDesiredMutation } from "../../domain/effectiveBehavior";
import {
  defaultUserHive,
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

export function runContext(pkg: DeploymentPackage): string {
  return pkg.deployment.runContext === "System" ? "SYSTEM" : "Logged-on user";
}
