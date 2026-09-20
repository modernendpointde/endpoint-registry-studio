import {
  isAdmxToken,
  isAdministrativeTemplateCompilable,
  templateNamespace,
  validateAdministrativeTemplate,
  type AdministrativeTemplate,
  type AdministrativeTemplatePolicy,
  type AdmxTemplateIssue,
} from "../../domain/admx";
import type { RegistryValue } from "../../domain/registry/model";
import { createZip } from "../zip";
import { administrativeTemplateImportInstructions } from "./instructions";
import {
  assertNoExternalXmlPayload,
  containsIllegalXmlChars,
  escapeXml,
  hasForbiddenXmlSource,
  xmlDeclaration,
} from "./xml";

export interface CompiledAdministrativeTemplate {
  admxFileName: string;
  admlFileName: string;
  admx: string;
  adml: string;
  instructions: string;
}

export type CompileAdministrativeTemplateResult =
  | { status: "compiled"; compiled: CompiledAdministrativeTemplate }
  | { status: "invalid"; issues: AdmxTemplateIssue[] };

const SUPPORTED_ON = "StudioGenerated";

function categoryStringId(token: string): string {
  return "Cat_" + token;
}

function policyStringId(policyId: string): string {
  return "Pol_" + policyId;
}

function explainStringId(policyId: string): string {
  return "Pol_" + policyId + "_Explain";
}

function revision(version: string): string {
  const [major, minor] = version.split(".");
  return major + "." + (minor ?? "0");
}

function collectStrings(template: AdministrativeTemplate): string[] {
  const values = [template.name, template.version, template.vendorId, template.productId];
  for (const policy of template.policies) {
    values.push(
      policy.displayName,
      policy.explainText,
      policy.category,
      policy.policyId,
      policy.snapshot.keyPath,
      policy.snapshot.valueName,
    );
    if (policy.snapshot.value.type === "String" || policy.snapshot.value.type === "ExpandString") {
      values.push(policy.snapshot.value.data);
    }
    if (policy.disabledBehavior.kind === "WriteFixedValue") {
      const authored = policy.disabledBehavior.value;
      if (authored.type === "String" || authored.type === "ExpandString")
        values.push(authored.data);
    }
  }
  return values;
}

function categoryToken(displayName: string, used: Map<string, string>): string {
  const existing = used.get(displayName);
  if (existing) return existing;
  let base = displayName.replace(/[^A-Za-z0-9_]+/g, "");
  if (!/^[A-Za-z]/.test(base)) base = "C" + base;
  if (!isAdmxToken(base)) base = "Category";
  let token = base;
  let suffix = 2;
  const taken = new Set(used.values());
  while (taken.has(token)) {
    token = base + String(suffix);
    suffix += 1;
  }
  used.set(displayName, token);
  return token;
}

function admxValueXml(value: RegistryValue): string {
  if (value.type === "DWord") {
    return '<decimal value="' + String(value.data) + '" />';
  }
  if (value.type === "String" || value.type === "ExpandString") {
    return "<string>" + escapeXml(value.data) + "</string>";
  }
  throw new Error("Unsupported ADMX value type.");
}

function disabledXml(policy: AdministrativeTemplatePolicy): string {
  if (policy.disabledBehavior.kind === "DeleteValue") {
    return "      <disabledValue>\n        <delete />\n      </disabledValue>";
  }
  if (policy.disabledBehavior.kind === "WriteFixedValue") {
    return `      <disabledValue>\n        ${admxValueXml(policy.disabledBehavior.value)}\n      </disabledValue>`;
  }
  return "";
}

