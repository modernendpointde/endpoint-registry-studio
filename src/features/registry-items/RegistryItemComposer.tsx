import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  REGISTRY_TYPES,
  type RegistryHive,
  type RegistryType,
  type RegistryValue,
} from "../../domain/registry/model";
import {
  isItemField,
  type ItemField,
  type ValidationField,
} from "../../domain/validation/workspaceValidation";
import { destructiveImpact } from "../../shared/ui/entryPresentation";
import type { RequestConfirm } from "../../shared/ui/confirm";
import type { DeploymentPackage, RegistryItem } from "../../domain/workspace/workspace";
import { blankRegistryValue, valueGuidance } from "./itemDraft";
import type { ItemDraftState } from "./itemDraftState";
import { RegistryPathField, RegistryValueInput } from "./itemFieldControls";
import { enterActionFor, useItemFieldFeedback } from "./itemFieldFeedback";
import { commitPathText, readItemEditorState } from "./itemEditorState";

/**
 * The order a blocking field is reported in: the four primary fields of the form first, then the settings
 * that live behind `Details…`, which the commit opens on the named field.
 */
const PRIMARY_FIELDS: readonly ItemField[] = ["hive", "keyPath", "valueName", "value"];
const DETAIL_FIELDS: readonly ItemField[] = [
  "userHiveTarget",
  "includeDefaultUser",
  "desiredState",
  "view",
  "rollbackMode",
  "rollbackValue",
  "enabled",
];

function firstBlockingField(
  errors: readonly { field?: ValidationField | undefined }[],
): ItemField | undefined {
  const named = [...PRIMARY_FIELDS, ...DETAIL_FIELDS].find((field) =>
    errors.some((issue) => issue.field === field),
  );
  if (named) return named;
  const first = errors[0]?.field;
  return isItemField(first) ? first : undefined;
}

/**
 * The permanent Registry Item form of a package detail. It writes the item in the surface itself, so the
 * common case costs no overlay; `Details…` opens the dialog on the same draft for everything else.
 */
