import { describe, expect, it } from "vitest";

import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  packageFingerprint,
  WORKSPACE_SCHEMA_VERSION,
} from "../domain/workspace/workspace";
import {
  createAuthoredPolicy,
  createAdministrativeTemplate,
  createPolicyDraftFromItem,
  isAdministrativeTemplateCompilable,
} from "../domain/admx";
import { createRegistryDefinition, GENERATOR_VERSION } from "../domain/registry/model";
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
      keyPath: "Software\\Northgate",
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

function completePolicy() {
  const item = createRegistryItem({
    registry: createRegistryDefinition({
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: "Enabled",
      value: { type: "DWord", data: 1 },
    }),
  });
  const created = createPolicyDraftFromItem(item, createDeploymentPackage());
  if (created.status !== "created") throw new Error("Expected an eligible Registry Item.");
  return {
    ...created.policy,
    policyId: "EnableFeature",
    displayName: "Enable feature",
    explainText: "Writes the DWORD when enabled.",
    category: "Northgate App",
    valueMode: "ProfileInput" as const,
    dwordMin: 0,
    dwordMax: 1,
    enabledBehavior: { kind: "WritePresentValue" as const },
    disabledBehavior: { kind: "DeleteValue" as const },
    notConfiguredBehavior: { kind: "DeleteValue" as const },
  };
}

function completeTemplate() {
  const dwordPolicy = completePolicy();
  const stringItem = createRegistryItem({
    registry: createRegistryDefinition({
      hive: "HKEY_CURRENT_USER",
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: "DisplayName",
      value: { type: "String", data: "Northgate" },
    }),
  });
  const created = createPolicyDraftFromItem(
    stringItem,
    createDeploymentPackage({
      deployment: { ...createDeploymentPackage().deployment, runContext: "LoggedOnUser" },
    }),
  );
  if (created.status !== "created") throw new Error("Expected an eligible Registry Item.");
  return createAdministrativeTemplate({
    name: "Northgate App",
    version: "1.0.0",
    vendorId: "Northgate",
    productId: "App",
    policies: [
      dwordPolicy,
      {
        ...created.policy,
        policyId: "UserDisplayName",
        displayName: "User display name",
        explainText: "User string policy.",
        category: "Northgate App",
        valueMode: "Fixed" as const,
        enabledBehavior: { kind: "WritePresentValue" as const },
        disabledBehavior: {
          kind: "WriteFixedValue" as const,
          value: { type: "String" as const, data: "Off" },
        },
        notConfiguredBehavior: { kind: "DeleteValue" as const },
      },
    ],
  });
}