function policyElements(policy: AdministrativeTemplatePolicy): {
  body: string;
  presentation: string;
} {
  if (policy.valueMode !== "ProfileInput") {
    const enabled = `      <enabledValue>\n        ${admxValueXml(policy.snapshot.value)}\n      </enabledValue>`;
    return { body: [enabled, disabledXml(policy)].filter(Boolean).join("\n"), presentation: "" };
  }
  const elementId = policy.policyId + "_Value";
  if (policy.snapshot.value.type === "DWord") {
    const min = policy.dwordMin ?? 0;
    const max = policy.dwordMax ?? 0;
    return {
      body: [
        `      <elements>\n        <decimal id="${elementId}" valueName="${escapeXml(policy.snapshot.valueName)}" minValue="${min}" maxValue="${max}" />\n      </elements>`,
        disabledXml(policy),
      ]
        .filter(Boolean)
        .join("\n"),
      presentation: `      <presentation id="${policy.policyId}">\n        <decimalTextBox refId="${elementId}" />\n      </presentation>`,
    };
  }
  return {
    body: [
      `      <elements>\n        <text id="${elementId}" valueName="${escapeXml(policy.snapshot.valueName)}"${policy.snapshot.value.type === "ExpandString" ? ' expandable="true"' : ""} />\n      </elements>`,
      disabledXml(policy),
    ]
      .filter(Boolean)
      .join("\n"),
    presentation: `      <presentation id="${policy.policyId}">\n        <textBox refId="${elementId}">\n          <label>Value</label>\n        </textBox>\n      </presentation>`,
  };
}

function renderAdmx(template: AdministrativeTemplate): string {
  const namespace = templateNamespace(template);
  const rev = revision(template.version);
  const categoryNames = new Map<string, string>();
  const categories: string[] = [];
  const seenCategories = new Set<string>();
  for (const policy of template.policies) {
    const token = categoryToken(policy.category, categoryNames);
    if (seenCategories.has(token)) continue;
    seenCategories.add(token);
    categories.push(
      `    <category name="${token}" displayName="$(string.${categoryStringId(token)})" />`,
    );
  }
  const policies = template.policies.map((policy) => {
    const token = categoryNames.get(policy.category) ?? "Category";
    const parts = policyElements(policy);
    const presentationAttr =
      policy.valueMode === "ProfileInput"
        ? ` presentation="$(presentation.${policy.policyId})"`
        : "";
    const valueNameAttr =
      policy.valueMode === "Fixed" ? ` valueName="${escapeXml(policy.snapshot.valueName)}"` : "";
    return [
      `    <policy name="${policy.policyId}" class="${policy.policyClass}" displayName="$(string.${policyStringId(policy.policyId)})" explainText="$(string.${explainStringId(policy.policyId)})"${presentationAttr} key="${escapeXml(policy.snapshot.keyPath)}"${valueNameAttr}>`,
      `      <parentCategory ref="${token}" />`,
      `      <supportedOn ref="${SUPPORTED_ON}" />`,
      parts.body,
      "    </policy>",
    ].join("\n");
  });
  return [
    xmlDeclaration(),
    `<policyDefinitions revision="${rev}" schemaVersion="1.0" xmlns="http://www.microsoft.com/GroupPolicy/PolicyDefinitions">`,
    "  <policyNamespaces>",
    `    <target prefix="${template.vendorId}" namespace="${namespace}" />`,
    "  </policyNamespaces>",
    `  <resources minRequiredRevision="${rev}" />`,
    "  <supportedOn>",
    "    <definitions>",
    `      <definition name="${SUPPORTED_ON}" displayName="$(string.${SUPPORTED_ON})" />`,
    "    </definitions>",
    "  </supportedOn>",
    "  <categories>",
    ...categories,
    "  </categories>",
    "  <policies>",
    ...policies,
    "  </policies>",
    "</policyDefinitions>",
    "",
  ].join("\n");
}

