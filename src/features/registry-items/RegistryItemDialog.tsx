import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import {
  REGISTRY_TYPES,
  REGISTRY_VIEWS,
  type RegistryHive,
  type RegistryType,
  type RegistryValue,
} from "../../domain/registry/model";
import { normalizeRevertForDesiredState } from "../../domain/effectiveBehavior";
import type { DeploymentPackage, RegistryItem } from "../../domain/workspace/workspace";
import { englishUi } from "../../shared/localization/locale";
import { destructiveImpact } from "../../shared/ui/entryPresentation";
import type { RequestConfirm } from "../../shared/ui/confirm";
import type { ContextualHelpKey } from "../../shared/ui/contextualHelp";
import type { ItemField } from "../../domain/validation/workspaceValidation";
import { Dialog, HelpTip } from "../../shared/ui/Overlays";
import { ChevronGlyph, ItemListGlyph } from "../../shared/ui/icons";
import { blankRegistryValue, valueGuidance } from "./itemDraft";
import type { ItemDraftState } from "./itemDraftState";
import { RegistryPathField, RegistryValueInput } from "./itemFieldControls";
import { enterActionFor, useItemFieldFeedback } from "./itemFieldFeedback";
import {
  ADVANCED_FIELDS,
  commitPathText,
  isDraftDirty,
  readItemEditorState,
} from "./itemEditorState";

export type RegistryItemDialogMode = "edit" | "duplicate" | "details";

function FieldTitle({
  children,
  helpKey,
  htmlFor,
}: {
  children: ReactNode;
  helpKey?: ContextualHelpKey;
  htmlFor?: string;
}) {
  return (
    <span className="wb-field-title">
      {htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}
      {helpKey && <HelpTip helpKey={helpKey} />}
    </span>
  );
}

/**
 * Edits one item. In `edit` and `duplicate` mode it commits the item into its package; in `details` mode
 * it edits the draft of the inline form and hands the whole draft back, so the form keeps its raw text.
 */
