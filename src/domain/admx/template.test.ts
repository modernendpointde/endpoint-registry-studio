import { describe, expect, it } from "vitest";
import { createRegistryDefinition } from "../registry/model";
import { createDeploymentPackage, createRegistryItem } from "../workspace/workspace";
import {
  createAdministrativeTemplate,
  createAuthoredPolicy,
  createPolicyDraftFromItem,
  isAdministrativeTemplateCompilable,
  registryValueIdentity,
  templateNamespace,
  validateAdministrativeTemplate,
  type AdministrativeTemplatePolicy,
} from "./template";

function acceptedItem() {
  return createRegistryItem({
    registry: createRegistryDefinition({
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: "Enabled",
      value: { type: "DWord", data: 1 },
    }),
  });
}

function completePolicy() {
  const created = createPolicyDraftFromItem(acceptedItem(), createDeploymentPackage());
  if (created.status !== "created") throw new Error("expected accepted item");
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

describe("administrative template model", () => {
  it("snapshots the Registry definition and leaves author choices unspecified", () => {
    const item = acceptedItem();
    const created = createPolicyDraftFromItem(item, createDeploymentPackage());
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    item.registry.valueName = "Changed";
    expect(created.policy.snapshot.valueName).toBe("Enabled");
    expect(created.policy.registryItemId).toBe(item.id);
    expect(created.policy.valueMode).toBe("Unspecified");
    expect(created.policy.enabledBehavior.kind).toBe("Unspecified");
    expect(created.policy.disabledBehavior.kind).toBe("Unspecified");
    expect(createAdministrativeTemplate().version).toBe("");
  });

  it("does not create a draft from a rejected item", () => {
    const item = acceptedItem();
    item.registry.desiredState = "Absent";
    expect(createPolicyDraftFromItem(item, createDeploymentPackage()).status).toBe("rejected");
  });

  it("blocks two policies that resolve to the same Registry value", () => {
    const first = { ...completePolicy(), id: "policy-1", policyId: "EnableFeature" };
    const second = {
      ...completePolicy(),
      id: "policy-2",
      policyId: "EnableFeatureAgain",
      displayName: "Enable feature again",
    };
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [first, second],
    });

    const issues = validateAdministrativeTemplate(template);
    const duplicate = issues.find((entry) => entry.code === "RegistryTargetDuplicate");

    expect(duplicate).toBeDefined();
    expect(duplicate?.message).toMatch(/write the same Registry value/);
    expect(duplicate?.message).toMatch(/Enable feature/);
    expect(isAdministrativeTemplateCompilable(template)).toBe(false);
  });

  it("treats Registry targets as case-insensitive, as Windows does", () => {
    const first = { ...completePolicy(), id: "policy-1", policyId: "EnableFeature" };
    const second = { ...completePolicy(), id: "policy-2", policyId: "EnableFeatureAgain" };
    second.snapshot = {
      ...second.snapshot,
      keyPath: "software\\policies\\northgate\\app",
      valueName: "enabled",
    };
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [first, second],
    });

    expect(validateAdministrativeTemplate(template).map((entry) => entry.code)).toContain(
      "RegistryTargetDuplicate",
    );
  });

  it("folds Unicode names the way Windows treats them, so a duplicate cannot hide", () => {
    const sigma = { ...completePolicy(), id: "policy-1", policyId: "EnableFeature" };
    sigma.snapshot = { ...sigma.snapshot, valueName: "\u03a3" };
    const finalSigma = { ...completePolicy(), id: "policy-2", policyId: "EnableFeatureAgain" };
    finalSigma.snapshot = { ...finalSigma.snapshot, valueName: "\u03c2" };

    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [sigma, finalSigma],
    });

    expect(validateAdministrativeTemplate(template).map((entry) => entry.code)).toContain(
      "RegistryTargetDuplicate",
    );
  });

  it("keeps the Registry view in the target identity", () => {
    const definition = completePolicy().snapshot;

    expect(registryValueIdentity({ ...definition, view: "Registry32" })).not.toBe(
      registryValueIdentity(definition),
    );
  });

  it("does not block distinct targets that stay compilable", () => {
    function templateWith(policies: AdministrativeTemplatePolicy[]) {
      return createAdministrativeTemplate({
        name: "Northgate App",
        version: "1.0.0",
        vendorId: "Northgate",
        productId: "App",
        policies,
      });
    }
    const base = { ...completePolicy(), id: "policy-a", policyId: "EnableFeature" };

    const otherValueName = { ...completePolicy(), id: "policy-b", policyId: "EnableFeatureTwo" };
    otherValueName.snapshot = { ...otherValueName.snapshot, valueName: "EnabledOther" };
    const valueNameTemplate = templateWith([base, otherValueName]);
    expect(validateAdministrativeTemplate(valueNameTemplate)).toEqual([]);
    expect(isAdministrativeTemplateCompilable(valueNameTemplate)).toBe(true);

    const userHive = {
      ...completePolicy(),
      id: "policy-c",
      policyId: "EnableFeatureThree",
      policyClass: "User" as const,
    };
    userHive.snapshot = { ...userHive.snapshot, hive: "HKEY_CURRENT_USER" };
    const hiveTemplate = templateWith([base, userHive]);
    expect(validateAdministrativeTemplate(hiveTemplate)).toEqual([]);
    expect(isAdministrativeTemplateCompilable(hiveTemplate)).toBe(true);
  });

  it("is not compilable until every author field is present", () => {
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [completePolicy()],
    });
    expect(templateNamespace(template)).toBe("Northgate.App");
    expect(validateAdministrativeTemplate(template)).toEqual([]);
    expect(isAdministrativeTemplateCompilable(template)).toBe(true);

    const draft = createPolicyDraftFromItem(acceptedItem(), createDeploymentPackage());
    if (draft.status !== "created") throw new Error("expected accepted item");
    const incomplete = createAdministrativeTemplate({
      vendorId: "Microsoft",
      productId: "Windows",
      policies: [draft.policy],
    });
    expect(validateAdministrativeTemplate(incomplete).map((issue) => issue.code)).toEqual([
      "TemplateNameMissing",
      "TemplateVersionInvalid",
      "NamespaceReserved",
      "PolicyIdInvalid",
      "DisplayNameMissing",
      "ExplainTextMissing",
      "CategoryMissing",
      "ValueModeUnspecified",
      "EnabledBehaviorUnspecified",
      "DisabledBehaviorUnspecified",
      "NotConfiguredBehaviorUnspecified",
    ]);
    expect(isAdministrativeTemplateCompilable(incomplete)).toBe(false);
  });

  it("rejects duplicate policy identifiers, invalid DWORD ranges, and incompatible Disabled values", () => {
    const first = completePolicy();
    const second = {
      ...completePolicy(),
      id: "other",
      policyId: first.policyId,
    };
    delete (second as { dwordMax?: number }).dwordMax;
    const third = {
      ...completePolicy(),
      id: "disabled-bad",
      policyId: "BadDisabled",
      disabledBehavior: {
        kind: "WriteFixedValue" as const,
        value: { type: "QWord" as const, data: "1" },
      },
    };
    const fourth = {
      ...completePolicy(),
      id: "disabled-ok",
      policyId: "OkDisabled",
      disabledBehavior: {
        kind: "WriteFixedValue" as const,
        value: { type: "DWord" as const, data: 0 },
      },
    };
    const fifth = {
      ...completePolicy(),
      id: "disabled-invalid-dword",
      policyId: "InvalidDisabled",
      disabledBehavior: {
        kind: "WriteFixedValue" as const,
        value: { type: "DWord" as const, data: 1.5 },
      },
    };
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [first, second, third, fourth, fifth],
    });
    const codes = validateAdministrativeTemplate(template).map((issue) => issue.code);
    expect(codes).toContain("PolicyIdDuplicate");
    expect(codes).toContain("DwordRangeInvalid");
    expect(codes).toContain("DisabledValueInvalid");
  });

  it("accepts a same-type Disabled WriteFixedValue and rejects an invalid DWORD", () => {
    const valid = {
      ...completePolicy(),
      disabledBehavior: {
        kind: "WriteFixedValue" as const,
        value: { type: "DWord" as const, data: 0 },
      },
    };
    const invalid = {
      ...completePolicy(),
      policyId: "InvalidDisabledSolo",
      disabledBehavior: {
        kind: "WriteFixedValue" as const,
        value: { type: "DWord" as const, data: 1.5 },
      },
    };
    const ok = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [valid],
    });
    expect(validateAdministrativeTemplate(ok)).toEqual([]);
    const bad = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [invalid],
    });
    expect(validateAdministrativeTemplate(bad).map((issue) => issue.code)).toContain(
      "DisabledValueInvalid",
    );
  });
  it("empty templates are not compilable", () => {
    const template = createAdministrativeTemplate({
      name: "Empty",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
    });
    expect(validateAdministrativeTemplate(template)).toEqual([]);
    expect(isAdministrativeTemplateCompilable(template)).toBe(false);
  });

  it("compiles an authored policy that carries its own Registry definition", () => {
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [
        createAuthoredPolicy({
          id: "policy-1",
          policyId: "EnableFeature",
          displayName: "Enable feature",
          explainText: "Writes the configured value.",
          category: "Northgate App",
          snapshot: createRegistryDefinition({
            hive: "HKEY_LOCAL_MACHINE",
            keyPath: "Software\\Policies\\Northgate\\App",
            valueName: "Enabled",
            value: { type: "DWord", data: 1 },
          }),
          valueMode: "ProfileInput",
          dwordMin: 0,
          dwordMax: 10,
          enabledBehavior: { kind: "WritePresentValue" },
          disabledBehavior: { kind: "DeleteValue" },
          notConfiguredBehavior: { kind: "DeleteValue" },
        }),
      ],
    });

    expect(template.policies[0]!.registryItemId).toBeUndefined();
    expect(validateAdministrativeTemplate(template)).toEqual([]);
    expect(isAdministrativeTemplateCompilable(template)).toBe(true);
  });

  it("keeps an authored policy fail-closed while its target is missing", () => {
    const template = createAdministrativeTemplate({
      name: "Northgate App",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
      policies: [
        createAuthoredPolicy({
          policyId: "EnableFeature",
          displayName: "Enable feature",
          explainText: "Writes it.",
          category: "Northgate App",
        }),
      ],
    });

    expect(validateAdministrativeTemplate(template).map((entry) => entry.code)).toContain(
      "SnapshotIneligible",
    );
    expect(isAdministrativeTemplateCompilable(template)).toBe(false);
  });
});
