import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAdministrativeTemplate, type AdministrativeTemplatePolicy } from "../../domain/admx";
import { createRegistryDefinition } from "../../domain/registry/model";
import { compileAdministrativeTemplate, generateAdministrativeTemplateZip } from "./generate";
import { escapeXml, isWellFormedXml } from "./xml";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function policy(
  overrides: Partial<AdministrativeTemplatePolicy> &
    Pick<AdministrativeTemplatePolicy, "policyId" | "policyClass" | "snapshot">,
): AdministrativeTemplatePolicy {
  return {
    id: overrides.id ?? overrides.policyId,
    registryItemId: overrides.registryItemId ?? overrides.policyId,
    displayName: "Display",
    explainText: "Explain",
    category: "Northgate App",
    valueMode: "Fixed",
    enabledBehavior: { kind: "WritePresentValue" },
    disabledBehavior: { kind: "DeleteValue" },
    notConfiguredBehavior: { kind: "DeleteValue" },
    ...overrides,
  };
}

function sampleTemplate() {
  return createAdministrativeTemplate({
    name: "Northgate App",
    version: "1.0.0",
    vendorId: "Northgate",
    productId: "App",
    policies: [
      policy({
        policyId: "MachineDword",
        policyClass: "Machine",
        snapshot: createRegistryDefinition({
          keyPath: "Software\\Policies\\Northgate\\App",
          valueName: "Enabled",
          value: { type: "DWord", data: 1 },
        }),
        displayName: "Enable feature",
        explainText: "Machine DWORD policy.",
        valueMode: "ProfileInput",
        dwordMin: 0,
        dwordMax: 1,
      }),
      policy({
        policyId: "MachineExpand",
        policyClass: "Machine",
        snapshot: createRegistryDefinition({
          keyPath: "Software\\Policies\\Northgate\\App",
          valueName: "InstallPath",
          value: { type: "ExpandString", data: "%ProgramFiles%\\Northgate" },
        }),
        displayName: "Install path",
        explainText: "Machine expandable string.",
        valueMode: "ProfileInput",
      }),
      policy({
        policyId: "UserString",
        policyClass: "User",
        snapshot: createRegistryDefinition({
          hive: "HKEY_CURRENT_USER",
          keyPath: "Software\\Policies\\Northgate\\App",
          valueName: "DisplayName",
          value: { type: "String", data: "Northgate" },
        }),
        displayName: "User display name",
        explainText: "User string policy.",
      }),
    ],
  });
}

describe("ADMX generator", () => {
  it("matches golden ADMX and ADML for the three representative policies", () => {
    const compiled = compileAdministrativeTemplate(sampleTemplate());
    expect(compiled.status).toBe("compiled");
    if (compiled.status !== "compiled") return;
    if (process.env.UPDATE_ADMX_FIXTURES === "1") {
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(join(fixtureDir, "representative.admx"), compiled.compiled.admx);
      writeFileSync(join(fixtureDir, "representative.adml"), compiled.compiled.adml);
    }
    expect(compiled.compiled.admx).toBe(
      readFileSync(join(fixtureDir, "representative.admx"), "utf8"),
    );
    expect(compiled.compiled.adml).toBe(
      readFileSync(join(fixtureDir, "representative.adml"), "utf8"),
    );
    const again = compileAdministrativeTemplate(sampleTemplate());
    expect(again.status).toBe("compiled");
    if (again.status !== "compiled") return;
    expect(again.compiled.admx).toBe(compiled.compiled.admx);
    expect(isWellFormedXml(compiled.compiled.admx)).toBe(true);
    expect(isWellFormedXml(compiled.compiled.adml)).toBe(true);
    const admxDoc = new DOMParser().parseFromString(compiled.compiled.admx, "application/xml");
    expect(admxDoc.documentElement.namespaceURI).toBe(
      "http://www.microsoft.com/GroupPolicy/PolicyDefinitions",
    );
    expect(compiled.compiled.admx).toContain('expandable="true"');
    expect(compiled.compiled.admx).not.toContain("comboBox");
    expect(compiled.compiled.admx).not.toContain("Microsoft.Policies.Windows");
  });

  it("refuses incomplete templates, LeaveExisting, fixed ExpandString, and ineligible snapshots", () => {
    expect(compileAdministrativeTemplate(createAdministrativeTemplate({ name: "X" })).status).toBe(
      "invalid",
    );
    const leave = sampleTemplate();
    leave.policies[2] = { ...leave.policies[2]!, notConfiguredBehavior: { kind: "LeaveExisting" } };
    expect(compileAdministrativeTemplate(leave).status).toBe("invalid");
    const fixedExpand = sampleTemplate();
    fixedExpand.policies[1] = { ...fixedExpand.policies[1]!, valueMode: "Fixed" };
    expect(compileAdministrativeTemplate(fixedExpand).status).toBe("invalid");
    const rejected = sampleTemplate();
    rejected.policies[0] = {
      ...rejected.policies[0]!,
      snapshot: createRegistryDefinition({
        keyPath: "Software\\Microsoft\\Windows",
        valueName: "Enabled",
        value: { type: "DWord", data: 1 },
      }),
    };
    expect(compileAdministrativeTemplate(rejected).status).toBe("invalid");
  });

  it.each(["<!DOCTYPE foo>", "<!ENTITY xxe>", "<script>alert(1)</script>", "file:///etc/passwd"])(
    "fails closed on forbidden source %s",
    (payload) => {
      const template = sampleTemplate();
      template.policies[0] = { ...template.policies[0]!, displayName: payload };
      expect(compileAdministrativeTemplate(template).status).toBe("invalid");
    },
  );

  it("rejects reserved and colliding generated string identifiers", () => {
    const reserved = sampleTemplate();
    reserved.policies[0] = { ...reserved.policies[0]!, policyId: "StudioGenerated" };
    expect(compileAdministrativeTemplate(reserved).status).toBe("invalid");
    const colliding = sampleTemplate();
    colliding.policies[1] = { ...colliding.policies[1]!, policyId: "Foo" };
    colliding.policies[2] = { ...colliding.policies[2]!, policyId: "Foo_Explain" };
    expect(compileAdministrativeTemplate(colliding).status).toBe("invalid");
  });

  it("rejects XML-illegal noncharacters and unpaired surrogates", () => {
    const nonchar = sampleTemplate();
    nonchar.policies[0] = { ...nonchar.policies[0]!, displayName: "Bad\uFFFE" };
    expect(compileAdministrativeTemplate(nonchar).status).toBe("invalid");
    const surrogate = sampleTemplate();
    surrogate.policies[0] = { ...surrogate.policies[0]!, displayName: "Bad\uD800" };
    expect(compileAdministrativeTemplate(surrogate).status).toBe("invalid");
  });

  it("rejects ADMX output above the 1 MB Intune limit", () => {
    const template = sampleTemplate();
    template.policies[0] = {
      ...template.policies[0]!,
      explainText: "a".repeat(1048576),
    };
    expect(compileAdministrativeTemplate(template).status).toBe("invalid");
  });

  it("packages ADMX, ADML, and import instructions in a zip", () => {
    const zip = generateAdministrativeTemplateZip(sampleTemplate());
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("App.admx");
    expect(text).toContain("en-US/App.adml");
    expect(text).toContain("IMPORT.md");
  });
});

describe("XML escaping", () => {
  it("escapes markup characters", () => {
    expect(escapeXml("a&b<c>\"'")).toBe("a&amp;b&lt;c&gt;&quot;&apos;");
  });
});
