import { describe, expect, it } from "vitest";

import {
  cloneRegistryItem,
  createDeploymentPackage,
  createRegistryItem,
  packageFingerprint,
  registryItemLabel,
} from "./workspace";

describe("Deployment Package domain", () => {
  it("uses the same aggregate for one and many Registry Items", () => {
    const first = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        valueName: "One",
      },
    });
    const pkg = createDeploymentPackage({ name: "Contoso", items: [first] });

    expect(pkg.items).toEqual([first]);
    pkg.items = [...pkg.items, createRegistryItem()];
    expect(pkg.items).toHaveLength(2);
    expect(pkg.deployment).toMatchObject({ method: "Remediation", runContext: "System" });
  });

  it("creates a distinct item copy and fingerprints package execution data", () => {
    const original = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        valueName: "Homepage",
      },
    });
    const duplicate = cloneRegistryItem(original);
    const pkg = createDeploymentPackage({ name: "Homepage", items: [original] });

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.registry).not.toBe(original.registry);
    expect(packageFingerprint({ ...pkg, name: "Renamed" })).toBe(packageFingerprint(pkg));
    expect(
      packageFingerprint({
        ...pkg,
        deployment: { ...pkg.deployment, method: "Win32App" },
      }),
    ).not.toBe(packageFingerprint(pkg));
    expect(packageFingerprint({ ...pkg, items: [{ ...original, enabled: false }] })).not.toBe(
      packageFingerprint(pkg),
    );
  });

  it("fingerprints only settings that affect the generated package", () => {
    const present = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        valueName: "Enabled",
        value: { type: "DWord", data: 1 },
      },
    });
    const remediation = createDeploymentPackage({ items: [present] });
    const baseline = packageFingerprint(remediation);

    expect(
      packageFingerprint({
        ...remediation,
        items: [
          {
            ...present,
            description: "Documentation only",
            registry: {
              ...present.registry,
              deletionMode: "KeyRecursive",
              rollbackMode: "SetDefinedRollbackValue",
              rollbackValue: { type: "String", data: "unused" },
            },
            userHive: {
              userHiveTarget: "AllExistingProfiles",
              includeDefaultUser: true,
            },
          },
        ],
      }),
    ).toBe(baseline);

    const absent = {
      ...present,
      registry: {
        ...present.registry,
        desiredState: "Absent" as const,
        deletionMode: "KeyRecursive" as const,
      },
    };
    const absentPackage = createDeploymentPackage({ items: [absent] });
    expect(
      packageFingerprint({
        ...absentPackage,
        items: [
          {
            ...absent,
            registry: {
              ...absent.registry,
              valueName: "IgnoredForRecursiveDeletion",
              value: { type: "String", data: "unused" },
            },
          },
        ],
      }),
    ).toBe(packageFingerprint(absentPackage));

    const win32Item = {
      ...present,
      registry: {
        ...present.registry,
        rollbackMode: "SetDefinedRollbackValue" as const,
        rollbackValue: { type: "String" as const, data: "before" },
      },
    };
    const win32 = {
      ...remediation,
      deployment: { ...remediation.deployment, method: "Win32App" as const },
      items: [win32Item],
    };
    expect(
      packageFingerprint({
        ...win32,
        items: [
          {
            ...win32Item,
            registry: {
              ...win32Item.registry,
              rollbackValue: { type: "String", data: "after" },
            },
          },
        ],
      }),
    ).not.toBe(packageFingerprint(win32));

    const profileItem = {
      ...present,
      registry: { ...present.registry, hive: "HKEY_CURRENT_USER" as const },
      userHive: {
        userHiveTarget: "AllExistingProfiles" as const,
        includeDefaultUser: false,
      },
    };
    const profilePackage = createDeploymentPackage({ items: [profileItem] });
    expect(
      packageFingerprint({
        ...profilePackage,
        items: [
          {
            ...profileItem,
            userHive: { ...profileItem.userHive, includeDefaultUser: true },
          },
        ],
      }),
    ).not.toBe(packageFingerprint(profilePackage));

    const signedInProfile = {
      ...profileItem,
      userHive: { userHiveTarget: "AllSignedInUsers" as const, includeDefaultUser: false },
    };
    const signedInPackage = createDeploymentPackage({ items: [signedInProfile] });
    expect(
      packageFingerprint({
        ...signedInPackage,
        items: [
          {
            ...signedInProfile,
            userHive: { ...signedInProfile.userHive, includeDefaultUser: true },
          },
        ],
      }),
    ).toBe(packageFingerprint(signedInPackage));
  });

  it("labels recursive key deletion by the key rather than a stale hidden value name", () => {
    const item = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
        keyPath: "Software\\Contoso\\Retired",
        valueName: "StaleValueName",
      },
    });

    expect(registryItemLabel(item)).toBe("Retired");
  });
});
