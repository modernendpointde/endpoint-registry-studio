import { describe, expect, it } from "vitest";

import { createRegistryItem } from "../../domain/workspace/workspace";
import { blankRegistryValue, registryItemCandidate } from "./itemDraft";

describe("Registry Item draft helpers", () => {
  it("keeps incomplete Binary text outside the domain candidate", () => {
    const item = createRegistryItem();
    item.registry.value = blankRegistryValue("Binary");
    const incomplete = registryItemCandidate(item, "f", "");
    const complete = registryItemCandidate(item, "ff 10", "");
    expect(incomplete.parsedValueBinary).toBeUndefined();
    expect(incomplete.item.registry.value).toEqual({ type: "Binary", data: [] });
    expect(complete.item.registry.value).toEqual({ type: "Binary", data: [255, 16] });
  });
});