export function RegistryItemComposer({
  deploymentPackage,
  requestConfirm,
  state,
  draftDirty,
  onStateChange,
  onCommit,
  onOpenDetails,
  onDiscard,
}: {
  deploymentPackage: DeploymentPackage;
  /** The app's one confirmation surface, so a destructive shape is accepted on purpose. */
  requestConfirm: RequestConfirm;
  state: ItemDraftState;
  draftDirty: boolean;
  onStateChange: (next: ItemDraftState) => void;
  onCommit: (item: RegistryItem) => void;
  onOpenDetails: (focusField?: ItemField) => void;
  onDiscard: () => void;
}): ReactNode {
  const { draft, pathText, pathEdited, valueBinaryText, rollbackBinaryText } = state;
  const formRef = useRef<HTMLFormElement>(null);
  const valueNameRef = useRef<HTMLInputElement>(null);
  const [pathHiveNote, setPathHiveNote] = useState<RegistryHive>();
  /** Bumped by a commit, so the focus moves to the value name after the new draft is in place. */
  const [focusRequest, setFocusRequest] = useState(0);
  const editor = useMemo(
    () =>
      readItemEditorState({
        draft,
        pathText,
        pathEdited,
        valueBinaryText,
        rollbackBinaryText,
        deploymentPackage,
      }),
    [deploymentPackage, draft, pathEdited, pathText, rollbackBinaryText, valueBinaryText],
  );
  const api = useItemFieldFeedback(editor.issues, { surface: "composer" });
  const { isPresent, recursiveDelete, candidate, advancedSummaryText } = editor;

  useEffect(() => {
    if (focusRequest === 0) return;
    valueNameRef.current?.focus();
  }, [focusRequest]);

  const focusPrimary = (field: ItemField | undefined) => {
    if (!field) return;
    formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
  };

  /** Committing raw path text is what makes the resolution idempotent: afterwards it is not edited. */
  const commitPath = () => {
    if (!pathEdited) return;
    const committed = commitPathText(draft, pathText);
    if (!committed.committed) return;
    onStateChange({
      ...state,
      draft: committed.draft,
      pathText: committed.pathText,
      pathEdited: false,
    });
    if (committed.hiveNote) setPathHiveNote(committed.hiveNote);
  };

  const updateHive = (hive: RegistryHive) => {
    // A pending prefix is consumed first, so the manual choice is never overridden by typed text.
    const committed = pathEdited ? commitPathText(draft, pathText) : undefined;
    const base = committed?.committed ? committed.draft : draft;
    onStateChange({
      ...state,
      draft: {
        ...base,
        registry: { ...base.registry, hive },
        userHive: { includeDefaultUser: false },
      },
      ...(committed?.committed ? { pathText: committed.pathText } : {}),
      // An unsupported prefix is not taken over, so the field stays edited and keeps its error; the
      // manual hive choice must never make the form show a path that the commit would not save.
      ...(committed === undefined || committed.committed ? { pathEdited: false } : {}),
    });
    setPathHiveNote(undefined);
  };

  const updateValue = (next: RegistryValue) =>
    onStateChange({ ...state, draft: { ...draft, registry: { ...draft.registry, value: next } } });

  const updateValueType = (type: RegistryType) =>
    onStateChange({
      ...state,
      draft: { ...draft, registry: { ...draft.registry, value: blankRegistryValue(type) } },
      ...(type === "Binary" ? { valueBinaryText: "" } : {}),
    });

  const runCommit = async () => {
    api.attempt();
    if (!editor.valid) {
      // A blocking primary field is corrected where the reader is; a detail field opens the dialog on it.
      const blocking = firstBlockingField(editor.errors);
      if (blocking && DETAIL_FIELDS.includes(blocking)) onOpenDetails(blocking);
      else focusPrimary(blocking);
      return;
    }
    const impact = destructiveImpact(candidate.registry, editor.activeFields.revert);
    if (
      impact &&
      !(await requestConfirm({
        title: "Add this Registry Item?",
        message: impact,
        confirmLabel: "Add item",
        tone: "danger",
      }))
    )
      return;
    onCommit(candidate);
    setFocusRequest((current) => current + 1);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runCommit();
  };
  const missingProfileTarget = editor.systemHkcu && !draft.userHive.userHiveTarget;

  return (
    <form
      id="registry-item-composer"
      ref={formRef}
      className="wb-composer"
      aria-labelledby="registry-item-composer-heading"
      onSubmit={submit}
      onKeyDown={(event) => {
        const action = enterActionFor(event);
        if (action.kind === "ignore") return;
        if (action.kind === "cancel") {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        void runCommit();
      }}
      noValidate
    >
      <div className="wb-composer__heading">
        <h3 id="registry-item-composer-heading">Registry Item</h3>
        <p>
          {draft.registry.desiredState === "Present"
            ? "Write the value this package deploys."
            : "Write the value or key this package removes."}
        </p>
      </div>
      <div className="wb-composer__grid">
        <RegistryPathField
          hive={editor.resolvedDraft.registry.hive}
          onHive={updateHive}
          pathText={pathText}
          onPathText={(text) => {
            onStateChange({ ...state, pathText: text, pathEdited: true });
            setPathHiveNote(undefined);
          }}
          onPathBlur={commitPath}
          hiveNote={pathHiveNote}
          api={api}
          hintPlacement="title"
          hint="A leading HKLM or HKCU moves the hive into the selector."
          keyPathId="registry-item-composer-path"
          className="wb-field"
        />
        {!recursiveDelete && (
          <div className="wb-field">
            <span className="wb-field-title">
              <label htmlFor="registry-item-composer-value-name">Value name</label>
              <small>Leave blank to target the default value.</small>
            </span>
            <input
              id="registry-item-composer-value-name"
              ref={valueNameRef}
              data-field="valueName"
              aria-label="Value name"
              aria-invalid={api.invalid("valueName")}
              aria-describedby={api.describedBy("valueName")}
              value={draft.registry.valueName}
              {...api.interaction("valueName")}
              onChange={(event) =>
                onStateChange({
                  ...state,
                  draft: {
                    ...draft,
                    registry: { ...draft.registry, valueName: event.target.value },
                  },
                })
              }
            />
            {api.feedback("valueName")}
          </div>
        )}
        {isPresent && (
          <>
            <div className="wb-field">
              <span className="wb-field-title">
                <label htmlFor="registry-item-composer-value-type">Registry value type</label>
              </span>
              <select
                id="registry-item-composer-value-type"
                data-field="valueType"
                aria-label="Registry value type"
                value={draft.registry.value.type}
                onChange={(event) => updateValueType(event.target.value as RegistryType)}
              >
                {REGISTRY_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="wb-field">
              <span className="wb-field-title">
                <label htmlFor="registry-item-composer-value">Registry value</label>
              </span>
              <RegistryValueInput
                value={draft.registry.value}
                field="value"
                rawText={valueBinaryText}
                onChange={updateValue}
                onRawTextChange={(text) => onStateChange({ ...state, valueBinaryText: text })}
                ariaLabel="Registry value"
                controlId="registry-item-composer-value"
                api={api}
              />
              {valueGuidance(draft.registry.value.type) === undefined ? null : (
                <small>{valueGuidance(draft.registry.value.type)}</small>
              )}
              {api.feedback("value")}
            </div>
          </>
        )}
      </div>
      <div className="wb-composer__actions">
        <button
          type="submit"
          className="wb-button wb-button--primary"
          aria-disabled={!editor.valid}
        >
          Add item
        </button>
        <button
          type="button"
          className="wb-button wb-button--ghost"
          onClick={() => onOpenDetails()}
        >
          Details…
        </button>
        {draftDirty && (
          <button type="button" className="wb-button wb-button--quiet" onClick={onDiscard}>
            Discard draft
          </button>
        )}
        {/* Red is delayed like it is on the fields: the line only warns once a commit was attempted. */}
        <p className="wb-composer__summary" data-invalid={api.attempted && !editor.valid}>
          <span>{advancedSummaryText}</span>
          {missingProfileTarget && (
            <button
              type="button"
              className="wb-link-button"
              onClick={() => onOpenDetails("userHiveTarget")}
            >
              Set the profile target…
            </button>
          )}
        </p>
      </div>
    </form>
  );
}
