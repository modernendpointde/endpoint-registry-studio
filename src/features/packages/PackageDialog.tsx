import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { DeploymentPackage } from "../../domain/workspace/workspace";
import { Dialog } from "../../shared/ui/Overlays";

export type PackageDialogMode = "create" | "edit" | "duplicate";

export function PackageDialog({
  initialPackage,
  mode,
  onDirtyChange,
  onSave,
  onCancel,
}: {
  initialPackage: DeploymentPackage;
  mode: PackageDialogMode;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (pkg: DeploymentPackage) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialPackage);
  const [attempted, setAttempted] = useState(false);
  const original = useMemo(() => JSON.stringify(initialPackage), [initialPackage]);
  const dirty = JSON.stringify(draft) !== original;
  const valid = draft.name.trim().length > 0;

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

  const title =
    mode === "edit"
      ? "Edit Deployment Package"
      : mode === "duplicate"
        ? "Duplicate Deployment Package"
        : "Add Deployment Package";

  return (
    <Dialog
      title={title}
      eyebrow="Package settings"
      size="small"
      initialFocus='[name="package-name"]'
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="wb-button wb-button--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" form="package-dialog-form" className="wb-button wb-button--primary">
            {mode === "edit"
              ? "Save changes"
              : mode === "duplicate"
                ? "Create copy"
                : "Add package"}
          </button>
        </>
      }
    >
      <form id="package-dialog-form" className="wb-form" onSubmit={submit} noValidate>
        <label className="wb-field">
          <span>Package name</span>
          <input
            name="package-name"
            aria-label="Package name"
            aria-invalid={attempted && !valid}
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
          {attempted && !valid && (
            <small className="wb-field__error">Package name is required.</small>
          )}
        </label>

        <div className="wb-form-grid">
          <label className="wb-field">
            <span>Deployment method</span>
            <select
              aria-label="Deployment method"
              value={draft.deployment.method}
              onChange={(event) =>
                setDeployment(
                  "method",
                  event.target.value as DeploymentPackage["deployment"]["method"],
                )
              }
            >
              <option value="Remediation">Intune Remediation</option>
              <option value="PlatformScript">Platform Script</option>
              <option value="Win32App">Win32 App</option>
            </select>
          </label>
          <label className="wb-field">
            <span>Run script as</span>
            <select
              aria-label="Run script as"
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
              <small>Generated scripts must be signed before deployment.</small>
            </span>
          </label>
        </div>
      </form>
    </Dialog>
  );
}
