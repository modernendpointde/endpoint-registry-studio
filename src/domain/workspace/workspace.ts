import type { PrimaryDeploymentTarget } from "./deployment";
import { effectiveDesiredMutation, effectiveRegistryItemBehavior } from "../effectiveBehavior";
import {
  GENERATOR_VERSION,
  cloneRegistryDefinition,
  createId,
  createRegistryDefinition,
  type RegistryDefinition,
} from "../registry/model";

export const WORKSPACE_SCHEMA_VERSION = 7;
export const WORKSPACE_KIND = "registry-workspace" as const;
export const PACKAGE_KIND = "registry-package" as const;

export type RunContext = "System" | "LoggedOnUser";
export type UserHiveTarget = "AllSignedInUsers" | "AllExistingProfiles";

export interface DeploymentConfiguration {
  method: PrimaryDeploymentTarget;
  runContext: RunContext;
  runIn64BitPowerShell: boolean;
  enforceSignatureCheck: boolean;
}

export interface UserHiveConfiguration {
  userHiveTarget?: UserHiveTarget;
  includeDefaultUser: boolean;
}

export interface RegistryItem {
  id: string;
  enabled: boolean;
  registry: RegistryDefinition;
  userHive: UserHiveConfiguration;
  description: string;
}

export interface DeploymentPackage {
  id: string;
  name: string;
  deployment: DeploymentConfiguration;
  items: RegistryItem[];
}

export interface RegistryWorkspace {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  kind: typeof WORKSPACE_KIND;
  generatorVersion: string;
  id: string;
  name: string;
  packages: DeploymentPackage[];
}

export interface RegistryPackage {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  kind: typeof PACKAGE_KIND;
  generatorVersion: string;
  sourceWorkspaceId?: string;
  sourceWorkspaceName?: string;
  package: DeploymentPackage;
  fingerprint: string;
}

export function defaultDeployment(): DeploymentConfiguration {
  return {
    method: "Remediation",
    runContext: "System",
    runIn64BitPowerShell: true,
    enforceSignatureCheck: false,
  };
}

export function defaultUserHive(): UserHiveConfiguration {
  return {
    includeDefaultUser: false,
  };
}

export function createRegistryItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    id: createId(),
    enabled: true,
    registry: createRegistryDefinition({ keyPath: "", valueName: "" }),
    userHive: defaultUserHive(),
    description: "",
    ...overrides,
  };
}

export function createDeploymentPackage(
  overrides: Partial<DeploymentPackage> = {},
): DeploymentPackage {
  return {
    id: createId(),
    name: "Untitled Deployment Package",
    deployment: defaultDeployment(),
    items: [],
    ...overrides,
  };
}

export function createWorkspace(overrides: Partial<RegistryWorkspace> = {}): RegistryWorkspace {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    kind: WORKSPACE_KIND,
    generatorVersion: GENERATOR_VERSION,
    id: createId(),
    name: "Untitled Workspace",
    packages: [],
    ...overrides,
  };
}

export function cloneRegistryItem(item: RegistryItem): RegistryItem {
  return {
    ...item,
    id: createId(),
    registry: cloneRegistryDefinition(item.registry),
    userHive: { ...item.userHive },
  };
}

export function cloneDeploymentPackage(pkg: DeploymentPackage): DeploymentPackage {
  return {
    ...pkg,
    id: createId(),
    name: `${pkg.name} copy`.trim(),
    deployment: { ...pkg.deployment },
    items: pkg.items.map(cloneRegistryItem),
  };
}

function canonicalPackageData(
  pkg: DeploymentPackage,
  generatorVersion = GENERATOR_VERSION,
): string {
  return JSON.stringify({
    deployment: pkg.deployment,
    items: pkg.items
      .filter((item) => item.enabled)
      .map((item) => {
        const behavior = effectiveRegistryItemBehavior(item, pkg);
        return {
          registry: behavior.registry,
          ...(behavior.userHive
            ? {
                userHive: {
                  userHiveTarget: behavior.userHive.target,
                  includeDefaultUser: behavior.userHive.includeDefaultUser,
                },
              }
            : {}),
        };
      }),
    generatorVersion,
  });
}

export function packageFingerprint(
  pkg: DeploymentPackage,
  generatorVersion = GENERATOR_VERSION,
): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(canonicalPackageData(pkg, generatorVersion))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0");
}

export function registryItemLabel(item: RegistryItem): string {
  if (effectiveDesiredMutation(item).kind === "DeleteKeyRecursive") {
    const segments = item.registry.keyPath.split("\\");
    return segments.at(-1) || "Registry key";
  }
  if (item.registry.valueName.trim()) return item.registry.valueName.trim();
  const segments = item.registry.keyPath.split("\\");
  return segments.at(-1) || "Default Registry value";
}

export function deploymentPackageLabel(pkg: DeploymentPackage): string {
  return pkg.name.trim() || "Untitled Deployment Package";
}
