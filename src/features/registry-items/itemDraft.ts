import { parseBinary, type RegistryType, type RegistryValue } from "../../domain/registry/model";
import type { RegistryItem } from "../../domain/workspace/workspace";

export function blankRegistryValue(type: RegistryType): RegistryValue {
  if (type === "MultiString" || type === "Binary") return { type, data: [] };
  if (type === "DWord") return { type, data: 0 };
  if (type === "QWord") return { type, data: "0" };
  return { type, data: "" };
}

export function binaryText(value: RegistryValue): string {
  return value.type === "Binary"
    ? value.data.map((byte) => byte.toString(16).padStart(2, "0")).join(" ")
    : "";
}

export function valueGuidance(type: RegistryType): string {
  if (type === "ExpandString")
    return "Stored raw text is compared exactly; variables are not expanded.";
  if (type === "MultiString") return "One value per line. Order is significant.";
  if (type === "Binary") return "Enter hexadecimal bytes separated by spaces.";
  return "Registry type and value must match exactly.";
}

export function registryItemCandidate(
  draft: RegistryItem,
  valueBinaryText: string,
  rollbackBinaryText: string,
): {
  item: RegistryItem;
  parsedValueBinary: number[] | undefined;
  parsedRollbackBinary: number[] | undefined;
} {
  const parsedValueBinary =
    draft.registry.value.type === "Binary" ? parseBinary(valueBinaryText) : undefined;
  const parsedRollbackBinary =
    draft.registry.rollbackValue.type === "Binary" ? parseBinary(rollbackBinaryText) : undefined;
  let registry = draft.registry;
  if (draft.registry.value.type === "Binary" && parsedValueBinary !== undefined)
    registry = { ...registry, value: { type: "Binary", data: parsedValueBinary } };
  if (draft.registry.rollbackValue.type === "Binary" && parsedRollbackBinary !== undefined)
    registry = {
      ...registry,
      rollbackValue: { type: "Binary", data: parsedRollbackBinary },
    };
  return {
    item: registry === draft.registry ? draft : { ...draft, registry },
    parsedValueBinary,
    parsedRollbackBinary,
  };
}
