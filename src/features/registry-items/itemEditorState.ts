import type { RegistryHive } from "../../domain/registry/model";
import { readHivePathInput } from "../../domain/registry/path";
import {
  activeRegistryItemFields,
  effectiveDesiredMutation,
  type ActiveRegistryItemFields,
  type EffectiveMutation,
} from "../../domain/effectiveBehavior";
import type { DeploymentPackage, RegistryItem } from "../../domain/workspace/workspace";
import {
  issueForField,
  validatePackageConflicts,
  validateRegistryItem,
  type ItemField,
  type ItemValidationIssue,
  type ValidationField,
} from "../../domain/validation/workspaceValidation";
import { registryItemCandidate } from "./itemDraft";

/**
 * The rules of the item editor live here, outside React, so that the dialog and the inline form in the
 * package detail can share one implementation. Everything in this module is pure: it takes the draft state
 * and returns the derived state.
 */

/** Settings that live behind the Advanced disclosure, so validation navigation can open it. */
export const ADVANCED_FIELDS: ReadonlySet<ValidationField> = new Set<ValidationField>([
  "enabled",
  "desiredState",
  "view",
]);

const SUMMARY_TEXT_LIMIT = 48;

function truncateSummary(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > SUMMARY_TEXT_LIMIT
    ? `${single.slice(0, SUMMARY_TEXT_LIMIT - 1)}…`
    : single;
}

/** The delete scope in words, exactly as the collapsed summary states it. */
function deleteScopeSummary(deletionMode: RegistryItem["registry"]["deletionMode"]): string {
  if (deletionMode === "KeyRecursive") return "deletes the key and everything below it";
  if (deletionMode === "KeyIfEmpty") return "deletes the value, then the empty key";
  return "deletes the value";
}

/**
 * The path field holds raw text so that a hive prefix can be recognised without mangling what the reader is
 * typing. The resolved draft is what validation and saving see; it only differs while the reader has an
 * uncommitted edit in the path field.
 */
function resolveDraftPath(
  draft: RegistryItem,
  pathText: string,
  pathEdited: boolean,
): { draft: RegistryItem; unsupportedHive?: string } {
  if (!pathEdited) return { draft };
  const parsed = readHivePathInput(pathText);
  if (parsed.kind === "hive") {
    return {
      draft: {
        ...draft,
        registry: { ...draft.registry, hive: parsed.hive, keyPath: parsed.keyPath },
        ...(parsed.hive === draft.registry.hive ? {} : { userHive: { includeDefaultUser: false } }),
      },
    };
  }
  if (parsed.kind === "unsupported-hive") {
    return {
      draft: { ...draft, registry: { ...draft.registry, keyPath: pathText } },
      unsupportedHive: parsed.prefix,
    };
  }
  return { draft: { ...draft, registry: { ...draft.registry, keyPath: parsed.keyPath } } };
}

interface CommittedPath {
  draft: RegistryItem;
  pathText: string;
  hiveNote?: RegistryHive;
  /** False when the text names a hive this product does not support, which stays an error. */
  committed: boolean;
}

/**
 * Commits raw path text: a recognised prefix moves the hive and is removed from the path, an unsupported
 * hive stays an error, and a relative path is kept as typed. Committing is what makes the resolution
 * idempotent, because afterwards the field is no longer considered edited.
 */
export function commitPathText(draft: RegistryItem, pathText: string): CommittedPath {
  const parsed = readHivePathInput(pathText);
  if (parsed.kind === "unsupported-hive") return { draft, pathText, committed: false };
  if (parsed.kind === "hive") {
    return {
      draft: {
        ...draft,
        registry: { ...draft.registry, hive: parsed.hive, keyPath: parsed.keyPath },
        ...(parsed.hive === draft.registry.hive ? {} : { userHive: { includeDefaultUser: false } }),
      },
      pathText: parsed.keyPath,
      hiveNote: parsed.hive,
      committed: true,
    };
  }
  return {
    draft: { ...draft, registry: { ...draft.registry, keyPath: parsed.keyPath } },
    pathText: parsed.keyPath,
    committed: true,
  };
}

interface ItemEditorState {
  /** What validation and saving see, including a path edit that is not committed yet. */
  resolvedDraft: RegistryItem;
  unsupportedHive?: string;
  candidate: RegistryItem;
  parsedValueBinary?: number[];
  parsedRollbackBinary?: number[];
  activeFields: ActiveRegistryItemFields;
  desired: EffectiveMutation;
  isPresent: boolean;
  issues: ItemValidationIssue[];
  errors: ItemValidationIssue[];
  valid: boolean;
  recursiveDelete: boolean;
  systemHkcu: boolean;
  /** The line the collapsed Advanced region shows. */
  advancedSummaryText: string;
}

