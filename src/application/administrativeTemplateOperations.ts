import {
  createAdministrativeTemplate,
  createPolicyDraftFromItem,
  foldRegistryName,
  type AdministrativeTemplate,
  type AdministrativeTemplatePolicy,
  type AdmxRejection,
} from "../domain/admx";
import type {
  DeploymentPackage,
  RegistryItem,
  RegistryWorkspace,
} from "../domain/workspace/workspace";
import type { RegistryDefinition, RegistryValue } from "../domain/registry/model";
import { effectiveRevertMutation } from "../domain/effectiveBehavior";
import {
  assertAdministrativeTemplateSerializable,
  RegistryJsonImportError,
} from "../serialization/workspaceSchema";

export interface AdministrativeTemplateCandidate {
  packageId: string;
  packageName: string;
  item: RegistryItem;
  status: "accepted" | "rejected";
  policyClass?: "Machine" | "User";
  reasons: AdmxRejection[];
}

export function administrativeTemplateCandidates(
  workspace: RegistryWorkspace,
): AdministrativeTemplateCandidate[] {
  return workspace.packages.flatMap((pkg) =>
    pkg.items.map((item) => {
      const assessment = createPolicyDraftFromItem(item, pkg);
      return assessment.status === "created"
        ? {
            packageId: pkg.id,
            packageName: pkg.name,
            item,
            status: "accepted" as const,
            policyClass: assessment.policy.policyClass,
            reasons: [],
          }
        : {
            packageId: pkg.id,
            packageName: pkg.name,
            item,
            status: "rejected" as const,
            reasons: assessment.reasons,
          };
    }),
  );
}

function sourceItem(
  workspace: RegistryWorkspace,
  itemId: string,
): { pkg: DeploymentPackage; item: RegistryItem } | undefined {
  for (const pkg of workspace.packages) {
    const item = pkg.items.find((candidate) => candidate.id === itemId);
    if (item) return { pkg, item };
  }
  return undefined;
}

export function createAdministrativeTemplateDraft(
  workspace: RegistryWorkspace,
  selectedItemIds: ReadonlySet<string>,
): AdministrativeTemplate {
  const policies: AdministrativeTemplatePolicy[] = [];
  for (const itemId of selectedItemIds) {
    const source = sourceItem(workspace, itemId);
    if (!source) throw new Error("A selected Registry Item no longer exists.");
    const created = createPolicyDraftFromItem(source.item, source.pkg);
    if (created.status !== "created") {
      throw new Error(
        "A selected Registry Item is no longer eligible: " +
          created.reasons.map((reason) => reason.message).join(" "),
      );
    }
    policies.push(created.policy);
  }
  return createAdministrativeTemplate({ policies });
}

export function saveAdministrativeTemplate(
  workspace: RegistryWorkspace,
  template: AdministrativeTemplate,
  replacingId?: string,
): RegistryWorkspace {
  assertAdministrativeTemplateSerializable(template);
  const duplicate = workspace.administrativeTemplates.some(
    (candidate) => candidate.id === template.id && candidate.id !== replacingId,
  );
  if (duplicate) throw new Error("Administrative template ID already exists.");
  if (replacingId && !workspace.administrativeTemplates.some(({ id }) => id === replacingId)) {
    throw new Error("Administrative template to replace no longer exists.");
  }
  return {
    ...workspace,
    administrativeTemplates: replacingId
      ? workspace.administrativeTemplates.map((candidate) =>
          candidate.id === replacingId ? template : candidate,
        )
      : [...workspace.administrativeTemplates, template],
  };
}

export function administrativeTemplatePersistenceIssue(
  template: AdministrativeTemplate,
): string | undefined {
  try {
    assertAdministrativeTemplateSerializable(template);
    return undefined;
  } catch (error) {
    return error instanceof RegistryJsonImportError
      ? error.message
      : "Administrative template draft cannot be saved.";
  }
}

export function removeAdministrativeTemplate(
  workspace: RegistryWorkspace,
  templateId: string,
): RegistryWorkspace {
  return {
    ...workspace,
    administrativeTemplates: workspace.administrativeTemplates.filter(
      (template) => template.id !== templateId,
    ),
  };
}

function sameValue(a: RegistryValue, b: RegistryValue): boolean {
  if (a.type !== b.type) return false;
  const left = a.data;
  const right = b.data;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }
  if (Array.isArray(left) || Array.isArray(right)) return false;
  return left === right;
}

function sameDefinition(
  a: RegistryDefinition,
  b: RegistryDefinition,
  revertActive: boolean,
): boolean {
  return (
    a.desiredState === b.desiredState &&
    a.deletionMode === b.deletionMode &&
    a.hive === b.hive &&
    // Windows treats Registry paths and value names case-insensitively, so a change in case alone does
    // not change the effective setting.
    foldRegistryName(a.keyPath) === foldRegistryName(b.keyPath) &&
    foldRegistryName(a.valueName) === foldRegistryName(b.valueName) &&
    a.view === b.view &&
    sameValue(a.value, b.value) &&
    // Rollback fields only describe the setting when the package actually reverts.
    (!revertActive ||
      (a.rollbackMode === b.rollbackMode && sameValue(a.rollbackValue, b.rollbackValue)))
  );
}

