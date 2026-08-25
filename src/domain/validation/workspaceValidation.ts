import type { DeploymentPackage, RegistryItem, RegistryWorkspace } from "../workspace/workspace";
import {
  effectiveDesiredMutation,
  effectiveRegistryViews,
  effectiveUserHive,
} from "../effectiveBehavior";
import {
  validateRegistryItem as validateItemDefinition,
  type IssueSeverity,
  type ValidationIssue,
} from "./validate";

export type ItemField =
  | "enabled"
  | "desiredState"
  | "hive"
  | "keyPath"
  | "valueName"
  | "valueType"
  | "value"
  | "view"
  | "rollbackMode"
  | "rollbackValue"
  | "userHiveTarget"
  | "includeDefaultUser";

export type PackageField = "name" | "method" | "runContext";
export type ValidationField = ItemField | PackageField;

export interface PackageValidationIssue extends ValidationIssue {
  packageId: string;
  itemId?: string;
  scope: "package" | "item";
  field?: ValidationField;
}

export type ItemValidationIssue = PackageValidationIssue;

const itemFieldByCode: Record<string, ItemField> = {
  "invalid-hive": "hive",
  "invalid-key-path": "keyPath",
  "invalid-value-name": "valueName",
  "invalid-view": "view",
  "invalid-multi-string": "value",
  "invalid-binary": "value",
  "invalid-dword": "value",
  "invalid-qword": "value",
  "invalid-rollback-multi-string": "rollbackValue",
  "invalid-rollback-binary": "rollbackValue",
  "invalid-rollback-dword": "rollbackValue",
  "invalid-rollback-qword": "rollbackValue",
  "recursive-revert-unsupported": "rollbackMode",
  "absent-delete-revert-invalid": "rollbackMode",
  "recursive-delete": "keyPath",
  "policy-path": "keyPath",
  "auto-view": "view",
  "auto-view-wow-risk": "view",
  "win32-no-uninstall": "rollbackMode",
  "sensitive-data": "valueName",
};

function packageIssue(
  pkg: DeploymentPackage,
  code: string,
  severity: IssueSeverity,
  message: string,
  field?: PackageField,
): PackageValidationIssue {
  return {
    code,
    severity,
    message,
    packageId: pkg.id,
    scope: "package",
    ...(field ? { field } : {}),
  };
}

function itemIssue(
  pkg: DeploymentPackage,
  item: RegistryItem,
  code: string,
  severity: IssueSeverity,
  message: string,
  field?: ValidationField,
): PackageValidationIssue {
  return {
    code,
    severity,
    message,
    itemId: item.id,
    packageId: pkg.id,
    scope: "item",
    ...(field ? { field } : {}),
  };
}

type ConflictView = "Registry32" | "Registry64";
type ConflictScope = { kind: "exact"; key: string } | { kind: "dynamic-profiles" };
type ConflictIndex = Map<string, Map<string, RegistryItem>>;

function conflictViews(item: RegistryItem, pkg: DeploymentPackage): readonly ConflictView[] {
  return effectiveRegistryViews(item.registry.view, pkg.deployment.runIn64BitPowerShell).map(
    (view) => view.architecture,
  );
}

function conflictScopes(item: RegistryItem, pkg: DeploymentPackage): readonly ConflictScope[] {
  const userHive = effectiveUserHive(item, pkg);
  if (!userHive) {
    return [{ kind: "exact", key: item.registry.hive }];
  }
  const scopes: ConflictScope[] = [];
  if (userHive.target) {
    scopes.push({ kind: "dynamic-profiles" });
  } else {
    scopes.push({ kind: "exact", key: `invalid:${item.id}` });
  }
  if (userHive.includeDefaultUser) {
    scopes.push({ kind: "exact", key: "default-user" });
  }
  return scopes;
}

function intentSignature(item: RegistryItem): string {
  return item.registry.desiredState === "Absent"
    ? "Absent"
    : `Present:${item.registry.value.type}:${JSON.stringify(item.registry.value.data)}`;
}

function pathPrefixes(path: string): string[] {
  const segments = path.toLowerCase().split("\\");
  return segments.map((_, index) => segments.slice(0, index + 1).join("\\"));
}

