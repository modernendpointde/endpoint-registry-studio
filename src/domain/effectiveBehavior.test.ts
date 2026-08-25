import { describe, expect, it } from "vitest";

import type { DeletionMode, DesiredState, RegistryView, RollbackMode } from "./registry/model";
import {
  activeRegistryItemFields,
  configuredRevertIssue,
  effectiveDesiredMutation,
  effectiveRegistryItemBehavior,
  effectiveRegistryViews,
  effectiveRevertMutation,
  effectiveUserHive,
  normalizeRevertForDesiredState,
  normalizeUserHiveTarget,
} from "./effectiveBehavior";
import { createDeploymentPackage, createRegistryItem } from "./workspace/workspace";

describe("effective Registry Item behavior", () => {
  it.each([
    ["Auto", true, ["Auto:Registry64"]],
    ["Auto", false, ["Auto:Registry32"]],
    ["Registry32", true, ["Registry32:Registry32"]],
    ["Registry64", false, ["Registry64:Registry64"]],
    ["Both", true, ["Registry32:Registry32", "Registry64:Registry64"]],
  ] satisfies Array<[RegistryView, boolean, string[]]>)(
    "expands %s with 64-bit host=%s",
    (view, run64Bit, expected) => {
      expect(
        effectiveRegistryViews(view, run64Bit).map(
          (target) => `${target.requested}:${target.architecture}`,
        ),
      ).toEqual(expected);
    },
  );

  it.each([
    ["Present", "Value", "SetValue"],
    ["Absent", "Value", "DeleteValue"],
    ["Absent", "KeyIfEmpty", "DeleteValueAndEmptyKey"],
    ["Absent", "KeyRecursive", "DeleteKeyRecursive"],
  ] satisfies Array<[DesiredState, DeletionMode, string]>)(
    "maps %s/%s to %s",
    (desiredState, deletionMode, expected) => {
      const item = createRegistryItem();
      item.registry.desiredState = desiredState;
      item.registry.deletionMode = deletionMode;
      expect(effectiveDesiredMutation(item).kind).toBe(expected);
    },
  );

  it.each([
    ["Remediation", "Present", "Value", "DeleteManagedValue", undefined, undefined],
    ["PlatformScript", "Present", "Value", "SetDefinedRollbackValue", undefined, undefined],
    ["Win32App", "Present", "Value", "None", undefined, undefined],
    ["Win32App", "Present", "Value", "DeleteManagedValue", "DeleteValue", undefined],
    ["Win32App", "Present", "Value", "SetDefinedRollbackValue", "SetValue", undefined],
    ["Win32App", "Absent", "Value", "DeleteManagedValue", undefined, "AbsentDeleteManagedValue"],
    ["Win32App", "Absent", "Value", "SetDefinedRollbackValue", "SetValue", undefined],
    ["Win32App", "Absent", "KeyRecursive", "SetDefinedRollbackValue", undefined, "RecursiveDelete"],
  ] satisfies Array<
    [
      "Remediation" | "PlatformScript" | "Win32App",
      DesiredState,
      DeletionMode,
      RollbackMode,
      string | undefined,
      string | undefined,
    ]
  >)(
    "resolves %s %s/%s Revert %s",
    (method, desiredState, deletionMode, rollbackMode, action, issue) => {
      const item = createRegistryItem();
      item.registry.desiredState = desiredState;
      item.registry.deletionMode = deletionMode;
      item.registry.rollbackMode = rollbackMode;
      const pkg = createDeploymentPackage({
        deployment: { ...createDeploymentPackage().deployment, method },
        items: [item],
      });
      expect(effectiveRevertMutation(item, pkg)?.kind).toBe(action);
      expect(configuredRevertIssue(item, pkg)).toBe(issue);
    },
  );

  it.each([
    ["System", "HKEY_CURRENT_USER", "AllSignedInUsers", true, false],
    ["System", "HKEY_CURRENT_USER", "AllExistingProfiles", true, true],
    ["System", "HKEY_LOCAL_MACHINE", "AllExistingProfiles", true, undefined],
    ["LoggedOnUser", "HKEY_CURRENT_USER", "AllExistingProfiles", true, undefined],
  ] as const)(
    "resolves %s %s target %s Default User=%s",
    (runContext, hive, target, includeDefaultUser, expectedDefaultUser) => {
      const item = createRegistryItem();
      item.registry.hive = hive;
      item.userHive = { userHiveTarget: target, includeDefaultUser };
      const pkg = createDeploymentPackage({
        deployment: { ...createDeploymentPackage().deployment, runContext },
        items: [item],
      });
      expect(effectiveUserHive(item, pkg)?.includeDefaultUser).toBe(expectedDefaultUser);
    },
  );

  it("projects only active execution data and exposes the same field relevance", () => {
    const item = createRegistryItem();
    item.registry.desiredState = "Absent";
    item.registry.deletionMode = "KeyRecursive";
    item.registry.hive = "HKEY_CURRENT_USER";
    item.registry.valueName = "inactive";
    item.registry.rollbackMode = "SetDefinedRollbackValue";
    item.userHive = { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true };
    const pkg = createDeploymentPackage({
      deployment: { ...createDeploymentPackage().deployment, method: "Win32App" },
      items: [item],
    });

    expect(effectiveRegistryItemBehavior(item, pkg)).toEqual({
      registry: {
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
        hive: "HKEY_CURRENT_USER",
        keyPath: item.registry.keyPath,
        view: "Auto",
      },
      userHive: { target: "AllExistingProfiles", includeDefaultUser: true },
    });
    expect(activeRegistryItemFields(item, pkg)).toEqual({
      valueName: false,
      value: false,
      deletionMode: true,
      revert: true,
      revertValue: false,
      userHive: true,
      defaultUser: true,
    });
  });

  it("normalizes only dependent UI drafts", () => {
    expect(
      normalizeUserHiveTarget({ userHiveTarget: "AllExistingProfiles", includeDefaultUser: true }),
    ).toEqual({ includeDefaultUser: false });
    expect(
      normalizeUserHiveTarget(
        { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true },
        "AllSignedInUsers",
      ),
    ).toEqual({ userHiveTarget: "AllSignedInUsers", includeDefaultUser: false });
    expect(normalizeRevertForDesiredState("DeleteManagedValue", "Absent", "Value")).toBe("None");
    expect(
      normalizeRevertForDesiredState("SetDefinedRollbackValue", "Absent", "KeyRecursive"),
    ).toBe("None");
  });
});
