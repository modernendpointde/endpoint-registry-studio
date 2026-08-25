import { describe, expect, it } from "vitest";

import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
} from "../domain/workspace/workspace";
import { authorizePackageDownload } from "./packageDownloads";
import { commitRegistryImport, importedPackageName } from "../features/import/registryImport";
import { packageImportDecision } from "../features/packages/workspaceImport";

describe("Workbench use cases", () => {
  it("explains why empty packages cannot be downloaded", () => {
    const result = authorizePackageDownload([createDeploymentPackage()]);
    expect(result).toEqual({
      allowed: false,
      tone: "info",
      message: "Add at least one Registry Item.",
    });
  });

  it("names express imports from the file stem and avoids collisions", () => {
    expect(importedPackageName([], { kind: "clipboard" })).toBe("Imported Registry");
    expect(importedPackageName([], { kind: "file", fileName: "policies.reg" })).toBe("policies");
    expect(importedPackageName(["policies"], { kind: "file", fileName: "policies.reg" })).toBe(
      "policies 2",
    );
  });

  it("creates a default package when no import target is open", () => {
    const workspace = createWorkspace();
    const result = commitRegistryImport(
      workspace,
      [
        {
          id: "import-1",
          enabled: true,
          description: "",
          registry: createRegistryItem().registry,
        },
      ],
      undefined,
      { kind: "file", fileName: "baseline.reg" },
    );
    expect(result.created).toBe(true);
    expect(result.workspace.packages).toHaveLength(1);
    expect(result.workspace.packages[0]?.name).toBe("baseline");
    expect(result.workspace.packages[0]?.items).toHaveLength(1);
    expect(result.workspace.packages[0]?.deployment.method).toBe("Remediation");
  });

  it("distinguishes package and cross-package item collisions", () => {
    const pkg = createDeploymentPackage({ items: [createRegistryItem()] });
    const workspace = { ...createWorkspace(), packages: [pkg] };
    expect(
      packageImportDecision(workspace, {
        schemaVersion: 7,
        kind: "registry-package",
        generatorVersion: "1.0.0",
        fingerprint: "test",
        package: pkg,
      }).kind,
    ).toBe("collision");
  });
});
