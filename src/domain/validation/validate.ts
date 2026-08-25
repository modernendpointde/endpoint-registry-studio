import type { PrimaryDeploymentTarget } from "../workspace/deployment";
import {
  configuredRegistryRevertIssue,
  effectiveDesiredMutationForRegistry,
} from "../effectiveBehavior";
import { HIVES, REGISTRY_VIEWS, normalizeQWord, type RegistryValue } from "../registry/model";
import type { RegistryItem } from "../workspace/workspace";

export type IssueSeverity = "Error" | "Warning" | "Info";

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  itemId?: string;
}

function issue(
  code: string,
  severity: IssueSeverity,
  message: string,
  itemId?: string,
): ValidationIssue {
  return itemId === undefined ? { code, severity, message } : { code, severity, message, itemId };
}

function validateValue(
  value: RegistryValue,
  itemId: string,
  codePrefix = "invalid",
  label = "",
): ValidationIssue[] {
  const code = (suffix: string) => `${codePrefix}-${suffix}`;
  const message = (text: string) => (label ? `${label} ${text.toLowerCase()}` : text);
  switch (value.type) {
    case "String":
    case "ExpandString":
      return [];
    case "MultiString":
      return value.data.every((item) => typeof item === "string")
        ? []
        : [
            issue(
              code("multi-string"),
              "Error",
              message("MultiString must contain only strings."),
              itemId,
            ),
          ];
    case "Binary": {
      const issues = value.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        ? []
        : [
            issue(
              code("binary"),
              "Error",
              message("Binary values must contain bytes from 0 to 255."),
              itemId,
            ),
          ];
      if (codePrefix === "invalid" && value.data.length > 4096) {
        issues.push(
          issue("large-binary", "Warning", "This Binary value is unusually large.", itemId),
        );
      }
      return issues;
    }
    case "DWord":
      return Number.isInteger(value.data) && value.data >= 0 && value.data <= 4_294_967_295
        ? []
        : [
            issue(
              code("dword"),
              "Error",
              message("DWORD must be an unsigned 32-bit integer."),
              itemId,
            ),
          ];
    case "QWord":
      return normalizeQWord(value.data) === value.data
        ? []
        : [
            issue(
              code("qword"),
              "Error",
              message("QWORD must be a canonical unsigned 64-bit decimal string."),
              itemId,
            ),
          ];
  }
}

export function validateRegistryItem(
  item: RegistryItem,
  method: PrimaryDeploymentTarget,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const registry = item.registry;
  const desired = effectiveDesiredMutationForRegistry(registry);
  if (!HIVES.includes(registry.hive)) {
    issues.push(issue("invalid-hive", "Error", "Unsupported Registry hive.", item.id));
  }
  if (
    registry.keyPath.trim() === "" ||
    registry.keyPath.startsWith("\\") ||
    registry.keyPath.endsWith("\\") ||
    registry.keyPath.includes("\\\\") ||
    registry.keyPath.includes("\0")
  ) {
    issues.push(
      issue(
        "invalid-key-path",
        "Error",
        "Key path must be a non-empty relative Registry path without empty segments or NUL characters.",
        item.id,
      ),
    );
  }
  if (desired.kind !== "DeleteKeyRecursive" && registry.valueName.includes("\0")) {
    issues.push(
      issue("invalid-value-name", "Error", "Value name must not contain a NUL character.", item.id),
    );
  }
  if (!REGISTRY_VIEWS.includes(registry.view)) {
    issues.push(issue("invalid-view", "Error", "Unsupported Registry view.", item.id));
  }
  if (desired.kind === "SetValue") {
    issues.push(...validateValue(desired.value, item.id));
  }
  if (method === "Win32App" && registry.rollbackMode === "SetDefinedRollbackValue") {
    issues.push(...validateValue(registry.rollbackValue, item.id, "invalid-rollback", "Revert"));
  }
  const revertIssue = configuredRegistryRevertIssue(registry, method);
  if (revertIssue === "RecursiveDelete") {
    issues.push(
      issue(
        "recursive-revert-unsupported",
        "Error",
        "A recursively deleted key cannot be restored by a single Registry-value Revert action.",
        item.id,
      ),
    );
  } else if (revertIssue === "AbsentDeleteManagedValue") {
    issues.push(
      issue(
        "absent-delete-revert-invalid",
        "Error",
        "Deleting the managed value is not a Revert action for an item whose desired state is Absent.",
        item.id,
      ),
    );
  }
  if (desired.kind === "DeleteKeyRecursive") {
    issues.push(
      issue(
        "recursive-delete",
        "Warning",
        "Recursive key deletion removes the key and all descendant values and keys.",
        item.id,
      ),
    );
  }
  if (/^software\\policies(?:\\|$)/i.test(registry.keyPath)) {
    issues.push(
      issue(
        "policy-path",
        "Warning",
        "This path is policy-managed and may be overwritten by another policy source.",
        item.id,
      ),
    );
  }
  if (item.enabled && registry.view === "Auto" && registry.hive === "HKEY_LOCAL_MACHINE") {
    issues.push(
      issue(
        /(^|\\)wow6432node(\\|$)/i.test(registry.keyPath) ? "auto-view-wow-risk" : "auto-view",
        "Warning",
        /(^|\\)wow6432node(\\|$)/i.test(registry.keyPath)
          ? "Auto uses the PowerShell host view and this path contains WOW6432Node; verify the intended effective view to avoid double redirection."
          : `Auto uses the PowerShell host architecture for ${method}; choose Registry32, Registry64, or Both when the view must be explicit.`,
        item.id,
      ),
    );
  }
  if (item.enabled && method === "PlatformScript") {
    issues.push(
      issue(
        "platform-once",
        "Warning",
        "Platform Scripts apply once and do not continuously enforce Registry state.",
        item.id,
      ),
    );
  }
  if (item.enabled && method === "Win32App" && registry.rollbackMode === "None") {
    issues.push(
      issue(
        "win32-no-uninstall",
        "Warning",
        "Win32 uninstall cannot reverse this entry because no Revert action is configured.",
        item.id,
      ),
    );
  }
  if (/(password|secret|token|credential|key)$/i.test(registry.valueName)) {
    issues.push(
      issue(
        "sensitive-data",
        "Warning",
        "The value name may contain sensitive information; protect exported files.",
        item.id,
      ),
    );
  }
  return issues;
}
