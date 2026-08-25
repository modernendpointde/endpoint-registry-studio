import { deploymentTargetDefinition } from "../../domain/workspace/deployment";
import {
  activeRegistryItemFields,
  effectiveDesiredMutation,
  effectiveRevertMutation,
  effectiveUserHive,
} from "../../domain/effectiveBehavior";
import { displayValue, GENERATOR_VERSION } from "../../domain/registry/model";
import {
  deploymentPackageLabel,
  registryItemLabel,
  type DeploymentPackage,
  type RegistryItem,
} from "../../domain/workspace/workspace";

export interface PackagePortalSetting {
  label: string;
  value: string;
  reason: string;
}

function markdownText(value: string): string {
  return value
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .replace(/[\r\n\t]+/g, " ")
    .replace(/([\\`*_[\]{}()#+.!|>-])/g, "\\$1");
}

function markdownCode(value: string): string {
  const visible = value
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(
      /[\u0000-\u001f\u007f]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  const longestTicks = Math.max(0, ...[...visible.matchAll(/`+/g)].map(([ticks]) => ticks.length));
  const fence = "`".repeat(longestTicks + 1);
  return `${fence}${visible.startsWith("`") || visible.endsWith("`") ? ` ${visible} ` : visible}${fence}`;
}

function executionLabel(pkg: DeploymentPackage): string {
  return pkg.deployment.runContext === "System" ? "SYSTEM" : "Logged-on user";
}

export function hasGeneratedRevert(item: RegistryItem, pkg: DeploymentPackage): boolean {
  return item.enabled && effectiveRevertMutation(item, pkg) !== undefined;
}

export function deploymentPackageSummary(pkg: DeploymentPackage): string {
  const method = deploymentTargetDefinition(pkg.deployment.method).label;
  return `${method} · ${executionLabel(pkg)}`;
}

function userHiveTargetLabel(target?: RegistryItem["userHive"]["userHiveTarget"]): string {
  const labels = {
    AllSignedInUsers: "Currently signed-in users",
    AllExistingProfiles: "All existing user profiles",
  } as const;
  return target ? labels[target] : "Target required";
}

export function packagePortalSettings(pkg: DeploymentPackage): PackagePortalSetting[] {
  const enabledCount = pkg.items.filter((item) => item.enabled).length;
  const common = [
    {
      label: "Deployment method",
      value: deploymentTargetDefinition(pkg.deployment.method).label,
      reason: "Used for every generated file in this Deployment Package.",
    },
    {
      label: pkg.deployment.method === "Win32App" ? "Install behavior" : "Run script as",
      value: executionLabel(pkg),
      reason:
        pkg.deployment.method === "Win32App"
          ? "Select the matching Install behavior in the Win32 App program settings."
          : pkg.deployment.runContext === "System"
            ? "Run this script using the logged-on credentials: No."
            : "Run this script using the logged-on credentials: Yes.",
    },
    {
      label: "Registry Items",
      value: `${enabledCount} enabled of ${pkg.items.length}`,
      reason: "Only enabled items are emitted into this package's scripts.",
    },
  ];
  return [
    ...common,
    {
      label: "Run in 64-bit PowerShell",
      value: pkg.deployment.runIn64BitPowerShell ? "Yes" : "No",
      reason:
        pkg.deployment.method === "Win32App"
          ? "Install and uninstall command files select this host architecture; configure custom detection to match."
          : "Auto Registry views follow this PowerShell host architecture; explicit views remain host-independent.",
    },
    {
      label: "Enforce script signature check",
      value: pkg.deployment.enforceSignatureCheck ? "Yes" : "No",
      reason: pkg.deployment.enforceSignatureCheck
        ? pkg.deployment.method === "Win32App"
          ? "Command files use AllSigned; sign every script with a trusted certificate and enable signature checking for custom detection."
          : "Sign every downloaded script with a trusted certificate before upload."
        : "Generated scripts are unsigned.",
    },
  ];
}

