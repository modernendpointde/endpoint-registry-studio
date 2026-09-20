import { foldRegistryName, registryValueLabel } from "../admx";
import { effectiveDesiredMutation } from "../effectiveBehavior";
import type { AdministrativeTemplate } from "../admx";
import type { RegistryWorkspace } from "../workspace/workspace";

/**
 * Locally detected overlap between an administrative template policy and a Deployment Package item.
 *
 * This is not a proven Intune assignment conflict. The product compares the Registry intent it holds
 * locally; it cannot know which profiles are assigned, which wins in the tenant, or what the client
 * ends up with. The wording in the Workbench must stay at that level.
 */
export type RegistryOverlapKind = "same-value" | "deletion-scope";

export interface RegistryOverlap {
  kind: RegistryOverlapKind;
  templateId: string;
  templateName: string;
  policyId: string;
  policyLabel: string;
  target: string;
  packageId: string;
  packageName: string;
  itemLabel: string;
  message: string;
}

function itemLabel(valueName: string, keyPath: string): string {
  return valueName === "" ? keyPath : valueName;
}

/**
 * Finds Registry values that a template policy and an enabled Deployment Package item both affect.
 * Paths and value names are compared case-insensitively, because Windows treats them that way.
 */
export function registryOverlapsForTemplate(
  workspace: RegistryWorkspace,
  template: AdministrativeTemplate,
): RegistryOverlap[] {
  const overlaps: RegistryOverlap[] = [];

  for (const policy of template.policies) {
    const policyKeyPath = foldRegistryName(policy.snapshot.keyPath);
    const policyValueName = foldRegistryName(policy.snapshot.valueName);
    const policyLabel = policy.displayName || policy.snapshot.valueName || "Untitled policy";
    const target = registryValueLabel(policy.snapshot);

    for (const pkg of workspace.packages) {
      for (const item of pkg.items) {
        if (!item.enabled) continue;
        if (item.registry.hive !== policy.snapshot.hive) continue;
        const mutation = effectiveDesiredMutation(item);
        const itemKeyPath = foldRegistryName(item.registry.keyPath);
        const label = itemLabel(item.registry.valueName, item.registry.keyPath);

        if (mutation.kind === "DeleteKeyRecursive") {
          const containsPolicy =
            policyKeyPath === itemKeyPath || policyKeyPath.startsWith(itemKeyPath + "\\");
          if (containsPolicy) {
            overlaps.push({
              kind: "deletion-scope",
              templateId: template.id,
              templateName: template.name,
              policyId: policy.id,
              policyLabel,
              target,
              packageId: pkg.id,
              packageName: pkg.name,
              itemLabel: label,
              message: `Deployment Package "${pkg.name}" deletes the key tree that contains the Registry value of policy "${policyLabel}": ${target}.`,
            });
          }
          continue;
        }

        if (
          itemKeyPath === policyKeyPath &&
          foldRegistryName(item.registry.valueName) === policyValueName
        ) {
          overlaps.push({
            kind: "same-value",
            templateId: template.id,
            templateName: template.name,
            policyId: policy.id,
            policyLabel,
            target,
            packageId: pkg.id,
            packageName: pkg.name,
            itemLabel: label,
            message: `Deployment Package "${pkg.name}" contains "${label}", which affects the same Registry value as policy "${policyLabel}": ${target}.`,
          });
        }
      }
    }
  }

  return overlaps;
}

export function registryOverlaps(workspace: RegistryWorkspace): RegistryOverlap[] {
  return workspace.administrativeTemplates.flatMap((template) =>
    registryOverlapsForTemplate(workspace, template),
  );
}
