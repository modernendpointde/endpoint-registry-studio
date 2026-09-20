import {
  cloneRegistryDefinition,
  createRegistryDefinition,
  createId,
  type RegistryDefinition,
  type RegistryValue,
} from "../registry/model";
import type { DeploymentPackage, RegistryItem } from "../workspace/workspace";
import {
  assessAdmxEligibility,
  assessAdmxRegistryDefinition,
  isValidAdmxValueData,
  type AdmxPolicyClass,
} from "./eligibility";
import type { AdmxRejection } from "./reasons";
import {
  admxNamespace,
  isAdmxTemplateVersion,
  isAdmxToken,
  isReservedAdmxNamespace,
} from "./identifiers";

export type AdmxValueMode = "Unspecified" | "Fixed" | "ProfileInput";

export type AdmxEnabledBehavior = { kind: "Unspecified" } | { kind: "WritePresentValue" };

export type AdmxDisabledBehavior =
  | { kind: "Unspecified" }
  | { kind: "DeleteValue" }
  | { kind: "WriteFixedValue"; value: RegistryValue };

export type AdmxNotConfiguredBehavior =
  { kind: "Unspecified" } | { kind: "DeleteValue" } | { kind: "LeaveExisting" };

export const ADMX_TEMPLATE_ISSUES = [
  "TemplateNameMissing",
  "TemplateVersionInvalid",
  "VendorIdInvalid",
  "ProductIdInvalid",
  "NamespaceReserved",
  "PolicyIdInvalid",
  "PolicyIdDuplicate",
  "DisplayNameMissing",
  "ExplainTextMissing",
  "CategoryMissing",
  "ValueModeUnspecified",
  "EnabledBehaviorUnspecified",
  "DisabledBehaviorUnspecified",
  "NotConfiguredBehaviorUnspecified",
  "NotConfiguredLeaveExistingUnsupported",
  "ExpandStringRequiresProfileInput",
  "DisabledValueInvalid",
  "DwordRangeInvalid",
  "SnapshotIneligible",
  "PolicyClassMismatch",
  "RegistryTargetDuplicate",
] as const;

export type AdmxTemplateIssueCode = (typeof ADMX_TEMPLATE_ISSUES)[number];

export interface AdmxTemplateIssue {
  code: AdmxTemplateIssueCode;
  message: string;
  policyId?: string;
}

export interface AdministrativeTemplatePolicy {
  id: string;
  /**
   * Present when the policy was derived from a Deployment Package item, absent when the author wrote the
   * Registry definition directly. The presence of the ID is the provenance.
   */
  registryItemId?: string;
  policyClass: AdmxPolicyClass;
  snapshot: RegistryDefinition;
  displayName: string;
  explainText: string;
  category: string;
  policyId: string;
  valueMode: AdmxValueMode;
  dwordMin?: number;
  dwordMax?: number;
  enabledBehavior: AdmxEnabledBehavior;
  disabledBehavior: AdmxDisabledBehavior;
  notConfiguredBehavior: AdmxNotConfiguredBehavior;
}

export interface AdministrativeTemplate {
  id: string;
  name: string;
  version: string;
  vendorId: string;
  productId: string;
  policies: AdministrativeTemplatePolicy[];
}

export function createAdministrativeTemplate(
  overrides: Partial<AdministrativeTemplate> = {},
): AdministrativeTemplate {
  return {
    id: createId(),
    name: "",
    version: "",
    vendorId: "",
    productId: "",
    policies: [],
    ...overrides,
  };
}

export function createPolicyDraftFromItem(
  item: RegistryItem,
  pkg: DeploymentPackage,
):
  | { status: "created"; policy: AdministrativeTemplatePolicy }
  | { status: "rejected"; reasons: AdmxRejection[] } {
  const eligibility = assessAdmxEligibility(item, pkg);
  if (eligibility.status === "rejected") {
    return { status: "rejected", reasons: eligibility.reasons };
  }
  return {
    status: "created",
    policy: {
      id: createId(),
      registryItemId: item.id,
      policyClass: eligibility.policyClass,
      snapshot: cloneRegistryDefinition(item.registry),
      displayName: "",
      explainText: "",
      category: "",
      policyId: "",
      valueMode: "Unspecified",
      enabledBehavior: { kind: "Unspecified" },
      disabledBehavior: { kind: "Unspecified" },
      notConfiguredBehavior: { kind: "Unspecified" },
    },
  };
}

