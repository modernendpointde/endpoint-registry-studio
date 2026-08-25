import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const documents = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "docs/ARCHITECTURE.md",
  "docs/DOCKER_AND_HOSTING.md",
  "docs/GHCR_DEPLOYMENT.md",
  "docs/POWERSHELL_OUTPUT.md",
  "docs/SECURITY.md",
  "docs/TESTING.md",
  "docs/WORKSPACE_SCHEMA.md",
];
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
const failures = [];

for (const document of documents) {
  const source = await readFile(join(root, document), "utf8");
  for (const match of source.matchAll(linkPattern)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
      continue;
    }
    const target = rawTarget.replace(/^<|>$/g, "").split(/[?#]/, 1)[0];
    if (!target) continue;
    const resolved = resolve(root, dirname(document), target);
    try {
      await access(resolved);
    } catch {
      failures.push(`${document}: missing ${rawTarget}`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Documentation link check failed:\n${failures.join("\n")}`);
}

process.stdout.write(`Documentation links PASS: ${documents.length} maintained files checked.\n`);
