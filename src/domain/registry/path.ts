import type { RegistryHive } from "./model";

/**
 * Classification of a Registry path typed or read with a possible hive prefix.
 *
 * The result classifies the input. It does not decide whether the remaining key path is valid;
 * existing path validation still applies to the returned `keyPath`.
 */
export type HivePathInput =
  | { kind: "hive"; hive: RegistryHive; keyPath: string }
  | { kind: "unsupported-hive"; prefix: string }
  | { kind: "relative"; keyPath: string };

const SUPPORTED_ALIASES: Readonly<Record<string, RegistryHive>> = {
  HKLM: "HKEY_LOCAL_MACHINE",
  HKEY_LOCAL_MACHINE: "HKEY_LOCAL_MACHINE",
  HKCU: "HKEY_CURRENT_USER",
  HKEY_CURRENT_USER: "HKEY_CURRENT_USER",
};

/**
 * Hives that exist in Windows but that this product does not support. Naming them explicitly turns a
 * silent fallback into an explicit message.
 */
const UNSUPPORTED_ALIASES: ReadonlySet<string> = new Set([
  "HKCR",
  "HKEY_CLASSES_ROOT",
  "HKU",
  "HKEY_USERS",
  "HKCC",
  "HKEY_CURRENT_CONFIG",
  "HKEY_PERFORMANCE_DATA",
]);

function firstSegment(raw: string): { segment: string; keyPath: string } {
  const separator = raw.indexOf("\\");
  if (separator === -1) return { segment: raw, keyPath: "" };
  return { segment: raw.slice(0, separator), keyPath: raw.slice(separator + 1) };
}

/**
 * Trims surrounding whitespace and removes a single trailing colon, so a PowerShell-style
 * `HKLM:\Software` is recognised as the same prefix as `HKLM\Software`.
 */
function normalizeSegment(segment: string): string {
  const trimmed = segment.trim();
  const withoutColon = trimmed.endsWith(":") ? trimmed.slice(0, -1) : trimmed;
  return withoutColon.toUpperCase();
}

export function readHivePathInput(raw: string): HivePathInput {
  const { segment, keyPath } = firstSegment(raw);
  const normalized = normalizeSegment(segment);

  const hive = SUPPORTED_ALIASES[normalized];
  if (hive !== undefined) return { kind: "hive", hive, keyPath };

  if (UNSUPPORTED_ALIASES.has(normalized)) {
    return { kind: "unsupported-hive", prefix: segment.trim() };
  }

  return { kind: "relative", keyPath: raw };
}