/**
 * A policy whose Registry definition is written directly in the template instead of being derived from a
 * Deployment Package item. It starts empty and fail-closed: the validator rejects the missing path until
 * the author supplies one that ADMX can express.
 */
export function createAuthoredPolicy(
  overrides: Partial<AdministrativeTemplatePolicy> = {},
): AdministrativeTemplatePolicy {
  return {
    id: createId(),
    policyClass: "Machine",
    snapshot: createRegistryDefinition({ hive: "HKEY_LOCAL_MACHINE", keyPath: "", valueName: "" }),
    displayName: "",
    explainText: "",
    category: "",
    policyId: "",
    valueMode: "Unspecified",
    enabledBehavior: { kind: "Unspecified" },
    disabledBehavior: { kind: "Unspecified" },
    notConfiguredBehavior: { kind: "Unspecified" },
    ...overrides,
  };
}

function issue(code: AdmxTemplateIssueCode, message: string, policyId?: string): AdmxTemplateIssue {
  return policyId ? { code, message, policyId } : { code, message };
}

/**
 * Registry paths and value names are case-insensitive on Windows, so two policies that differ only in
 * casing still write the same value.
 *
 * The fold uses upper casing rather than `toLowerCase()`. Windows compares with ordinal upcasing, and
 * JavaScript lowercase mappings disagree with it for some characters: the Greek final sigma U+03C2
 * upcases to U+03A3 while it lowercases to itself. Missing such a pair would let two policies claim one
 * value, so the fold errs towards reporting an overlap. A false overlap blocks compilation and is
 * visible; a missed one would ship a template whose policies overwrite each other.
 */
export function foldRegistryName(value: string): string {
  return value.toUpperCase();
}

/**
 * The identity of a Registry value for conflict detection. The view is included, although every
 * eligible administrative-template policy uses the Auto view, so that the identity stays correct if the
 * supported set ever grows.
 */
export function registryValueIdentity(definition: RegistryDefinition): string {
  return [
    definition.hive,
    foldRegistryName(definition.keyPath),
    foldRegistryName(definition.valueName),
    definition.view,
  ].join("\u0000");
}

export function registryValueLabel(definition: RegistryDefinition): string {
  return `${definition.hive}\\${definition.keyPath}\\${definition.valueName} (view ${definition.view})`;
}

export function templateNamespace(template: AdministrativeTemplate): string {
  return admxNamespace(template.vendorId, template.productId);
}

