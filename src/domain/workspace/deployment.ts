export const PRIMARY_DEPLOYMENT_TARGETS = ["Remediation", "PlatformScript", "Win32App"] as const;
export type PrimaryDeploymentTarget = (typeof PRIMARY_DEPLOYMENT_TARGETS)[number];

export interface DeploymentTargetDefinition {
  id: PrimaryDeploymentTarget;
  label: string;
}

export const DEPLOYMENT_TARGET_DEFINITIONS: readonly DeploymentTargetDefinition[] = [
  {
    id: "Remediation",
    label: "Intune Remediation",
  },
  {
    id: "PlatformScript",
    label: "Platform Script",
  },
  {
    id: "Win32App",
    label: "Win32 App",
  },
];

export function deploymentTargetDefinition(
  target: PrimaryDeploymentTarget,
): DeploymentTargetDefinition {
  return DEPLOYMENT_TARGET_DEFINITIONS.find((definition) => definition.id === target)!;
}
