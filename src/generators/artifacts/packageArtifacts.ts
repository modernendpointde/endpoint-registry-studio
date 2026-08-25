import { GENERATOR_VERSION } from "../../domain/registry/model";
import {
  deploymentPackageLabel,
  packageFingerprint,
  type DeploymentPackage,
  type RegistryWorkspace,
} from "../../domain/workspace/workspace";
import { exportRegistryPackage } from "../../serialization/workspaceSchema";
import { generatePowerShell, type ScriptKind } from "../powershell";
import type { TargetArtifact } from "../types";
import { createZip } from "../zip";
import { packageCsv } from "./csv";
import { hasGeneratedRevert, packageReadme } from "./documentation";
import { artifactZipFiles, packageSlug, textArtifact } from "./shared";

function scripts(pkg: DeploymentPackage): TargetArtifact[] {
  const generate = (kind: ScriptKind) => generatePowerShell(pkg, kind);
  if (pkg.deployment.method === "Remediation") {
    const detect = generate("Detect");
    return [
      textArtifact("DryRun.ps1", "Read-only local test", generate("DryRun")),
      textArtifact("Detect.ps1", "Intune Remediation detection", detect),
      textArtifact("Remediate.ps1", "Intune Remediation enforcement", generate("Remediate")),
    ];
  }
  if (pkg.deployment.method === "PlatformScript") {
    return [
      textArtifact("DryRun.ps1", "Read-only local test", generate("DryRun")),
      textArtifact("Apply.ps1", "One-time Registry application", generate("Apply")),
    ];
  }
  const files = [
    textArtifact("Install.ps1", "Win32 install script", generate("Install")),
    textArtifact("Detect.ps1", "Win32 custom detection", generate("Win32Detect")),
  ];
  if (pkg.items.some((item) => hasGeneratedRevert(item, pkg))) {
    files.push(textArtifact("Uninstall.ps1", "Explicit Win32 uninstall", generate("Uninstall")));
  }
  return files;
}

function win32PowerShellCommand(pkg: DeploymentPackage, scriptName: string): string {
  const executable = pkg.deployment.runIn64BitPowerShell
    ? "%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"
    : "powershell.exe";
  const executionPolicy = pkg.deployment.enforceSignatureCheck ? "AllSigned" : "Bypass";
  return `${executable} -NoProfile -ExecutionPolicy ${executionPolicy} -File ${scriptName}\n`;
}

export function generateDeploymentPackageArtifacts(
  workspace: RegistryWorkspace,
  pkg: DeploymentPackage,
): TargetArtifact[] {
  const fingerprint = packageFingerprint(pkg);
  const generated = scripts(pkg);
  const support: TargetArtifact[] = [
    textArtifact("README.md", "Package and Intune guidance", packageReadme(pkg, fingerprint)),
    textArtifact(
      "VERSION",
      "Generator and package fingerprint",
      `${GENERATOR_VERSION}\nFingerprint=${fingerprint}\n`,
    ),
    textArtifact(
      "registry-package.json",
      "Portable Deployment Package definition",
      exportRegistryPackage(workspace, pkg),
    ),
    textArtifact("registry-summary.csv", "Registry Item summary", packageCsv(pkg)),
  ];
  if (pkg.deployment.method === "Win32App") {
    const hasRevert = pkg.items.some((item) => hasGeneratedRevert(item, pkg));
    support.push(
      textArtifact(
        "install-command.txt",
        "Suggested install command",
        win32PowerShellCommand(pkg, "Install.ps1"),
      ),
      textArtifact(
        "uninstall-command.txt",
        "Suggested uninstall command",
        hasRevert
          ? win32PowerShellCommand(pkg, "Uninstall.ps1")
          : "Uninstall is unavailable because no enabled Registry Item has an explicit Revert action.\n",
      ),
      textArtifact(
        "detection-notes.md",
        "Win32 detection guidance",
        "# Detection\n\nUse `Detect.ps1` as the custom detection script. Exit 0 means installed, 1 means not installed, and 2 means detection error.\n",
      ),
    );
  }
  return [...generated, ...support];
}

export function deploymentPackageName(pkg: DeploymentPackage): string {
  return `${packageSlug(deploymentPackageLabel(pkg))}-${pkg.deployment.method.toLowerCase()}-${packageFingerprint(pkg)}.zip`;
}

export function generateDeploymentPackageZip(
  workspace: RegistryWorkspace,
  pkg: DeploymentPackage,
): Uint8Array {
  return createZip(artifactZipFiles(generateDeploymentPackageArtifacts(workspace, pkg)));
}
