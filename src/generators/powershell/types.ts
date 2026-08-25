import type { RegistryMutationKind } from "../../domain/effectiveBehavior";
import type { UserHiveTarget } from "../../domain/workspace/workspace";

export type ScriptKind =
  "Detect" | "Remediate" | "Apply" | "DryRun" | "Install" | "Uninstall" | "Win32Detect";

export interface RenderContext {
  usesUtf8Decoder: boolean;
}

export interface ScriptFeatures {
  profileTargeting: boolean;
  profileTargets: ReadonlySet<UserHiveTarget>;
  includeDefaultUser: boolean;
  exactSequence: boolean;
  actions: ReadonlySet<RegistryMutationKind>;
}