/**
 * A policy keeps a frozen snapshot, so a later edit to the source item is not an error. The status only
 * tells the author that the two no longer agree, never that they must.
 */
export type PolicySnapshotStatus = "matches" | "differs" | "unavailable" | "authored";

export interface PolicySource {
  status: PolicySnapshotStatus;
  packageId?: string;
  packageName?: string;
  itemValueName?: string;
  item?: RegistryItem;
}

export function policySource(
  workspace: RegistryWorkspace,
  policy: AdministrativeTemplatePolicy,
): PolicySource {
  // Without a source ID the definition was written in the template itself; there is nothing to compare.
  if (policy.registryItemId === undefined) return { status: "authored" };
  for (const pkg of workspace.packages) {
    const item = pkg.items.find((candidate) => candidate.id === policy.registryItemId);
    if (!item) continue;
    return {
      status: sameDefinition(
        item.registry,
        policy.snapshot,
        effectiveRevertMutation(item, pkg) !== undefined,
      )
        ? "matches"
        : "differs",
      packageId: pkg.id,
      packageName: pkg.name,
      itemValueName: item.registry.valueName,
      item,
    };
  }
  return { status: "unavailable" };
}

export interface TemplatePolicyReference {
  templateId: string;
  templateName: string;
  policyId: string;
  policyLabel: string;
}

export function templatePoliciesForItem(
  workspace: RegistryWorkspace,
  itemId: string,
): TemplatePolicyReference[] {
  return workspace.administrativeTemplates.flatMap((template) =>
    template.policies
      .filter((policy) => policy.registryItemId === itemId)
      .map((policy) => ({
        templateId: template.id,
        templateName: template.name || "Untitled administrative template",
        policyId: policy.id,
        policyLabel: policy.displayName || policy.snapshot.valueName || "Untitled policy",
      })),
  );
}

/** Items of a package that already feed at least one administrative template policy. */
export function itemsReferencedByTemplates(
  workspace: RegistryWorkspace,
  pkg: DeploymentPackage,
): Array<{ item: RegistryItem; references: TemplatePolicyReference[] }> {
  return pkg.items
    .map((item) => ({ item, references: templatePoliciesForItem(workspace, item.id) }))
    .filter((entry) => entry.references.length > 0);
}

export type SnapshotReplacement =
  | { kind: "replaced"; template: AdministrativeTemplate; resetChoices: boolean }
  | { kind: "unchanged" }
  | { kind: "unavailable" };

/**
 * Adopts the current source definition into a policy snapshot. Choices that made sense for the previous
 * definition are cleared when the value name or type changes, so the author has to decide again instead
 * of inheriting a range or a fixed value that no longer describes the setting.
 */
export function replacePolicySnapshot(
  workspace: RegistryWorkspace,
  template: AdministrativeTemplate,
  policyId: string,
): SnapshotReplacement {
  const policy = template.policies.find((candidate) => candidate.id === policyId);
  if (!policy) return { kind: "unavailable" };
  const source = policySource(workspace, policy);
  if (source.status !== "matches" && source.status !== "differs") return { kind: "unavailable" };
  if (source.status === "matches") return { kind: "unchanged" };
  if (!source.item) return { kind: "unavailable" };

  const pkg = workspace.packages.find((candidate) => candidate.id === source.packageId);
  if (!pkg) return { kind: "unavailable" };
  const assessment = createPolicyDraftFromItem(source.item, pkg);
  if (assessment.status !== "created") return { kind: "unavailable" };

  const typeChanged = assessment.policy.snapshot.value.type !== policy.snapshot.value.type;
  const nameChanged =
    foldRegistryName(assessment.policy.snapshot.valueName) !==
    foldRegistryName(policy.snapshot.valueName);
  // A different hive or key path means the policy now describes a different setting, so an authored
  // range, fixed value, or state behaviour from the previous target must not be carried over.
  const targetChanged =
    assessment.policy.snapshot.hive !== policy.snapshot.hive ||
    foldRegistryName(assessment.policy.snapshot.keyPath) !==
      foldRegistryName(policy.snapshot.keyPath);
  const resetChoices = typeChanged || nameChanged || targetChanged;

  const next: AdministrativeTemplatePolicy = resetChoices
    ? {
        id: policy.id,
        ...(policy.registryItemId === undefined ? {} : { registryItemId: policy.registryItemId }),
        policyClass: assessment.policy.policyClass,
        snapshot: assessment.policy.snapshot,
        displayName: policy.displayName,
        explainText: policy.explainText,
        category: policy.category,
        policyId: policy.policyId,
        valueMode: "Unspecified",
        enabledBehavior: { kind: "Unspecified" },
        disabledBehavior: { kind: "Unspecified" },
        notConfiguredBehavior: { kind: "Unspecified" },
      }
    : {
        ...policy,
        policyClass: assessment.policy.policyClass,
        snapshot: assessment.policy.snapshot,
      };

  return {
    kind: "replaced",
    resetChoices,
    template: {
      ...template,
      policies: template.policies.map((candidate) =>
        candidate.id === policyId ? next : candidate,
      ),
    },
  };
}
