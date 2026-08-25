import type { TargetArtifact } from "../types";
import type { ZipFile } from "../zip";

export function textArtifact(name: string, purpose: string, content: string): TargetArtifact {
  return {
    name,
    path: name,
    purpose,
    mediaType: name.endsWith(".json")
      ? "application/json;charset=utf-8"
      : name.endsWith(".md")
        ? "text/markdown;charset=utf-8"
        : "text/plain;charset=utf-8",
    content,
  };
}

export function packageSlug(value: string): string {
  const slug = value
    .trim()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug.slice(0, 80).replace(/-$/g, "") || "deployment-package";
}

export function artifactZipFiles(artifacts: readonly TargetArtifact[], prefix = ""): ZipFile[] {
  const encoder = new TextEncoder();
  return artifacts.map((artifact) => ({
    name: `${prefix}${artifact.path}`,
    data:
      typeof artifact.content === "string" ? encoder.encode(artifact.content) : artifact.content,
  }));
}
