import { describe, expect, it } from "vitest";

import { createAdministrativeTemplate, createPolicyDraftFromItem } from "../admx";
import { createRegistryDefinition } from "../registry/model";
import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  type RegistryItem,
} from "../workspace/workspace";
import { registryOverlaps } from "./registryOverlap";

function item(overrides: Partial<RegistryItem["registry"]> = {}): RegistryItem {
  return createRegistryItem({
    registry: createRegistryDefinition({
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: "Enabled",
      value: { type: "DWord", data: 1 },
      ...overrides,
    }),
  });
}

function policyFrom(source: RegistryItem) {
  const created = createPolicyDraftFromItem(source, createDeploymentPackage());
  if (created.status !== "created") throw new Error("expected an accepted item");
  return { ...created.policy, displayName: "Enable feature" };
}

describe("administrative template Registry overlap", () => {
  it("reports a package item that affects the same Registry value", () => {
    const source = item();
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Baseline", items: [source] })],
      administrativeTemplates: [
        createAdministrativeTemplate({
          id: "template-1",
          name: "Northgate App",
          policies: [policyFrom(source)],
        }),
      ],
    });

    const overlaps = registryOverlaps(workspace);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ kind: "same-value", packageName: "Baseline" });
    expect(overlaps[0]!.message).toMatch(
      /affects the same Registry value as policy "Enable feature"/,
    );
    expect(overlaps[0]!.message).toMatch(/HKEY_LOCAL_MACHINE/);
  });

  it("ignores a disabled item, a different value name, and a different hive", () => {
    const source = item();
    const disabled = item();
    disabled.enabled = false;
    const otherValue = item({ valueName: "Other" });
    const otherHive = item({ hive: "HKEY_CURRENT_USER" });
    const workspace = createWorkspace({
      packages: [
        createDeploymentPackage({ name: "Mixed", items: [disabled, otherValue, otherHive] }),
      ],
      administrativeTemplates: [
        createAdministrativeTemplate({
          id: "template-1",
          name: "Northgate App",
          policies: [policyFrom(source)],
        }),
      ],
    });

    expect(registryOverlaps(workspace)).toEqual([]);
  });

  it("reports a recursive key deletion that contains the policy path", () => {
    const source = item();
    const deleting = item({
      keyPath: "Software\\Policies\\Northgate",
      desiredState: "Absent",
      deletionMode: "KeyRecursive",
    });
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Cleanup", items: [deleting] })],
      administrativeTemplates: [
        createAdministrativeTemplate({
          id: "template-1",
          name: "Northgate App",
          policies: [policyFrom(source)],
        }),
      ],
    });

    const overlaps = registryOverlaps(workspace);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ kind: "deletion-scope", packageName: "Cleanup" });
    expect(overlaps[0]!.message).toMatch(/deletes the key tree that contains/);
  });

  it("reports nothing for an unrelated package path or a workspace without templates", () => {
    const source = item();
    const unrelated = item({
      keyPath: "Software\\Policies\\Northgate\\Other",
      valueName: "Enabled",
    });
    const withTemplate = createWorkspace({
      packages: [createDeploymentPackage({ name: "Unrelated", items: [unrelated] })],
      administrativeTemplates: [
        createAdministrativeTemplate({
          id: "template-1",
          name: "Northgate App",
          policies: [policyFrom(source)],
        }),
      ],
    });

    expect(registryOverlaps(withTemplate)).toEqual([]);
    expect(
      registryOverlaps(
        createWorkspace({ packages: [createDeploymentPackage({ items: [source] })] }),
      ),
    ).toEqual([]);
  });
});