describe("current Workspace and package schema", () => {
  it("round trips schema 8 packages and exact typed values", () => {
    const first = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Northgate",
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
        keyPath: "Software\\Northgate",
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

    expect(WORKSPACE_SCHEMA_VERSION).toBe(8);
    expect(importCurrentWorkspace(exportWorkspace(workspace))).toEqual(workspace);
    expect(JSON.parse(exportWorkspace(workspace))).toEqual(workspace);
  });

  it("accepts exact Binary, DWORD, and QWORD import boundaries", () => {
    const binary = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Northgate",
        value: { type: "Binary", data: [0, 255] },
        rollbackMode: "SetDefinedRollbackValue",
        rollbackValue: { type: "DWord", data: 4_294_967_295 },
      },
    });
    const numeric = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Northgate",
        value: { type: "DWord", data: 0 },
        rollbackMode: "SetDefinedRollbackValue",
        rollbackValue: { type: "QWord", data: "18446744073709551615" },
      },
    });
    const qword = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Northgate",
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
    const unsupported = "Only schema 8 and the previous published schema 7 are supported";

    for (const schemaVersion of [1, 6, 9]) {
      const workspace = { ...createWorkspace(), schemaVersion };
      expect(() => importCurrentWorkspace(JSON.stringify(workspace))).toThrow(
        RegistryJsonImportError,
      );
      expect(() => importCurrentWorkspace(JSON.stringify(workspace))).toThrow(unsupported);

      const pkg = createDeploymentPackage();
      const packageFile = JSON.parse(
        exportRegistryPackage(createWorkspace({ packages: [pkg] }), pkg),
      ) as Record<string, unknown>;
      packageFile.schemaVersion = schemaVersion;
      expect(() => importRegistryJson(JSON.stringify(packageFile))).toThrow(unsupported);
    }
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
        keyPath: "Software\\Northgate",
      },
    });
    const pkg = createDeploymentPackage({ items: [item] });
    const serialized = JSON.parse(exportWorkspace(createWorkspace({ packages: [pkg] }))) as {
      packages: Array<{ items: Array<{ registry: Record<string, unknown> }> }>;
    };
    serialized.packages[0]!.items[0]!.registry.obsoleteField = true;

    expect(() => importCurrentWorkspace(JSON.stringify(serialized))).toThrow(
      "obsoleteField is not supported by schema 8",
    );

    const removedProfileField = JSON.parse(
      exportWorkspace(createWorkspace({ packages: [pkg] })),
    ) as {
      packages: Array<{ items: Array<{ userHive: Record<string, unknown> }> }>;
    };
    removedProfileField.packages[0]!.items[0]!.userHive.specificSid = "removed-profile-field";
    expect(() => importCurrentWorkspace(JSON.stringify(removedProfileField))).toThrow(
      "specificSid is not supported by schema 8",
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

  it("opens a schema 7 Workspace, lifts it, and writes it back as the current schema", () => {
    const typedItems = [
      createRegistryItem({
        registry: createRegistryDefinition({ value: { type: "DWord", data: 4_000_000_000 } }),
      }),
      createRegistryItem({
        registry: createRegistryDefinition({ value: { type: "String", data: "Grüße" } }),
      }),
      createRegistryItem({
        registry: createRegistryDefinition({ value: { type: "Binary", data: [0, 255, 16] } }),
      }),
      createRegistryItem({
        registry: createRegistryDefinition({
          value: { type: "QWord", data: "18446744073709551615" },
        }),
      }),
      createRegistryItem({
        registry: createRegistryDefinition({
          value: { type: "MultiString", data: ["a", "b"] },
        }),
      }),
    ];
    const first = createDeploymentPackage({ id: "released-1", name: "First", items: typedItems });
    const second = createDeploymentPackage({ id: "released-2", name: "Second" });
    const current = JSON.parse(
      exportWorkspace(
        createWorkspace({
          id: "released-workspace",
          name: "Released Workspace",
          packages: [first, second],
        }),
      ),
    ) as Record<string, unknown>;
    // A schema 7 Workspace has no administrativeTemplates field at all.
    delete current.administrativeTemplates;
    current.schemaVersion = 7;

    const lifted = importCurrentWorkspace(JSON.stringify(current));

    expect(lifted.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(lifted.id).toBe("released-workspace");
    expect(lifted.name).toBe("Released Workspace");
    expect(lifted.packages.map((pkg) => pkg.id)).toEqual(["released-1", "released-2"]);
    expect(lifted.packages[0]!.items.map((item) => item.id)).toEqual(typedItems.map((i) => i.id));
    expect(lifted.packages[0]!.items.map((item) => item.registry.value)).toEqual(
      typedItems.map((item) => item.registry.value),
    );
    expect(lifted.administrativeTemplates).toEqual([]);
    expect(JSON.parse(exportWorkspace(lifted))).toMatchObject({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      kind: "registry-workspace",
    });
  });

  it("opens a schema 7 package file without altering its fingerprint", () => {
    const pkg = createDeploymentPackage({
      name: "Released Package",
      items: [createRegistryItem(), createRegistryItem({ enabled: false })],
    });
    const packageFile = JSON.parse(
      exportRegistryPackage(createWorkspace({ packages: [pkg] }), pkg),
    ) as Record<string, unknown>;
    packageFile.schemaVersion = 7;

    const imported = importRegistryJson(JSON.stringify(packageFile));

    if (imported.kind !== "package") throw new Error("Expected a package import.");
    expect(imported.package.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(imported.package.package.name).toBe("Released Package");
    expect(imported.package.package.items.map((item) => item.id)).toEqual(
      pkg.items.map((item) => item.id),
    );
    expect(imported.package.fingerprint).toBe(packageFingerprint(pkg, GENERATOR_VERSION));
  });

  it("applies structural limits on the lifted schema 7 path", () => {
    const oversized = {
      schemaVersion: 7,
      kind: "registry-workspace",
      generatorVersion: "1.0.2",
      id: "oversized",
      name: "Oversized",
      packages: Array.from({ length: 10_001 }, () => ({})),
    };

    expect(() => importCurrentWorkspace(JSON.stringify(oversized))).toThrow(
      "packages must contain at most 10000 packages",
    );
  });

  it("rejects schema 7 Workspaces that carry the newer administrativeTemplates field", () => {
    const workspace = JSON.parse(exportWorkspace(createWorkspace())) as Record<string, unknown>;
    workspace.schemaVersion = 7;

    expect(() => importCurrentWorkspace(JSON.stringify(workspace))).toThrow(
      "administrativeTemplates is not part of schema 7",
    );
  });

  it("round trips administrative templates without affecting package fingerprints", () => {
    const draft = createAdministrativeTemplate({ name: "Draft" });
    const workspace = createWorkspace({ administrativeTemplates: [draft] });
    const roundTrip = importCurrentWorkspace(exportWorkspace(workspace));
    expect(roundTrip.schemaVersion).toBe(8);
    expect(roundTrip.administrativeTemplates).toEqual(workspace.administrativeTemplates);
    const pkg = createDeploymentPackage();
    expect(packageFingerprint(pkg)).toBe(
      packageFingerprint(
        createWorkspace({ packages: [pkg], administrativeTemplates: [draft] }).packages[0]!,
      ),
    );
  });

  it("round trips a template policy that has no source item", () => {
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [createAuthoredPolicy()],
    });
    const roundTrip = importCurrentWorkspace(
      exportWorkspace(createWorkspace({ administrativeTemplates: [template] })),
    );

    expect(roundTrip.administrativeTemplates[0]!.policies[0]!.registryItemId).toBeUndefined();
  });

  it("still reads a schema 8 policy that carries a source item", () => {
    // The field became optional, so documents written before the amendment stay readable without a
    // schema increment: the presence of the ID is the provenance.
    const file = JSON.parse(
      exportWorkspace(createWorkspace({ administrativeTemplates: [completeTemplate()] })),
    ) as { administrativeTemplates: Array<{ policies: Array<Record<string, unknown>> }> };
    const policy = file.administrativeTemplates[0]!.policies[0]!;
    expect(typeof policy.registryItemId).toBe("string");

    const roundTrip = importCurrentWorkspace(JSON.stringify(file));
    expect(roundTrip.administrativeTemplates[0]!.policies[0]!.registryItemId).toBe(
      policy.registryItemId,
    );
  });

  it("round trips a complete administrative template including nested WriteFixedValue", () => {
    const template = completeTemplate();
    expect(isAdministrativeTemplateCompilable(template)).toBe(true);
    const workspace = createWorkspace({ administrativeTemplates: [template] });
    const roundTrip = importCurrentWorkspace(exportWorkspace(workspace));
    expect(roundTrip.administrativeTemplates).toEqual(workspace.administrativeTemplates);
    expect(isAdministrativeTemplateCompilable(roundTrip.administrativeTemplates[0]!)).toBe(true);
    expect(roundTrip.administrativeTemplates[0]!.policies[1]!.disabledBehavior).toEqual({
      kind: "WriteFixedValue",
      value: { type: "String", data: "Off" },
    });
  });

  it("rejects unknown administrative template fields", () => {
    const workspace = JSON.parse(exportWorkspace(createWorkspace())) as {
      administrativeTemplates: Array<Record<string, unknown>>;
    };
    workspace.administrativeTemplates = [{ ...createAdministrativeTemplate(), extra: true }];
    expect(() => importCurrentWorkspace(JSON.stringify(workspace))).toThrow(
      "not supported by schema 8",
    );
  });

  it("rejects nested invalid administrative template data", () => {
    const workspace = JSON.parse(
      exportWorkspace(createWorkspace({ administrativeTemplates: [completeTemplate()] })),
    ) as {
      administrativeTemplates: Array<Record<string, unknown>>;
    };
    const missingPolicies = structuredClone(workspace);
    delete missingPolicies.administrativeTemplates[0]!.policies;
    expect(() => importCurrentWorkspace(JSON.stringify(missingPolicies))).toThrow(
      "policies must be an array",
    );

    const missingTemplates = structuredClone(workspace) as Record<string, unknown>;
    delete missingTemplates.administrativeTemplates;
    expect(() => importCurrentWorkspace(JSON.stringify(missingTemplates))).toThrow(
      "administrativeTemplates must be an array",
    );

    const badClass = structuredClone(workspace);
    (
      badClass.administrativeTemplates[0]!.policies as Array<Record<string, unknown>>
    )[0]!.policyClass = "Both";
    expect(() => importCurrentWorkspace(JSON.stringify(badClass))).toThrow("unsupported value");

    const badMode = structuredClone(workspace);
    (badMode.administrativeTemplates[0]!.policies as Array<Record<string, unknown>>)[0]!.valueMode =
      "Inferred";
    expect(() => importCurrentWorkspace(JSON.stringify(badMode))).toThrow("unsupported value");

    const extraPolicyField = structuredClone(workspace);
    (
      extraPolicyField.administrativeTemplates[0]!.policies as Array<Record<string, unknown>>
    )[0]!.extra = true;
    expect(() => importCurrentWorkspace(JSON.stringify(extraPolicyField))).toThrow(
      "not supported by schema 8",
    );

    const extraBehaviorField = structuredClone(workspace);
    (
      (
        extraBehaviorField.administrativeTemplates[0]!.policies as Array<Record<string, unknown>>
      )[0]!.enabledBehavior as Record<string, unknown>
    ).note = "nope";
    expect(() => importCurrentWorkspace(JSON.stringify(extraBehaviorField))).toThrow(
      "not supported by schema 8",
    );

    const extraSnapshotField = structuredClone(workspace);
    (
      (
        extraSnapshotField.administrativeTemplates[0]!.policies as Array<Record<string, unknown>>
      )[0]!.snapshot as Record<string, unknown>
    ).obsoleteField = true;
    expect(() => importCurrentWorkspace(JSON.stringify(extraSnapshotField))).toThrow(
      "not supported by schema 8",
    );

    const duplicatePolicy = structuredClone(workspace);
    const policies = duplicatePolicy.administrativeTemplates[0]!.policies as Array<
      Record<string, unknown>
    >;
    policies.push({ ...policies[0]! });
    expect(() => importCurrentWorkspace(JSON.stringify(duplicatePolicy))).toThrow(
      "duplicate policy object ID",
    );
  });

  it("rejects malformed and oversized JSON", () => {
    expect(() => importRegistryJson("not json")).toThrow("not valid JSON");
    expect(() => importRegistryJson(" ".repeat(MAX_REGISTRY_JSON_BYTES + 1))).toThrow(
      "import limit",
    );
  });
});
