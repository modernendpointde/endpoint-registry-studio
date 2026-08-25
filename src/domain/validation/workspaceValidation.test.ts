import { describe, expect, it } from "vitest";

import { createDeploymentPackage, createRegistryItem } from "../workspace/workspace";
import { validateDeploymentPackage, validateRegistryItem } from "./workspaceValidation";

function validPackage() {
  const item = createRegistryItem({
    registry: { ...createRegistryItem().registry, keyPath: "Software\\Contoso" },
  });
  return createDeploymentPackage({ name: "Settings", items: [item] });
}

describe("Deployment Package validation", () => {
  it("treats an empty package as an incomplete authoring state rather than an error", () => {
    const pkg = createDeploymentPackage({ name: "", items: [] });
    const issues = validateDeploymentPackage(pkg);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "package-name", severity: "Error" }),
      ]),
    );
    expect(issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "package-empty" })]),
    );
  });

  it("blocks a package when every Registry Item is disabled", () => {
    const pkg = createDeploymentPackage({
      items: [
        createRegistryItem({
          enabled: false,
          registry: { ...createRegistryItem().registry, keyPath: "Software\\Contoso" },
        }),
      ],
    });

    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "package-no-enabled-items", severity: "Error" }),
      ]),
    );
  });

  it("blocks SYSTEM + HKCU without an item user-hive target", () => {
    const pkg = validPackage();
    const item = pkg.items[0]!;
    item.registry.hive = "HKEY_CURRENT_USER";
    expect(validateRegistryItem(item, pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "system-hkcu-target-required", severity: "Error" }),
      ]),
    );
  });

  it("treats stored user-hive details as inactive outside SYSTEM plus HKCU", () => {
    const pkg = validPackage();
    const item = pkg.items[0]!;
    item.registry.hive = "HKEY_CURRENT_USER";
    item.userHive = {
      userHiveTarget: "AllExistingProfiles",
      includeDefaultUser: true,
    };
    pkg.deployment.runContext = "LoggedOnUser";
    expect(validateRegistryItem(item, pkg).filter((issue) => issue.severity === "Error")).toEqual(
      [],
    );
    expect(validateRegistryItem(item, pkg).map((issue) => issue.code)).not.toEqual(
      expect.arrayContaining([
        "user-target-context",
        "specific-sid-context",
        "default-user-context",
        "default-user-risk",
      ]),
    );
  });

  it("accepts both supported SYSTEM profile targets", () => {
    const pkg = validPackage();
    const item = pkg.items[0]!;
    item.registry.hive = "HKEY_CURRENT_USER";
    item.userHive.userHiveTarget = "AllExistingProfiles";
    expect(validateRegistryItem(item, pkg).filter((issue) => issue.severity === "Error")).toEqual(
      [],
    );
    item.userHive.userHiveTarget = "AllSignedInUsers";
    item.userHive.includeDefaultUser = true;
    expect(validateRegistryItem(item, pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "default-user-target", severity: "Error" }),
      ]),
    );

    item.userHive.userHiveTarget = "AllExistingProfiles";
    expect(validateRegistryItem(item, pkg).map((issue) => issue.code)).toContain(
      "default-user-risk",
    );
  });

  it("detects conflicts inside one package", () => {
    const pkg = validPackage();
    pkg.items.push({
      ...createRegistryItem(),
      registry: { ...pkg.items[0]!.registry, value: { type: "String", data: "different" } },
    });
    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "conflicting-entry", severity: "Error" }),
      ]),
    );
  });

  it("detects overlapping effective views but permits separate explicit views", () => {
    const first = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        view: "Both",
        value: { type: "String", data: "first" },
      },
    });
    const second = createRegistryItem({
      registry: {
        ...first.registry,
        view: "Registry64",
        value: { type: "String", data: "second" },
      },
    });
    const pkg = createDeploymentPackage({ items: [first, second] });
    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "conflicting-entry", severity: "Error" }),
      ]),
    );

    first.registry.view = "Registry32";
    expect(validateDeploymentPackage(pkg).map((issue) => issue.code)).not.toContain(
      "conflicting-entry",
    );

    first.registry.view = "Auto";
    pkg.deployment.runIn64BitPowerShell = true;
    expect(validateDeploymentPackage(pkg).map((issue) => issue.code)).toContain(
      "conflicting-entry",
    );
  });

  it("blocks recursive deletion that overlaps a required descendant", () => {
    const recursive = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
        keyPath: "Software\\Contoso",
        valueName: "ignored",
      },
    });
    const child = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso\\Child",
        valueName: "Enabled",
      },
    });
    const pkg = createDeploymentPackage({ items: [recursive, child] });

    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "conflicting-recursive-delete",
          severity: "Error",
          itemId: child.id,
        }),
      ]),
    );

    child.registry.desiredState = "Absent";
    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "redundant-recursive-delete", severity: "Warning" }),
      ]),
    );
  });

  it("uses SYSTEM profile target overlap when detecting conflicts", () => {
    const first = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        hive: "HKEY_CURRENT_USER",
        keyPath: "Software\\Contoso",
        value: { type: "String", data: "first" },
      },
      userHive: {
        userHiveTarget: "AllSignedInUsers",
        includeDefaultUser: false,
      },
    });
    const second = createRegistryItem({
      registry: { ...first.registry, value: { type: "String", data: "second" } },
      userHive: {
        userHiveTarget: "AllSignedInUsers",
        includeDefaultUser: false,
      },
    });
    const pkg = createDeploymentPackage({ items: [first, second] });
    expect(validateDeploymentPackage(pkg).map((issue) => issue.code)).toContain(
      "conflicting-entry",
    );

    second.userHive.userHiveTarget = "AllExistingProfiles";
    expect(validateDeploymentPackage(pkg).map((issue) => issue.code)).toContain(
      "conflicting-entry",
    );

    second.userHive.userHiveTarget = "AllSignedInUsers";
    first.userHive.includeDefaultUser = true;
    second.userHive.includeDefaultUser = true;
    expect(validateDeploymentPackage(pkg).map((issue) => issue.code)).toContain(
      "conflicting-entry",
    );
  });

  it("rejects Win32 Revert actions that cannot reverse an Absent item", () => {
    const item = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
        keyPath: "Software\\Contoso",
        rollbackMode: "SetDefinedRollbackValue",
      },
    });
    const pkg = createDeploymentPackage({
      deployment: { ...createDeploymentPackage().deployment, method: "Win32App" },
      items: [item],
    });
    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "recursive-revert-unsupported", severity: "Error" }),
      ]),
    );

    item.registry.deletionMode = "Value";
    item.registry.rollbackMode = "DeleteManagedValue";
    expect(validateDeploymentPackage(pkg)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "absent-delete-revert-invalid", severity: "Error" }),
      ]),
    );
  });
});
