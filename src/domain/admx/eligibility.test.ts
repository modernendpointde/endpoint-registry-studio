import { describe, expect, it } from "vitest";
import { createRegistryDefinition } from "../registry/model";
import {
  createDeploymentPackage,
  createRegistryItem,
  defaultDeployment,
} from "../workspace/workspace";
import { assessAdmxEligibility } from "./eligibility";

function machinePackage() {
  return createDeploymentPackage();
}

function userPackage() {
  return createDeploymentPackage({
    deployment: { ...defaultDeployment(), runContext: "LoggedOnUser" },
  });
}

function win32Package() {
  return createDeploymentPackage({
    deployment: { ...defaultDeployment(), method: "Win32App" },
  });
}

function presentItem(overrides: Parameters<typeof createRegistryDefinition>[0] = {}) {
  return createRegistryItem({
    registry: createRegistryDefinition({
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: "Enabled",
      value: { type: "DWord", data: 1 },
      ...overrides,
    }),
  });
}

function codes(item: ReturnType<typeof presentItem>, pkg = machinePackage()) {
  const result = assessAdmxEligibility(item, pkg);
  return result.status === "rejected" ? result.reasons.map((reason) => reason.reasonCode) : [];
}

describe("ADMX eligibility", () => {
  it("accepts an HKLM DWORD policy path", () => {
    expect(assessAdmxEligibility(presentItem(), machinePackage())).toEqual({
      status: "accepted",
      policyClass: "Machine",
    });
  });

  it("accepts ordinary HKCU string policy in a logged-on-user package", () => {
    const item = presentItem({
      hive: "HKEY_CURRENT_USER",
      value: { type: "String", data: "northgate" },
    });
    expect(assessAdmxEligibility(item, userPackage())).toEqual({
      status: "accepted",
      policyClass: "User",
    });
  });

  it("accepts ExpandString", () => {
    expect(
      assessAdmxEligibility(
        presentItem({ value: { type: "ExpandString", data: "%ProgramFiles%\\App" } }),
        machinePackage(),
      ).status,
    ).toBe("accepted");
  });

  it("rejects Absent desired state including deletion modes", () => {
    expect(codes(presentItem({ desiredState: "Absent", deletionMode: "Value" }))).toContain(
      "DesiredStateNotPresent",
    );
    expect(codes(presentItem({ desiredState: "Absent", deletionMode: "KeyIfEmpty" }))).toContain(
      "DesiredStateNotPresent",
    );
    expect(codes(presentItem({ desiredState: "Absent", deletionMode: "KeyRecursive" }))).toContain(
      "DesiredStateNotPresent",
    );
  });

  it("rejects unnamed and malformed names", () => {
    expect(codes(presentItem({ valueName: "   " }))).toContain("UnnamedValue");
    expect(codes(presentItem({ valueName: "Name\0x" }))).toContain("MalformedValueName");
  });

  it("rejects unsupported types and invalid DWORD data", () => {
    expect(codes(presentItem({ value: { type: "QWord", data: "1" } }))).toContain(
      "UnsupportedType",
    );
    expect(codes(presentItem({ value: { type: "MultiString", data: ["a"] } }))).toContain(
      "UnsupportedType",
    );
    expect(codes(presentItem({ value: { type: "Binary", data: [1] } }))).toContain(
      "UnsupportedType",
    );
    expect(codes(presentItem({ value: { type: "DWord", data: 1.5 } }))).toContain(
      "InvalidValueData",
    );
    expect(codes(presentItem({ value: { type: "DWord", data: -1 } }))).toContain(
      "InvalidValueData",
    );
  });

  it("rejects explicit Registry views including Registry32", () => {
    expect(codes(presentItem({ view: "Registry32" }))).toContain("ExplicitRegistryView");
    expect(codes(presentItem({ view: "Registry64" }))).toContain("ExplicitRegistryView");
    expect(codes(presentItem({ view: "Both" }))).toContain("ExplicitRegistryView");
  });

  it("rejects SYSTEM signed-in user targeting and Default User", () => {
    const signedIn = presentItem({ hive: "HKEY_CURRENT_USER" });
    signedIn.userHive = { userHiveTarget: "AllSignedInUsers", includeDefaultUser: false };
    expect(codes(signedIn, machinePackage())).toEqual(["SystemUserHiveTargeting"]);

    const defaultUser = presentItem({ hive: "HKEY_CURRENT_USER" });
    defaultUser.userHive = { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true };
    expect(codes(defaultUser, machinePackage())).toEqual([
      "SystemUserHiveTargeting",
      "DefaultUserProcessing",
    ]);
  });

  it("rejects Win32 Revert and keeps inactive Revert fields eligible", () => {
    const item = presentItem({ rollbackMode: "DeleteManagedValue" });
    expect(codes(item, win32Package())).toContain("RevertConfigured");
    expect(assessAdmxEligibility(item, machinePackage()).status).toBe("accepted");
  });

  it("rejects empty, malformed, Microsoft, WOW64, and view-dependent paths", () => {
    expect(codes(presentItem({ keyPath: "" }))).toContain("EmptyKeyPath");
    expect(codes(presentItem({ keyPath: "Software\Policies\Northgate\App\0" }))).toContain(
      "MalformedKeyPath",
    );
    expect(codes(presentItem({ value: { type: "String", data: "ok\0" } }))).toContain(
      "InvalidValueData",
    );
    expect(codes(presentItem({ keyPath: "Software\\Policies\\Northgate\\" }))).toContain(
      "MalformedKeyPath",
    );
    expect(codes(presentItem({ keyPath: "Software\\Microsoft\\Windows" }))).toContain(
      "MicrosoftRegistryLocation",
    );
    expect(codes(presentItem({ keyPath: "Software\\Policies\\Microsoft\\Office" }))).toContain(
      "MicrosoftRegistryLocation",
    );
    expect(codes(presentItem({ keyPath: "System\\CurrentControlSet" }))).toContain(
      "MicrosoftRegistryLocation",
    );
    expect(
      codes(presentItem({ keyPath: "Software\\WOW6432Node\\Policies\\Northgate\\App" })),
    ).toContain("Wow6432NodePath");
    expect(codes(presentItem({ keyPath: "Software\\Northgate\\App" }))).toContain(
      "ViewDependentKeyPath",
    );
    expect(codes(presentItem({ keyPath: "HARDWARE\\DEVICEMAP" }))).toContain("UnsupportedKeyPath");
  });

  it("rejects secret-like value names", () => {
    expect(codes(presentItem({ valueName: "ApiToken" }))).toContain("SensitiveValueName");
  });

  it("collects multiple reasons without approximating", () => {
    const item = presentItem({
      desiredState: "Absent",
      view: "Registry32",
      value: { type: "QWord", data: "1" },
      valueName: "",
    });
    expect(codes(item)).toEqual([
      "DesiredStateNotPresent",
      "UnnamedValue",
      "UnsupportedType",
      "ExplicitRegistryView",
    ]);
  });
});
