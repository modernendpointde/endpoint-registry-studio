import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const generatorRoot = resolve("src/generators");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function resolveModule(from: string, request: string): string | undefined {
  if (!request.startsWith(".")) return undefined;
  const candidate = resolve(dirname(from), request);
  for (const path of [`${candidate}.ts`, join(candidate, "index.ts")]) {
    if (sourceSet.has(path)) return path;
  }
  return undefined;
}

const sources = sourceFiles(generatorRoot);
const sourceSet = new Set(sources);
const graph = new Map(
  sources.map((file) => {
    const content = readFileSync(file, "utf8");
    const dependencies = [...content.matchAll(/\b(?:from|import)\s*[(']([^')"]+)[')"]/g)]
      .map((match) => resolveModule(file, match[1] ?? ""))
      .filter((path): path is string => path !== undefined);
    return [file, dependencies] as const;
  }),
);

describe("generator module boundaries", () => {
  it("keeps the generator import graph acyclic", () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (file: string, trail: string[]): void => {
      if (visiting.has(file)) {
        const cycle = [...trail, file]
          .map((path) => normalize(relative(generatorRoot, path)))
          .join(" -> ");
        throw new Error(`Generator import cycle: ${cycle}`);
      }
      if (visited.has(file)) return;
      visiting.add(file);
      for (const dependency of graph.get(file) ?? []) visit(dependency, [...trail, file]);
      visiting.delete(file);
      visited.add(file);
    };

    for (const file of sources) visit(file, []);
    expect(visited.size).toBe(sources.length);
  });

  it("keeps the public generator facades small and framework independent", () => {
    for (const facade of ["powershell.ts"]) {
      const content = readFileSync(join(generatorRoot, facade), "utf8");
      expect(content.split("\n").length).toBeLessThan(20);
    }
    expect(
      readFileSync(resolve("src/application/packageBuildService.ts"), "utf8").split("\n").length,
    ).toBeLessThan(20);
    for (const file of sources) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(/\breact\b|platform\/browser|document\.|window\./i);
    }
  });
});
