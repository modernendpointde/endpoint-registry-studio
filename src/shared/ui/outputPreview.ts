export type ScriptPreviewMode = "configuration" | "full";

export function extractConfigurationBlock(script: string): string {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^\s*\$entries\s*=\s*@\(\s*$/i.test(line));
  if (start < 0) return "# This file does not contain a Registry configuration block.\n";
  const endOffset = lines.slice(start + 1).findIndex((line) => line.trim() === ")");
  if (endOffset < 0) return "# The Registry configuration block is incomplete.\n";
  return `${lines.slice(start, start + endOffset + 2).join("\n")}\n`;
}

export function scriptPreview(script: string, mode: ScriptPreviewMode): string {
  return mode === "configuration" ? extractConfigurationBlock(script) : script;
}
