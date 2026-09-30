import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The interface keeps one corner-radius scale. This guard fails when a rule invents another value
 * instead of using a token, which is how the stylesheet had accumulated thirteen different radii.
 */
const styleRoot = "src/styles";
const files = readdirSync(styleRoot).filter((name) => name.endsWith(".css"));
/** Anchored on purpose: an unanchored `0` would also accept `10px` and `20px`. */
const allowedValue = /^(?:var\(--wb-radius-[a-z-]+\)|50%|0)$/;

function declarations(): Array<{ file: string; line: number; value: string }> {
  return files.flatMap((file) =>
    readFileSync(join(styleRoot, file), "utf8")
      .split("\n")
      .flatMap((text, index) => {
        const match = /border-radius:\s*([^;]+);/.exec(text);
        return match?.[1] === undefined ? [] : [{ file, line: index + 1, value: match[1].trim() }];
      }),
  );
}

function radiusTokens(): { defined: string[]; used: string[] } {
  const defined = [
    ...readFileSync(join(styleRoot, "tokens.css"), "utf8").matchAll(/(--wb-radius-[a-z-]+)(?=:)/g),
  ].map((match) => match[1] ?? "");
  const used = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(join(styleRoot, file), "utf8").matchAll(
      /var\((--wb-radius-[a-z-]+)\)/g,
    )) {
      if (match[1] !== undefined) used.add(match[1]);
    }
  }
  return { defined, used: [...used].sort() };
}

describe("corner radius scale", () => {
  it("uses only the radius tokens, circles and square edges", () => {
    const offenders = declarations()
      .filter((declaration) => !allowedValue.test(declaration.value))
      .map((declaration) => `${declaration.file}:${declaration.line} ${declaration.value}`);
    expect(offenders).toEqual([]);
  });

  it("rejects the raw values the scale replaced", () => {
    // A guard that silently accepts a raw number is worthless, so prove both directions.
    for (const raw of ["10px", "20px", "14px", "999px", "0px", "50 %"]) {
      expect(allowedValue.test(raw), raw + " must be rejected").toBe(false);
    }
    for (const allowed of ["0", "50%", "var(--wb-radius-card)"]) {
      expect(allowedValue.test(allowed), allowed + " must be accepted").toBe(true);
    }
  });

  it("defines exactly the steps it uses", () => {
    const { defined, used } = radiusTokens();
    expect([...new Set(defined)].sort()).toEqual(used);
  });
});