export function packageReadme(pkg: DeploymentPackage, fingerprint: string): string {
  const settings = packagePortalSettings(pkg);
  const enabled = pkg.items.filter((item) => item.enabled);
  return [
    `# ${markdownText(deploymentPackageLabel(pkg))}`,
    "",
    `Deployment Package containing ${enabled.length} enabled Registry Item${enabled.length === 1 ? "" : "s"}.`,
    "",
    `- Fingerprint: \`${fingerprint}\``,
    `- Deployment: ${markdownText(deploymentPackageSummary(pkg))}`,
    "",
    "## Deployment steps",
    "",
    ...(pkg.deployment.method === "Remediation"
      ? [
          "Upload `Detect.ps1` and `Remediate.ps1` to an Intune Remediation. Use `DryRun.ps1` only for local read-only verification.",
        ]
      : pkg.deployment.method === "PlatformScript"
        ? [
            "Upload `Apply.ps1` as the Intune Platform Script. Use `DryRun.ps1` only for local read-only verification.",
          ]
        : [
            "Use this folder as Win32 Content Prep Tool source input; this ZIP is not an `.intunewin` file.",
            "Package the source, use the generated install/uninstall command files for Program settings, and upload `Detect.ps1` as the custom detection script.",
          ]),
    "",
    "## Registry Items",
    "",
    ...pkg.items.flatMap((item, index) => {
      const fields = activeRegistryItemFields(item, pkg);
      const desired = effectiveDesiredMutation(item);
      const revert = effectiveRevertMutation(item, pkg);
      const userHive = effectiveUserHive(item, pkg);
      return [
        `### ${index + 1}. ${markdownText(registryItemLabel(item))}${item.enabled ? "" : " (disabled)"}`,
        "",
        `- Registry: ${markdownCode(`${item.registry.hive}\\${item.registry.keyPath}`)}`,
        ...(fields.valueName
          ? [`- Value: ${markdownCode(item.registry.valueName || "(Default)")}`]
          : []),
        ...(desired.kind === "SetValue"
          ? [
              "- Desired state: Present",
              `- Required type: ${desired.value.type}`,
              `- Required value: ${markdownCode(displayValue(desired.value))}`,
            ]
          : [
              `- Desired state: Absent — ${
                desired.kind === "DeleteValue"
                  ? "delete value"
                  : desired.kind === "DeleteValueAndEmptyKey"
                    ? "delete value, then key if empty"
                    : "delete key recursively"
              }`,
            ]),
        `- Registry view: ${item.registry.view}`,
        ...(pkg.deployment.method === "Win32App"
          ? [
              `- Revert behavior: ${
                !revert
                  ? "No revert action"
                  : revert.kind === "DeleteValue"
                    ? "Delete managed value"
                    : `Set ${revert.value.type} to ${displayValue(revert.value)}`
              }`,
            ]
          : []),
        ...(userHive
          ? [
              `- User hive target: ${userHiveTargetLabel(userHive.target)}`,
              ...(userHive.target === "AllExistingProfiles"
                ? [
                    `- Configure new users (Default User): ${userHive.includeDefaultUser ? "Yes" : "No"}`,
                  ]
                : []),
            ]
          : []),
        ...(item.description ? [`- Description: ${markdownText(item.description)}`] : []),
        "",
      ];
    }),
    "## Intune portal settings",
    "",
    ...settings.flatMap((setting) => [
      `- **${setting.label}:** ${setting.value}`,
      `  ${setting.reason}`,
    ]),
    "",
    "## Safety",
    "",
    "Test on a representative non-production Windows device. DryRun and Detect do not change Registry values. SYSTEM + HKCU profile hives are mounted only when needed and only self-mounted hives are unloaded.",
    "Every script writes one first output line beginning with `ERS;` and the package fingerprint. SYSTEM Remediate, Apply, Install, and Uninstall also append one line to `%ProgramData%\\Endpoint Registry Studio\\ers.log`. Detect, DryRun, and logged-on-user packages do not write that file. Intune Collect diagnostics includes Intune Management Extension logs; add `ers.log` as an extra Win32 collect-logs path if you need that file remotely.",
    "",
    `Generated by Endpoint Registry Studio ${GENERATOR_VERSION}.`,
    "",
  ].join("\n");
}
