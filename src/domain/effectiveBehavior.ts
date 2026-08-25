import type {
  DeletionMode,
  RegistryHive,
  RegistryDefinition,
  RegistryValue,
  RegistryView,
  RollbackMode,
} from "./registry/model";
import type { PrimaryDeploymentTarget } from "./workspace/deployment";
import type {
  DeploymentPackage,
  RegistryItem,
  UserHiveConfiguration,
  UserHiveTarget,
} from "./workspace/workspace";

export type RegistryMutationKind =
  "SetValue" | "DeleteValue" | "DeleteValueAndEmptyKey" | "DeleteKeyRecursive";

export type EffectiveMutation =
  | { kind: "SetValue"; value: RegistryValue }
  | { kind: "DeleteValue" }
  | { kind: "DeleteValueAndEmptyKey" }
  | { kind: "DeleteKeyRecursive" };

export type EffectiveRevertMutation =
  { kind: "SetValue"; value: RegistryValue } | { kind: "DeleteValue" };

export type EffectiveRegistryView = {
  requested: Exclude<RegistryView, "Both">;
  architecture: "Registry32" | "Registry64";
};

export type EffectiveUserHive = {
  target?: UserHiveTarget;
  includeDefaultUser: boolean;
};

export type RevertConfigurationIssue = "RecursiveDelete" | "AbsentDeleteManagedValue";

export type ActiveRegistryItemFields = {
  valueName: boolean;
  value: boolean;
  deletionMode: boolean;
  revert: boolean;
  revertValue: boolean;
  userHive: boolean;
  defaultUser: boolean;
};

type DesiredRegistrySource = Pick<RegistryDefinition, "desiredState" | "deletionMode" | "value">;

type EffectiveDesiredData =
  | {
      desiredState: "Present";
      hive: RegistryHive;
      keyPath: string;
      valueName: string;
      value: RegistryValue;
      view: RegistryView;
    }
  | {
      desiredState: "Absent";
      deletionMode: "KeyRecursive";
      hive: RegistryHive;
      keyPath: string;
      view: RegistryView;
    }
  | {
      desiredState: "Absent";
      deletionMode: Exclude<DeletionMode, "KeyRecursive">;
      hive: RegistryHive;
      keyPath: string;
      valueName: string;
      view: RegistryView;
    };

type EffectiveRevertData = {
  rollbackMode?: Exclude<RollbackMode, "None">;
  rollbackValue?: RegistryValue;
};

export type EffectiveRegistryItemBehavior = {
  registry: EffectiveDesiredData & EffectiveRevertData;
  userHive?: EffectiveUserHive;
};

function assertNever(value: never): never {
  throw new Error(`Unsupported domain value: ${String(value)}`);
}

export function effectiveDesiredMutationForRegistry(
  registry: DesiredRegistrySource,
): EffectiveMutation {
  if (registry.desiredState === "Present") {
    return { kind: "SetValue", value: registry.value };
  }
  switch (registry.deletionMode) {
    case "Value":
      return { kind: "DeleteValue" };
    case "KeyIfEmpty":
      return { kind: "DeleteValueAndEmptyKey" };
    case "KeyRecursive":
      return { kind: "DeleteKeyRecursive" };
    default:
      return assertNever(registry.deletionMode);
  }
}

export function effectiveDesiredMutation(item: RegistryItem): EffectiveMutation {
  return effectiveDesiredMutationForRegistry(item.registry);
}

export function effectiveRollbackMode(item: RegistryItem, pkg: DeploymentPackage): RollbackMode {
  const revert = effectiveRevertMutation(item, pkg);
  if (!revert) return "None";
  return revert.kind === "DeleteValue" ? "DeleteManagedValue" : "SetDefinedRollbackValue";
}

export function configuredRevertIssue(
  item: RegistryItem,
  pkg: DeploymentPackage,
): RevertConfigurationIssue | undefined {
  return configuredRegistryRevertIssue(item.registry, pkg.deployment.method);
}

export function configuredRegistryRevertIssue(
  registry: Pick<RegistryDefinition, "desiredState" | "deletionMode" | "rollbackMode">,
  method: PrimaryDeploymentTarget,
): RevertConfigurationIssue | undefined {
  if (method !== "Win32App" || registry.rollbackMode === "None") {
    return undefined;
  }
  if (registry.desiredState === "Absent") {
    if (registry.deletionMode === "KeyRecursive") return "RecursiveDelete";
    if (registry.rollbackMode === "DeleteManagedValue") {
      return "AbsentDeleteManagedValue";
    }
  }
  return undefined;
}