export function readItemEditorState({
  draft,
  pathText,
  pathEdited,
  valueBinaryText,
  rollbackBinaryText,
  deploymentPackage,
}: {
  draft: RegistryItem;
  pathText: string;
  pathEdited: boolean;
  valueBinaryText: string;
  rollbackBinaryText: string;
  deploymentPackage: DeploymentPackage;
}): ItemEditorState {
  const path = resolveDraftPath(draft, pathText, pathEdited);
  const resolvedDraft = path.draft;
  const {
    item: candidate,
    parsedValueBinary,
    parsedRollbackBinary,
  } = registryItemCandidate(resolvedDraft, valueBinaryText, rollbackBinaryText);
  const activeFields = activeRegistryItemFields(resolvedDraft, deploymentPackage);
  const desired = effectiveDesiredMutation(resolvedDraft);
  const isPresent = desired.kind === "SetValue";
  const showRevert = activeFields.revert;
  const invalidValueBinary =
    isPresent && draft.registry.value.type === "Binary" && parsedValueBinary === undefined;
  const invalidRollbackBinary =
    showRevert &&
    draft.registry.rollbackMode === "SetDefinedRollbackValue" &&
    draft.registry.rollbackValue.type === "Binary" &&
    parsedRollbackBinary === undefined;
  /**
   * The package the commit would produce: the candidate in the place the item would take. Its own rules
   * and the conflicts it would cause beside the existing items both decide whether the commit may run.
   */
  const hypotheticalPackage: DeploymentPackage = {
    ...deploymentPackage,
    items: [
      ...deploymentPackage.items.filter((existing) => existing.id !== candidate.id),
      candidate,
    ],
  };
  const issues: ItemValidationIssue[] = [
    ...validateRegistryItem(candidate, hypotheticalPackage),
    ...validatePackageConflicts(hypotheticalPackage).filter(
      (issue) => issue.itemId === candidate.id,
    ),
    ...(invalidValueBinary
      ? [
          {
            code: "invalid-binary",
            severity: "Error" as const,
            message: "Binary values must contain two-digit hexadecimal bytes.",
            itemId: draft.id,
            packageId: deploymentPackage.id,
            scope: "item" as const,
            field: "value" as const,
          },
        ]
      : []),
    ...(invalidRollbackBinary
      ? [
          {
            code: "invalid-rollback-binary",
            severity: "Error" as const,
            message: "Revert Binary values must contain two-digit hexadecimal bytes.",
            itemId: draft.id,
            packageId: deploymentPackage.id,
            scope: "item" as const,
            field: "rollbackValue" as const,
          },
        ]
      : []),
    ...(path.unsupportedHive
      ? [
          {
            code: "unsupported-hive-prefix",
            severity: "Error" as const,
            message: `${path.unsupportedHive} is not supported. Use HKLM or HKCU.`,
            itemId: draft.id,
            packageId: deploymentPackage.id,
            scope: "item" as const,
            field: "keyPath" as const,
          },
        ]
      : []),
  ];
  const errors = issues.filter((issue) => issue.severity === "Error");
  return {
    resolvedDraft,
    ...(path.unsupportedHive ? { unsupportedHive: path.unsupportedHive } : {}),
    candidate,
    ...(parsedValueBinary !== undefined ? { parsedValueBinary } : {}),
    ...(parsedRollbackBinary !== undefined ? { parsedRollbackBinary } : {}),
    activeFields,
    desired,
    isPresent,
    issues,
    errors,
    valid: errors.length === 0,
    recursiveDelete: desired.kind === "DeleteKeyRecursive",
    systemHkcu: activeFields.userHive,
    advancedSummaryText: advancedSummaryEntries({
      draft,
      isPresent,
      deploymentPackage,
    }).join(" · "),
  };
}

/**
 * The collapsed state has to be safe to ignore. It therefore always names the desired state, and it adds
 * every setting that is not at its default and every default whose effective effect differs from what its
 * label suggests.
 */
