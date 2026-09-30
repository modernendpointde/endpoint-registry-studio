import { useEffect, useMemo, useState, type FormEvent, type SyntheticEvent } from "react";

import type { DeploymentPackage } from "../../domain/workspace/workspace";
import { DEPLOYMENT_TARGET_DEFINITIONS } from "../../domain/workspace/deployment";
import {
  validateDeploymentPackage,
  type PackageField,
} from "../../domain/validation/workspaceValidation";
import { Dialog } from "../../shared/ui/Overlays";
import { ChevronGlyph, PackageGlyph } from "../../shared/ui/icons";
import { packageMethod, runContext } from "../registry-items/presentation";

export type PackageDialogMode = "edit" | "duplicate";

export function PackageDialog({
  initialPackage,
  mode,
  focusField,
  onDirtyChange,
  onSave,
  onCancel,
}: {
  initialPackage: DeploymentPackage;
  mode: PackageDialogMode;
  focusField?: PackageField;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (pkg: DeploymentPackage) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialPackage);
  const [attempted, setAttempted] = useState(false);
  /**
   * The deployment settings stay behind one disclosure, and it opens itself when validation names one
   * of them, because a control the reader cannot see cannot be corrected.
   */
  const [deploymentOpen, setDeploymentOpen] = useState(
    focusField === "method" || focusField === "runContext",
  );
  const deploymentSummary = `${packageMethod(draft)} · ${runContext(draft)} · ${
    draft.deployment.runIn64BitPowerShell ? "64-bit" : "32-bit"
  }`;
  const toggleDeployment = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setDeploymentOpen(event.currentTarget.open);
  };
  const original = useMemo(() => JSON.stringify(initialPackage), [initialPackage]);
  const dirty = JSON.stringify(draft) !== original;
  const valid = draft.name.trim().length > 0;

  /**
   * The dialog derives its own field messages from the draft, so a message appears with the state that
   * caused it and disappears again once the draft no longer violates it.
   */
  const issues = useMemo(() => validateDeploymentPackage(draft), [draft]);
  const fieldIssue = (field: PackageField) =>
    issues.find((issue) => issue.field === field && issue.severity === "Error") ??
    issues.find((issue) => issue.field === field && issue.severity === "Warning");
  const showFieldIssue = (field: PackageField) => attempted || focusField === field;
  const feedback = (field: PackageField) => {
    const issue = fieldIssue(field);
    if (!issue || !showFieldIssue(field)) return null;
    return (
      <small
        id={`package-${field}-feedback`}
        className={issue.severity === "Error" ? "wb-field__error" : "wb-field__warning"}
      >
        {issue.message}
      </small>
    );
  };
  const invalid = (field: PackageField) =>
    showFieldIssue(field) && fieldIssue(field)?.severity === "Error";
  const describedBy = (field: PackageField) =>
    showFieldIssue(field) && fieldIssue(field) ? `package-${field}-feedback` : undefined;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const setDeployment = <K extends keyof DeploymentPackage["deployment"]>(
    key: K,
    value: DeploymentPackage["deployment"][K],
  ) => setDraft((current) => ({ ...current, deployment: { ...current.deployment, [key]: value } }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;
    onSave({ ...draft, name: draft.name.trim() });
  };

  const title = mode === "edit" ? "Edit Deployment Package" : "Duplicate Deployment Package";

  return (
    <Dialog
      title={title}
      eyebrow="Package settings"
      eyebrowGlyph={<PackageGlyph />}
      size="small"
      initialFocus={focusField ? `[data-field="${focusField}"]` : '[name="package-name"]'}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="wb-button wb-button--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" form="package-dialog-form" className="wb-button wb-button--primary">
            {mode === "edit" ? "Save changes" : "Create copy"}
          </button>
        </>
      }
    >
      <form id="package-dialog-form" className="wb-form" onSubmit={submit} noValidate>
        <label className="wb-field">
          <span>Package name</span>
          <input
            name="package-name"
            data-field="name"
            aria-label="Package name"
            aria-invalid={invalid("name")}
            aria-describedby={describedBy("name")}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
          {feedback("name")}
        </label>

        <details className="wb-disclosure" open={deploymentOpen} onToggle={toggleDeployment}>
          <summary>
            <span>
              <strong>Deployment</strong>
              <small>{deploymentSummary}</small>
            </span>
            <b aria-hidden="true">
              <ChevronGlyph />
            </b>
          </summary>
          <div className="wb-disclosure__content">
            <div className="wb-form-grid">
              <label className="wb-field">
                <span>Script delivery method</span>
                <select
                  data-field="method"
                  aria-label="Script delivery method"
                  aria-invalid={invalid("method")}
                  aria-describedby={describedBy("method")}
                  value={draft.deployment.method}
                  onChange={(event) =>
                    setDeployment(
                      "method",
                      event.target.value as DeploymentPackage["deployment"]["method"],
                    )
                  }
                >
                  {DEPLOYMENT_TARGET_DEFINITIONS.map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.label}
                    </option>
                  ))}
                </select>
                {feedback("method")}
              </label>
              <label className="wb-field">
                <span>Run script as</span>
                <select
                  data-field="runContext"
                  aria-label="Run script as"
                  aria-invalid={invalid("runContext")}
                  aria-describedby={describedBy("runContext")}
                  value={draft.deployment.runContext}
                  onChange={(event) =>
                    setDeployment(
                      "runContext",
                      event.target.value as DeploymentPackage["deployment"]["runContext"],
                    )
                  }
                >
                  <option value="System">SYSTEM</option>
                  <option value="LoggedOnUser">Logged-on user</option>
                </select>
                {feedback("runContext")}
              </label>
            </div>

            <div className="wb-option-list">
              <label>
                <input
                  type="checkbox"
                  checked={draft.deployment.runIn64BitPowerShell}
                  onChange={(event) => setDeployment("runIn64BitPowerShell", event.target.checked)}
                />
                <span>
                  <strong>Use 64-bit PowerShell</strong>
                  <small>Controls how Auto resolves the Registry view.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.deployment.enforceSignatureCheck}
                  onChange={(event) => setDeployment("enforceSignatureCheck", event.target.checked)}
                />
                <span>
                  <strong>Require signed scripts</strong>
                  <small>
                    Win32 command files use AllSigned. Other methods note the requirement in the
                    README.
                  </small>
                </span>
              </label>
            </div>
          </div>
        </details>
      </form>
    </Dialog>
  );
}
