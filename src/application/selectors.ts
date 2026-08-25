import { deploymentTargetDefinition } from "../domain/workspace/deployment";
import {
  deploymentPackageLabel,
  type DeploymentPackage,
  type RegistryWorkspace,
} from "../domain/workspace/workspace";

export interface PackageFilters {
  search: string;
  method: string;
  context: string;
  sort: string;
}

export function selectPackage(
  workspace: RegistryWorkspace,
  packageId?: string,
): DeploymentPackage | undefined {
  return workspace.packages.find((pkg) => pkg.id === packageId);
}

export function selectVisiblePackages(
  workspace: RegistryWorkspace,
  filters: PackageFilters,
): DeploymentPackage[] {
  const query = filters.search.toLowerCase();
  return [...workspace.packages]
    .filter((pkg) => filters.method === "All" || pkg.deployment.method === filters.method)
    .filter((pkg) => filters.context === "All" || pkg.deployment.runContext === filters.context)
    .filter((pkg) =>
      [
        pkg.name,
        deploymentTargetDefinition(pkg.deployment.method).label,
        pkg.deployment.runContext,
        ...pkg.items.flatMap((item) => [
          item.registry.hive,
          item.registry.keyPath,
          item.registry.valueName,
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort((left, right) =>
      filters.sort === "method"
        ? left.deployment.method.localeCompare(right.deployment.method)
        : filters.sort === "items"
          ? right.items.length - left.items.length
          : deploymentPackageLabel(left).localeCompare(deploymentPackageLabel(right)),
    );
}

export function selectSelectedPackages(
  workspace: RegistryWorkspace,
  selected: ReadonlySet<string>,
): DeploymentPackage[] {
  return workspace.packages.filter((pkg) => selected.has(pkg.id));
}
