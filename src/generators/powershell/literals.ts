import { effectiveRegistryViews } from "../../domain/effectiveBehavior";
import type { RegistryType, RegistryValue, RegistryView } from "../../domain/registry/model";
import type { RegistryItem } from "../../domain/workspace/workspace";
import type { RenderContext } from "./types";

export const UTF8_DECODER = String.raw`function ConvertFrom-ErsUtf8Base64 {
    param([Parameter(Mandatory = $true)][string]$Value)
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}`;

export function isSafeAsciiLiteral(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

export function utf8Base64(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new TextEncoder().encode(value);
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;
    result += alphabet[(chunk >>> 18) & 0x3f];
    result += alphabet[(chunk >>> 12) & 0x3f];
    result += hasSecond ? alphabet[(chunk >>> 6) & 0x3f] : "=";
    result += hasThird ? alphabet[chunk & 0x3f] : "=";
  }
  return result;
}

export function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function psText(value: string, context: RenderContext): string {
  if (isSafeAsciiLiteral(value)) return psString(value);
  context.usesUtf8Decoder = true;
  return `(ConvertFrom-ErsUtf8Base64 -Value '${utf8Base64(value)}')`;
}

export function psBoolean(value: boolean): string {
  return value ? "$true" : "$false";
}

function signedDWordLiteral(value: number): string {
  const signed = value > 0x7fffffff ? value - 0x1_0000_0000 : value;
  return signed === -0x80000000 ? "[int32]::MinValue" : `[int32](${signed})`;
}

function signedQWordLiteral(value: string): string {
  const unsigned = BigInt(value);
  const signed = unsigned > 0x7fff_ffff_ffff_ffffn ? unsigned - 0x1_0000_0000_0000_0000n : unsigned;
  return signed === -0x8000_0000_0000_0000n ? "[int64]::MinValue" : `[int64](${signed.toString()})`;
}

export function psValue(value: RegistryValue, context: RenderContext): string {
  switch (value.type) {
    case "String":
    case "ExpandString":
      return `[string]${psText(value.data, context)}`;
    case "MultiString":
      return `[string[]]@(${value.data.map((item) => psText(item, context)).join(", ")})`;
    case "Binary":
      return `[byte[]]@(${value.data.join(", ")})`;
    case "DWord":
      return signedDWordLiteral(value.data);
    case "QWord":
      return signedQWordLiteral(value.data);
  }
}

export function psKind(type: RegistryType): string {
  return `[Microsoft.Win32.RegistryValueKind]::${type}`;
}

export function psHive(item: RegistryItem): string {
  return item.registry.hive === "HKEY_LOCAL_MACHINE"
    ? "[Microsoft.Win32.RegistryHive]::LocalMachine"
    : "[Microsoft.Win32.RegistryHive]::CurrentUser";
}

export function psViews(view: RegistryView, runIn64BitPowerShell: boolean): string {
  return `@(${effectiveRegistryViews(view, runIn64BitPowerShell)
    .map((current) => {
      const runtimeView = current.requested === "Auto" ? "Default" : current.requested;
      return `[ordered]@{ Label = '${current.requested}'; Value = [Microsoft.Win32.RegistryView]::${runtimeView} }`;
    })
    .join(", ")})`;
}
