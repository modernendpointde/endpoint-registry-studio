import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { exportWorkspace, importRegistryJson } from "../serialization/workspaceSchema";
import { validateWorkspace } from "../domain/validation/workspaceValidation";
import { SAMPLE_WORKSPACES } from "./sampleWorkspaces";

const samplesDir = join(import.meta.dirname, "../../samples");

describe("sample Workspaces", () => {
  it("exports six Open-able Workspaces without blocking errors", () => {
    expect(SAMPLE_WORKSPACES).toHaveLength(6);
    for (const sample of SAMPLE_WORKSPACES) {
      const text = exportWorkspace(sample.workspace);
      const imported = importRegistryJson(text);
      expect(imported.kind).toBe("workspace");
      if (imported.kind !== "workspace") continue;
      const errors = validateWorkspace(imported.workspace).filter(
        (issue) => issue.severity === "Error",
      );
      expect(errors, sample.fileName).toEqual([]);
      expect(readFileSync(join(samplesDir, sample.fileName), "utf8")).toBe(text);
    }
  });
});
