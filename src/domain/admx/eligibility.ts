import { effectiveRevertMutation, effectiveUserHive } from "../effectiveBehavior";
import type { RegistryDefinition, RegistryValue } from "../registry/model";
import type { DeploymentPackage, RegistryItem } from "../workspace/workspace";
import { admxRejection, type AdmxRejection } from "./reasons";

const SUPPORTED_TYPES = new Set(["String", "ExpandString", "DWord"]);
const BLOCKED_PREFIXES = ["system", "software\\microsoft", "software\\policies\\microsoft"];
const SENSITIVE_VALUE_NAME = /(password|secret|token|credential|key)$/i;
const POLICIES_PRODUCT = /^software\\policies\\[^\\]+\\[^\\]+/;

export type AdmxPolicyClass = "Machine" | "User";

export type AdmxEligibility =
  | { status: "accepted"; policyClass: AdmxPolicyClass }
  | { status: "rejected"; reasons: AdmxRejection[] };

export function isValidAdmxValueData(value: RegistryValue): boolean {
  switch (value.type) {
    case "String":
    case "ExpandString":
      return !value.data.includes("\0");
    case "DWord":
      return Number.isInteger(value.data) && value.data >= 0 && value.data <= 4_294_967_295;
    default:
      return false;
  }
}

export function isMalformedAdmxKeyPath(keyPath: string): boolean {
  return (
    keyPath.startsWith("\\") ||
    keyPath.endsWith("\\") ||
    keyPath.includes("\\\\") ||
    keyPath.includes("/") ||
    keyPath.includes("\0")
  );
}

export function assessAdmxRegistryDefinition(registry: RegistryDefinition): AdmxRejection[] {
  const reasons: AdmxRejection[] = [];
  if (registry.desiredState !== "Present") {
    reasons.push(admxRejection("DesiredStateNotPresent"));
  }
  if (registry.valueName.includes("\0")) {
    reasons.push(admxRejection("MalformedValueName"));
  } else if (registry.valueName.trim() === "") {
    reasons.push(admxRejection("UnnamedValue"));
  }
  if (SENSITIVE_VALUE_NAME.test(registry.valueName)) {
    reasons.push(admxRejection("SensitiveValueName"));
  }
  if (!SUPPORTED_TYPES.has(registry.value.type)) {
    reasons.push(admxRejection("UnsupportedType"));
  } else if (!isValidAdmxValueData(registry.value)) {
    reasons.push(admxRejection("InvalidValueData"));
  }
  if (registry.view !== "Auto") {
    reasons.push(admxRejection("ExplicitRegistryView"));
  }

  const keyPath = registry.keyPath;
  if (keyPath.trim() === "") {
    reasons.push(admxRejection("EmptyKeyPath"));
    return reasons;
  }
  if (isMalformedAdmxKeyPath(keyPath)) {
    reasons.push(admxRejection("MalformedKeyPath"));
    return reasons;
  }

  const normalized = keyPath.toLowerCase();
  if (/(^|\\)wow6432node(\\|$)/.test(normalized)) {
    reasons.push(admxRejection("Wow6432NodePath"));
  }
  if (
    BLOCKED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix + "\\"))
  ) {
    reasons.push(admxRejection("MicrosoftRegistryLocation"));
  } else if (POLICIES_PRODUCT.test(normalized)) {
    return reasons;
  } else if (normalized.startsWith("software\\")) {
    reasons.push(admxRejection("ViewDependentKeyPath"));
  } else {
    reasons.push(admxRejection("UnsupportedKeyPath"));
  }
  return reasons;
}

export function assessAdmxEligibility(item: RegistryItem, pkg: DeploymentPackage): AdmxEligibility {
  const reasons = assessAdmxRegistryDefinition(item.registry);
  const userHive = effectiveUserHive(item, pkg);
  if (userHive) {
    reasons.push(admxRejection("SystemUserHiveTargeting"));
    if (userHive.includeDefaultUser) {
      reasons.push(admxRejection("DefaultUserProcessing"));
    }
  }
  if (effectiveRevertMutation(item, pkg)) {
    reasons.push(admxRejection("RevertConfigured"));
  }
  if (reasons.length > 0) {
    return { status: "rejected", reasons };
  }
  return {
    status: "accepted",
    policyClass: item.registry.hive === "HKEY_LOCAL_MACHINE" ? "Machine" : "User",
  };
}
