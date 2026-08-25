import {
  activeRegistryItemFields,
  effectiveDesiredMutation,
  effectiveRollbackMode,
  effectiveRevertMutation,
  effectiveUserHive,
} from "../../domain/effectiveBehavior";
import { displayValue } from "../../domain/registry/model";
import {
  deploymentPackageLabel,
  packageFingerprint,
  registryItemLabel,
  type DeploymentPackage,
} from "../../domain/workspace/workspace";

function csvCell(value: string): string {
  const safeValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

export function packageCsv(pkg: DeploymentPackage): string {
  const header = [
    "PackageId",
    "PackageName",
    "PackageFingerprint",
    "ItemId",
    "ItemLabel",
    "Enabled",
    "State",
    "Hive",
    "KeyPath",
    "ValueName",
    "Type",
    "Value",
    "View",
    "DeletionMode",
    "RevertMode",
    "RevertType",
    "RevertValue",
    "Method",
    "RunContext",
    "UserHiveTarget",
    "IncludeDefaultUser",
  ];
  const rows = pkg.items.map((item) => {
    const fields = activeRegistryItemFields(item, pkg);
    const desired = effectiveDesiredMutation(item);
    const revert = effectiveRevertMutation(item, pkg);
    const userHive = effectiveUserHive(item, pkg);
    const present = desired.kind === "SetValue";
    return [
      pkg.id,
      deploymentPackageLabel(pkg),
      packageFingerprint(pkg),
      item.id,
      registryItemLabel(item),
      String(item.enabled),
      item.registry.desiredState,
      item.registry.hive,
      item.registry.keyPath,
      fields.valueName ? item.registry.valueName : "",
      present ? desired.value.type : "",
      present ? displayValue(desired.value) : "",
      item.registry.view,
      present ? "" : item.registry.deletionMode,
      pkg.deployment.method === "Win32App" ? effectiveRollbackMode(item, pkg) : "",
      revert?.kind === "SetValue" ? revert.value.type : "",
      revert?.kind === "SetValue" ? displayValue(revert.value) : "",
      pkg.deployment.method,
      pkg.deployment.runContext,
      userHive?.target ?? "",
      userHive?.target === "AllExistingProfiles" ? String(userHive.includeDefaultUser) : "",
    ];
  });
  return `${header.map(csvCell).join(",")}\r\n${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