function advancedSummaryEntries({
  draft,
  isPresent,
  deploymentPackage,
}: {
  draft: RegistryItem;
  isPresent: boolean;
  deploymentPackage: DeploymentPackage;
}): string[] {
  const activeFields = activeRegistryItemFields(draft, deploymentPackage);
  const entries: string[] = [
    isPresent
      ? "Present"
      : `Desired state Absent · ${deleteScopeSummary(draft.registry.deletionMode)}`,
  ];
  if (draft.registry.view !== "Auto") {
    entries.push(`View ${draft.registry.view}`);
  } else if (!deploymentPackage.deployment.runIn64BitPowerShell) {
    entries.push("View Auto · resolves to Registry32 in this package");
  }
  if (!draft.enabled) entries.push("Excluded from generated scripts");
  if (draft.description !== "") {
    // The raw value is what the generated documentation carries, so the summary follows it.
    const collapsed = truncateSummary(draft.description);
    entries.push(`Description: ${collapsed === "" ? "whitespace only" : collapsed}`);
  }
  // A revert action and a profile target change what the package does on uninstall, so the collapsed
  // line states them instead of leaving them behind the disclosure.
  if (activeFields.revert && draft.registry.rollbackMode !== "None") {
    entries.push(
      draft.registry.rollbackMode === "DeleteManagedValue"
        ? "Revert: delete the managed value"
        : `Revert: set a defined value (${draft.registry.rollbackValue.type})`,
    );
  }
  if (activeFields.userHive) {
    entries.push(
      draft.userHive.userHiveTarget === undefined
        ? "User hive target required"
        : draft.userHive.userHiveTarget === "AllSignedInUsers"
          ? "Profile target: currently signed-in users"
          : draft.userHive.includeDefaultUser
            ? "Profile target: all existing profiles and Default User"
            : "Profile target: all existing profiles",
    );
  }
  return entries;
}

interface FieldFeedback {
  /** True once the reader interacted, saved, or arrived from a validation target. */
  showError: boolean;
  error?: ItemValidationIssue;
  warning?: ItemValidationIssue;
}

/**
 * Red validation is delayed until interaction or Save, except for the field a validation navigation named.
 */
export function readFieldFeedback(
  issues: readonly ItemValidationIssue[],
  field: ItemField,
  {
    attempted,
    touched,
    focusField,
  }: { attempted: boolean; touched: ReadonlySet<ItemField>; focusField?: ItemField },
): FieldFeedback {
  const error = issueForField(issues, field, "Error");
  const warning = issueForField(issues, field, "Warning");
  return {
    showError: attempted || touched.has(field) || focusField === field,
    ...(error ? { error } : {}),
    ...(warning ? { warning } : {}),
  };
}

/**
 * The two authoring surfaces are mounted at the same time, so their feedback elements need their own ids:
 * a description that resolved to the hidden surface would be announced from the wrong place.
 */
export type EditorSurface = "dialog" | "composer";

export function feedbackElementId(field: ItemField, surface: EditorSurface = "dialog"): string {
  return surface === "composer"
    ? `registry-item-composer-${field}-feedback`
    : `registry-item-${field}-feedback`;
}

/** A warning still describes the field; the generic Auto-view note is carried by the summary instead. */
export function describedByFeedbackId(
  field: ItemField,
  feedback: FieldFeedback,
  surface: EditorSurface = "dialog",
): string | undefined {
  const hasError = feedback.showError && feedback.error !== undefined;
  const hasWarning = feedback.warning !== undefined && feedback.warning.code !== "auto-view";
  return hasError || hasWarning ? feedbackElementId(field, surface) : undefined;
}

/**
 * What an Enter keypress means inside an item form. Both authoring surfaces share this rule: a textarea
 * keeps its line breaks, a toggle keeps its own activation, and an IME composition or a held key never
 * commits. A composition keeps its default handling because cancelling it would break the input method.
 */
export type EnterCommitAction = { kind: "ignore" } | { kind: "cancel" } | { kind: "commit" };

export interface EnterKeyEvent {
  key: string;
  isComposing: boolean;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface EnterKeyTarget {
  tagName: string;
  type?: string | undefined;
}

export function enterCommitAction(
  event: EnterKeyEvent,
  target: EnterKeyTarget | null,
): EnterCommitAction {
  if (event.key !== "Enter") return { kind: "ignore" };
  if (event.isComposing) return { kind: "ignore" };
  if (event.repeat) return { kind: "cancel" };
  if (target === null) return { kind: "ignore" };
  if (target.tagName === "TEXTAREA") return { kind: "ignore" };
  if (target.tagName === "INPUT" && (target.type === "checkbox" || target.type === "radio")) {
    // A toggle is operated with Space; Enter must not commit from one.
    return { kind: "cancel" };
  }
  if (target.tagName !== "INPUT" && target.tagName !== "SELECT") return { kind: "ignore" };
  return { kind: "commit" };
}

export function isDraftDirty({
  candidate,
  original,
  draft,
  valueBinaryText,
  originalValueBinaryText,
  rollbackBinaryText,
  originalRollbackBinaryText,
}: {
  candidate: RegistryItem;
  original: string;
  draft: RegistryItem;
  valueBinaryText: string;
  originalValueBinaryText: string;
  rollbackBinaryText: string;
  originalRollbackBinaryText: string;
}): boolean {
  return (
    JSON.stringify(candidate) !== original ||
    (draft.registry.value.type === "Binary" && valueBinaryText !== originalValueBinaryText) ||
    (draft.registry.rollbackValue.type === "Binary" &&
      rollbackBinaryText !== originalRollbackBinaryText)
  );
}
