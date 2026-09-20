import { describe, expect, it } from "vitest";

import { createAdministrativeTemplate, createAuthoredPolicy } from "../domain/admx";

import {
  administrativeTemplateCandidates,
  createAdministrativeTemplateDraft,
  itemsReferencedByTemplates,
  policySource,
  removeAdministrativeTemplate,
  replacePolicySnapshot,
  saveAdministrativeTemplate,
  templatePoliciesForItem,
} from "./administrativeTemplateOperations";
import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
} from "../domain/workspace/workspace";
import { exportWorkspace, importRegistryJson } from "../serialization/workspaceSchema";

function eligibleItem(name: string) {
  return createRegistryItem({
    registry: {
      ...createRegistryItem().registry,
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: name,
      value: { type: "DWord", data: 1 },
    },
  });
}

describe("administrative template operations", () => {
  it("assesses every item in package context and preserves exact rejection reasons", () => {
    const accepted = eligibleItem("Enabled");
    const rejected = eligibleItem("Secret");
    rejected.registry.desiredState = "Absent";
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [accepted, rejected] })],
    });

    const candidates = administrativeTemplateCandidates(workspace);

    expect(candidates[0]).toMatchObject({ status: "accepted", policyClass: "Machine" });
    expect(candidates[1]).toMatchObject({ status: "rejected" });
    expect(candidates[1]!.reasons.map(({ reasonCode }) => reasonCode)).toEqual([
      "DesiredStateNotPresent",
      "SensitiveValueName",
    ]);
  });

  it("creates independent snapshots only from currently eligible selected items", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ items: [item] })],
    });
    const template = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    item.registry.valueName = "Changed later";

    expect(template.policies).toHaveLength(1);
    expect(template.policies[0]!.snapshot.valueName).toBe("Enabled");
    expect(template.policies[0]!.registryItemId).toBe(item.id);
  });

  it("saves, replaces, and removes template drafts without changing packages", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ items: [item] })],
    });
    const template = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    const saved = saveAdministrativeTemplate(workspace, template);
    const replaced = saveAdministrativeTemplate(
      saved,
      { ...template, name: "Updated" },
      template.id,
    );
    const removed = removeAdministrativeTemplate(replaced, template.id);

    expect(saved.packages).toBe(workspace.packages);
    expect(replaced.administrativeTemplates[0]!.name).toBe("Updated");
    expect(removed.administrativeTemplates).toEqual([]);
  });

  it("rejects structurally invalid numeric bounds before a draft enters the Workspace", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ items: [item] })],
    });
    const template = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    template.policies[0]!.dwordMin = -1;

    expect(() => saveAdministrativeTemplate(workspace, template)).toThrow(
      "administrativeTemplate.policies[0].dwordMin must be an unsigned 32-bit integer",
    );
  });

  it("rejects metadata beyond schema limits before a draft enters the Workspace", () => {
    const workspace = createWorkspace();
    const template = createAdministrativeTemplateDraft(workspace, new Set());
    template.name = "x".repeat(257);

    expect(() => saveAdministrativeTemplate(workspace, template)).toThrow(
      "administrativeTemplate.name must be a string of at most 256 characters",
    );
  });

  it("round-trips a structurally valid incomplete saved draft through schema 8", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ items: [item] })],
    });
    const template = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    const saved = saveAdministrativeTemplate(workspace, template);

    const imported = importRegistryJson(exportWorkspace(saved));
    expect(imported.kind).toBe("workspace");
    if (imported.kind !== "workspace") throw new Error("Expected Workspace round-trip.");
    expect(imported.workspace.administrativeTemplates).toEqual([template]);
  });

  it("reports whether a policy snapshot still matches its source item", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [item] })],
    });
    const template = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    const policy = template.policies[0]!;

    expect(policySource(workspace, policy).status).toBe("matches");

    // A later edit is not an error; it only means the two no longer agree.
    item.registry.value = { type: "DWord", data: 9 };
    expect(policySource(workspace, policy).status).toBe("differs");

    const withoutSource = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [] })],
    });
    expect(policySource(withoutSource, policy).status).toBe("unavailable");
  });

  it("finds the templates that reference an item, and the items a package contributes", () => {
    const item = eligibleItem("Enabled");
    const untouched = eligibleItem("Untouched");
    const pkg = createDeploymentPackage({ name: "Source", items: [item, untouched] });
    const workspace = createWorkspace({ packages: [pkg] });
    const template = saveAdministrativeTemplate(
      workspace,
      createAdministrativeTemplateDraft(workspace, new Set([item.id])),
    );

    const references = templatePoliciesForItem(template, item.id);
    expect(references).toHaveLength(1);
    expect(references[0]!.templateId).toBe(template.administrativeTemplates[0]!.id);

    const contributed = itemsReferencedByTemplates(template, pkg);
    expect(contributed.map((entry) => entry.item.id)).toEqual([item.id]);
    expect(contributed[0]!.references).toHaveLength(1);
  });

  it("adopts a changed source and clears choices that no longer describe the setting", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [item] })],
    });
    const draft = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    const authored = {
      ...saveAdministrativeTemplate(workspace, draft),
    };
    const templateId = authored.administrativeTemplates[0]!.id;
    const policyId = authored.administrativeTemplates[0]!.policies[0]!.id;
    const withChoices = {
      ...authored,
      administrativeTemplates: authored.administrativeTemplates.map((template) => ({
        ...template,
        policies: template.policies.map((policy) => ({
          ...policy,
          valueMode: "ProfileInput" as const,
          dwordMin: 0,
          dwordMax: 10,
          enabledBehavior: { kind: "WritePresentValue" as const },
        })),
      })),
    };
    const template = withChoices.administrativeTemplates[0]!;

    expect(replacePolicySnapshot(withChoices, template, policyId)).toEqual({ kind: "unchanged" });

    // Renaming the source value invalidates the authored choices rather than carrying them over.
    item.registry.valueName = "Renamed";
    const replaced = replacePolicySnapshot(withChoices, template, policyId);
    if (replaced.kind !== "replaced") throw new Error("expected a replacement");
    const policy = replaced.template.policies[0]!;
    expect(replaced.resetChoices).toBe(true);
    expect(policy.snapshot.valueName).toBe("Renamed");
    expect(policy.valueMode).toBe("Unspecified");
    expect(policy.enabledBehavior).toEqual({ kind: "Unspecified" });
    expect(policy.dwordMin).toBeUndefined();
    expect(policy.dwordMax).toBeUndefined();
    expect(withChoices.administrativeTemplates[0]!.id).toBe(templateId);
  });

  it("keeps authored choices when only the value data changed", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [item] })],
    });
    const saved = saveAdministrativeTemplate(
      workspace,
      createAdministrativeTemplateDraft(workspace, new Set([item.id])),
    );
    const template = saved.administrativeTemplates[0]!;
    const policyId = template.policies[0]!.id;
    const withChoices = {
      ...saved,
      administrativeTemplates: [
        {
          ...template,
          policies: template.policies.map((policy) => ({
            ...policy,
            valueMode: "ProfileInput" as const,
            dwordMin: 0,
            dwordMax: 10,
          })),
        },
      ],
    };

    item.registry.value = { type: "DWord", data: 5 };
    const replaced = replacePolicySnapshot(
      withChoices,
      withChoices.administrativeTemplates[0]!,
      policyId,
    );

    if (replaced.kind !== "replaced") throw new Error("expected a replacement");
    expect(replaced.resetChoices).toBe(false);
    expect(replaced.template.policies[0]!.dwordMax).toBe(10);
    expect(replaced.template.policies[0]!.snapshot.value).toEqual({ type: "DWord", data: 5 });
  });

  it("treats a case-only target change as the same setting", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [item] })],
    });
    const template = createAdministrativeTemplateDraft(workspace, new Set([item.id]));
    const policy = template.policies[0]!;

    item.registry.keyPath = item.registry.keyPath.toLowerCase();
    item.registry.valueName = "enabled";

    expect(policySource(workspace, policy).status).toBe("matches");
  });

  it("compares array-valued Registry data structurally", () => {
    const item = eligibleItem("Enabled");
    item.registry.value = { type: "MultiString", data: [""] };
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [item] })],
    });
    // Built directly: MultiString is not ADMX-eligible, but the comparison must still be structural.
    const template = createAdministrativeTemplate({
      policies: [
        {
          id: "policy-1",
          registryItemId: item.id,
          policyClass: "Machine",
          snapshot: { ...item.registry, value: { type: "MultiString", data: [] } },
          displayName: "Policy",
          explainText: "Text",
          category: "Category",
          policyId: "PolicyId",
          valueMode: "Unspecified",
          enabledBehavior: { kind: "Unspecified" },
          disabledBehavior: { kind: "Unspecified" },
          notConfiguredBehavior: { kind: "Unspecified" },
        },
      ],
    });

    // An empty array and an array holding an empty string are different settings.
    expect(policySource(workspace, template.policies[0]!).status).toBe("differs");
  });

  it("clears authored choices when the source moves to a different target", () => {
    const item = eligibleItem("Enabled");
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source", items: [item] })],
    });
    const saved = saveAdministrativeTemplate(
      workspace,
      createAdministrativeTemplateDraft(workspace, new Set([item.id])),
    );
    const template = saved.administrativeTemplates[0]!;
    const policyId = template.policies[0]!.id;
    const withChoices = {
      ...saved,
      administrativeTemplates: [
        {
          ...template,
          policies: template.policies.map((policy) => ({
            ...policy,
            valueMode: "ProfileInput" as const,
            dwordMin: 0,
            dwordMax: 10,
            disabledBehavior: {
              kind: "WriteFixedValue" as const,
              value: { type: "DWord" as const, data: 4 },
            },
          })),
        },
      ],
    };

    item.registry.keyPath = "Software\\Policies\\Northgate\\Renamed";
    const replaced = replacePolicySnapshot(
      withChoices,
      withChoices.administrativeTemplates[0]!,
      policyId,
    );

    if (replaced.kind !== "replaced") throw new Error("expected a replacement");
    expect(replaced.resetChoices).toBe(true);
    expect(replaced.template.policies[0]!.dwordMax).toBeUndefined();
    expect(replaced.template.policies[0]!.disabledBehavior).toEqual({ kind: "Unspecified" });
  });

  it("treats an authored policy as having no source to compare or adopt", () => {
    const template = createAdministrativeTemplate({ policies: [createAuthoredPolicy()] });
    const workspace = createWorkspace({ administrativeTemplates: [template] });
    const policy = template.policies[0]!;

    expect(policySource(workspace, policy).status).toBe("authored");
    expect(replacePolicySnapshot(workspace, template, policy.id)).toEqual({
      kind: "unavailable",
    });
  });
});
