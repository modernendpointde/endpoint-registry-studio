import { describe, expect, it } from "vitest";

import { createAdministrativeTemplate } from "../domain/admx";
import {
  administrativeTemplateArchiveName,
  administrativeTemplateBuild,
  buildAdministrativeTemplateArchive,
} from "./administrativeTemplateBuildService";

describe("administrative template build service", () => {
  it("provides an explicit empty-policy issue and blocks archive generation", () => {
    const template = createAdministrativeTemplate({
      name: "Northgate",
      version: "1.0.0",
      vendorId: "Northgate",
      productId: "App",
    });
    expect(administrativeTemplateBuild(template)).toMatchObject({
      status: "invalid",
      issues: [{ message: "Add at least one compatible Registry Item." }],
    });
    expect(() => buildAdministrativeTemplateArchive(template)).toThrow(
      "Add at least one compatible Registry Item.",
    );
  });

  it("creates a bounded local archive name without trusting authored path separators", () => {
    const template = createAdministrativeTemplate({
      productId: "../Northgate App",
      version: "1.0.0",
    });
    expect(administrativeTemplateArchiveName(template)).toBe("Northgate-App-1.0.0.zip");
    expect(administrativeTemplateArchiveName(createAdministrativeTemplate())).toBe(
      "administrative-template.zip",
    );
  });
});
