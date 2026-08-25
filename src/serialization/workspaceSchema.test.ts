import { describe, expect, it } from "vitest";

import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  packageFingerprint,
  WORKSPACE_SCHEMA_VERSION,
} from "../domain/workspace/workspace";
import {
  exportRegistryPackage,
  exportWorkspace,
  importPackageAsCopy,
  importRegistryJson,
  MAX_REGISTRY_JSON_BYTES,
  RegistryJsonImportError,
} from "./workspaceSchema";

function importCurrentWorkspace(text: string) {
  const result = importRegistryJson(text);
  if (result.kind !== "workspace") throw new Error("Expected a Workspace file.");
  return result.workspace;
}

function workspaceTextWithRegistryValue(
  value: unknown,
  field: "value" | "rollbackValue" = "value",
): string {
  const item = createRegistryItem({
    registry: {
      ...createRegistryItem().registry,
      keyPath: "Software\\Contoso",
      rollbackMode: "SetDefinedRollbackValue",
    },
  });
  const serialized = JSON.parse(
    exportWorkspace(createWorkspace({ packages: [createDeploymentPackage({ items: [item] })] })),
  ) as {
    packages: Array<{ items: Array<{ registry: Record<string, unknown> }> }>;
  };
  serialized.packages[0]!.items[0]!.registry[field] = value;
  return JSON.stringify(serialized);
}

