import type { RegistryDefinition } from "../../domain/registry/model";
import { effectiveDesiredMutationForRegistry } from "../../domain/effectiveBehavior";

export function destructiveImpact(
  registry: RegistryDefinition,
  includeRevertBehavior: boolean,
): string | undefined {
  if (effectiveDesiredMutationForRegistry(registry).kind === "DeleteKeyRecursive") {
    return `Saving this entry authorizes recursive deletion of ${registry.hive}\\${registry.keyPath} and every descendant key and value.`;
  }
  if (includeRevertBehavior && registry.rollbackMode === "DeleteManagedValue") {
    return `Revert behavior will delete ${registry.valueName || "the default value"} from ${registry.hive}\\${registry.keyPath}.`;
  }
  return undefined;
}