export function RegistryItemDialog({
  initialState,
  deploymentPackage,
  requestConfirm,
  mode,
  focusField,
  onDirtyChange,
  onSave,
  onApplyDraft,
  onChangeRunContext,
  onCancel,
}: {
  initialState: ItemDraftState;
  deploymentPackage: DeploymentPackage;
  /** The app's one confirmation surface, so a destructive shape is saved on purpose. */
  requestConfirm: RequestConfirm;
  mode: RegistryItemDialogMode;
  focusField?: ItemField;
  onDirtyChange: (dirty: boolean) => void;
  /** Commits the item into its package; used by `edit` and `duplicate`. */
  onSave?: (item: RegistryItem) => void;
  /** Hands the edited draft back to the form; used by `details`. */
  onApplyDraft?: (state: ItemDraftState) => void;
  onChangeRunContext: (runContext: DeploymentPackage["deployment"]["runContext"]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialState.draft);
  const [pathText, setPathText] = useState(initialState.pathText);
  const [pathEdited, setPathEdited] = useState(initialState.pathEdited);
  const [pathHiveNote, setPathHiveNote] = useState<RegistryHive>();
  const [valueBinaryText, setValueBinaryText] = useState(initialState.valueBinaryText);
  const [rollbackBinaryText, setRollbackBinaryText] = useState(initialState.rollbackBinaryText);
  /** Opened from the form, the reader asked for depth, so the advanced region starts expanded. */
  const [advancedOpen, setAdvancedOpen] = useState(
    mode === "details" || (focusField !== undefined && ADVANCED_FIELDS.has(focusField)),
  );
  const original = useMemo(() => JSON.stringify(initialState.draft), [initialState]);
  const summaryRef = useRef<HTMLElement>(null);
  /** Set by the summary's own activation, so only a deliberate toggle may adjust the scroll position. */
  const userToggledDisclosure = useRef(false);
  /**
   * The draft rules live in `itemEditorState`, outside React, so that the dialog and the inline form in
   * the package detail share one implementation. This component wires that state to the form.
   */
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
  const {
    resolvedDraft,
    candidate,
    activeFields,
    isPresent,
    errors,
    valid,
    recursiveDelete,
    advancedSummaryText,
  } = editor;
  const showRevert = activeFields.revert;
  const systemHkcu = editor.systemHkcu;
  const api = useItemFieldFeedback(
    editor.issues,
    focusField === undefined ? { surface: "dialog" } : { focusField, surface: "dialog" },
  );
  const dirty = isDraftDirty({
    candidate,
    original,
    draft,
    valueBinaryText,
    originalValueBinaryText: initialState.valueBinaryText,
    rollbackBinaryText,
    originalRollbackBinaryText: initialState.rollbackBinaryText,
  });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const setItem = <K extends keyof RegistryItem>(key: K, value: RegistryItem[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setRegistry = <K extends keyof RegistryItem["registry"]>(
    key: K,
    value: RegistryItem["registry"][K],
  ) => setDraft((current) => ({ ...current, registry: { ...current.registry, [key]: value } }));
  const systemHkcuChoice = !resolvedDraft.userHive.userHiveTarget
    ? ""
    : resolvedDraft.userHive.userHiveTarget === "AllSignedInUsers"
      ? "signed-in"
      : resolvedDraft.userHive.includeDefaultUser
        ? "existing-default"
        : "existing";
  const selectSystemHkcuChoice = (choice: "signed-in" | "existing" | "existing-default") => {
    const userHive: RegistryItem["userHive"] =
      choice === "signed-in"
        ? { userHiveTarget: "AllSignedInUsers", includeDefaultUser: false }
        : choice === "existing"
          ? { userHiveTarget: "AllExistingProfiles", includeDefaultUser: false }
          : { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true };
    setDraft((current) => ({ ...current, userHive }));
    api.touch("userHiveTarget");
    if (choice === "existing-default") api.touch("includeDefaultUser");
  };
  /**
   * The SYSTEM and HKCU error has two resolutions with different scope. They appear with the error,
   * because a resolution that is one click away should not need a second screen.
   */
  const userHiveResolution = api.invalid("userHiveTarget");

  const updateDesiredState = (desiredState: RegistryItem["registry"]["desiredState"]) =>
    setDraft((current) => ({
      ...current,
      registry: {
        ...current.registry,
        desiredState,
        rollbackMode: normalizeRevertForDesiredState(
          current.registry.rollbackMode,
          desiredState,
          current.registry.deletionMode,
        ),
      },
    }));

  const updateDeletion = (deletionMode: RegistryItem["registry"]["deletionMode"]) =>
    setDraft((current) => ({
      ...current,
      registry: {
        ...current.registry,
        deletionMode,
        rollbackMode: normalizeRevertForDesiredState(
          current.registry.rollbackMode,
          current.registry.desiredState,
          deletionMode,
        ),
      },
    }));

  /**
   * Commits the raw path text: a recognised prefix moves the hive and is removed from the path, an
   * unsupported hive stays an error, and a relative path is kept as typed. Committing is what makes
   * the resolution idempotent, because afterwards the field is no longer considered edited.
   */
  const commitPath = () => {
    if (!pathEdited) return;
    const committed = commitPathText(draft, pathText);
    if (!committed.committed) return;
    setDraft(committed.draft);
    setPathText(committed.pathText);
    if (committed.hiveNote) setPathHiveNote(committed.hiveNote);
    setPathEdited(false);
  };

  const updateHive = (hive: RegistryItem["registry"]["hive"]) => {
    // A pending prefix is consumed first, so the manual choice is never overridden by typed text.
    commitPath();
    setDraft((current) => ({
      ...current,
      registry: { ...current.registry, hive },
      userHive: { includeDefaultUser: false },
    }));
    setPathHiveNote(undefined);
  };

  /** Both save paths run the same validation and the same destructive-change confirmation. */
  const runSave = async () => {
    api.attempt();
    if (!valid) return;
    const impact = destructiveImpact(candidate.registry, showRevert);
    if (
      impact &&
      !(await requestConfirm({
        title: "Save this Registry Item?",
        message: impact,
        confirmLabel: submitLabel,
        tone: "danger",
      }))
    )
      return;
    commitPath();
    onSave?.(candidate);
  };

  /** Details mode changes the draft only: nothing is committed, so incomplete fields do not block it. */
  const applyDetails = () =>
    onApplyDraft?.({ draft, pathText, pathEdited, valueBinaryText, rollbackBinaryText });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "details") applyDetails();
    else void runSave();
  };

  const title =
    mode === "details"
      ? "Registry Item details"
      : mode === "edit"
        ? "Edit Registry Item"
        : "Duplicate Registry Item";
  const submitLabel =
    mode === "details" ? "Apply details" : mode === "edit" ? "Save changes" : "Create copy";
  const saveMessage = valid
    ? mode === "details"
      ? "Ready to apply"
      : "Ready to save"
    : api.attempted || api.touchedCount > 0
      ? `Resolve ${errors.length} blocking ${errors.length === 1 ? "issue" : "issues"}.`
      : "Complete the required fields.";
  /**
   * The dialog opens the advanced region itself, and that must not move the dialog: React sets the
   * attribute, which fires a toggle that no reader asked for. Only the summary's own activation may
   * adjust the scroll position, and then only to keep that summary in sight.
   */
  const toggleAdvanced = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setAdvancedOpen(event.currentTarget.open);
    if (!userToggledDisclosure.current) return;
    userToggledDisclosure.current = false;
    const summary = summaryRef.current;
    if (summary === null) return;
    window.requestAnimationFrame(() => summary.scrollIntoView?.({ block: "nearest" }));
  };

  return (
    <Dialog
      title={title}
      eyebrow={`${deploymentPackage.name || "Deployment Package"} · Registry Item`}
      eyebrowGlyph={<ItemListGlyph />}
      size="large"
      initialFocus={focusField ? `[data-field="${focusField}"]` : '[data-field="keyPath"]'}
      onClose={onCancel}
      footer={
        <>
          <span
            className={`wb-dialog-status${valid ? " is-ready" : api.attempted ? " is-error" : ""}`}
            aria-live="polite"
          >
            {(valid || api.attempted) && <span className="wb-status-dot" />}
            {saveMessage}
          </span>
          <button type="button" className="wb-button wb-button--ghost" onClick={onCancel}>
            {mode === "edit" ? "Cancel changes" : "Cancel"}
          </button>
          <button
            type="submit"
            form="registry-item-form"
            className="wb-button wb-button--primary"
            aria-disabled={mode !== "details" && !valid}
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <form
        id="registry-item-form"
        className="wb-item-form"
        onSubmit={submit}
        onKeyDown={(event) => {
          const action = enterActionFor(event);
          if (action.kind === "ignore") return;
          if (action.kind === "cancel") {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          if (mode === "details") applyDetails();
          else void runSave();
        }}
        noValidate
      >
        <section className="wb-editor-section">
          <div className="wb-editor-section__heading">
            <div>
              <h3>Registry target</h3>
              <p>Hive, path, and value name.</p>
            </div>
          </div>
          <div className="wb-form-grid">
            <RegistryPathField
              hive={resolvedDraft.registry.hive}
              onHive={updateHive}
              pathText={pathText}
              onPathText={(text) => {
                setPathText(text);
                setPathEdited(true);
                setPathHiveNote(undefined);
              }}
              onPathBlur={commitPath}
              hiveNote={pathHiveNote}
              api={api}
            />
            {!recursiveDelete && (
              <label className="wb-field wb-field--wide">
                <span>Value name</span>
                <input
                  data-field="valueName"
                  aria-label="Value name"
                  aria-invalid={api.invalid("valueName")}
                  aria-describedby={api.describedBy("valueName")}
                  value={draft.registry.valueName}
                  {...api.interaction("valueName")}
                  onChange={(event) => setRegistry("valueName", event.target.value)}
                />
                <small>Leave blank to target the default value.</small>
                {api.feedback("valueName")}
              </label>
            )}
          </div>
        </section>

        {systemHkcu && (
          <section className="wb-editor-section">
            <div className="wb-editor-section__heading">
              <div>
                <h3>
                  User hive target
                  <HelpTip helpKey="userHiveTarget" />
                </h3>
                <p>SYSTEM target for this HKCU item.</p>
              </div>
            </div>
            <div>
              <fieldset
                className="wb-choice-cards wb-choice-cards--compact"
                data-field="userHiveTarget"
                // The validation names this group, so the group has to be able to take the focus.
                tabIndex={-1}
                aria-invalid={api.invalid("userHiveTarget")}
                aria-describedby={
                  api.describedBy("userHiveTarget") ?? api.describedBy("includeDefaultUser")
                }
                {...api.interaction("userHiveTarget")}
              >
                <legend className="wb-visually-hidden">User hive target</legend>
                {(
                  [
                    {
                      choice: "signed-in" as const,
                      title: "Currently signed-in users",
                      detail: "Interactive users signed in when the script runs.",
                    },
                    {
                      choice: "existing" as const,
                      title: "All existing user profiles",
                      detail: "Every applicable local profile, including unloaded hives.",
                    },
                    {
                      choice: "existing-default" as const,
                      title: "All existing profiles and Default User",
                      detail:
                        "Existing profiles plus the Default User template for future profiles.",
                    },
                  ] as const
                ).map((option) => (
                  <label key={option.choice} data-selected={systemHkcuChoice === option.choice}>
                    <input
                      type="radio"
                      name="registry-item-user-hive"
                      {...(option.choice === "existing-default"
                        ? { "data-field": "includeDefaultUser" }
                        : {})}
                      aria-label={option.title}
                      checked={systemHkcuChoice === option.choice}
                      onChange={() => selectSystemHkcuChoice(option.choice)}
                    />
                    <span>
                      <strong>{option.title}</strong>
                      <small>{option.detail}</small>
                    </span>
                  </label>
                ))}
                <div className="wb-choice-cards__note">
                  {api.feedback("userHiveTarget")}
                  {api.feedback("includeDefaultUser")}
                </div>
              </fieldset>
              {userHiveResolution ? (
                <div className="wb-field-actions">
                  <button
                    type="button"
                    className="wb-button wb-button--ghost"
                    onClick={() => selectSystemHkcuChoice("existing")}
                  >
                    Target all existing profiles
                  </button>
                  <button
                    type="button"
                    className="wb-button wb-button--ghost"
                    onClick={() => onChangeRunContext("LoggedOnUser")}
                  >
                    Run this package as logged-on user
                  </button>
                  <small>
                    Target all existing profiles changes this item only. Running this package as
                    logged-on user changes every item in the package, and its HKEY_LOCAL_MACHINE
                    items then run in the user&apos;s context.
                  </small>
                </div>
              ) : null}
            </div>
          </section>
        )}

        {isPresent && (
          <section className="wb-editor-section">
            <div className="wb-editor-section__heading">
              <div>
                <h3>Registry value</h3>
                <p>Type and raw value must match.</p>
              </div>
            </div>
            <div className="wb-form-grid">
              <div className="wb-field">
                <FieldTitle htmlFor="registry-item-value-type" helpKey="valueType">
                  {englishUi.registryItems.editor.valueType}
                </FieldTitle>
                <select
                  id="registry-item-value-type"
                  data-field="valueType"
                  aria-label="Registry value type"
                  value={draft.registry.value.type}
                  onChange={(event) => {
                    const type = event.target.value as RegistryType;
                    setRegistry("value", blankRegistryValue(type));
                    if (type === "Binary") setValueBinaryText("");
                  }}
                >
                  {REGISTRY_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </div>
              <label className="wb-field">
                <span>Registry value</span>
                <RegistryValueInput
                  value={draft.registry.value}
                  field="value"
                  rawText={valueBinaryText}
                  onChange={(next: RegistryValue) => setRegistry("value", next)}
                  onRawTextChange={setValueBinaryText}
                  ariaLabel="Registry value"
                  api={api}
                />
                <small>
                  {valueGuidance(draft.registry.value.type) ??
                    "Registry type and value must match exactly."}
                </small>
                {api.feedback("value")}
              </label>
            </div>
          </section>
        )}

        {!isPresent && (
          <section className="wb-editor-section">
            <div className="wb-editor-section__heading">
              <div>
                <h3>
                  Delete behavior
                  <HelpTip helpKey="deleteBehavior" />
                </h3>
                <p>Choose the scope removed by this item.</p>
              </div>
            </div>
            <div className="wb-field">
              <select
                id="registry-item-delete-behavior"
                aria-label="Delete behavior"
                value={draft.registry.deletionMode}
                onChange={(event) =>
                  updateDeletion(event.target.value as RegistryItem["registry"]["deletionMode"])
                }
              >
                <option value="Value">Delete value</option>
                <option value="KeyIfEmpty">Delete value, then empty key</option>
                <option value="KeyRecursive">Delete key recursively</option>
              </select>
              {api.feedback("keyPath")}
            </div>
          </section>
        )}

        {showRevert && (
          <section className="wb-editor-section">
            <div className="wb-editor-section__heading">
              <div>
                <h3>
                  Revert behavior
                  <HelpTip helpKey="rollback" />
                </h3>
                <p>Win32 App uninstall behavior.</p>
              </div>
            </div>
            <div className="wb-form-grid">
              <div className="wb-field wb-field--wide">
                <select
                  id="registry-item-revert-behavior"
                  data-field="rollbackMode"
                  aria-label="Revert behavior"
                  aria-invalid={api.invalid("rollbackMode")}
                  aria-describedby={api.describedBy("rollbackMode")}
                  value={draft.registry.rollbackMode}
                  {...api.interaction("rollbackMode")}
                  onChange={(event) =>
                    setRegistry(
                      "rollbackMode",
                      event.target.value as RegistryItem["registry"]["rollbackMode"],
                    )
                  }
                >
                  <option value="None">No revert action</option>
                  {isPresent && <option value="DeleteManagedValue">Delete managed value</option>}
                  {!recursiveDelete && (
                    <option value="SetDefinedRollbackValue">Set a defined value</option>
                  )}
                </select>
                {api.feedback("rollbackMode")}
              </div>
              {activeFields.revertValue && (
                <>
                  <label className="wb-field">
                    <span>Revert value type</span>
                    <select
                      aria-label="Revert value type"
                      value={draft.registry.rollbackValue.type}
                      onChange={(event) => {
                        const type = event.target.value as RegistryType;
                        setRegistry("rollbackValue", blankRegistryValue(type));
                        if (type === "Binary") setRollbackBinaryText("");
                      }}
                    >
                      {REGISTRY_TYPES.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <label className="wb-field">
                    <span>Revert value</span>
                    <RegistryValueInput
                      value={draft.registry.rollbackValue}
                      field="rollbackValue"
                      rawText={rollbackBinaryText}
                      onChange={(next: RegistryValue) => setRegistry("rollbackValue", next)}
                      onRawTextChange={setRollbackBinaryText}
                      ariaLabel="Revert value"
                      api={api}
                    />
                    {api.feedback("rollbackValue")}
                  </label>
                </>
              )}
            </div>
          </section>
        )}

        <details className="wb-disclosure" open={advancedOpen} onToggle={toggleAdvanced}>
          <summary
            ref={summaryRef}
            onClick={() => {
              userToggledDisclosure.current = true;
            }}
          >
            <span>
              <strong>{englishUi.registryItems.editor.advanced}</strong>
              <small>{advancedSummaryText}</small>
            </span>
            <b aria-hidden="true">
              <ChevronGlyph />
            </b>
          </summary>
          <div className="wb-disclosure__content">
            <div className="wb-disclosure__lead">
              <small>
                Rarely changed settings. The line above names everything that is not at its default.
              </small>
              <HelpTip helpKey="advancedItemSettings" />
            </div>
            <div className="wb-form-grid">
              <div className="wb-field">
                <FieldTitle htmlFor="registry-item-desired-state" helpKey="desiredState">
                  {englishUi.registryItems.editor.desiredState}
                </FieldTitle>
                <select
                  id="registry-item-desired-state"
                  data-field="desiredState"
                  aria-label="Desired state"
                  value={draft.registry.desiredState}
                  {...api.interaction("desiredState")}
                  onChange={(event) =>
                    updateDesiredState(
                      event.target.value as RegistryItem["registry"]["desiredState"],
                    )
                  }
                >
                  <option value="Present">Present</option>
                  <option value="Absent">Absent</option>
                </select>
              </div>
              <div className="wb-field">
                <FieldTitle htmlFor="registry-item-view" helpKey="registryView">
                  {englishUi.registryItems.editor.registryView}
                </FieldTitle>
                <select
                  id="registry-item-view"
                  data-field="view"
                  aria-label="Registry view"
                  aria-invalid={api.invalid("view")}
                  aria-describedby={api.describedBy("view")}
                  value={draft.registry.view}
                  {...api.interaction("view")}
                  onChange={(event) =>
                    setRegistry("view", event.target.value as RegistryItem["registry"]["view"])
                  }
                >
                  {REGISTRY_VIEWS.map((view) => (
                    <option key={view}>{view}</option>
                  ))}
                </select>
                {draft.registry.view === "Auto" && (
                  <small>Auto follows the selected PowerShell host architecture.</small>
                )}
                {api.feedback("view")}
              </div>
              <div className="wb-field">
                <span>Enabled</span>
                <label className="wb-control-switch">
                  <input
                    type="checkbox"
                    data-field="enabled"
                    aria-label="Enabled"
                    checked={draft.enabled}
                    onChange={(event) => setItem("enabled", event.target.checked)}
                    {...api.interaction("enabled")}
                  />
                  Include in generated scripts
                </label>
              </div>
              <label className="wb-field wb-field--wide">
                <span>Description</span>
                <textarea
                  rows={3}
                  aria-label="Description"
                  value={draft.description}
                  onChange={(event) => setItem("description", event.target.value)}
                />
              </label>
            </div>
          </div>
        </details>
      </form>
    </Dialog>
  );
}
