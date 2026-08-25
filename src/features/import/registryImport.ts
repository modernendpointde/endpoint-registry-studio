import { createDeploymentPackage, type RegistryWorkspace } from "../../domain/workspace/workspace";
import type { ParsedRegistryCandidate } from "../../serialization/registryFileDecoder";
import { itemFromImport } from "../registry-items/presentation";
import { savePackage, updatePackage } from "../../application/workspaceOperations";

export type RegistryImportSource = {
  kind: "file" | "clipboard";
  fileName?: string;
};

export function importedPackageName(
  existingNames: readonly string[],
  source: RegistryImportSource,
): string {
  const stem = source.kind === "file" ? (source.fileName ?? "").replace(/\.reg$/i, "").trim() : "";
  const base = stem || "Imported Registry";
  if (!existingNames.includes(base)) return base;
  let index = 2;
  while (existingNames.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function commitRegistryImport(
  workspace: RegistryWorkspace,
  candidates: readonly ParsedRegistryCandidate[],
  targetPackageId: string | undefined,
  source: RegistryImportSource,
): { workspace: RegistryWorkspace; packageId: string; created: boolean } {
  const items = candidates.map(itemFromImport);
  if (targetPackageId) {
    return {
      workspace: updatePackage(workspace, targetPackageId, (pkg) => ({
        ...pkg,
        items: [...pkg.items, ...items],
      })),
      packageId: targetPackageId,
      created: false,
    };
  }
  const pkg = createDeploymentPackage({
    name: importedPackageName(
      workspace.packages.map((candidate) => candidate.name),
      source,
    ),
    items,
  });
  return {
    workspace: savePackage(workspace, pkg),
    packageId: pkg.id,
    created: true,
  };
}
