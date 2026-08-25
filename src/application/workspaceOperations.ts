import {
  cloneRegistryItem,
  type DeploymentPackage,
  type RegistryItem,
  type RegistryWorkspace,
} from "../domain/workspace/workspace";

export function renameWorkspace(workspace: RegistryWorkspace, name: string): RegistryWorkspace {
  return { ...workspace, name };
}

export function savePackage(
  workspace: RegistryWorkspace,
  pkg: DeploymentPackage,
  replacingId?: string,
): RegistryWorkspace {
  return {
    ...workspace,
    packages: replacingId
      ? workspace.packages.map((current) => (current.id === replacingId ? pkg : current))
      : [...workspace.packages, pkg],
  };
}

export function removePackage(workspace: RegistryWorkspace, packageId: string): RegistryWorkspace {
  return {
    ...workspace,
    packages: workspace.packages.filter((pkg) => pkg.id !== packageId),
  };
}

export function updatePackage(
  workspace: RegistryWorkspace,
  packageId: string,
  update: (pkg: DeploymentPackage) => DeploymentPackage,
): RegistryWorkspace {
  return {
    ...workspace,
    packages: workspace.packages.map((pkg) => (pkg.id === packageId ? update(pkg) : pkg)),
  };
}

export function saveItem(
  workspace: RegistryWorkspace,
  packageId: string,
  item: RegistryItem,
  replacingId?: string,
): RegistryWorkspace {
  return updatePackage(workspace, packageId, (pkg) => ({
    ...pkg,
    items: replacingId
      ? pkg.items.map((current) => (current.id === replacingId ? item : current))
      : [...pkg.items, item],
  }));
}

export function removeItem(
  workspace: RegistryWorkspace,
  packageId: string,
  itemId: string,
): RegistryWorkspace {
  return updatePackage(workspace, packageId, (pkg) => ({
    ...pkg,
    items: pkg.items.filter((item) => item.id !== itemId),
  }));
}

export function setItemEnabled(
  workspace: RegistryWorkspace,
  packageId: string,
  itemId: string,
  enabled: boolean,
): RegistryWorkspace {
  return updatePackage(workspace, packageId, (pkg) => ({
    ...pkg,
    items: pkg.items.map((item) => (item.id === itemId ? { ...item, enabled } : item)),
  }));
}

export function transferItem(
  workspace: RegistryWorkspace,
  sourcePackageId: string,
  targetPackageId: string,
  item: RegistryItem,
  action: "move" | "copy",
): RegistryWorkspace {
  const transferred = action === "copy" ? cloneRegistryItem(item) : item;
  return {
    ...workspace,
    packages: workspace.packages.map((pkg) => {
      if (pkg.id === targetPackageId) return { ...pkg, items: [...pkg.items, transferred] };
      if (action === "move" && pkg.id === sourcePackageId)
        return { ...pkg, items: pkg.items.filter((candidate) => candidate.id !== item.id) };
      return pkg;
    }),
  };
}
