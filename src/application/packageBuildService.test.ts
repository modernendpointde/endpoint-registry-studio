import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  packageFingerprint,
  type RegistryItem,
} from "../domain/workspace/workspace";
import {
  deploymentPackageName,
  generateDeploymentPackageArtifacts,
  generateWorkspacePackagesZip,
  packageSlug,
  packagePortalSettings,
  workspaceArchiveName,
} from "./packageBuildService";

function read16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function read32(data: Uint8Array, offset: number): number {
  return (
    (data[offset]! |
      (data[offset + 1]! << 8) |
      (data[offset + 2]! << 16) |
      (data[offset + 3]! << 24)) >>>
    0
  );
}

function extractStoredZip(data: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (read32(data, offset) === 0x04034b50) {
    const size = read32(data, offset + 18);
    const nameLength = read16(data, offset + 26);
    const extraLength = read16(data, offset + 28);
    const nameOffset = offset + 30;
    const contentOffset = nameOffset + nameLength + extraLength;
    const name = decoder.decode(data.subarray(nameOffset, nameOffset + nameLength));
    files.set(name, data.slice(contentOffset, contentOffset + size));
    offset = contentOffset + size;
  }
  return files;
}

function extractWorkspaceManifest(data: Uint8Array): {
  schemaVersion: number;
  packages: Array<{
    packageId: string;
    packagePath: string;
    totalItemCount: number;
    enabledItemCount: number;
  }>;
} {
  const manifest = extractStoredZip(data).get("manifest.json");
  if (!manifest) throw new Error("Expected manifest.json in Workspace archive.");
  return JSON.parse(new TextDecoder().decode(manifest)) as {
    schemaVersion: number;
    packages: Array<{
      packageId: string;
      packagePath: string;
      totalItemCount: number;
      enabledItemCount: number;
    }>;
  };
}

function configuredItem(valueName: string): RegistryItem {
  const base = createRegistryItem();
  return {
    ...base,
    registry: {
      ...base.registry,
      keyPath: "Software\\Contoso",
      valueName,
      value: { type: "DWord" as const, data: 1 },
    },
  };
}

function configuredPackage(name: string, itemNames = ["Setting"]) {
  return createDeploymentPackage({ name, items: itemNames.map(configuredItem) });
}

function characterizationPackage() {
  const presentBase = createRegistryItem();
  const present: RegistryItem = {
    ...presentBase,
    id: "11111111-1111-4111-8111-111111111111",
    registry: {
      ...presentBase.registry,
      hive: "HKEY_CURRENT_USER",
      keyPath: "Software\\Contoso\\設定",
      valueName: "Enabled",
      value: { type: "DWord", data: 4_294_967_295 },
      view: "Both",
      rollbackMode: "SetDefinedRollbackValue",
      rollbackValue: { type: "String", data: "Grüße" },
    },
    userHive: { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true },
    description: "Representative item",
  };
  const absentBase = createRegistryItem();
  const absent: RegistryItem = {
    ...absentBase,
    id: "22222222-2222-4222-8222-222222222222",
    registry: {
      ...absentBase.registry,
      desiredState: "Absent",
      deletionMode: "KeyIfEmpty",
      keyPath: "Software\\Contoso\\Legacy",
      valueName: "Retired",
      view: "Auto",
      rollbackMode: "SetDefinedRollbackValue",
      rollbackValue: { type: "QWord", data: "18446744073709551615" },
    },
  };
  const recursiveBase = createRegistryItem();
  const recursive: RegistryItem = {
    ...recursiveBase,
    id: "33333333-3333-4333-8333-333333333333",
    registry: {
      ...recursiveBase.registry,
      desiredState: "Absent",
      deletionMode: "KeyRecursive",
      keyPath: "Software\\Contoso\\Removed",
      valueName: "ignored",
      view: "Registry32",
      rollbackMode: "None",
    },
  };
  return createDeploymentPackage({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Characterization package",
    deployment: {
      method: "Win32App",
      runContext: "System",
      runIn64BitPowerShell: true,
      enforceSignatureCheck: false,
    },
    items: [present, absent, recursive],
  });
}