export function effectiveRevertMutation(
  item: RegistryItem,
  pkg: DeploymentPackage,
): EffectiveRevertMutation | undefined {
  if (
    pkg.deployment.method !== "Win32App" ||
    item.registry.rollbackMode === "None" ||
    configuredRevertIssue(item, pkg)
  ) {
    return undefined;
  }
  switch (item.registry.rollbackMode) {
    case "DeleteManagedValue":
      return { kind: "DeleteValue" };
    case "SetDefinedRollbackValue":
      return { kind: "SetValue", value: item.registry.rollbackValue };
    default:
      return assertNever(item.registry.rollbackMode);
  }
}

export function effectiveRegistryViews(
  view: RegistryView,
  runIn64BitPowerShell: boolean,
): readonly EffectiveRegistryView[] {
  switch (view) {
    case "Auto":
      return [
        {
          requested: "Auto",
          architecture: runIn64BitPowerShell ? "Registry64" : "Registry32",
        },
      ];
    case "Registry32":
      return [{ requested: "Registry32", architecture: "Registry32" }];
    case "Registry64":
      return [{ requested: "Registry64", architecture: "Registry64" }];
    case "Both":
      return [
        { requested: "Registry32", architecture: "Registry32" },
        { requested: "Registry64", architecture: "Registry64" },
      ];
    default:
      return assertNever(view);
  }
}

export function effectiveUserHive(
  item: RegistryItem,
  pkg: DeploymentPackage,
): EffectiveUserHive | undefined {
  if (pkg.deployment.runContext !== "System" || item.registry.hive !== "HKEY_CURRENT_USER") {
    return undefined;
  }
  return {
    ...(item.userHive.userHiveTarget ? { target: item.userHive.userHiveTarget } : {}),
    includeDefaultUser:
      item.userHive.userHiveTarget === "AllExistingProfiles" && item.userHive.includeDefaultUser,
  };
}

export function activeRegistryItemFields(
  item: RegistryItem,
  pkg: DeploymentPackage,
): ActiveRegistryItemFields {
  const desired = effectiveDesiredMutation(item);
  const userHive = effectiveUserHive(item, pkg);
  const revert = pkg.deployment.method === "Win32App";
  return {
    valueName: desired.kind !== "DeleteKeyRecursive",
    value: desired.kind === "SetValue",
    deletionMode: item.registry.desiredState === "Absent",
    revert,
    revertValue:
      revert &&
      item.registry.rollbackMode === "SetDefinedRollbackValue" &&
      item.registry.deletionMode !== "KeyRecursive",
    userHive: userHive !== undefined,
    defaultUser: userHive?.target === "AllExistingProfiles",
  };
}

function desiredData(item: RegistryItem): EffectiveDesiredData {
  const registry = item.registry;
  if (registry.desiredState === "Present") {
    return {
      desiredState: registry.desiredState,
      hive: registry.hive,
      keyPath: registry.keyPath,
      valueName: registry.valueName,
      value: registry.value,
      view: registry.view,
    };
  }
  if (registry.deletionMode === "KeyRecursive") {
    return {
      desiredState: registry.desiredState,
      deletionMode: registry.deletionMode,
      hive: registry.hive,
      keyPath: registry.keyPath,
      view: registry.view,
    };
  }
  return {
    desiredState: registry.desiredState,
    deletionMode: registry.deletionMode,
    hive: registry.hive,
    keyPath: registry.keyPath,
    valueName: registry.valueName,
    view: registry.view,
  };
}

function revertData(item: RegistryItem, pkg: DeploymentPackage): EffectiveRevertData {
  const revert = effectiveRevertMutation(item, pkg);
  if (!revert) return {};
  if (revert.kind === "DeleteValue") return { rollbackMode: "DeleteManagedValue" };
  if (revert.kind === "SetValue") {
    return {
      rollbackMode: "SetDefinedRollbackValue",
      rollbackValue: revert.value,
    };
  }
  return assertNever(revert);
}

export function effectiveRegistryItemBehavior(
  item: RegistryItem,
  pkg: DeploymentPackage,
): EffectiveRegistryItemBehavior {
  const userHive = effectiveUserHive(item, pkg);
  return {
    registry: { ...desiredData(item), ...revertData(item, pkg) },
    ...(userHive ? { userHive } : {}),
  };
}

export function normalizeUserHiveTarget(
  current: UserHiveConfiguration,
  target?: UserHiveTarget,
): UserHiveConfiguration {
  return {
    ...(target ? { userHiveTarget: target } : {}),
    includeDefaultUser: target === "AllExistingProfiles" && current.includeDefaultUser,
  };
}

export function normalizeRevertForDesiredState(
  rollbackMode: RollbackMode,
  desiredState: RegistryItem["registry"]["desiredState"],
  deletionMode: DeletionMode,
): RollbackMode {
  if (
    desiredState === "Absent" &&
    (deletionMode === "KeyRecursive" || rollbackMode === "DeleteManagedValue")
  ) {
    return "None";
  }
  return rollbackMode;
}
