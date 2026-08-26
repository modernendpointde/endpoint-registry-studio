import { describe, expect, it } from "vitest";

import { GENERATOR_VERSION, RELEASE_VERSION } from "./version";

describe("release metadata", () => {
  it("uses the release version as the generator contract version", () => {
    expect(RELEASE_VERSION).toBe("1.0.1");
    expect(GENERATOR_VERSION).toBe(RELEASE_VERSION);
  });
});