function artifactHash(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Deployment Package generation", () => {
  it("preserves characterized fingerprints and artifact bytes across domain refactors", () => {
    const pkg = characterizationPackage();
    const workspace = createWorkspace({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Characterization workspace",
      packages: [pkg],
    });

    expect(packageFingerprint(pkg)).toBe("200C9C41");
    expect(
      Object.fromEntries(
        generateDeploymentPackageArtifacts(workspace, pkg).map((artifact) => [
          artifact.name,
          artifactHash(artifact.content),
        ]),
      ),
    ).toEqual({
      "Install.ps1": "afad1c841d7dafa45dded69dc289af3300938124d9069cde9610829e71015305",
      "Detect.ps1": "9945562da2e68677bf90c554b31e68c80f6ebe8669ca92c3ea5a584c71a947d5",
      "Uninstall.ps1": "e3d4bd3b67afcf6beea89e512b7552777cede478dee329d7ad670c437a42c496",
      "README.md": "7ebc9f45b4b86b0e6bf9a1d267993dc54e1ec55011a6f109c2500156b4c7fb54",
      VERSION: "68a500461ef1d65dbfcf2d6b45f92d8b371b57cbb09d374a69da367c1b1c0e2d",
      "registry-package.json": "d1de686e20cbfc803f4dc19b1d110f8fe38a29bd1de21bdcc71ea714b0f6671d",
      "registry-summary.csv": "28576c0ea9b2910ddfbfd958ecd85abe7f5a9cc0cb1bedaf86d7c4ac4d7a2b32",
      "install-command.txt": "aafa738f25b88b50f4c4593e3eee0809c1cf84e7f53d09ca7d86d15b725197b1",
      "uninstall-command.txt": "15b7f996497b407d617c4f0ea0df18e850b3f01bbe930a5c63d083fba8998802",
      "detection-notes.md": "d251dcac23876dafaaf1b5e31a358b59043876f99573d796b528af6fbafea01b",
    });
  });

  it("generates all enabled items in one package and never merges another package", () => {
    const pkg = configuredPackage("First", ["One", "Two"]);
    const other = configuredPackage("Second", ["Other"]);
    const workspace = createWorkspace({ packages: [pkg, other] });
    const artifacts = generateDeploymentPackageArtifacts(workspace, pkg);
    const joined = artifacts.map((artifact) => String(artifact.content)).join("\n");

    expect(artifacts.map((artifact) => artifact.name)).toEqual(
      expect.arrayContaining([
        "DryRun.ps1",
        "Detect.ps1",
        "Remediate.ps1",
        "registry-package.json",
      ]),
    );
    expect(joined).toContain(pkg.items[0]!.id);
    expect(joined).toContain(pkg.items[1]!.id);
    expect(joined).not.toContain(other.items[0]!.id);
    expect(String(artifacts.find((artifact) => artifact.name === "README.md")?.content)).toContain(
      "Generated by Endpoint Registry Studio",
    );
  });

  it("keeps packages in separate folders without nested ZIPs", () => {
    const first = configuredPackage("Same name");
    const second = configuredPackage("Same name");
    second.deployment.method = "PlatformScript";
    const workspace = createWorkspace({ packages: [first, second] });
    const selected = new Set([first.id, second.id]);
    const archive = generateWorkspacePackagesZip(workspace, selected);
    const manifest = extractWorkspaceManifest(archive);
    const archiveText = new TextDecoder().decode(archive);

    expect(manifest.packages.map((pkg) => pkg.packagePath)).toEqual(["same-name/", "same-name-2/"]);
    expect(archiveText).toContain("same-name/Detect.ps1");
    expect(archiveText).toContain("same-name/registry-package.json");
    expect(archiveText).toContain("same-name-2/Apply.ps1");
    expect(archiveText).toContain("same-name-2/registry-package.json");
    expect(archiveText).toContain("manifest.json");
    expect(archiveText).toContain(".registry-workspace.json");
    expect(archiveText).not.toMatch(/\.zip/);
    expect(manifest).toMatchObject({ schemaVersion: 3 });
    expect(manifest.packages[0]).toMatchObject({ totalItemCount: 1, enabledItemCount: 1 });
  });

  it("keeps selected archive folders, manifest, and Workspace JSON in the same scope", () => {
    const selectedPackage = configuredPackage("Selected");
    const privateDraft = configuredPackage("Unselected private draft", ["PrivateValue"]);
    const workspace = createWorkspace({ packages: [selectedPackage, privateDraft] });

    const archive = extractStoredZip(
      generateWorkspacePackagesZip(workspace, new Set([selectedPackage.id])),
    );
    const workspaceName = [...archive.keys()].find((name) =>
      name.endsWith(".registry-workspace.json"),
    );
    if (!workspaceName) throw new Error("Expected Workspace JSON in selected archive.");
    const exportedWorkspace = JSON.parse(new TextDecoder().decode(archive.get(workspaceName))) as {
      packages: Array<{ id: string; items: Array<{ id: string }> }>;
    };
    const manifest = JSON.parse(new TextDecoder().decode(archive.get("manifest.json"))) as {
      packages: Array<{ packageId: string }>;
    };

    expect(exportedWorkspace.packages.map((pkg) => pkg.id)).toEqual([selectedPackage.id]);
    expect(manifest.packages.map((pkg) => pkg.packageId)).toEqual([selectedPackage.id]);
    expect(
      new TextDecoder().decode(
        generateWorkspacePackagesZip(workspace, new Set([selectedPackage.id])),
      ),
    ).not.toContain("PrivateValue");
  });

  it("excludes packages without enabled Registry Items", () => {
    const enabled = configuredPackage("Enabled");
    const disabled = configuredPackage("Disabled");
    disabled.items[0]!.enabled = false;
    const workspace = createWorkspace({ packages: [enabled, disabled] });
    expect(
      extractWorkspaceManifest(generateWorkspacePackagesZip(workspace)).packages.map(
        (pkg) => pkg.packageId,
      ),
    ).toEqual([enabled.id]);
    expect(
      extractWorkspaceManifest(generateWorkspacePackagesZip(workspace, new Set([disabled.id])))
        .packages,
    ).toEqual([]);
  });

  it("uses one deterministic package fingerprint everywhere", () => {
    const pkg = configuredPackage("Fingerprint", ["One", "Two"]);
    const workspace = createWorkspace({ packages: [pkg] });
    const fingerprint = packageFingerprint(pkg);
    const artifacts = generateDeploymentPackageArtifacts(workspace, pkg);
    const scripts = artifacts.filter((artifact) => artifact.name.endsWith(".ps1"));

    expect(scripts.every((artifact) => String(artifact.content).includes(fingerprint))).toBe(true);
    expect(String(artifacts.find((artifact) => artifact.name === "VERSION")?.content)).toContain(
      fingerprint,
    );
    expect(deploymentPackageName(pkg)).toContain(fingerprint);
    expect(packageFingerprint({ ...pkg, name: "Renamed" })).toBe(fingerprint);
  });

  it("keeps Remediation detection identical and puts the compact summary first", () => {
    const pkg = configuredPackage("Remediation", ["One", "Two"]);
    const workspace = createWorkspace({ packages: [pkg] });
    const detect = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find(
        (artifact) => artifact.name === "Detect.ps1",
      )?.content,
    );

    expect(detect).toContain(
      'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Detect; Compliant=$compliant; NonCompliant=$nonCompliant; Errors=$errors"',
    );
    expect(detect.indexOf('Write-Output "ERS;')).toBeLessThan(
      detect.indexOf("$details | Write-Output"),
    );
  });

  it("targets mixed HKLM and per-item SYSTEM HKCU entries safely", () => {
    const machine = configuredItem("Machine");
    const profiles = configuredItem("Profiles");
    profiles.registry.hive = "HKEY_CURRENT_USER";
    profiles.userHive.userHiveTarget = "AllExistingProfiles";
    profiles.userHive.includeDefaultUser = true;
    const signedIn = configuredItem("SignedIn");
    signedIn.registry.hive = "HKEY_CURRENT_USER";
    signedIn.userHive.userHiveTarget = "AllSignedInUsers";
    const pkg = createDeploymentPackage({ name: "Mixed", items: [machine, profiles, signedIn] });
    const workspace = createWorkspace({ packages: [pkg] });
    const dryRun = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find(
        (artifact) => artifact.name === "DryRun.ps1",
      )?.content,
    );
    const readme = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find(
        (artifact) => artifact.name === "README.md",
      )?.content,
    );
    const csv = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find(
        (artifact) => artifact.name === "registry-summary.csv",
      )?.content,
    );

    expect(dryRun).toContain("if ($source.Hive -ne [Microsoft.Win32.RegistryHive]::CurrentUser)");
    expect(dryRun).toContain("UserHiveTarget = 'AllExistingProfiles'");
    expect(dryRun).toContain("UserHiveTarget = 'AllSignedInUsers'");
    expect(dryRun).toContain("$script:PreparedProfiles.ContainsKey($Profile.Sid)");
    expect(dryRun).toContain("function Initialize-ProfileTargetPlans");
    expect(dryRun).toContain("Join-Path $env:SystemDrive 'Users\\Default'");
    expect(dryRun).toContain("& reg.exe load");
    expect(dryRun).toContain("finally {\n    Close-SelfLoadedProfileHives");
    expect(dryRun).toContain("Hive already loaded:");
    expect(dryRun).not.toContain('Write-Error "PROFILE-ERROR');
    expect(readme).toContain("User hive target: All existing user profiles");
    expect(readme).toContain("Configure new users (Default User): Yes");
    expect(readme).toContain("User hive target: Currently signed-in users");
    expect(csv).toContain('"IncludeDefaultUser"');
    expect(csv).toContain('"AllExistingProfiles","true"');
    expect(csv).toContain('"AllSignedInUsers",""');
  });

  it("keeps logged-on-user HKCU operations on current user without profile mounting", () => {
    const item = configuredItem("CurrentUser");
    item.registry.hive = "HKEY_CURRENT_USER";
    const pkg = createDeploymentPackage({
      name: "Current user",
      deployment: {
        ...createDeploymentPackage().deployment,
        runContext: "LoggedOnUser",
      },
      items: [item],
    });
    const workspace = createWorkspace({ packages: [pkg] });
    const apply = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find(
        (artifact) => artifact.name === "Remediate.ps1",
      )?.content,
    );

    expect(apply).toContain("Hive = [Microsoft.Win32.RegistryHive]::CurrentUser");
    expect(apply).toContain("HiveLabel = 'HKEY_CURRENT_USER'");
    expect(apply).not.toContain("$ProfileTargeting");
    expect(apply).not.toContain("function Resolve-ProfileTargets");
    expect(apply).not.toContain("& reg.exe load");
  });

  it("keeps Platform Script and Win32 output sets distinct", () => {
    const platform = configuredPackage("Platform");
    platform.deployment.method = "PlatformScript";
    const win32 = configuredPackage("Win32");
    win32.deployment.method = "Win32App";
    const workspace = createWorkspace({ packages: [platform, win32] });

    expect(
      generateDeploymentPackageArtifacts(workspace, platform).map((file) => file.name),
    ).toEqual(expect.arrayContaining(["DryRun.ps1", "Apply.ps1"]));
    const win32Names = generateDeploymentPackageArtifacts(workspace, win32).map(
      (file) => file.name,
    );
    expect(win32Names).toEqual(expect.arrayContaining(["Install.ps1", "Detect.ps1"]));
    expect(win32Names).not.toContain("Uninstall.ps1");
  });

  it("documents only effective Present, Absent, and Win32 Revert behavior", () => {
    const recursive = configuredItem("StaleName");
    recursive.registry.desiredState = "Absent";
    recursive.registry.deletionMode = "KeyRecursive";
    recursive.registry.value = { type: "String", data: "stale-value" };
    const reverted = configuredItem("Managed");
    reverted.registry.rollbackMode = "SetDefinedRollbackValue";
    reverted.registry.rollbackValue = { type: "String", data: "before" };
    const pkg = createDeploymentPackage({
      name: "Documented",
      deployment: { ...createDeploymentPackage().deployment, method: "Win32App" },
      items: [recursive, reverted],
    });
    const workspace = createWorkspace({ packages: [pkg] });
    const artifacts = generateDeploymentPackageArtifacts(workspace, pkg);
    const readme = String(artifacts.find((file) => file.name === "README.md")?.content);
    const csv = String(artifacts.find((file) => file.name === "registry-summary.csv")?.content);

    expect(readme).toContain("Desired state: Absent — delete key recursively");
    expect(readme).not.toContain("stale-value");
    expect(readme).toContain("Revert behavior: Set String to before");
    expect(csv).toContain('"DeletionMode"');
    expect(csv).toContain('"RevertMode"');
    expect(csv).toContain('"KeyRecursive"');
    expect(csv).not.toContain("stale-value");
  });

  it("produces bounded filenames and distinct selected and all archive names", () => {
    const workspace = createWorkspace({ name: "Very long Workspace name" });
    expect(packageSlug("x".repeat(300))).toHaveLength(80);
    expect(workspaceArchiveName(workspace, "selected")).toContain("-selected-");
    expect(workspaceArchiveName(workspace, "all")).toContain("-all-");
  });

  it("escapes imported Markdown text and documents the Win32 handoff precisely", () => {
    const item = configuredItem("[click](https://example.invalid)");
    item.description = "![image](https://example.invalid/image.png)\n# heading";
    const pkg = createDeploymentPackage({
      name: "[Package](https://example.invalid)",
      deployment: { ...createDeploymentPackage().deployment, method: "Win32App" },
      items: [item],
    });
    const workspace = createWorkspace({ packages: [pkg] });
    const readme = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find((file) => file.name === "README.md")
        ?.content,
    );

    expect(readme).toContain("not an `.intunewin` file");
    expect(readme).toContain("Win32 Content Prep Tool");
    expect(readme).not.toContain("![image](https://example.invalid/image.png)");
    expect(readme).not.toContain("[Package](https://example.invalid)");
    expect(packagePortalSettings(pkg)).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Install behavior" })]),
    );
  });

  it("omits inactive profile drafts and neutralizes formula-leading CSV cells", () => {
    const item = configuredItem("@SUM(A1:A2)");
    item.registry.hive = "HKEY_CURRENT_USER";
    item.registry.value = { type: "String", data: "+cmd|' /C calc'!A0" };
    item.userHive.userHiveTarget = "AllExistingProfiles";
    item.userHive.includeDefaultUser = true;
    const pkg = createDeploymentPackage({
      name: "=Injected",
      deployment: {
        ...createDeploymentPackage().deployment,
        runContext: "LoggedOnUser",
      },
      items: [item],
    });
    const workspace = createWorkspace({ packages: [pkg] });
    const csv = String(
      generateDeploymentPackageArtifacts(workspace, pkg).find(
        (file) => file.name === "registry-summary.csv",
      )?.content,
    );

    expect(csv).toContain('"\'=Injected"');
    expect(csv).toContain('"\'@SUM(A1:A2)"');
    expect(csv).toContain("\"'+cmd|' /C calc'!A0\"");
    expect(csv).not.toContain("AllExistingProfiles");
  });

  it("uses the selected Win32 host architecture and signature policy in commands", () => {
    const pkg = configuredPackage("Commands");
    pkg.deployment.method = "Win32App";
    pkg.items[0]!.registry.rollbackMode = "DeleteManagedValue";
    const workspace = createWorkspace({ packages: [pkg] });
    const command = (name: string) =>
      String(
        generateDeploymentPackageArtifacts(workspace, pkg).find((file) => file.name === name)
          ?.content,
      );

    expect(command("install-command.txt")).toBe(
      "%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File Install.ps1\n",
    );
    expect(command("uninstall-command.txt")).toContain("Sysnative");

    pkg.deployment.runIn64BitPowerShell = false;
    pkg.deployment.enforceSignatureCheck = true;
    expect(command("install-command.txt")).toBe(
      "powershell.exe -NoProfile -ExecutionPolicy AllSigned -File Install.ps1\n",
    );
  });
});
