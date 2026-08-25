import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)(DockerWorkbench|DockerWorkspaceLifecycle)\.tsx?$/i,
  /(^|\/)persistentWorkspaceHome\.ts$/i,
  /(^|\/)workspaceHome\.ts$/i,
  /(^|\/)persistent(\/|$)/i,
  /(^|\/)dockerWorkspace/i,
];

const FORBIDDEN_MARKERS = [
  "indexedDB",
  "IDBDatabase",
  "endpoint-registry-studio-home",
  "workspace.registry-workspace.json",
  "workspace-json",
  "file-handle",
  "navigator.storage.getDirectory",
  "storage.getDirectory",
  "navigator.storage.persist",
  "storage.persist",
  "queryPermission",
  "requestPermission",
  "showOpenFilePicker",
  "showSaveFilePicker",
  "FileSystemHandle",
  "pagehide",
  "Saved locally",
  "Saving…",
  "Saving...",
  "Couldn’t save locally",
  "Delete workspace from this browser",
].map((marker) => marker.toLowerCase());

function normalize(path) {
  return path.split(sep).join("/");
}

function isForbiddenPath(absPath, root) {
  return FORBIDDEN_PATH_PATTERNS.some((pattern) =>
    pattern.test(normalize(relative(root, absPath))),
  );
}

function hasForbiddenMarker(text) {
  const lower = text.toLowerCase();
  return FORBIDDEN_MARKERS.find((marker) => lower.includes(marker));
}

function candidatesFor(specifier, fromFile) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base];
  for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
    candidates.push(base + ext);
  }
  candidates.push(join(base, "index.ts"));
  candidates.push(join(base, "index.tsx"));
  return candidates;
}

function resolveImport(specifier, fromFile) {
  if (specifier.startsWith(".")) {
    return candidatesFor(specifier, fromFile).find(
      (path) => existsSync(path) && statSync(path).isFile(),
    );
  }
  return null;
}

function collectImportSpecifiers(sourceFile) {
  const specifiers = new Set();
  const dynamic = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        specifiers.add(argument.text);
      } else {
        dynamic.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { specifiers, dynamic };
}

function createImportGraph(entry) {
  const root = resolve(dirname(entry), "..", "..");
  const visited = new Set();
  const files = [];
  const errors = [];
  const stack = [resolve(entry)];
  while (stack.length > 0) {
    const file = stack.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (isForbiddenPath(file, root)) {
      errors.push("forbidden import reachable: " + normalize(relative(root, file)));
    }
    if (extname(file) === ".css") continue;
    const source = readFileSync(file, "utf8");
    files.push(file);
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const { specifiers, dynamic } = collectImportSpecifiers(sourceFile);
    if (dynamic.length > 0) {
      errors.push("non-literal dynamic import in " + normalize(relative(root, file)));
    }
    const dynamicPattern = /\bimport\s*\(\s*(?!["'])/g;
    if (dynamicPattern.test(source)) {
      errors.push("non-literal dynamic import in " + normalize(relative(root, file)));
    }
    for (const specifier of specifiers) {
      const resolved = resolveImport(specifier, file);
      if (resolved) stack.push(resolved);
    }
  }
  return { root, files, errors };
}

function walkFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) results.push({ path, symlink: true });
    else if (entry.isDirectory()) results.push(...walkFiles(path));
    else if (entry.isFile()) results.push({ path, symlink: false });
  }
  return results;
}

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".map", ".txt", ".svg"]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function main() {
  const args = process.argv.slice(2);
  const entry = args[args.indexOf("--entry") + 1];
  const dist = args[args.indexOf("--dist") + 1];
  const manifestPath = args[args.indexOf("--manifest") + 1];
  const checkManifest = args.includes("--check-manifest");
  if (!entry || !dist || !manifestPath) {
    throw new Error("Usage: --entry <tsx> --dist <dir> --manifest <file> [--check-manifest]");
  }
  const cwd = process.cwd();
  const distRoot = resolve(cwd, dist);
  const manifestAbs = resolve(cwd, manifestPath);
  const manifestRel = normalize(relative(distRoot, manifestAbs));
  const failures = [];

  const graph = createImportGraph(resolve(cwd, entry));
  for (const error of graph.errors) failures.push(error);
  for (const file of graph.files) {
    const marker = hasForbiddenMarker(readFileSync(file, "utf8"));
    if (marker) {
      failures.push(
        normalize(relative(graph.root, file)) + ": forbidden source marker '" + marker + "'",
      );
    }
  }

  if (!existsSync(distRoot)) failures.push("dist directory missing: " + dist);
  const entries = walkFiles(distRoot);
  const manifestFiles = [];
  for (const entry of entries) {
    if (entry.symlink) {
      failures.push(normalize(relative(distRoot, entry.path)) + ": symbolic link not allowed");
      continue;
    }
    const relativePath = normalize(relative(distRoot, entry.path));
    if (relativePath === manifestRel) continue;
    const buffer = readFileSync(entry.path);
    manifestFiles.push({ path: relativePath, bytes: buffer.length, sha256: sha256(buffer) });
    if (TEXT_EXTENSIONS.has(extname(entry.path))) {
      const marker = hasForbiddenMarker(buffer.toString("utf8"));
      if (marker) failures.push(relativePath + ": forbidden bundle marker '" + marker + "'");
    }
  }

  manifestFiles.sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest = {
    schemaVersion: 1,
    artifact: "endpoint-registry-studio-web",
    files: manifestFiles,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  if (checkManifest) {
    if (!existsSync(manifestAbs)) failures.push("manifest missing for check: " + manifestPath);
    else if (readFileSync(manifestAbs, "utf8") !== manifestText)
      failures.push("manifest mismatch: " + manifestPath);
  } else {
    writeFileSync(manifestAbs, manifestText);
  }

  if (failures.length > 0) {
    process.stderr.write(failures.map((failure) => "FAIL " + failure).join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(
    "PASS storage-free: " +
      graph.files.length +
      " source files, " +
      manifestFiles.length +
      " artifacts\n",
  );
}

main();
