export { GENERATOR_VERSION } from "../../version";

export const HIVES = ["HKEY_LOCAL_MACHINE", "HKEY_CURRENT_USER"] as const;
export type RegistryHive = (typeof HIVES)[number];

export const REGISTRY_TYPES = [
  "String",
  "ExpandString",
  "MultiString",
  "Binary",
  "DWord",
  "QWord",
] as const;
export type RegistryType = (typeof REGISTRY_TYPES)[number];

export const REGISTRY_VIEWS = ["Auto", "Registry32", "Registry64", "Both"] as const;
export type RegistryView = (typeof REGISTRY_VIEWS)[number];

export type DesiredState = "Present" | "Absent";
export type DeletionMode = "Value" | "KeyIfEmpty" | "KeyRecursive";
export type RollbackMode = "None" | "DeleteManagedValue" | "SetDefinedRollbackValue";

export type RegistryValue =
  | { type: "String"; data: string }
  | { type: "ExpandString"; data: string }
  | { type: "MultiString"; data: string[] }
  | { type: "Binary"; data: number[] }
  | { type: "DWord"; data: number }
  | { type: "QWord"; data: string };

export interface RegistryDefinition {
  desiredState: DesiredState;
  deletionMode: DeletionMode;
  hive: RegistryHive;
  keyPath: string;
  valueName: string;
  value: RegistryValue;
  view: RegistryView;
  rollbackMode: RollbackMode;
  rollbackValue: RegistryValue;
}

let fallbackIdCounter = 0;

export function createId(): string {
  const bytes = new Uint8Array(16);
  const browserCrypto = globalThis.crypto;

  if (browserCrypto && typeof browserCrypto.getRandomValues === "function") {
    browserCrypto.getRandomValues(bytes);
  } else {
    fallbackIdCounter += 1;
    const seed = `${Date.now()}-${fallbackIdCounter}-${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] =
        (seed.charCodeAt(index % seed.length) + Math.floor(Math.random() * 256)) & 0xff;
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRegistryDefinition(
  overrides: Partial<RegistryDefinition> = {},
): RegistryDefinition {
  return {
    desiredState: "Present",
    deletionMode: "Value",
    hive: "HKEY_LOCAL_MACHINE",
    keyPath: "SOFTWARE\\Contoso",
    valueName: "Setting",
    value: { type: "String", data: "" },
    view: "Auto",
    rollbackMode: "None",
    rollbackValue: { type: "String", data: "" },
    ...overrides,
  };
}

export function cloneRegistryDefinition(definition: RegistryDefinition): RegistryDefinition {
  return {
    ...definition,
    value: {
      ...definition.value,
      data: Array.isArray(definition.value.data)
        ? [...definition.value.data]
        : definition.value.data,
    } as RegistryValue,
    rollbackValue: {
      ...definition.rollbackValue,
      data: Array.isArray(definition.rollbackValue.data)
        ? [...definition.rollbackValue.data]
        : definition.rollbackValue.data,
    } as RegistryValue,
  };
}

export function displayValue(value: RegistryValue): string {
  if (value.type === "Binary") {
    return value.data.map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  }
  if (value.type === "MultiString") {
    return value.data.join(" | ");
  }
  return String(value.data);
}

export function normalizeQWord(input: string): string | undefined {
  if (!/^\d+$/.test(input.trim())) return undefined;
  const canonical = input.trim().replace(/^0+(?=\d)/, "");
  return BigInt(canonical) <= 18_446_744_073_709_551_615n ? canonical : undefined;
}

export function parseBinary(input: string): number[] | undefined {
  const compact = input.trim().replace(/[\s,-]+/g, " ");
  if (compact === "") return [];
  const parts = compact.split(" ");
  if (parts.some((part) => !/^[0-9a-fA-F]{2}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}
