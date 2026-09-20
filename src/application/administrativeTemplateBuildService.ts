import {
  compileAdministrativeTemplate,
  generateAdministrativeTemplateZip,
} from "../generators/admx";
import type { AdministrativeTemplate } from "../domain/admx";

export function administrativeTemplateArchiveName(template: AdministrativeTemplate): string {
  const base = [template.productId, template.version]
    .filter((value) => value.trim() !== "")
    .join("-");
  const safe = (base || "administrative-template")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return `${safe || "administrative-template"}.zip`;
}

export function administrativeTemplateBuild(template: AdministrativeTemplate) {
  const result = compileAdministrativeTemplate(template);
  if (result.status === "invalid" && result.issues.length === 0) {
    return {
      status: "invalid" as const,
      issues: [
        {
          code: "PolicyIdInvalid" as const,
          message: "Add at least one compatible Registry Item.",
        },
      ],
    };
  }
  return result;
}

export function buildAdministrativeTemplateArchive(template: AdministrativeTemplate): Uint8Array {
  const result = administrativeTemplateBuild(template);
  if (result.status !== "compiled") {
    throw new Error(result.issues.map((issue) => issue.message).join(" "));
  }
  return generateAdministrativeTemplateZip(template);
}
