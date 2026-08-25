import {
  effectiveDesiredMutation,
  effectiveRevertMutation,
  effectiveUserHive,
  type RegistryMutationKind,
} from "../../domain/effectiveBehavior";
import type {
  DeploymentPackage,
  RegistryItem,
  UserHiveTarget,
} from "../../domain/workspace/workspace";
import type { ScriptFeatures, ScriptKind } from "./types";

export function desiredAction(item: RegistryItem): RegistryMutationKind {
  return effectiveDesiredMutation(item).kind;
}

export function revertAction(
  item: RegistryItem,
  pkg: DeploymentPackage,
): RegistryMutationKind | undefined {
  return effectiveRevertMutation(item, pkg)?.kind;
}

export function roleItems(pkg: DeploymentPackage, kind: ScriptKind): RegistryItem[] {
  const enabled = pkg.items.filter((item) => item.enabled);
  return kind === "Uninstall" ? enabled.filter((item) => revertAction(item, pkg)) : enabled;
}

export function analyzeFeatures(
  pkg: DeploymentPackage,
  kind: ScriptKind,
  items: readonly RegistryItem[],
): ScriptFeatures {
  const profileItems = items.filter((item) => effectiveUserHive(item, pkg));
  const profileTargets = new Set<UserHiveTarget>();
  for (const item of profileItems) {
    const target = effectiveUserHive(item, pkg)?.target;
    if (target) profileTargets.add(target);
  }
  const actions = new Set<RegistryMutationKind>();
  if (["Remediate", "Apply", "Install"].includes(kind)) {
    for (const item of items) actions.add(desiredAction(item));
  } else if (kind === "Uninstall") {
    for (const item of items) {
      const action = revertAction(item, pkg);
      if (action) actions.add(action);
    }
  }
  return {
    profileTargeting: profileItems.length > 0,
    profileTargets,
    includeDefaultUser: profileItems.some(
      (item) => effectiveUserHive(item, pkg)?.includeDefaultUser === true,
    ),
    exactSequence:
      (kind === "Detect" || kind === "Win32Detect" || kind === "DryRun") &&
      items.some((item) => {
        const desired = effectiveDesiredMutation(item);
        return (
          desired.kind === "SetValue" &&
          (desired.value.type === "MultiString" || desired.value.type === "Binary")
        );
      }),
    actions,
  };
}
