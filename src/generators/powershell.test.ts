import { describe, expect, it } from "vitest";

import type { RegistryValue } from "../domain/registry/model";
import {
  createDeploymentPackage,
  createRegistryItem,
  packageFingerprint,
  type DeploymentPackage,
  type RegistryItem,
} from "../domain/workspace/workspace";
import { generatePowerShell, type ScriptKind } from "./powershell";

function configuredItem(
  id: string,
  value: RegistryValue = { type: "String", data: "Configured" },
  registry: Partial<RegistryItem["registry"]> = {},
): RegistryItem {
  const base = createRegistryItem();
  return {
    ...base,
    id,
    registry: {
      ...base.registry,
      keyPath: "SOFTWARE\\Contoso",
      valueName: id,
      value,
      ...registry,
    },
  };
}

function configuredPackage(
  items: RegistryItem[],
  overrides: Partial<DeploymentPackage> = {},
): DeploymentPackage {
  return createDeploymentPackage({ name: "Generator package", items, ...overrides });
}

function generate(
  items: RegistryItem[],
  kind: ScriptKind,
  overrides: Partial<DeploymentPackage> = {},
): string {
  return generatePowerShell(configuredPackage(items, overrides), kind);
}

describe("role-specific PowerShell generation", () => {
  it("compiles directly from a package deterministically with typed views and metadata", () => {
    const item = configuredItem(
      "quote",
      { type: "String", data: "O'Brien" },
      {
        valueName: "Quote'Name",
        view: "Both",
      },
    );
    const pkg = configuredPackage([item], { name: "O'Brien package" });
    const first = generatePowerShell(pkg, "Detect");

    expect(generatePowerShell(pkg, "Detect")).toBe(first);
    expect(first).toContain("# Endpoint Registry Studio");
    expect(first).toContain("# Generator version: 1.0.1");
    expect(first).toContain("# Deployment Package: O'Brien package");
    expect(first).toContain(`# Deployment Package fingerprint: ${packageFingerprint(pkg)}`);
    expect(first).toContain("[Microsoft.Win32.RegistryView]::Registry32");
    expect(first).toContain("[Microsoft.Win32.RegistryView]::Registry64");
    expect(first).toContain("Quote''Name");
    expect(first).toContain("[string]'O''Brien'");
    expect(first).not.toContain("Configuration fingerprint");
    expect(first).not.toContain("Invoke-Expression");
  });

  it("emits exact CLR write literals for all Registry value kinds and numeric boundaries", () => {
    const items = [
      configuredItem("string", { type: "String", data: "Text" }),
      configuredItem("expand", { type: "ExpandString", data: "%TEMP%\\Path" }),
      configuredItem("multi", { type: "MultiString", data: ["One", "Two"] }),
      configuredItem("empty-multi", { type: "MultiString", data: [] }),
      configuredItem("binary", { type: "Binary", data: [0, 1, 127, 255] }),
      configuredItem("dword-min", { type: "DWord", data: 2_147_483_648 }),
      configuredItem("dword-max", { type: "DWord", data: 4_294_967_295 }),
      configuredItem("qword-min", { type: "QWord", data: "9223372036854775808" }),
      configuredItem("qword-max", { type: "QWord", data: "18446744073709551615" }),
    ];
    const script = generate(items, "Apply");

    expect(script).toContain("Value = [string]'Text'");
    expect(script).toContain("Value = [string]'%TEMP%\\Path'");
    expect(script).toContain("Value = [string[]]@('One', 'Two')");
    expect(script).toContain("Value = [string[]]@()");
    expect(script).toContain("Value = [byte[]]@(0, 1, 127, 255)");
    expect(script).toContain("Value = [int32]::MinValue");
    expect(script).toContain("Value = [int32](-1)");
    expect(script).toContain("Value = [int64]::MinValue");
    expect(script).toContain("Value = [int64](-1)");
    expect(script).toContain("[Microsoft.Win32.RegistryValueKind]::MultiString");
    expect(script).not.toContain("ConvertTo-RegistryWriteValue");
    expect(script).not.toContain("ConvertTo-Unsigned");
    expect(script).not.toContain("[System.Enum]::Parse");
  });

  it("keeps non-ASCII source ASCII-safe and decodes every user-controlled Registry string", () => {
    const item = configuredItem("unicode", {
      type: "MultiString",
      data: ["Grüße ✓", "中文", "東京", "line\n)\nend"],
    });
    item.registry.keyPath = "SOFTWARE\\Grüße\\東京";
    item.registry.valueName = "名称✓";
    const script = generate([item], "Apply", { name: "Paket Grüße ✓" });
    const expectedValues = [
      "SOFTWARE\\Grüße\\東京",
      "名称✓",
      "Grüße ✓",
      "中文",
      "東京",
      "line\n)\nend",
    ];

    expect(script).toContain("function ConvertFrom-ErsUtf8Base64");
    expect(script).toContain("[System.Text.Encoding]::UTF8.GetString");
    for (const value of expectedValues) {
      expect(script).toContain(Buffer.from(value, "utf8").toString("base64"));
      expect(script).not.toContain(value);
    }
    expect(script).not.toMatch(/[^\x00-\x7F]/);
  });

  it("omits the Unicode decoder when all emitted source is ASCII", () => {
    const script = generate([configuredItem("ascii")], "Apply");
    expect(script).not.toContain("ConvertFrom-ErsUtf8Base64");
    expect(script).not.toMatch(/[^\x00-\x7F]/);
  });

  it("detects Present by exact raw kind/value and Absent by its deletion scope", () => {
    const present = configuredItem("present", { type: "ExpandString", data: "%TEMP%" });
    const valueAbsent = configuredItem(
      "value-absent",
      { type: "DWord", data: 1 },
      {
        desiredState: "Absent",
        deletionMode: "Value",
      },
    );
    const keyAbsent = configuredItem(
      "key-absent",
      { type: "DWord", data: 1 },
      {
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
      },
    );
    const emptyKey = configuredItem(
      "empty-key",
      { type: "DWord", data: 1 },
      {
        desiredState: "Absent",
        deletionMode: "KeyIfEmpty",
      },
    );
    const arrays = configuredItem("arrays", { type: "MultiString", data: ["A", "B"] });
    const script = generate([present, valueAbsent, keyAbsent, emptyKey, arrays], "Detect");

    expect(script).toContain("Check = 'Exact'");
    expect(script).toContain("Check = 'ValueAbsent'");
    expect(script).toContain("Check = 'KeyAbsent'");
    expect(script).toContain("Check = 'KeyIfEmpty'");
    expect(script).toContain("KeyEmpty = ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0)");
    expect(script).toContain(
      "return ((-not $State.KeyExists) -or ((-not $State.ValueExists) -and (-not $State.KeyEmpty)))",
    );
    expect(script).toContain("DoNotExpandEnvironmentNames");
    expect(script).toContain("if ($State.Kind -ne $Entry.Kind)");
    expect(script).toContain("return $State.Value -ceq $Entry.Value");
    expect(script).toContain("function Test-ExactSequence");
    expect(script).toContain("$Actual.Count -ne $Expected.Count");
    expect(script).not.toContain("Comparison =");
    expect(script).not.toContain("ContainsAll");
    expect(script).not.toContain("IgnoreOrder");
    expect(script).not.toContain("ExpandEnvironmentVariables([string]$actual)");
  });

  it("keeps Detect and DryRun read-only", () => {
    for (const kind of ["Detect", "DryRun"] as const) {
      const script = generate([configuredItem("read-only")], kind);
      expect(script).toContain("function Get-RegistryState");
      expect(script).toContain("function Test-RegistryExactState");
      expect(script).not.toContain("SetValue(");
      expect(script).not.toContain("CreateSubKey(");
      expect(script).not.toContain("DeleteSubKey");
      expect(script).not.toContain("DeleteValue(");
    }
  });

  it("writes directly without embedding read or compliance machinery", () => {
    for (const kind of ["Remediate", "Apply", "Install"] as const) {
      const script = generate([configuredItem("write")], kind);
      expect(script).toContain("function Invoke-RegistryAction");
      expect(script).toContain("$key.SetValue($Entry.ValueName, $Entry.Value, $Entry.Kind)");
      expect(script).not.toContain("Get-RegistryState");
      expect(script).not.toContain("Test-RegistryExactState");
      expect(script).not.toContain("DoNotExpandEnvironmentNames");
      expect(script).not.toContain("UNCHANGED");
      expect(script).not.toContain("APPLIED [");
      expect(
        script.indexOf('Write-Output "ERS; fingerprint=$PackageFingerprint; role='),
      ).toBeLessThan(script.indexOf("$details | Write-Output"));
      expect(script).not.toContain("DeleteSubKeyTree");
      expect(script).not.toContain("DeleteValue(");
    }
  });

  it("emits only deletion branches used by the package", () => {
    const value = configuredItem("value", undefined, {
      desiredState: "Absent",
      deletionMode: "Value",
    });
    const empty = configuredItem("empty", undefined, {
      desiredState: "Absent",
      deletionMode: "KeyIfEmpty",
    });
    const recursive = configuredItem("recursive", undefined, {
      desiredState: "Absent",
      deletionMode: "KeyRecursive",
    });

    const valueScript = generate([value], "Remediate");
    expect(valueScript).toContain("'DeleteValue' {");
    expect(valueScript).not.toContain("'DeleteValueAndEmptyKey' {");
    expect(valueScript).not.toContain("DeleteSubKeyTree");

    const emptyScript = generate([empty], "Remediate");
    expect(emptyScript).toContain("'DeleteValueAndEmptyKey' {");
    expect(emptyScript).toContain("$key.SubKeyCount -eq 0");
    expect(emptyScript).not.toContain("'DeleteValue' {");
    expect(emptyScript).not.toContain("DeleteSubKeyTree");

    const recursiveScript = generate([recursive], "Remediate");
    expect(recursiveScript).toContain("DeleteSubKeyTree");
    expect(recursiveScript).not.toContain("DeleteValue(");
    expect(recursiveScript).not.toContain("CreateSubKey(");
  });

  it("emits only explicit Win32 Revert entries and values", () => {
    const none = configuredItem("no-revert", { type: "String", data: "DesiredOnly" });
    const remove = configuredItem(
      "delete-revert",
      { type: "String", data: "Managed" },
      {
        rollbackMode: "DeleteManagedValue",
      },
    );
    const restore = configuredItem(
      "set-revert",
      { type: "String", data: "Desired" },
      {
        rollbackMode: "SetDefinedRollbackValue",
        rollbackValue: { type: "DWord", data: 7 },
      },
    );
    const script = generate([none, remove, restore], "Uninstall", {
      deployment: { ...configuredPackage([]).deployment, method: "Win32App" },
    });

    expect(script).not.toContain("no-revert");
    expect(script).not.toContain("DesiredOnly");
    expect(script).toContain("delete-revert");
    expect(script).toContain("set-revert");
    expect(script).toContain("Action = 'DeleteValue'");
    expect(script).toContain("Value = [int32](7)");
    expect(script).not.toContain("RollbackMode");
    expect(script).not.toContain("NO-ROLLBACK");
    expect(script).not.toContain("Get-RegistryState");
  });

  it("uses method-specific detection exit codes and summary-first buffered details", () => {
    const pkg = configuredPackage([configuredItem("detect")]);
    const remediation = generatePowerShell(pkg, "Detect");
    const win32 = generatePowerShell(pkg, "Win32Detect");
    const summary =
      'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Detect; Compliant=$compliant; NonCompliant=$nonCompliant; Errors=$errors"';

    expect(remediation).toContain(summary);
    expect(remediation.indexOf(summary)).toBeLessThan(
      remediation.indexOf("$details | Write-Output"),
    );
    expect(win32).toContain(summary);
    expect(remediation).toContain(
      "$exitCode = if ($nonCompliant -gt 0 -or $errors -gt 0) { 1 } else { 0 }",
    );
    expect(win32).toContain("DETECTION-ERROR");
    expect(win32).toContain(
      "$exitCode = if ($errors -gt 0) { 2 } elseif ($nonCompliant -gt 0) { 1 } else { 0 }",
    );
  });

  it("omits all profile machinery for ordinary HKLM and logged-on-user HKCU scripts", () => {
    const user = configuredItem("current-user");
    user.registry.hive = "HKEY_CURRENT_USER";
    const loggedOn = configuredPackage([user], {
      deployment: {
        ...createDeploymentPackage().deployment,
        runContext: "LoggedOnUser",
      },
    });

    for (const script of [
      generatePowerShell(configuredPackage([configuredItem("machine")]), "Apply"),
      generatePowerShell(loggedOn, "Apply"),
    ]) {
      expect(script).not.toContain("ProfileResolution");
      expect(script).not.toContain("HKEY_USERS");
      expect(script).not.toContain("NTUSER.DAT");
      expect(script).not.toContain("reg.exe");
      expect(script).not.toContain("Get-CimInstance");
    }
  });

  it("plans each SYSTEM HKCU scope once and owns hive cleanup in one outer boundary", () => {
    const profiles = configuredItem("profiles");
    profiles.registry.hive = "HKEY_CURRENT_USER";
    profiles.userHive.userHiveTarget = "AllExistingProfiles";
    profiles.userHive.includeDefaultUser = true;
    const profileScript = generate([profiles], "Apply");
    expect(profileScript).toContain("function Get-AllProfileRecords");
    expect(profileScript).not.toContain("Win32_UserProfile");
    expect(profileScript).not.toContain("LastUseTime");
    expect(profileScript).not.toContain("LastWriteTimeUtc");
    expect(profileScript).toContain("Users\\Default");
    expect(profileScript).toContain("function Initialize-ProfileTargetPlans");
    expect(profileScript).toContain("$script:ProfileTargetPlans['AllExistingProfiles']");
    expect(profileScript).toContain("$script:ProfileTargetPlans['DefaultUser']");
    expect(profileScript).not.toContain("function Resolve-ProfileTargets");
    expect(profileScript.match(/Initialize-ProfileTargetPlans/g)).toHaveLength(2);
    expect(profileScript).toContain("$script:PreparedProfiles.ContainsKey($Profile.Sid)");
    expect(profileScript).toContain("if ($null -ne $profile.Error) { continue }");
    expect(profileScript).toContain("$errors += $script:ProfileCleanupErrors");
    expect(profileScript).toContain("PROFILE-ERROR: Could not unload self-loaded hive");
    expect(profileScript).not.toContain("function Get-SignedInUserSids");
    expect(profileScript).not.toContain("SpecificUserSid");
    expect(profileScript).toContain(
      "finally {\n    Close-SelfLoadedProfileHives\n}\n$errors += $script:ProfileCleanupErrors",
    );
    expect(profileScript.match(/Close-SelfLoadedProfileHives/g)).toHaveLength(2);
    expect(profileScript).not.toMatch(/\$(?!script:|env:)[A-Za-z_]\w*:/);
    expect(profileScript).toContain(
      'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Apply; processed=$processed; errors=$errors"',
    );

    const signedIn = configuredItem("signed-in");
    signedIn.registry.hive = "HKEY_CURRENT_USER";
    signedIn.userHive.userHiveTarget = "AllSignedInUsers";
    signedIn.userHive.includeDefaultUser = true;
    const signedInScript = generate([signedIn], "Apply");
    expect(signedInScript).toContain("function Get-SignedInUserSids");
    expect(signedInScript).toContain("interactive Explorer owner");
    expect(signedInScript).not.toContain("SpecificUserSid");
    expect(signedInScript).not.toContain("function Get-AllProfileRecords");
    expect(signedInScript).not.toContain("Users\\Default");
    expect(signedInScript).not.toContain("Win32_UserProfile");
  });

  it("reuses mixed-scope plans and isolates individual profile discovery failures", () => {
    const firstAll = configuredItem("all-one");
    firstAll.registry.hive = "HKEY_CURRENT_USER";
    firstAll.userHive.userHiveTarget = "AllExistingProfiles";
    const secondAll = configuredItem("all-two");
    secondAll.registry.hive = "HKEY_CURRENT_USER";
    secondAll.userHive.userHiveTarget = "AllExistingProfiles";
    secondAll.userHive.includeDefaultUser = true;
    const signedIn = configuredItem("signed");
    signedIn.registry.hive = "HKEY_CURRENT_USER";
    signedIn.userHive.userHiveTarget = "AllSignedInUsers";
    const machine = configuredItem("machine");

    const script = generate([firstAll, secondAll, signedIn, machine], "Detect");

    expect(script.match(/\$allProfiles = @\(Get-AllProfileRecords\)/g)).toHaveLength(1);
    expect(script.match(/foreach \(\$sid in @\(Get-SignedInUserSids\)\)/g)).toHaveLength(1);
    expect(script).toContain("foreach ($sid in @($profileList.GetSubKeyNames())) {");
    expect(script).toContain("Could not inspect profile $($sid)");
    expect(script).toContain("$script:ProfileRecords.ContainsKey($Sid)");
    expect(script).toContain("$script:PreparedProfiles[$Profile.Sid] = $Profile");
    expect(script).toContain("$targets = @($script:ProfileTargetPlans[$source.UserHiveTarget])");
    expect(script).not.toContain("Resolve-ProfileTargets -UserHiveTarget");
    expect(script).toContain("Hive = [Microsoft.Win32.RegistryHive]::LocalMachine");
  });

  it("does not pull profile code into Uninstall for an HKCU item without Revert behavior", () => {
    const hkcuNone = configuredItem("hkcu-none");
    hkcuNone.registry.hive = "HKEY_CURRENT_USER";
    hkcuNone.userHive.userHiveTarget = "AllExistingProfiles";
    const machineRevert = configuredItem("machine-revert", undefined, {
      rollbackMode: "DeleteManagedValue",
    });
    const script = generate([hkcuNone, machineRevert], "Uninstall");

    expect(script).not.toContain("hkcu-none");
    expect(script).not.toContain("ProfileResolution");
    expect(script).not.toContain("NTUSER.DAT");
  });

  it("emits a stable ERS first-line mark and writes ers.log only from SYSTEM mutation", () => {
    const item = configuredItem("mark");
    const systemApply = generate([item], "Apply");
    const loggedOn = generatePowerShell(
      configuredPackage([item], {
        deployment: {
          ...createDeploymentPackage().deployment,
          runContext: "LoggedOnUser",
        },
      }),
      "Apply",
    );
    const detect = generate([item], "Detect");
    const dryRun = generate([item], "DryRun");
    const ersApply =
      'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Apply; processed=$processed; errors=$errors"';
    const ersDetect =
      'Write-Output "ERS; fingerprint=$PackageFingerprint; role=Detect; Compliant=$compliant; NonCompliant=$nonCompliant; Errors=$errors"';
    const ersDryRun =
      'Write-Output "ERS; fingerprint=$PackageFingerprint; role=DryRun; total=$total; compliant=$compliant; non-compliant=$nonCompliant; errors=$errors"';

    expect(systemApply).toContain(ersApply);
    expect(systemApply).toContain("function Write-ErsDeviceMark");
    expect(systemApply).toContain("Join-Path $env:ProgramData 'Endpoint Registry Studio'");
    expect(systemApply).toContain(
      'Write-ErsDeviceMark "fingerprint=$PackageFingerprint role=Apply',
    );
    expect(systemApply.indexOf(ersApply)).toBeLessThan(
      systemApply.indexOf("$details | Write-Output"),
    );
    expect(loggedOn).toContain(ersApply);
    expect(loggedOn).not.toContain("Write-ErsDeviceMark");
    expect(loggedOn).not.toContain("Join-Path $env:ProgramData 'Endpoint Registry Studio'");
    expect(detect).toContain(ersDetect);
    expect(detect).not.toContain("Write-ErsDeviceMark");
    expect(dryRun).toContain(ersDryRun);
    expect(dryRun.indexOf(ersDryRun)).toBeLessThan(dryRun.indexOf("$details | Write-Output"));
    expect(dryRun).not.toContain("Write-ErsDeviceMark");
    expect(dryRun).not.toContain('Write-Output "DRY-RUN [');
  });
});