function renderAdml(template: AdministrativeTemplate): string {
  const rev = revision(template.version);
  const categoryNames = new Map<string, string>();
  const strings: string[] = [
    `      <string id="${SUPPORTED_ON}">Generated by Endpoint Registry Studio.</string>`,
  ];
  const presentations: string[] = [];
  for (const policy of template.policies) {
    const token = categoryToken(policy.category, categoryNames);
    if (!strings.some((entry) => entry.includes(`id="${categoryStringId(token)}"`))) {
      strings.push(
        `      <string id="${categoryStringId(token)}">${escapeXml(policy.category)}</string>`,
      );
    }
    strings.push(
      `      <string id="${policyStringId(policy.policyId)}">${escapeXml(policy.displayName)}</string>`,
    );
    strings.push(
      `      <string id="${explainStringId(policy.policyId)}">${escapeXml(policy.explainText)}</string>`,
    );
    const parts = policyElements(policy);
    if (parts.presentation) presentations.push(parts.presentation);
  }
  const presentationBlock =
    presentations.length > 0
      ? ["    <presentationTable>", ...presentations, "    </presentationTable>"].join("\n")
      : "";
  return (
    [
      xmlDeclaration(),
      `<policyDefinitionResources revision="${rev}" schemaVersion="1.0" xmlns="http://www.microsoft.com/GroupPolicy/PolicyDefinitions">`,
      `  <displayName>${escapeXml(template.name)}</displayName>`,
      `  <description>Version ${escapeXml(template.version)}</description>`,
      "  <resources>",
      "    <stringTable>",
      ...strings,
      "    </stringTable>",
      presentationBlock,
      "  </resources>",
      "</policyDefinitionResources>",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n")
      .replace(/\n\n/g, "\n") + "\n"
  );
}

export function compileAdministrativeTemplate(
  template: AdministrativeTemplate,
): CompileAdministrativeTemplateResult {
  const issues = validateAdministrativeTemplate(template);
  if (!isAdministrativeTemplateCompilable(template) || issues.length > 0) {
    return { status: "invalid", issues };
  }
  const stringIds = [SUPPORTED_ON];
  const categoryNames = new Map<string, string>();
  for (const policy of template.policies) {
    categoryToken(policy.category, categoryNames);
    stringIds.push(policyStringId(policy.policyId), explainStringId(policy.policyId));
  }
  for (const token of new Set(categoryNames.values())) {
    stringIds.push(categoryStringId(token));
  }
  if (new Set(stringIds).size !== stringIds.length) {
    return {
      status: "invalid",
      issues: [
        {
          code: "PolicyIdDuplicate",
          message: "Generated ADML string identifiers collide.",
        },
      ],
    };
  }
  if (template.policies.some((policy) => policy.policyId === SUPPORTED_ON)) {
    return {
      status: "invalid",
      issues: [
        {
          code: "PolicyIdInvalid",
          message: "Policy identifier StudioGenerated is reserved.",
        },
      ],
    };
  }
  const strings = collectStrings(template);
  if (strings.some(containsIllegalXmlChars) || strings.some(hasForbiddenXmlSource)) {
    return {
      status: "invalid",
      issues: [
        {
          code: "SnapshotIneligible",
          message: "Template strings contain XML-illegal or external payload content.",
        },
      ],
    };
  }
  const compiled: CompiledAdministrativeTemplate = {
    admxFileName: template.productId + ".admx",
    admlFileName: "en-US/" + template.productId + ".adml",
    admx: renderAdmx(template),
    adml: renderAdml(template),
    instructions: administrativeTemplateImportInstructions(
      template,
      template.productId + ".admx",
      "en-US/" + template.productId + ".adml",
    ),
  };
  const encoder = new TextEncoder();
  if (
    encoder.encode(compiled.admx).length > 1024 * 1024 ||
    encoder.encode(compiled.adml).length > 1024 * 1024
  ) {
    return {
      status: "invalid",
      issues: [
        {
          code: "SnapshotIneligible",
          message: "Generated ADMX/ADML exceeds the 1 MB Intune import limit.",
        },
      ],
    };
  }
  assertNoExternalXmlPayload(compiled.admx);
  assertNoExternalXmlPayload(compiled.adml);
  return { status: "compiled", compiled };
}

export function generateAdministrativeTemplateZip(template: AdministrativeTemplate): Uint8Array {
  const result = compileAdministrativeTemplate(template);
  if (result.status !== "compiled") {
    throw new Error("Administrative template is not compilable.");
  }
  const encoder = new TextEncoder();
  return createZip([
    { name: result.compiled.admxFileName, data: encoder.encode(result.compiled.admx) },
    { name: result.compiled.admlFileName, data: encoder.encode(result.compiled.adml) },
    { name: "IMPORT.md", data: encoder.encode(result.compiled.instructions) },
  ]);
}
