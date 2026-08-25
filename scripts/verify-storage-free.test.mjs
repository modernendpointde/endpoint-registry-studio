import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const verifier = new URL("./verify-storage-free.mjs", import.meta.url).pathname;
const failures = [];
const MANIFEST = "dist/artifact-manifest.sha256.json";

function runVerifier(cwd, args) {
  try {
    const out = execFileSync(process.execPath, [verifier, ...args], { cwd, encoding: "utf8" });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: String(error.stdout || "") + String(error.stderr || "") };
  }
}

const root = mkdtempSync(join(tmpdir(), "ers-verify-storage-free-"));
try {
  const clean = join(root, "clean");
  mkdirSync(join(clean, "dist", "assets"), { recursive: true });
  writeFileSync(
    join(clean, "entry.tsx"),
    'import { render } from "./dep";\nconst a = import("./dep");\nrender("hi");\n',
  );
  writeFileSync(
    join(clean, "dep.ts"),
    "export function render(value: string): string { return value; }\n",
  );
  writeFileSync(
    join(clean, "dist", "index.html"),
    '<html><body><script src="assets/app.js"></script></body></html>',
  );
  writeFileSync(join(clean, "dist", "assets", "app.js"), "console.log('hi');");
  const a = runVerifier(clean, ["--entry", "entry.tsx", "--dist", "dist", "--manifest", MANIFEST]);
  if (!a.ok || !a.out.includes("PASS storage-free"))
    failures.push("clean fixture should PASS: " + a.out);
  const a2 = runVerifier(clean, [
    "--entry",
    "entry.tsx",
    "--dist",
    "dist",
    "--manifest",
    MANIFEST,
    "--check-manifest",
  ]);
  if (!a2.ok) failures.push("deterministic manifest re-check should PASS: " + a2.out);

  for (const use of [
    { name: "import-dynamic", source: 'void import("./persistent/persistentWorkspaceHome");\n' },
    { name: "import-static", source: 'import "./persistent/persistentWorkspaceHome";\n' },
  ]) {
    const fixture = join(root, use.name);
    mkdirSync(join(fixture, "persistent"), { recursive: true });
    writeFileSync(join(fixture, "entry.tsx"), use.source);
    writeFileSync(
      join(fixture, "persistent", "persistentWorkspaceHome.ts"),
      "export const p = 1;\n",
    );
    mkdirSync(join(fixture, "dist"), { recursive: true });
    writeFileSync(join(fixture, "dist", "index.html"), "<html></html>");
    const r = runVerifier(fixture, [
      "--entry",
      "entry.tsx",
      "--dist",
      "dist",
      "--manifest",
      MANIFEST,
    ]);
    if (r.ok || !r.out.includes("forbidden import reachable")) {
      failures.push(use.name + " fixture should FAIL: " + r.out);
    }
  }

  const dyn = join(root, "dynamic");
  mkdirSync(join(dyn, "dist"), { recursive: true });
  writeFileSync(join(dyn, "entry.tsx"), 'const name = "./x";\nvoid import(name);\n');
  writeFileSync(join(dyn, "dist", "index.html"), "<html></html>");
  const c = runVerifier(dyn, ["--entry", "entry.tsx", "--dist", "dist", "--manifest", MANIFEST]);
  if (c.ok || !c.out.includes("non-literal dynamic import"))
    failures.push("dynamic import fixture should FAIL: " + c.out);

  const marker = join(root, "marker");
  mkdirSync(join(marker, "dist", "assets"), { recursive: true });
  writeFileSync(join(marker, "entry.tsx"), "export const q = 1;\n");
  writeFileSync(join(marker, "dist", "index.html"), "<html></html>");
  writeFileSync(join(marker, "dist", "assets", "app.js"), "indexedDB.open('x');");
  const d = runVerifier(marker, ["--entry", "entry.tsx", "--dist", "dist", "--manifest", MANIFEST]);
  if (d.ok || !d.out.includes("forbidden bundle marker"))
    failures.push("marker fixture should FAIL: " + d.out);

  const srcMarker = join(root, "source-marker");
  mkdirSync(join(srcMarker, "dist"), { recursive: true });
  writeFileSync(join(srcMarker, "entry.tsx"), "export const x = 'pagehide';\n");
  writeFileSync(join(srcMarker, "dist", "index.html"), "<html></html>");
  const s = runVerifier(srcMarker, [
    "--entry",
    "entry.tsx",
    "--dist",
    "dist",
    "--manifest",
    MANIFEST,
  ]);
  if (s.ok || !s.out.includes("forbidden source marker"))
    failures.push("source marker fixture should FAIL: " + s.out);

  const sym = join(root, "symlink");
  mkdirSync(join(sym, "dist", "assets"), { recursive: true });
  writeFileSync(join(sym, "entry.tsx"), "export const y = 1;\n");
  writeFileSync(join(sym, "dist", "index.html"), "<html></html>");
  writeFileSync(join(sym, "dist", "assets", "real.js"), "console.log(1);");
  symlinkSync(join(sym, "dist", "assets", "real.js"), join(sym, "dist", "assets", "link.js"));
  const symR = runVerifier(sym, ["--entry", "entry.tsx", "--dist", "dist", "--manifest", MANIFEST]);
  if (symR.ok || !symR.out.includes("symbolic link not allowed"))
    failures.push("symlink fixture should FAIL: " + symR.out);

  const varManifest = join(root, "custom-manifest");
  mkdirSync(join(varManifest, "dist", "assets"), { recursive: true });
  writeFileSync(join(varManifest, "entry.tsx"), "export const z = 1;\n");
  writeFileSync(join(varManifest, "dist", "index.html"), "<html></html>");
  writeFileSync(join(varManifest, "dist", "assets", "app.js"), "console.log('v');");
  const customManifest = "dist/custom-manifest.json";
  const v1 = runVerifier(varManifest, [
    "--entry",
    "entry.tsx",
    "--dist",
    "dist",
    "--manifest",
    customManifest,
  ]);
  if (!v1.ok) failures.push("variable manifest setup should PASS: " + v1.out);
  const v2 = runVerifier(varManifest, [
    "--entry",
    "entry.tsx",
    "--dist",
    "dist",
    "--manifest",
    customManifest,
    "--check-manifest",
  ]);
  if (!v2.ok) failures.push("variable manifest re-check should PASS: " + v2.out);

  const tamper = join(root, "tamper");
  mkdirSync(join(tamper, "dist", "assets"), { recursive: true });
  writeFileSync(join(tamper, "entry.tsx"), "export const r = 1;\n");
  writeFileSync(join(tamper, "dist", "index.html"), "<html></html>");
  writeFileSync(join(tamper, "dist", "assets", "app.js"), "console.log('one');");
  const e1 = runVerifier(tamper, [
    "--entry",
    "entry.tsx",
    "--dist",
    "dist",
    "--manifest",
    MANIFEST,
  ]);
  if (!e1.ok) failures.push("tamper setup should PASS: " + e1.out);
  writeFileSync(join(tamper, "dist", "assets", "app.js"), "console.log('two');");
  const e2 = runVerifier(tamper, [
    "--entry",
    "entry.tsx",
    "--dist",
    "dist",
    "--manifest",
    MANIFEST,
    "--check-manifest",
  ]);
  if (e2.ok || !e2.out.includes("manifest mismatch"))
    failures.push("tampered artifact should FAIL manifest check: " + e2.out);
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(failures.map((f) => "FAIL " + f).join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(
  "PASS verify-storage-free self-test: clean, literal dynamic import (ok), static+dynamic forbidden imports, non-literal dynamic import, bundle marker, source marker, symlink, variable manifest, deterministic re-check, tamper detection\n",
);
