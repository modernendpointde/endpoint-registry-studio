import { describe, expect, it } from "vitest";

import { countLabel } from "./grammar";

describe("countLabel", () => {
  it("uses the correct singular and plural labels", () => {
    expect(countLabel(1, "warning")).toBe("1 warning");
    expect(countLabel(2, "warning")).toBe("2 warnings");
    expect(countLabel(1, "entry", "entries")).toBe("1 entry");
    expect(countLabel(0, "entry", "entries")).toBe("0 entries");
  });
});
