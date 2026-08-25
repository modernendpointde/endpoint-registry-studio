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
  HIVES,
  REGISTRY_TYPES,
  REGISTRY_VIEWS,
  type RegistryType,
  type RegistryValue,
} from "../../domain/registry/model";
import {
  activeRegistryItemFields,
  effectiveDesiredMutation,
  normalizeRevertForDesiredState,
} from "../../domain/effectiveBehavior";
import type { DeploymentPackage, RegistryItem } from "../../domain/workspace/workspace";
import { englishUi } from "../../shared/localization/locale";
import { destructiveImpact } from "../../shared/ui/entryPresentation";
import type { ContextualHelpKey } from "../../shared/ui/contextualHelp";
import {
  issueForField,
  validateRegistryItem,
  type ItemField,
  type ItemValidationIssue,
} from "../../domain/validation/workspaceValidation";
import { Dialog, HelpTip } from "../../shared/ui/Overlays";
import { binaryText, blankRegistryValue, registryItemCandidate, valueGuidance } from "./itemDraft";

export type RegistryItemDialogMode = "create" | "edit" | "duplicate";

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

function fieldErrorMessage(issue: ItemValidationIssue): string {
  if (issue.code === "invalid-key-path") {
    return "Enter a non-empty relative Registry path without empty segments.";
  }
  return issue.message;
}