export function validateAdministrativeTemplate(
  template: AdministrativeTemplate,
): AdmxTemplateIssue[] {
  const issues: AdmxTemplateIssue[] = [];
  if (template.name.trim() === "") {
    issues.push(issue("TemplateNameMissing", "Template name is required."));
  }
  if (!isAdmxTemplateVersion(template.version)) {
    issues.push(issue("TemplateVersionInvalid", "Template version must be in the form 1.2.3."));
  }
  if (!isAdmxToken(template.vendorId)) {
    issues.push(issue("VendorIdInvalid", "Vendor identifier must be an ADMX-safe token."));
  }
  if (!isAdmxToken(template.productId)) {
    issues.push(issue("ProductIdInvalid", "Product identifier must be an ADMX-safe token."));
  }
  if (
    isAdmxToken(template.vendorId) &&
    isAdmxToken(template.productId) &&
    isReservedAdmxNamespace(templateNamespace(template))
  ) {
    issues.push(
      issue(
        "NamespaceReserved",
        "Vendor and product namespace must not use a Microsoft or Windows prefix.",
      ),
    );
  }

  const seen = new Set<string>();
  const targets = new Map<string, AdministrativeTemplatePolicy>();
  for (const policy of template.policies) {
    if (!isAdmxToken(policy.policyId)) {
      issues.push(
        issue("PolicyIdInvalid", "Policy identifier must be an ADMX-safe token.", policy.id),
      );
    } else if (seen.has(policy.policyId)) {
      issues.push(
        issue("PolicyIdDuplicate", "Policy identifiers must be unique in the template.", policy.id),
      );
    } else {
      seen.add(policy.policyId);
    }
    if (policy.displayName.trim() === "") {
      issues.push(issue("DisplayNameMissing", "Policy display name is required.", policy.id));
    }
    if (policy.explainText.trim() === "") {
      issues.push(issue("ExplainTextMissing", "Policy explanatory text is required.", policy.id));
    }
    if (policy.category.trim() === "") {
      issues.push(issue("CategoryMissing", "Policy category is required.", policy.id));
    }
    if (policy.valueMode === "Unspecified") {
      issues.push(
        issue("ValueModeUnspecified", "Value mode must be authored before compile.", policy.id),
      );
    }
    if (policy.enabledBehavior.kind === "Unspecified") {
      issues.push(
        issue(
          "EnabledBehaviorUnspecified",
          "Enabled behavior must be authored before compile.",
          policy.id,
        ),
      );
    }
    if (policy.disabledBehavior.kind === "Unspecified") {
      issues.push(
        issue(
          "DisabledBehaviorUnspecified",
          "Disabled behavior must be authored before compile.",
          policy.id,
        ),
      );
    }
    if (policy.notConfiguredBehavior.kind === "Unspecified") {
      issues.push(
        issue(
          "NotConfiguredBehaviorUnspecified",
          "Not Configured behavior must be authored before compile.",
          policy.id,
        ),
      );
    }
    if (policy.notConfiguredBehavior.kind === "LeaveExisting") {
      issues.push(
        issue(
          "NotConfiguredLeaveExistingUnsupported",
          "ADMX cannot represent LeaveExisting for Not Configured.",
          policy.id,
        ),
      );
    }
    if (
      policy.snapshot.value.type === "ExpandString" &&
      (policy.valueMode === "Fixed" || policy.disabledBehavior.kind === "WriteFixedValue")
    ) {
      issues.push(
        issue(
          "ExpandStringRequiresProfileInput",
          "ExpandString can be represented only as an administrator-editable ADMX text element.",
          policy.id,
        ),
      );
    }
    if (policy.disabledBehavior.kind === "WriteFixedValue") {
      const authored = policy.disabledBehavior.value;
      if (authored.type !== policy.snapshot.value.type || !isValidAdmxValueData(authored)) {
        issues.push(
          issue(
            "DisabledValueInvalid",
            "Disabled WriteFixedValue must use a valid value of the snapshotted Registry type.",
            policy.id,
          ),
        );
      }
    }
    const expectedClass = policy.snapshot.hive === "HKEY_LOCAL_MACHINE" ? "Machine" : "User";
    if (policy.policyClass !== expectedClass) {
      issues.push(
        issue("PolicyClassMismatch", "Policy class must match the snapshotted hive.", policy.id),
      );
    }
    const snapshotReasons = assessAdmxRegistryDefinition(policy.snapshot);
    if (snapshotReasons.length > 0) {
      issues.push(
        issue(
          "SnapshotIneligible",
          snapshotReasons.map((reason) => reason.message).join(" "),
          policy.id,
        ),
      );
    }
    if (policy.valueMode === "ProfileInput" && policy.snapshot.value.type === "DWord") {
      const min = policy.dwordMin;
      const max = policy.dwordMax;
      if (
        min === undefined ||
        max === undefined ||
        !Number.isInteger(min) ||
        !Number.isInteger(max) ||
        min < 0 ||
        max > 4_294_967_295 ||
        min > max
      ) {
        issues.push(
          issue(
            "DwordRangeInvalid",
            "DWORD profile input requires an explicit integer range from 0 to 4294967295.",
            policy.id,
          ),
        );
      }
    }
    const identity = registryValueIdentity(policy.snapshot);
    const existing = targets.get(identity);
    if (existing) {
      issues.push(
        issue(
          "RegistryTargetDuplicate",
          `Policy "${policy.displayName || policy.policyId || "Untitled policy"}" and policy "${
            existing.displayName || existing.policyId || "Untitled policy"
          }" write the same Registry value: ${registryValueLabel(policy.snapshot)}. Give each policy its own Registry value before compiling.`,
          policy.id,
        ),
      );
    } else {
      targets.set(identity, policy);
    }
  }
  return issues;
}

export function isAdministrativeTemplateCompilable(template: AdministrativeTemplate): boolean {
  return template.policies.length > 0 && validateAdministrativeTemplate(template).length === 0;
}
