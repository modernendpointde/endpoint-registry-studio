import type { RegistryPackage, RegistryWorkspace } from "../../domain/workspace/workspace";

export type PackageImportDecision =
  { kind: "append" } | { kind: "collision"; collision: "package-id" | "item-id" };

export function packageImportDecision(
  workspace: RegistryWorkspace,
  filePackage: RegistryPackage,
): PackageImportDecision {
  const itemIds = new Set(filePackage.package.items.map((item) => item.id));
  const itemCollisionOutsidePackage = workspace.packages.some(
    (pkg) => pkg.id !== filePackage.package.id && pkg.items.some((item) => itemIds.has(item.id)),
  );
  if (itemCollisionOutsidePackage) return { kind: "collision", collision: "item-id" };
  if (workspace.packages.some((pkg) => pkg.id === filePackage.package.id))
    return { kind: "collision", collision: "package-id" };
  return { kind: "append" };
}