function seenAt(index: ConflictIndex, key: string): Map<string, RegistryItem> {
  const current = index.get(key);
  if (current) return current;
  const created = new Map<string, RegistryItem>();
  index.set(key, created);
  return created;
}

function scopeKey(location: string, scope: ConflictScope): string {
  return scope.kind === "dynamic-profiles"
    ? `${location}|profiles:*`
    : `${location}|target:${scope.key}`;
}

function validatePackageConflicts(pkg: DeploymentPackage): PackageValidationIssue[] {
  const issues: PackageValidationIssue[] = [];
  const emitted = new Set<string>();
  const exactValues: ConflictIndex = new Map();
  const subtreeEntries: ConflictIndex = new Map();
  const recursiveKeys: ConflictIndex = new Map();

  const emit = (item: RegistryItem, code: string, severity: IssueSeverity, message: string) => {
    const key = `${item.id}|${code}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    issues.push(itemIssue(pkg, item, code, severity, message, "keyPath"));
  };

  const inspect = (
    index: ConflictIndex,
    key: string,
    intent: string,
    item: RegistryItem,
    warnOnSame: boolean,
    recursive: boolean,
  ) => {
    const seen = index.get(key);
    if (!seen || seen.size === 0) return;
    if ([...seen.keys()].some((candidate) => candidate !== intent)) {
      emit(
        item,
        recursive ? "conflicting-recursive-delete" : "conflicting-entry",
        "Error",
        recursive
          ? "Recursive key deletion conflicts with another enabled item in the same key subtree, Registry view, and execution target."
          : "This enabled item conflicts with another item targeting an overlapping Registry view and execution target.",
      );
    } else if (warnOnSame && seen.has(intent)) {
      emit(
        item,
        recursive ? "redundant-recursive-delete" : "duplicate-entry",
        "Warning",
        recursive
          ? "This enabled item is redundant with a recursive key deletion in the same Registry view and execution target."
          : "This enabled item overlaps another item with the same exact desired state.",
      );
    }
  };

  const inspectScopes = (
    index: ConflictIndex,
    location: string,
    scopes: readonly ConflictScope[],
    intent: string,
    item: RegistryItem,
    recursive: boolean,
  ) => {
    for (const scope of scopes) {
      inspect(index, scopeKey(location, scope), intent, item, true, recursive);
    }
  };

  const addScopes = (
    index: ConflictIndex,
    location: string,
    scopes: readonly ConflictScope[],
    intent: string,
    item: RegistryItem,
  ) => {
    for (const scope of scopes) {
      const key = scopeKey(location, scope);
      if (!seenAt(index, key).has(intent)) seenAt(index, key).set(intent, item);
    }
  };

  for (const item of pkg.items.filter((candidate) => candidate.enabled)) {
    const keyPath = item.registry.keyPath.toLowerCase();
    const scopes = conflictScopes(item, pkg);
    const intent = intentSignature(item);
    const recursive = effectiveDesiredMutation(item).kind === "DeleteKeyRecursive";

    for (const view of conflictViews(item, pkg)) {
      const base = `${item.registry.hive}|${view}`;
      if (!recursive) {
        const valueLocation = `${base}|${keyPath}|${item.registry.valueName.toLowerCase()}`;
        inspectScopes(exactValues, valueLocation, scopes, intent, item, false);
        addScopes(exactValues, valueLocation, scopes, intent, item);
      }

      if (recursive) {
        inspectScopes(subtreeEntries, `${base}|${keyPath}`, scopes, "Absent", item, true);
      }
      for (const prefix of pathPrefixes(keyPath)) {
        inspectScopes(
          recursiveKeys,
          `${base}|${prefix}`,
          scopes,
          item.registry.desiredState,
          item,
          true,
        );
      }
      for (const prefix of pathPrefixes(keyPath)) {
        addScopes(subtreeEntries, `${base}|${prefix}`, scopes, item.registry.desiredState, item);
      }
      if (recursive) {
        addScopes(recursiveKeys, `${base}|${keyPath}`, scopes, "Absent", item);
      }
    }
  }
  return issues;
}

export function validateRegistryItem(
  item: RegistryItem,
  pkg: DeploymentPackage,
): PackageValidationIssue[] {
  const issues = validateItemDefinition(item, pkg.deployment.method)
    .filter((issue) => issue.itemId === item.id && issue.code !== "auto-view")
    .map((issue): PackageValidationIssue => ({
      ...issue,
      packageId: pkg.id,
      itemId: item.id,
      scope: "item",
      ...(itemFieldByCode[issue.code] ? { field: itemFieldByCode[issue.code] } : {}),
    }));

  const userHive = effectiveUserHive(item, pkg);
  if (userHive && !userHive.target) {
    issues.push(
      itemIssue(
        pkg,
        item,
        "system-hkcu-target-required",
        "Error",
        "Choose which user hive SYSTEM should target.",
        "userHiveTarget",
      ),
    );
  }
  if (userHive && userHive.target !== "AllExistingProfiles" && item.userHive.includeDefaultUser) {
    issues.push(
      itemIssue(
        pkg,
        item,
        "default-user-target",
        "Error",
        "Default User is available only with all existing user profiles.",
        "includeDefaultUser",
      ),
    );
  }
  if (item.registry.hive === "HKEY_LOCAL_MACHINE" && pkg.deployment.runContext === "LoggedOnUser") {
    issues.push(
      itemIssue(
        pkg,
        item,
        "hklm-user-elevation",
        "Warning",
        "HKLM normally requires elevation; a logged-on user package may fail without rights.",
        "runContext",
      ),
    );
  }
  if (userHive?.includeDefaultUser) {
    issues.push(
      itemIssue(
        pkg,
        item,
        "default-user-risk",
        "Warning",
        "Default User uses C:\\Users\\Default\\NTUSER.DAT and affects every future profile.",
        "includeDefaultUser",
      ),
    );
  }
  if (
    userHive &&
    pkg.deployment.method === "PlatformScript" &&
    userHive.target === "AllExistingProfiles"
  ) {
    issues.push(
      itemIssue(
        pkg,
        item,
        "platform-all-profiles-lifecycle",
        "Warning",
        "Platform Script applies only to profiles present when it runs; later profiles and drift are not automatically handled.",
        "userHiveTarget",
      ),
    );
  }

  return issues;
}

export function validateDeploymentPackage(pkg: DeploymentPackage): PackageValidationIssue[] {
  const issues: PackageValidationIssue[] = [];
  if (!pkg.name.trim()) {
    issues.push(packageIssue(pkg, "package-name", "Error", "Package name is required.", "name"));
  }
  if (pkg.items.length > 0 && !pkg.items.some((item) => item.enabled)) {
    issues.push(
      packageIssue(
        pkg,
        "package-no-enabled-items",
        "Error",
        "Enable at least one Registry Item before review or download.",
      ),
    );
  }
  issues.push(...pkg.items.flatMap((item) => validateRegistryItem(item, pkg)));

  issues.push(...validatePackageConflicts(pkg));
  return issues;
}

function identity(item: RegistryItem): string {
  return [
    item.registry.hive,
    item.registry.keyPath.toLowerCase(),
    item.registry.valueName.toLowerCase(),
    item.registry.view,
  ].join("|");
}

export function validateWorkspace(workspace: RegistryWorkspace): PackageValidationIssue[] {
  const issues = workspace.packages.flatMap(validateDeploymentPackage);
  const targets = new Map<string, { pkg: DeploymentPackage; item: RegistryItem }>();
  for (const pkg of workspace.packages) {
    for (const item of pkg.items.filter((candidate) => candidate.enabled)) {
      const key = identity(item);
      const previous = targets.get(key);
      if (previous && previous.pkg.id !== pkg.id) {
        issues.push(
          itemIssue(
            pkg,
            item,
            "overlapping-package-item",
            "Warning",
            `This item targets the same Registry location as an item in “${previous.pkg.name}”; Deployment Packages remain independent.`,
            "valueName",
          ),
        );
      } else if (!previous) {
        targets.set(key, { pkg, item });
      }
    }
  }
  return issues;
}

export function issueForField(
  issues: readonly PackageValidationIssue[],
  field: ValidationField,
  severity: IssueSeverity,
): PackageValidationIssue | undefined {
  return issues.find((issue) => issue.field === field && issue.severity === severity);
}