describe("current Workspace and package schema", () => {
  it("round trips schema 7 packages and exact typed values", () => {
    const first = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        valueName: "Maximum",
        value: { type: "QWord", data: "18446744073709551615" },
        rollbackMode: "SetDefinedRollbackValue",
        rollbackValue: { type: "MultiString", data: ["Grüße", "東京"] },
      },
    });
    const second = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        hive: "HKEY_CURRENT_USER",
        keyPath: "Software\\Contoso",
        valueName: "Names",
        value: { type: "MultiString", data: ["One", "Two"] },
      },
      userHive: {
        userHiveTarget: "AllSignedInUsers",
        includeDefaultUser: false,
      },
    });
    const pkg = createDeploymentPackage({
      name: "Browser settings",
      deployment: {
        ...createDeploymentPackage().deployment,
        method: "PlatformScript",
      },
      items: [first, second],
    });
    const workspace = createWorkspace({ name: "Browser", packages: [pkg] });

    expect(WORKSPACE_SCHEMA_VERSION).toBe(7);
    expect(importCurrentWorkspace(exportWorkspace(workspace))).toEqual(workspace);
    expect(JSON.parse(exportWorkspace(workspace))).toEqual(workspace);
  });

  it("accepts exact Binary, DWORD, and QWORD import boundaries", () => {
    const binary = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        value: { type: "Binary", data: [0, 255] },
        rollbackMode: "SetDefinedRollbackValue",
        rollbackValue: { type: "DWord", data: 4_294_967_295 },
      },
    });
    const numeric = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        value: { type: "DWord", data: 0 },
        rollbackMode: "SetDefinedRollbackValue",
        rollbackValue: { type: "QWord", data: "18446744073709551615" },
      },
    });
    const qword = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
        value: { type: "QWord", data: "0" },
      },
    });
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ items: [binary, numeric, qword] })],
    });

    expect(importCurrentWorkspace(exportWorkspace(workspace))).toEqual(workspace);
  });

  it.each([
    ["a negative Binary byte", { type: "Binary", data: [-1] }, "byte integers from 0 to 255"],
    ["an overflowing Binary byte", { type: "Binary", data: [256] }, "byte integers from 0 to 255"],
    ["a fractional Binary byte", { type: "Binary", data: [1.5] }, "byte integers from 0 to 255"],
    ["a negative DWORD", { type: "DWord", data: -1 }, "unsigned 32-bit integer"],
    ["a fractional DWORD", { type: "DWord", data: 1.5 }, "unsigned 32-bit integer"],
    ["an overflowing DWORD", { type: "DWord", data: 4_294_967_296 }, "unsigned 32-bit integer"],
    ["a leading-zero QWORD", { type: "QWord", data: "00" }, "canonical unsigned 64-bit"],
    ["a negative QWORD", { type: "QWord", data: "-1" }, "canonical unsigned 64-bit"],
    ["a fractional QWORD", { type: "QWord", data: "1.5" }, "canonical unsigned 64-bit"],
    [
      "an overflowing QWORD",
      { type: "QWord", data: "18446744073709551616" },
      "canonical unsigned 64-bit",
    ],
  ])("rejects %s during schema parsing", (_label, value, message) => {
    expect(() => importCurrentWorkspace(workspaceTextWithRegistryValue(value))).toThrow(message);
  });

  it("validates inactive Revert values before they can enter Workspace state", () => {
    expect(() =>
      importCurrentWorkspace(
        workspaceTextWithRegistryValue({ type: "QWord", data: "01" }, "rollbackValue"),
      ),
    ).toThrow("canonical unsigned 64-bit");
  });

  it("imports one current portable package and verifies its fingerprint", () => {
    const pkg = createDeploymentPackage({
      name: "Homepage",
      items: [createRegistryItem(), createRegistryItem()],
    });
    const workspace = createWorkspace({ packages: [pkg] });
    const imported = importRegistryJson(exportRegistryPackage(workspace, pkg));

    expect(imported.kind).toBe("package");
    if (imported.kind === "package") {
      expect(imported.package.package).toEqual(pkg);
      expect(imported.package.fingerprint).toBe(packageFingerprint(pkg));
    }

    const changed = JSON.parse(exportRegistryPackage(workspace, pkg)) as Record<string, unknown>;
    changed.fingerprint = "00000000";
    expect(() => importRegistryJson(JSON.stringify(changed))).toThrow(/fingerprint does not match/);
  });

  it("verifies a current-schema package with its declared generator version", () => {
    const pkg = createDeploymentPackage({ items: [createRegistryItem()] });
    const serialized = JSON.parse(
      exportRegistryPackage(createWorkspace({ packages: [pkg] }), pkg),
    ) as Record<string, unknown>;
    serialized.generatorVersion = "1.0.0-compatible";
    serialized.fingerprint = packageFingerprint(pkg, "1.0.0-compatible");

    const imported = importRegistryJson(JSON.stringify(serialized));

    expect(imported.kind).toBe("package");
    if (imported.kind === "package") {
      expect(imported.package.generatorVersion).toBe("1.0.0-compatible");
      expect(imported.package.fingerprint).toBe(packageFingerprint(pkg, "1.0.0-compatible"));
    }
  });

  it("rejects every unsupported Workspace or package schema version", () => {
    const workspace = createWorkspace();
    const oldWorkspace = { ...workspace, schemaVersion: 6 };
    expect(() => importCurrentWorkspace(JSON.stringify(oldWorkspace))).toThrow(
      RegistryJsonImportError,
    );
    expect(() => importCurrentWorkspace(JSON.stringify(oldWorkspace))).toThrow(
      "Only schema 7 is supported",
    );

    const pkg = createDeploymentPackage();
    const packageFile = JSON.parse(
      exportRegistryPackage(createWorkspace({ packages: [pkg] }), pkg),
    ) as Record<string, unknown>;
    packageFile.schemaVersion = 6;
    expect(() => importRegistryJson(JSON.stringify(packageFile))).toThrow(
      "Only schema 7 is supported",
    );
  });

  it("rejects unsupported kinds and roots instead of fallback parsing", () => {
    expect(() => importRegistryJson(JSON.stringify({ schemaVersion: 3, entries: [] }))).toThrow(
      "Unsupported JSON kind",
    );
    expect(() =>
      importRegistryJson(
        JSON.stringify({ schemaVersion: 7, kind: "registry-configuration", entries: [] }),
      ),
    ).toThrow("Unsupported JSON kind");
    expect(() => importRegistryJson("[]")).toThrow("File root must be an object");
  });

  it("rejects unknown current-schema fields instead of silently discarding them", () => {
    const item = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Contoso",
      },
    });
    const pkg = createDeploymentPackage({ items: [item] });
    const serialized = JSON.parse(exportWorkspace(createWorkspace({ packages: [pkg] }))) as {
      packages: Array<{ items: Array<{ registry: Record<string, unknown> }> }>;
    };
    serialized.packages[0]!.items[0]!.registry.obsoleteField = true;

    expect(() => importCurrentWorkspace(JSON.stringify(serialized))).toThrow(
      "obsoleteField is not supported by schema 7",
    );

    const removedProfileField = JSON.parse(
      exportWorkspace(createWorkspace({ packages: [pkg] })),
    ) as {
      packages: Array<{ items: Array<{ userHive: Record<string, unknown> }> }>;
    };
    removedProfileField.packages[0]!.items[0]!.userHive.specificSid = "removed-profile-field";
    expect(() => importCurrentWorkspace(JSON.stringify(removedProfileField))).toThrow(
      "specificSid is not supported by schema 7",
    );

    const invalidDefaultScope = JSON.parse(
      exportWorkspace(createWorkspace({ packages: [pkg] })),
    ) as {
      packages: Array<{
        items: Array<{
          registry: { hive: string };
          userHive: { userHiveTarget?: string; includeDefaultUser: boolean };
        }>;
      }>;
    };
    invalidDefaultScope.packages[0]!.items[0]!.registry.hive = "HKEY_CURRENT_USER";
    invalidDefaultScope.packages[0]!.items[0]!.userHive = {
      userHiveTarget: "AllSignedInUsers",
      includeDefaultUser: true,
    };
    expect(() => importCurrentWorkspace(JSON.stringify(invalidDefaultScope))).toThrow(
      "includeDefaultUser requires the AllExistingProfiles target",
    );
  });

  it("rejects duplicate package and cross-package item IDs", () => {
    const item = createRegistryItem();
    const first = createDeploymentPackage({ items: [item] });
    const duplicatePackage = createWorkspace({ packages: [first, first] });
    expect(() => importCurrentWorkspace(exportWorkspace(duplicatePackage))).toThrow(
      /duplicate package ID/,
    );

    const duplicateItem = createWorkspace({
      packages: [first, createDeploymentPackage({ items: [item] })],
    });
    expect(() => importCurrentWorkspace(exportWorkspace(duplicateItem))).toThrow(
      /duplicate item ID/,
    );
  });

  it("assigns new package and item IDs when importing as a copy", () => {
    const pkg = createDeploymentPackage({ items: [createRegistryItem(), createRegistryItem()] });
    const workspace = createWorkspace({ packages: [pkg] });
    const imported = importRegistryJson(exportRegistryPackage(workspace, pkg));
    if (imported.kind !== "package") throw new Error("Expected a package import.");

    const copy = importPackageAsCopy(imported.package);
    expect(copy.id).not.toBe(pkg.id);
    expect(copy.items.map((item) => item.id)).not.toEqual(pkg.items.map((item) => item.id));
  });

  it("rejects malformed and oversized JSON", () => {
    expect(() => importRegistryJson("not json")).toThrow("not valid JSON");
    expect(() => importRegistryJson(" ".repeat(MAX_REGISTRY_JSON_BYTES + 1))).toThrow(
      "import limit",
    );
  });
});
