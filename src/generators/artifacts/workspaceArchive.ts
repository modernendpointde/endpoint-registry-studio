import {
  deploymentPackageLabel,
  packageFingerprint,
  type DeploymentPackage,
  type RegistryWorkspace,
} from "../../domain/workspace/workspace";
import { exportWorkspace } from "../../serialization/workspaceSchema";
import { createZip, type ZipFile } from "../zip";
import { generateDeploymentPackageArtifacts } from "./packageArtifacts";
import { artifactZipFiles, packageSlug } from "./shared";

export interface WorkspaceManifestEntry {
  packageId: string;
  packageName: string;
  packagePath: string;
  method: DeploymentPackage["deployment"]["method"];
  runContext: DeploymentPackage["deployment"]["runContext"];
  totalItemCount: number;
  enabledItemCount: number;
  fingerprint: string;
}

export interface WorkspaceManifest {
  schemaVersion: 3;
  kind: "registry-deployment-manifest";
  workspaceId: string;
  workspaceName: string;
  packages: WorkspaceManifestEntry[];
}

function uniqueFolder(pkg: DeploymentPackage, used: Set<string>): string {
  const base = packageSlug(deploymentPackageLabel(pkg));
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function workspaceManifest(
  workspace: RegistryWorkspace,
  selectedIds?: ReadonlySet<string>,
): WorkspaceManifest {
  const used = new Set<string>();
  const packages = workspace.packages.filter(
    (pkg) =>
      pkg.items.some((item) => item.enabled) &&
      (selectedIds === undefined || selectedIds.has(pkg.id)),
  );
  return {
    schemaVersion: 3,
    kind: "registry-deployment-manifest",
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    packages: packages.map((pkg) => {
      const folder = uniqueFolder(pkg, used);
      return {
        packageId: pkg.id,
        packageName: deploymentPackageLabel(pkg),
        packagePath: `${folder}/`,
        method: pkg.deployment.method,
        runContext: pkg.deployment.runContext,
        totalItemCount: pkg.items.length,
        enabledItemCount: pkg.items.filter((item) => item.enabled).length,
        fingerprint: packageFingerprint(pkg),
      };
    }),
  };
}

export function generateWorkspacePackagesZip(
  workspace: RegistryWorkspace,
  selectedIds?: ReadonlySet<string>,
): Uint8Array {
  const encoder = new TextEncoder();
  const manifest = workspaceManifest(workspace, selectedIds);
  const includedPackageIds = new Set(manifest.packages.map((entry) => entry.packageId));
  const archiveWorkspace: RegistryWorkspace = {
    ...workspace,
    packages: workspace.packages.filter((pkg) => includedPackageIds.has(pkg.id)),
  };
  const packageById = new Map(workspace.packages.map((pkg) => [pkg.id, pkg]));
  const files: ZipFile[] = [
    {
      name: `${packageSlug(workspace.name)}.registry-workspace.json`,
      data: encoder.encode(exportWorkspace(archiveWorkspace)),
    },
    {
      name: "manifest.json",
      data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    },
  ];
  for (const entry of manifest.packages) {
    const pkg = packageById.get(entry.packageId);
    if (!pkg) continue;
    files.push(
      ...artifactZipFiles(generateDeploymentPackageArtifacts(workspace, pkg), entry.packagePath),
    );
  }
  return createZip(files);
}

export function workspaceArchiveName(
  workspace: RegistryWorkspace,
  scope: "selected" | "all",
): string {
  return `${packageSlug(workspace.name)}-${scope}-registry-deployments.zip`;
}
