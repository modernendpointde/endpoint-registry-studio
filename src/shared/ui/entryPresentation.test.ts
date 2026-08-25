import { describe, expect, it } from "vitest";

import { createRegistryDefinition } from "../../domain/registry/model";
import { destructiveImpact } from "./entryPresentation";

describe("Registry Item impact presentation", () => {
  it("ignores an inactive Revert draft but always reports recursive deletion", () => {
    const revert = createRegistryDefinition({ rollbackMode: "DeleteManagedValue" });
    expect(destructiveImpact(revert, false)).toBeUndefined();
    expect(destructiveImpact(revert, true)).toContain("Revert behavior will delete");

    const recursive = createRegistryDefinition({
      desiredState: "Absent",
      deletionMode: "KeyRecursive",
      keyPath: "Software\\Contoso",
    });
    expect(destructiveImpact(recursive, false)).toContain("recursive deletion");
  });
});