export function RegistryItemDialog({
  initialItem,
  deploymentPackage,
  mode,
  focusField,
  onDirtyChange,
  onSave,
  onCancel,
}: {
  initialItem: RegistryItem;
  deploymentPackage: DeploymentPackage;
  mode: RegistryItemDialogMode;
  focusField?: ItemField;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (item: RegistryItem) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialItem);
  const [valueBinaryText, setValueBinaryText] = useState(() =>
    binaryText(initialItem.registry.value),
  );
  const [rollbackBinaryText, setRollbackBinaryText] = useState(() =>
    binaryText(initialItem.registry.rollbackValue),
  );
  const [touched, setTouched] = useState<Set<ItemField>>(new Set());
  const engaged = useRef<Set<ItemField>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const original = useMemo(() => JSON.stringify(initialItem), [initialItem]);
  const originalValueBinaryText = useMemo(
    () => binaryText(initialItem.registry.value),
    [initialItem],
  );
  const originalRollbackBinaryText = useMemo(
    () => binaryText(initialItem.registry.rollbackValue),
    [initialItem],
  );
  const {
    item: candidate,
    parsedValueBinary,
    parsedRollbackBinary,
  } = useMemo(
    () => registryItemCandidate(draft, valueBinaryText, rollbackBinaryText),
    [draft, rollbackBinaryText, valueBinaryText],
  );
  const activeFields = activeRegistryItemFields(draft, deploymentPackage);
  const desired = effectiveDesiredMutation(draft);
  const isPresent = desired.kind === "SetValue";
  const showRevert = activeFields.revert;
  const invalidValueBinary =
    isPresent && draft.registry.value.type === "Binary" && parsedValueBinary === undefined;
  const invalidRollbackBinary =
    showRevert &&
    draft.registry.rollbackMode === "SetDefinedRollbackValue" &&
    draft.registry.rollbackValue.type === "Binary" &&
    parsedRollbackBinary === undefined;
  const issues: ItemValidationIssue[] = [
    ...validateRegistryItem(candidate, { ...deploymentPackage, items: [candidate] }),
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
  ];
  const dirty =
    JSON.stringify(candidate) !== original ||
    (draft.registry.value.type === "Binary" && valueBinaryText !== originalValueBinaryText) ||
    (draft.registry.rollbackValue.type === "Binary" &&
      rollbackBinaryText !== originalRollbackBinaryText);
  const errors = issues.filter((issue) => issue.severity === "Error");
  const valid = errors.length === 0;
  const recursiveDelete = desired.kind === "DeleteKeyRecursive";
  const systemHkcu = activeFields.userHive;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const setItem = <K extends keyof RegistryItem>(key: K, value: RegistryItem[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setRegistry = <K extends keyof RegistryItem["registry"]>(
    key: K,
    value: RegistryItem["registry"][K],
  ) => setDraft((current) => ({ ...current, registry: { ...current.registry, [key]: value } }));
  const systemHkcuChoice = !draft.userHive.userHiveTarget
    ? ""
    : draft.userHive.userHiveTarget === "AllSignedInUsers"
      ? "signed-in"
      : draft.userHive.includeDefaultUser
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
    setTouched((current) => {
      const next = new Set(current);
      next.add("userHiveTarget");
      if (choice === "existing-default") next.add("includeDefaultUser");
      return next;
    });
  };

  const showError = (field: ItemField) => attempted || touched.has(field);
  const interaction = (field: ItemField) => ({
    onPointerDown: () => engaged.current.add(field),
    onKeyDown: () => engaged.current.add(field),
    onBlur: () => {
      if (!engaged.current.has(field)) return;
      setTouched((current) => new Set(current).add(field));
    },
  });
  const feedback = (field: ItemField) => {
    const error = issueForField(issues, field, "Error");
    const warning = issueForField(issues, field, "Warning");
    if (error && showError(field)) {
      return (
        <small id={`registry-item-${field}-feedback`} className="wb-field__error">
          {fieldErrorMessage(error)}
        </small>
      );
    }
    if (warning?.code !== "auto-view") {
      return (
        <small id={`registry-item-${field}-feedback`} className="wb-field__warning">
          {warning?.message}
        </small>
      );
    }
    return null;
  };
  const invalid = (field: ItemField) =>
    Boolean(showError(field) && issueForField(issues, field, "Error"));
  const describedBy = (field: ItemField) => {
    const warning = issueForField(issues, field, "Warning");
    return (showError(field) && issueForField(issues, field, "Error")) ||
      (warning && warning.code !== "auto-view")
      ? `registry-item-${field}-feedback`
      : undefined;
  };

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

  const updateHive = (hive: RegistryItem["registry"]["hive"]) =>
    setDraft((current) => ({
      ...current,
      registry: { ...current.registry, hive },
      userHive: { includeDefaultUser: false },
    }));

  const valueInput = (rollback = false) => {
    const value = rollback ? draft.registry.rollbackValue : draft.registry.value;
    const field: ItemField = rollback ? "rollbackValue" : "value";
    const update = (next: RegistryValue) => setRegistry(rollback ? "rollbackValue" : "value", next);
    const common = {
      "aria-label": rollback ? "Revert value" : "Registry value",
      "aria-invalid": invalid(field),
      "aria-describedby": describedBy(field),
      ...interaction(field),
    };
    if (value.type === "MultiString") {
      return (
        <textarea
          {...common}
          rows={3}
          value={value.data.join("\n")}
          onChange={(event) =>
            update({ type: "MultiString", data: event.target.value.split("\n") })
          }
        />
      );
    }
    if (value.type === "Binary") {
      const raw = rollback ? rollbackBinaryText : valueBinaryText;
      return (
        <textarea
          {...common}
          rows={3}
          placeholder="00 ff 10"
          value={raw}
          onChange={(event) =>
            rollback
              ? setRollbackBinaryText(event.target.value)
              : setValueBinaryText(event.target.value)
          }
        />
      );
    }
    if (value.type === "DWord") {
      return (
        <input
          {...common}
          type="number"
          min="0"
          max="4294967295"
          value={Number.isNaN(value.data) ? "" : value.data}
          onChange={(event) =>
            update({
              type: "DWord",
              data: event.target.value === "" ? Number.NaN : Number(event.target.value),
            })
          }
        />
      );
    }
    return (
      <input
        {...common}
        inputMode={value.type === "QWord" ? "numeric" : undefined}
        value={value.data}
        onChange={(event) => {
          if (value.type === "QWord") update({ type: "QWord", data: event.target.value });
          else if (value.type === "ExpandString")
            update({ type: "ExpandString", data: event.target.value });
          else update({ type: "String", data: event.target.value });
        }}
      />
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;
    const impact = destructiveImpact(candidate.registry, showRevert);
    if (impact && !window.confirm(`${impact}\n\nSave this Registry Item?`)) return;
    onSave(candidate);
  };

  const title =
    mode === "edit"
      ? "Edit Registry Item"
      : mode === "duplicate"
        ? "Duplicate Registry Item"
        : "Add Registry Item";
  const submitLabel =
    mode === "edit" ? "Save changes" : mode === "duplicate" ? "Create copy" : "Add item";
  const saveMessage = valid
    ? "Ready to save"
    : attempted || touched.size
      ? `Resolve ${errors.length} blocking ${errors.length === 1 ? "issue" : "issues"}.`
      : "Complete the required fields.";
  const keepDisclosureVisible = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    const details = event.currentTarget;
    window.requestAnimationFrame(() =>
      details.scrollIntoView?.({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      }),
    );
  };

  return (
    <Dialog
      title={title}
      eyebrow={`${deploymentPackage.name || "Deployment Package"} · Registry Item`}
      size="large"
      initialFocus={focusField ? `[data-field="${focusField}"]` : '[data-field="keyPath"]'}
      onClose={onCancel}
      footer={
        <>
          <span
            className={`wb-dialog-status${valid ? " is-ready" : attempted ? " is-error" : ""}`}
            aria-live="polite"
          >
            {saveMessage}
          </span>
          <button type="button" className="wb-button wb-button--ghost" onClick={onCancel}>
            {mode === "edit" ? "Cancel changes" : "Cancel"}
          </button>
          <button
            type="submit"
            form="registry-item-form"
            className="wb-button wb-button--primary"
            aria-disabled={!valid}
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
          if (
            event.key === "Enter" &&
            !(event.target instanceof HTMLTextAreaElement) &&
            !(event.target instanceof HTMLButtonElement)
          )
            event.preventDefault();
        }}
        noValidate
      >
        <section className="wb-editor-section">
          <div className="wb-editor-section__heading">
            <span>01</span>
            <div>
              <h3>Behavior</h3>
              <p>Desired state and whether the item is emitted.</p>
            </div>
          </div>
          <div className="wb-form-grid">
            <div className="wb-field">
              <span>Enabled</span>
              <label className="wb-control-switch">
                <input
                  type="checkbox"
                  aria-label="Enabled"
                  checked={draft.enabled}
                  onChange={(event) => setItem("enabled", event.target.checked)}
                />
                Include in generated scripts
              </label>
            </div>
            <div className="wb-field">
              <FieldTitle htmlFor="registry-item-desired-state" helpKey="desiredState">
                {englishUi.registryItems.editor.desiredState}
              </FieldTitle>
              <select
                id="registry-item-desired-state"
                aria-label="Desired state"
                value={draft.registry.desiredState}
                onChange={(event) =>
                  updateDesiredState(event.target.value as RegistryItem["registry"]["desiredState"])
                }
              >
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
              </select>
            </div>
          </div>
        </section>

        <section className="wb-editor-section">
          <div className="wb-editor-section__heading">
            <span>02</span>
            <div>
              <h3>Registry target</h3>
              <p>Hive, path, and value name.</p>
            </div>
          </div>
          <div className="wb-form-grid">
            <label className="wb-field">
              <span>Registry hive</span>
              <select
                data-field="hive"
                aria-label="Registry hive"
                aria-invalid={invalid("hive")}
                aria-describedby={describedBy("hive")}
                value={draft.registry.hive}
                {...interaction("hive")}
                onChange={(event) =>
                  updateHive(event.target.value as RegistryItem["registry"]["hive"])
                }
              >
                {HIVES.map((hive) => (
                  <option key={hive}>{hive}</option>
                ))}
              </select>
              {feedback("hive")}
            </label>
            <div className="wb-field">
              <FieldTitle htmlFor="registry-item-view" helpKey="registryView">
                {englishUi.registryItems.editor.registryView}
              </FieldTitle>
              <select
                id="registry-item-view"
                data-field="view"
                aria-label="Registry view"
                aria-invalid={invalid("view")}
                aria-describedby={describedBy("view")}
                value={draft.registry.view}
                {...interaction("view")}
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
              {feedback("view")}
            </div>
            <label className="wb-field wb-field--wide">
              <span>Registry path</span>
              <input
                data-field="keyPath"
                aria-label="Registry path"
                aria-invalid={invalid("keyPath")}
                aria-describedby={describedBy("keyPath")}
                placeholder={"Software\\Vendor\\Product"}
                value={draft.registry.keyPath}
                {...interaction("keyPath")}
                onChange={(event) => setRegistry("keyPath", event.target.value)}
              />
              <small>
                Enter a Registry path without the hive, for example Software\Vendor\Product.
              </small>
              {feedback("keyPath")}
            </label>
            {!recursiveDelete && (
              <label className="wb-field wb-field--wide">
                <span>Value name</span>
                <input
                  data-field="valueName"
                  aria-label="Value name"
                  aria-invalid={invalid("valueName")}
                  aria-describedby={describedBy("valueName")}
                  value={draft.registry.valueName}
                  {...interaction("valueName")}
                  onChange={(event) => setRegistry("valueName", event.target.value)}
                />
                <small>Leave blank to target the default value.</small>
                {feedback("valueName")}
              </label>
            )}
          </div>
        </section>

        {systemHkcu && (
          <section className="wb-editor-section">
            <div className="wb-editor-section__heading">
              <span>03</span>
              <div>
                <h3>
                  User hive target
                  <HelpTip helpKey="userHiveTarget" />
                </h3>
                <p>SYSTEM target for this HKCU item.</p>
              </div>
            </div>
            <fieldset
              className="wb-choice-cards wb-choice-cards--compact"
              data-field="userHiveTarget"
              aria-invalid={invalid("userHiveTarget")}
              aria-describedby={describedBy("userHiveTarget") ?? describedBy("includeDefaultUser")}
              {...interaction("userHiveTarget")}
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
                    detail: "Existing profiles plus the Default User template for future profiles.",
                  },
                ] as const
              ).map((option) => (
                <label key={option.choice} data-selected={systemHkcuChoice === option.choice}>
                  <input
                    type="radio"
                    name="registry-item-user-hive"
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
                {feedback("userHiveTarget")}
                {systemHkcuChoice === "existing-default" ? feedback("includeDefaultUser") : null}
              </div>
            </fieldset>
          </section>
        )}

        {isPresent && (
          <section className="wb-editor-section">
            <div className="wb-editor-section__heading">
              <span>{systemHkcu ? "04" : "03"}</span>
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
                {valueInput()}
                <small>{valueGuidance(draft.registry.value.type)}</small>
                {feedback("value")}
              </label>
            </div>
          </section>
        )}

        {!isPresent && (
          <details className="wb-disclosure" onToggle={keepDisclosureVisible}>
            <summary>
              <span>
                <span className="wb-field-title">
                  <strong>Delete behavior</strong>
                  <HelpTip helpKey="deleteBehavior" />
                </span>
                <small>Choose the scope removed by this item.</small>
              </span>
              <b aria-hidden="true">＋</b>
            </summary>
            <div className="wb-disclosure__content">
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
                {feedback("keyPath")}
              </div>
            </div>
          </details>
        )}

        {showRevert && (
          <details className="wb-disclosure" onToggle={keepDisclosureVisible}>
            <summary>
              <span>
                <span className="wb-field-title">
                  <strong>Revert behavior</strong>
                  <HelpTip helpKey="rollback" />
                </span>
                <small>Optional Win32 uninstall behavior.</small>
              </span>
              <b aria-hidden="true">＋</b>
            </summary>
            <div className="wb-disclosure__content wb-form-grid">
              <div className="wb-field wb-field--wide">
                <select
                  id="registry-item-revert-behavior"
                  data-field="rollbackMode"
                  aria-label="Revert behavior"
                  aria-invalid={invalid("rollbackMode")}
                  aria-describedby={describedBy("rollbackMode")}
                  value={draft.registry.rollbackMode}
                  {...interaction("rollbackMode")}
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
                {feedback("rollbackMode")}
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
                    {valueInput(true)}
                    {feedback("rollbackValue")}
                  </label>
                </>
              )}
            </div>
          </details>
        )}

        <details className="wb-disclosure" onToggle={keepDisclosureVisible}>
          <summary>
            <span>
              <strong>Description</strong>
              <small>Optional documentation for operators.</small>
            </span>
            <b aria-hidden="true">＋</b>
          </summary>
          <div className="wb-disclosure__content">
            <label className="wb-field">
              <textarea
                rows={3}
                aria-label="Description"
                value={draft.description}
                onChange={(event) => setItem("description", event.target.value)}
              />
            </label>
          </div>
        </details>
      </form>
    </Dialog>
  );
}
