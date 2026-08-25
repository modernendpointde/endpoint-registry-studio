import { describe, expect, it } from "vitest";

import { parseReg } from "../../serialization/registryFileDecoder";
import { itemFromImport } from "./presentation";

describe("Registry import presentation boundary", () => {
  it("commits a parsed candidate as a Registry Item without an Entry adapter", () => {
    const result = parseReg(
      'Windows Registry Editor Version 5.00\n\n[HKLM\\Software\\Contoso]\n"Enabled"=dword:00000001',
    );
    const candidate = result.candidates[0];
    expect(candidate).toBeDefined();

    const item = itemFromImport(candidate!);

    expect(candidate!.description).toBe("");
    expect(item).toEqual({
      id: candidate!.id,
      enabled: true,
      registry: candidate!.registry,
      userHive: { includeDefaultUser: false },
      description: "",
    });
    expect(item).not.toHaveProperty("notes");
  });
});
