import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  validateAdministrativeTemplate,
  createAdministrativeTemplate,
  createAuthoredPolicy,
  type AdministrativeTemplate,
  type AdministrativeTemplatePolicy,
  type AdmxTemplateIssue,
} from "../../domain/admx";
import type { RegistryValue } from "../../domain/registry/model";
import type { RegistryWorkspace } from "../../domain/workspace/workspace";
import {
  policySource,
  administrativeTemplateCandidates,
  administrativeTemplatePersistenceIssue,
  createAdministrativeTemplateDraft,
  removeAdministrativeTemplate,
  replacePolicySnapshot,
  saveAdministrativeTemplate,
  type PolicySource,
} from "../../application/administrativeTemplateOperations";
import { administrativeTemplateBuild } from "../../application/administrativeTemplateBuildService";
import {
  registryOverlapsForTemplate,
  type RegistryOverlap,
} from "../../domain/validation/registryOverlap";

type View =
  | { kind: "list" }
  | { kind: "pick"; selected: Set<string> }
  | { kind: "edit"; template: AdministrativeTemplate; replacingId?: string }
  | { kind: "preview"; template: AdministrativeTemplate };

function registryTarget(policy: AdministrativeTemplatePolicy): string {
  return `${policy.snapshot.hive}\\${policy.snapshot.keyPath}\\${policy.snapshot.valueName}`;
}

function valueText(value: RegistryValue): string {
  return value.type === "DWord" ? String(value.data) : String(value.data);
}

function behaviorText(
  behavior:
    | AdministrativeTemplatePolicy["enabledBehavior"]
    | AdministrativeTemplatePolicy["disabledBehavior"]
    | AdministrativeTemplatePolicy["notConfiguredBehavior"],
): string {
  switch (behavior.kind) {
    case "WritePresentValue":
      return "Writes the configured value";
    case "DeleteValue":
      return "Deletes the value";
    case "WriteFixedValue":
      return `Writes ${valueText(behavior.value)}`;
    case "LeaveExisting":
      return "Keeps the existing value (not representable in ADMX)";
    default:
      return "Not chosen";
  }
}

function PolicySummary({ policy }: { policy: AdministrativeTemplatePolicy }) {
  return (
    <li className="wb-admx-summary__item">
      <div className="wb-admx-summary__head">
        <strong>{policy.displayName || policy.snapshot.valueName || "Untitled policy"}</strong>
        <span className="wb-admx-summary__class">{policy.policyClass}</span>
      </div>
      <code>{registryTarget(policy)}</code>
      <small>
        {policy.snapshot.value.type} ·{" "}
        {policy.valueMode === "ProfileInput"
          ? "Administrator input"
          : policy.valueMode === "Fixed"
            ? "Fixed value"
            : "Value mode not chosen"}
      </small>
      <small>
        Enabled: {behaviorText(policy.enabledBehavior)} · Disabled:{" "}
        {behaviorText(policy.disabledBehavior)} · Not Configured:{" "}
        {behaviorText(policy.notConfiguredBehavior)}
      </small>
    </li>
  );
}

function OverlapNotice({ overlaps }: { overlaps: readonly RegistryOverlap[] }) {
  if (overlaps.length === 0) return null;
  return (
    <section className="wb-admx-overlaps">
      <h3>Also affected by Deployment Packages</h3>
      <p>
        Detected in this Workspace. An assigned profile and a script can reach the same Registry
        value, and the result on the client depends on what is assigned and when it runs. This is
        not a verified Intune conflict.
      </p>
      <ul>
        {overlaps.map((overlap) => (
          <li
            key={[overlap.kind, overlap.policyId, overlap.packageId, overlap.itemLabel].join("|")}
          >
            {overlap.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PolicyEditor({
  policy,
  issues,
  source,
  onChange,
  onDraftValidityChange,
  onReplaceSnapshot,
  onOpenSource,
}: {
  policy: AdministrativeTemplatePolicy;
  issues: readonly AdmxTemplateIssue[];
  source: PolicySource;
  onChange: (policy: AdministrativeTemplatePolicy) => void;
  onDraftValidityChange: (policyId: string, valid: boolean) => void;
  onReplaceSnapshot: () => void;
  onOpenSource: (packageId: string) => void;
}) {
  const policyIssues = issues.filter((issue) => issue.policyId === policy.id);
  const authored = policy.registryItemId === undefined;
  const set = <K extends keyof AdministrativeTemplatePolicy>(
    key: K,
    value: AdministrativeTemplatePolicy[K],
  ) => onChange({ ...policy, [key]: value });
  const disabledValue =
    policy.disabledBehavior.kind === "WriteFixedValue"
      ? valueText(policy.disabledBehavior.value)
      : valueText(policy.snapshot.value);
  const [disabledValueDraft, setDisabledValueDraft] = useState(disabledValue);
  useEffect(() => setDisabledValueDraft(disabledValue), [disabledValue]);
  const authoredValueText =
    policy.snapshot.value.type === "DWord" ? String(policy.snapshot.value.data) : "";
  const [authoredValueDraft, setAuthoredValueDraft] = useState(authoredValueText);
  useEffect(() => setAuthoredValueDraft(authoredValueText), [authoredValueText]);
  const invalidAuthoredValue =
    authored &&
    policy.snapshot.value.type === "DWord" &&
    (authoredValueDraft === "" ||
      !Number.isInteger(Number(authoredValueDraft)) ||
      Number(authoredValueDraft) < 0 ||
      Number(authoredValueDraft) > 4_294_967_295);
  const invalidDisabledDword =
    policy.disabledBehavior.kind === "WriteFixedValue" &&
    policy.snapshot.value.type === "DWord" &&
    (disabledValueDraft === "" ||
      !Number.isInteger(Number(disabledValueDraft)) ||
      Number(disabledValueDraft) < 0 ||
      Number(disabledValueDraft) > 4_294_967_295);
  useEffect(
    () => onDraftValidityChange(policy.id, !invalidDisabledDword && !invalidAuthoredValue),
    [invalidAuthoredValue, invalidDisabledDword, onDraftValidityChange, policy.id],
  );

  return (
    <fieldset className="wb-admx-policy">
      <legend>{policy.snapshot.valueName}</legend>
      <div className="wb-admx-policy__source">
        <span>{policy.policyClass}</span>
        <code title={registryTarget(policy)}>{registryTarget(policy)}</code>
        <code>{policy.snapshot.value.type}</code>
      </div>
      {authored && (
        <div className="wb-form-grid">
          <label className="wb-field">
            <span>Registry hive</span>
            <select
              aria-label={`Registry hive for ${policy.policyId || "this policy"}`}
              value={policy.snapshot.hive}
              onChange={(event) => {
                const hive = event.target.value as AdministrativeTemplatePolicy["snapshot"]["hive"];
                onChange({
                  ...policy,
                  policyClass: hive === "HKEY_LOCAL_MACHINE" ? "Machine" : "User",
                  snapshot: { ...policy.snapshot, hive },
                });
              }}
            >
              <option value="HKEY_LOCAL_MACHINE">HKEY_LOCAL_MACHINE</option>
              <option value="HKEY_CURRENT_USER">HKEY_CURRENT_USER</option>
            </select>
          </label>
          <label className="wb-field wb-field--wide">
            <span>Registry path</span>
            <input
              aria-label={`Registry path for ${policy.policyId || "this policy"}`}
              value={policy.snapshot.keyPath}
              placeholder="Software\Policies\Northgate\Widget"
              onChange={(event) =>
                onChange({
                  ...policy,
                  snapshot: { ...policy.snapshot, keyPath: event.target.value },
                })
              }
            />
          </label>
          <label className="wb-field">
            <span>Value name</span>
            <input
              aria-label={`Value name for ${policy.policyId || "this policy"}`}
              value={policy.snapshot.valueName}
              onChange={(event) =>
                onChange({
                  ...policy,
                  snapshot: { ...policy.snapshot, valueName: event.target.value },
                })
              }
            />
          </label>
          <label className="wb-field">
            <span>Registry value type</span>
            <select
              aria-label={`Registry value type for ${policy.policyId || "this policy"}`}
              value={policy.snapshot.value.type}
              onChange={(event) => {
                const type = event.target.value;
                onChange({
                  ...policy,
                  snapshot: {
                    ...policy.snapshot,
                    // ADMX can express text and DWORD inputs; everything else stays unavailable.
                    value:
                      type === "DWord"
                        ? { type: "DWord", data: 0 }
                        : type === "ExpandString"
                          ? { type: "ExpandString", data: "" }
                          : { type: "String", data: "" },
                  },
                });
              }}
            >
              <option value="String">String</option>
              <option value="ExpandString">ExpandString</option>
              <option value="DWord">DWORD</option>
            </select>
          </label>
          <label className="wb-field">
            <span>Registry value</span>
            {policy.snapshot.value.type === "DWord" ? (
              <>
                <input
                  type="number"
                  min={0}
                  max={4_294_967_295}
                  aria-label={`Registry value for ${policy.policyId || "this policy"}`}
                  value={authoredValueDraft}
                  onChange={(event) => {
                    const text = event.target.value;
                    setAuthoredValueDraft(text);
                    const parsed = Number(text);
                    if (
                      text === "" ||
                      !Number.isInteger(parsed) ||
                      parsed < 0 ||
                      parsed > 4_294_967_295
                    )
                      return;
                    onChange({
                      ...policy,
                      snapshot: { ...policy.snapshot, value: { type: "DWord", data: parsed } },
                    });
                  }}
                />
                {invalidAuthoredValue && (
                  <small className="wb-field__error">Enter an integer from 0 to 4294967295.</small>
                )}
              </>
            ) : policy.snapshot.value.type === "String" ||
              policy.snapshot.value.type === "ExpandString" ? (
              <input
                aria-label={`Registry value for ${policy.policyId || "this policy"}`}
                value={policy.snapshot.value.data}
                onChange={(event) => {
                  const current = policy.snapshot.value;
                  if (current.type !== "String" && current.type !== "ExpandString") return;
                  onChange({
                    ...policy,
                    snapshot: {
                      ...policy.snapshot,
                      value: { type: current.type, data: event.target.value },
                    },
                  });
                }}
              />
            ) : null}
          </label>
        </div>
      )}
      <div className="wb-admx-policy__provenance" data-status={source.status}>
        {source.status === "authored" ? (
          <span>
            This policy defines its own Registry target. No Deployment Package is involved, and
            nothing outside this template can change it.
          </span>
        ) : source.status === "unavailable" ? (
          <span>
            The source Registry Item is no longer in this Workspace. This policy keeps its snapshot
            and stays valid.
          </span>
        ) : (
          <>
            <span>
              Source: {source.packageName} · {source.itemValueName || "Default value"}
            </span>
            <button
              className="wb-button wb-button--quiet"
              onClick={() => source.packageId && onOpenSource(source.packageId)}
            >
              Open source package
            </button>
            <span className="wb-admx-policy__match">
              {source.status === "matches"
                ? "Source matches the snapshot"
                : "Source differs from the snapshot"}
            </span>
            {source.status === "differs" && (
              <button className="wb-button wb-button--ghost" onClick={onReplaceSnapshot}>
                Use current source
              </button>
            )}
          </>
        )}
      </div>
      <div className="wb-form-grid">
        <label className="wb-field">
          <span>Policy identifier</span>
          <input
            value={policy.policyId}
            maxLength={128}
            onChange={(event) => set("policyId", event.target.value)}
            placeholder="EnableFeature"
          />
        </label>
        <label className="wb-field">
          <span>Category</span>
          <input
            value={policy.category}
            maxLength={256}
            onChange={(event) => set("category", event.target.value)}
            placeholder="Northgate App"
          />
        </label>
        <label className="wb-field wb-field--wide">
          <span>Display name</span>
          <input
            value={policy.displayName}
            maxLength={10_000}
            onChange={(event) => set("displayName", event.target.value)}
          />
        </label>
        <label className="wb-field wb-field--wide">
          <span>Explanation</span>
          <textarea
            rows={3}
            value={policy.explainText}
            maxLength={10_000}
            onChange={(event) => set("explainText", event.target.value)}
          />
        </label>
        <label className="wb-field">
          <span>Value mode</span>
          <select
            aria-label={`Value mode for ${policy.snapshot.valueName}`}
            value={policy.valueMode}
            onChange={(event) =>
              set("valueMode", event.target.value as AdministrativeTemplatePolicy["valueMode"])
            }
          >
            <option value="Unspecified">Choose explicitly</option>
            <option value="Fixed">Fixed value</option>
            <option value="ProfileInput">Administrator input</option>
          </select>
        </label>
        <label className="wb-field">
          <span>Enabled</span>
          <select
            aria-label={`Enabled behavior for ${policy.snapshot.valueName}`}
            value={policy.enabledBehavior.kind}
            onChange={(event) =>
              set("enabledBehavior", {
                kind: event.target.value as "Unspecified" | "WritePresentValue",
              })
            }
          >
            <option value="Unspecified">Choose explicitly</option>
            <option value="WritePresentValue">Write configured value</option>
          </select>
        </label>
        <label className="wb-field">
          <span>Disabled</span>
          <select
            aria-label={`Disabled behavior for ${policy.snapshot.valueName}`}
            value={policy.disabledBehavior.kind}
            onChange={(event) => {
              const kind = event.target.value;
              set(
                "disabledBehavior",
                kind === "WriteFixedValue"
                  ? { kind, value: policy.snapshot.value }
                  : { kind: kind as "Unspecified" | "DeleteValue" },
              );
            }}
          >
            <option value="Unspecified">Choose explicitly</option>
            <option value="DeleteValue">Delete value</option>
            <option value="WriteFixedValue">Write fixed value</option>
          </select>
        </label>
        <label className="wb-field">
          <span>Not Configured</span>
          <select
            aria-label={`Not Configured behavior for ${policy.snapshot.valueName}`}
            value={policy.notConfiguredBehavior.kind}
            onChange={(event) =>
              set("notConfiguredBehavior", {
                kind: event.target.value as "Unspecified" | "DeleteValue" | "LeaveExisting",
              })
            }
          >
            <option value="Unspecified">Choose explicitly</option>
            <option value="DeleteValue">Delete value</option>
            <option value="LeaveExisting" disabled>
              Leave existing (not representable in ADMX)
            </option>
          </select>
        </label>
        {policy.disabledBehavior.kind === "WriteFixedValue" && (
          <label className="wb-field wb-field--wide">
            <span>Disabled fixed value</span>
            <input
              type={policy.snapshot.value.type === "DWord" ? "number" : "text"}
              value={disabledValueDraft}
              onChange={(event) => {
                const text = event.target.value;
                setDisabledValueDraft(text);
                if (policy.snapshot.value.type === "DWord") {
                  const parsed = Number(text);
                  if (
                    text === "" ||
                    !Number.isInteger(parsed) ||
                    parsed < 0 ||
                    parsed > 4_294_967_295
                  )
                    return;
                  set("disabledBehavior", {
                    kind: "WriteFixedValue",
                    value: { type: "DWord", data: parsed },
                  });
                  return;
                }
                set("disabledBehavior", {
                  kind: "WriteFixedValue",
                  value: { type: policy.snapshot.value.type, data: text } as RegistryValue,
                });
              }}
            />
            {invalidDisabledDword && (
              <small className="wb-field__error">Enter an integer from 0 to 4294967295.</small>
            )}
          </label>
        )}
        {policy.valueMode === "ProfileInput" && policy.snapshot.value.type === "DWord" && (
          <>
            <label className="wb-field">
              <span>Minimum DWORD</span>
              <input
                type="number"
                min={0}
                max={4_294_967_295}
                value={policy.dwordMin ?? ""}
                onChange={(event) =>
                  set(
                    "dwordMin",
                    event.target.value === "" ? undefined : Number(event.target.value),
                  )
                }
              />
            </label>
            <label className="wb-field">
              <span>Maximum DWORD</span>
              <input
                type="number"
                min={0}
                max={4_294_967_295}
                value={policy.dwordMax ?? ""}
                onChange={(event) =>
                  set(
                    "dwordMax",
                    event.target.value === "" ? undefined : Number(event.target.value),
                  )
                }
              />
            </label>
          </>
        )}
      </div>
      {policyIssues.length > 0 && (
        <ul className="wb-admx-issues">
          {policyIssues.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export function AdministrativeTemplatesWorkspace({
  workspace,
  pickRequest,
  onWorkspaceChange,
  onDownload,
  onDirtyChange,
  onGoToPackages,
  onOpenSource,
  onPickHandled,
}: {
  workspace: RegistryWorkspace;
  pickRequest?:
    | { token: number; selected: string[]; openTemplateId?: string; newTemplate?: boolean }
    | undefined;
  onWorkspaceChange: (workspace: RegistryWorkspace) => void;
  onDownload: (template: AdministrativeTemplate) => void;
  onDirtyChange: (dirty: boolean) => void;
  onGoToPackages: () => void;
  onOpenSource: (packageId: string) => void;
  onPickHandled: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [dirty, setDirty] = useState(false);
  const [invalidPolicyDrafts, setInvalidPolicyDrafts] = useState<Set<string>>(new Set());
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // A package can start template authoring, or open a template that uses its items. The request is a
  // one-shot token so navigation does not re-trigger it, and the Workspace is read through a ref so the
  // effect does not re-run on every authoring change.
  useEffect(() => {
    if (!pickRequest) return;
    // A package launch replaces whatever is being authored, so it asks the same question as closing.
    if (dirtyRef.current && !window.confirm("Discard unsaved administrative template changes?")) {
      onPickHandled();
      return;
    }
    const current = workspaceRef.current;
    if (pickRequest.newTemplate) {
      // Draft validity belongs to the previous policies; their IDs are gone with the new template.
      setInvalidPolicyDrafts(new Set());
      setDirty(true);
      onDirtyChange(true);
      setView({
        kind: "edit",
        template: createAdministrativeTemplate({ policies: [createAuthoredPolicy()] }),
      });
      onPickHandled();
      return;
    }
    if (pickRequest.openTemplateId) {
      const template = current.administrativeTemplates.find(
        (entry) => entry.id === pickRequest.openTemplateId,
      );
      if (template) {
        setInvalidPolicyDrafts(new Set());
        setDirty(false);
        onDirtyChange(false);
        setView({ kind: "edit", template, replacingId: template.id });
        onPickHandled();
        return;
      }
    }
    setView({ kind: "pick", selected: new Set(pickRequest.selected) });
    onPickHandled();
  }, [pickRequest, onDirtyChange, onPickHandled]);
  const candidates = useMemo(() => administrativeTemplateCandidates(workspace), [workspace]);
  const accepted = candidates.filter((candidate) => candidate.status === "accepted");
  /**
   * Picker selections can go stale: navigating to the package list allows an item to be deleted or
   * made ineligible while this surface stays mounted. Only ids that are still acceptable survive, so
   * accepting can never reference a source that no longer exists.
   */
  const selectedCandidates = useMemo(() => {
    if (view.kind !== "pick") return new Set<string>();
    // Eligibility and inclusion are different questions: an item that is eligible but disabled in its
    // package must not enter a policy, including when it was preselected and then switched off.
    const acceptable = new Set(
      accepted.filter((candidate) => candidate.item.enabled).map((candidate) => candidate.item.id),
    );
    return new Set([...view.selected].filter((id) => acceptable.has(id)));
  }, [accepted, view]);
  const edit = view.kind === "edit" ? view : undefined;
  const activeTemplate =
    view.kind === "edit" || view.kind === "preview" ? view.template : undefined;
  const overlaps = useMemo(
    () => (activeTemplate ? registryOverlapsForTemplate(workspace, activeTemplate) : []),
    [workspace, activeTemplate],
  );
  const issues = edit ? validateAdministrativeTemplate(edit.template) : [];
  const build = edit ? administrativeTemplateBuild(edit.template) : undefined;
  const persistenceIssue = edit ? administrativeTemplatePersistenceIssue(edit.template) : undefined;
  const compilable =
    build?.status === "compiled" && invalidPolicyDrafts.size === 0 && !persistenceIssue;
  const buildIssueCount = build?.status === "invalid" ? build.issues.length : 0;
  const setEditTemplate = (template: AdministrativeTemplate) => {
    if (!edit) return;
    setDirty(true);
    onDirtyChange(true);
    setView({ ...edit, template });
  };
  const setPolicyDraftValidity = useCallback((policyId: string, valid: boolean) => {
    setInvalidPolicyDrafts((current) => {
      if (valid && !current.has(policyId)) return current;
      if (!valid && current.has(policyId)) return current;
      const next = new Set(current);
      if (valid) next.delete(policyId);
      else next.add(policyId);
      return next;
    });
  }, []);
  const cancelEdit = () => {
    if (dirty && !window.confirm("Discard unsaved administrative template changes?")) return;
    setDirty(false);
    onDirtyChange(false);
    setInvalidPolicyDrafts(new Set());
    setView({ kind: "list" });
  };
  const saveDraft = () => {
    if (!edit || invalidPolicyDrafts.size > 0 || persistenceIssue) return;
    onWorkspaceChange(saveAdministrativeTemplate(workspace, edit.template, edit.replacingId));
    setDirty(false);
    onDirtyChange(false);
    setInvalidPolicyDrafts(new Set());
    setView({ kind: "list" });
  };
  return (
    <section className="wb-admx" aria-labelledby="wb-admx-title">
      <header className="wb-admx__header">
        <div>
          <span className="wb-eyebrow">Custom ADMX preview</span>
          <h2 id="wb-admx-title">Administrative Templates</h2>
        </div>
      </header>
      <div className="wb-admx__actions">
        {view.kind === "list" ? (
          <>
            <span className="wb-dialog-status">
              {workspace.administrativeTemplates.length} template{" "}
              {workspace.administrativeTemplates.length === 1 ? "draft" : "drafts"}
            </span>
            <button
              className="wb-button wb-button--primary"
              onClick={() => setView({ kind: "pick", selected: new Set() })}
            >
              New template
            </button>
          </>
        ) : view.kind === "pick" ? (
          <>
            <button
              className="wb-button wb-button--ghost"
              onClick={() => setView({ kind: "list" })}
            >
              Back
            </button>
            <button
              className="wb-button wb-button--ghost"
              onClick={() => {
                setInvalidPolicyDrafts(new Set());
                setView({
                  kind: "edit",
                  template: createAdministrativeTemplate({ policies: [createAuthoredPolicy()] }),
                });
                setDirty(true);
                onDirtyChange(true);
              }}
            >
              Start with my own Registry target
            </button>
            <button
              className="wb-button wb-button--primary"
              disabled={selectedCandidates.size === 0}
              onClick={() => {
                setInvalidPolicyDrafts(new Set());
                setView({
                  kind: "edit",
                  template: createAdministrativeTemplateDraft(workspace, selectedCandidates),
                });
                setDirty(true);
                onDirtyChange(true);
              }}
            >
              Add {selectedCandidates.size} accepted{" "}
              {selectedCandidates.size === 1 ? "item" : "items"}
            </button>
          </>
        ) : view.kind === "edit" ? (
          <>
            <span className={"wb-dialog-status" + (compilable ? " is-ready" : "")}>
              {compilable
                ? "Ready to preview and download"
                : `${issues.length || buildIssueCount || invalidPolicyDrafts.size || 1} authoring issues`}
            </span>
            <button className="wb-button wb-button--ghost" onClick={cancelEdit}>
              Cancel
            </button>
            <button
              className="wb-button wb-button--ghost"
              disabled={invalidPolicyDrafts.size > 0 || Boolean(persistenceIssue)}
              onClick={saveDraft}
            >
              Save draft to Workspace
            </button>
            <button
              className="wb-button wb-button--primary"
              disabled={!compilable}
              onClick={() => setView({ kind: "preview", template: view.template })}
            >
              Continue to review
            </button>
          </>
        ) : (
          <>
            <button
              className="wb-button wb-button--ghost"
              onClick={() =>
                setView(
                  workspace.administrativeTemplates.some(({ id }) => id === view.template.id)
                    ? {
                        kind: "edit",
                        template: view.template,
                        replacingId: view.template.id,
                      }
                    : { kind: "edit", template: view.template },
                )
              }
            >
              Back to edit
            </button>
            <button
              className="wb-button wb-button--primary"
              onClick={() => onDownload(view.template)}
            >
              Download template
            </button>
          </>
        )}
      </div>
      <div className="wb-admx__body">
        {view.kind === "list" && (
          <div className="wb-admx-list">
            <p className="wb-dialog-lead">
              Turn compatible Registry Items into native ADMX policy definitions, then download the
              ADMX, ADML, and import instructions for a manual Microsoft Intune import. Nothing is
              uploaded. Microsoft custom ADMX import remains in public preview; follow Microsoft's
              current guidance for production use.
            </p>
            {workspace.administrativeTemplates.length === 0 ? (
              <div className="wb-empty-state wb-empty-state--compact">
                <h3>No administrative template drafts</h3>
                {candidates.length === 0 ? (
                  <>
                    <p>
                      A template can reuse the Registry Items of a Deployment Package, or define its
                      own Registry targets. This Workspace has no Registry Items yet, so every
                      policy would be written here.
                    </p>
                    <button className="wb-button wb-button--ghost" onClick={onGoToPackages}>
                      Go to Deployment Packages
                    </button>
                  </>
                ) : accepted.length === 0 ? (
                  <>
                    <p>
                      This Workspace holds {candidates.length} Registry Item{" "}
                      {candidates.length === 1 ? "" : "s"}, but none of them can be represented as
                      an administrative template. Review the compatibility reasons before changing
                      anything: a setting that cannot be expressed exactly must not be approximated.
                    </p>
                    <button
                      className="wb-button wb-button--ghost"
                      onClick={() => setView({ kind: "pick", selected: new Set() })}
                    >
                      Review compatibility
                    </button>
                  </>
                ) : (
                  <p>
                    {accepted.length} compatible Registry Item{" "}
                    {accepted.length === 1 ? " is" : "s are"} available. Select the ones that should
                    become policy settings.
                  </p>
                )}
              </div>
            ) : (
              workspace.administrativeTemplates.map((template) => {
                const result = administrativeTemplateBuild(template);
                return (
                  <article key={template.id} className="wb-admx-template-card">
                    <div>
                      <strong>{template.name || "Untitled administrative template"}</strong>
                      <small>
                        {template.policies.length}{" "}
                        {template.policies.length === 1 ? "policy" : "policies"} ·{" "}
                        {result.status === "compiled" ? "Ready" : "Draft"}
                      </small>
                    </div>
                    <button
                      className="wb-button wb-button--ghost"
                      onClick={() => {
                        setView({ kind: "edit", template, replacingId: template.id });
                        setDirty(false);
                        onDirtyChange(false);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="wb-button wb-button--ghost"
                      disabled={result.status !== "compiled"}
                      onClick={() => setView({ kind: "preview", template })}
                    >
                      Preview
                    </button>
                    <button
                      className="wb-button wb-button--quiet"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Delete administrative template “${template.name || "Untitled"}”?`,
                          )
                        )
                          return;
                        onWorkspaceChange(removeAdministrativeTemplate(workspace, template.id));
                      }}
                    >
                      Delete
                    </button>
                  </article>
                );
              })
            )}
          </div>
        )}
        {view.kind === "pick" && (
          <div className="wb-admx-picker">
            <p className="wb-dialog-lead">
              Items from all Workspace packages are assessed in their own package context. Eligible
              items create frozen Registry snapshots, so later package edits do not change this
              draft.
            </p>
            {candidates.map((candidate) => (
              <label
                key={candidate.item.id}
                className="wb-admx-candidate"
                data-status={candidate.status}
              >
                <input
                  type="checkbox"
                  disabled={candidate.status === "rejected"}
                  checked={view.selected.has(candidate.item.id)}
                  onChange={(event) => {
                    const selected = new Set(view.selected);
                    if (event.target.checked) selected.add(candidate.item.id);
                    else selected.delete(candidate.item.id);
                    setView({ kind: "pick", selected });
                  }}
                />
                <span>
                  <strong>{candidate.item.registry.valueName || "Default value"}</strong>
                  <small>{candidate.packageName}</small>
                  <code>
                    {candidate.item.registry.hive}\{candidate.item.registry.keyPath}
                  </code>
                </span>
                <span className="wb-admx-candidate__status">
                  {candidate.status === "accepted" ? (
                    <>
                      Compatible · {candidate.policyClass}
                      {!candidate.item.enabled && <em> · disabled in the package</em>}
                    </>
                  ) : (
                    candidate.reasons.map((reason) => reason.message).join(" ")
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
        {view.kind === "edit" && (
          <div className="wb-admx-editor">
            <p className="wb-dialog-lead">
              Every policy choice is explicit. Saving an incomplete draft is allowed; preview and
              download remain blocked until compilation succeeds.
            </p>
            <div className="wb-form-grid">
              <label className="wb-field wb-field--wide">
                <span>Template name</span>
                <input
                  value={view.template.name}
                  maxLength={256}
                  onChange={(event) =>
                    setEditTemplate({ ...view.template, name: event.target.value })
                  }
                />
              </label>
              <label className="wb-field">
                <span>Version</span>
                <input
                  value={view.template.version}
                  maxLength={64}
                  placeholder="1.0.0"
                  onChange={(event) =>
                    setEditTemplate({ ...view.template, version: event.target.value })
                  }
                />
              </label>
              <label className="wb-field">
                <span>Vendor identifier</span>
                <input
                  value={view.template.vendorId}
                  maxLength={128}
                  placeholder="Northgate"
                  onChange={(event) =>
                    setEditTemplate({ ...view.template, vendorId: event.target.value })
                  }
                />
              </label>
              <label className="wb-field">
                <span>Product identifier</span>
                <input
                  value={view.template.productId}
                  maxLength={128}
                  placeholder="App"
                  onChange={(event) =>
                    setEditTemplate({ ...view.template, productId: event.target.value })
                  }
                />
              </label>
            </div>
            {issues.filter((issue) => !issue.policyId).length > 0 && (
              <ul className="wb-admx-issues">
                {issues
                  .filter((issue) => !issue.policyId)
                  .map((issue) => (
                    <li key={issue.code + issue.message}>{issue.message}</li>
                  ))}
              </ul>
            )}
            {persistenceIssue && (
              <ul className="wb-admx-issues">
                <li>{persistenceIssue}</li>
              </ul>
            )}
            <OverlapNotice overlaps={overlaps} />
            {build?.status === "invalid" &&
              build.issues.some(
                (issue) =>
                  !issues.some(
                    (domainIssue) =>
                      domainIssue.code === issue.code && domainIssue.message === issue.message,
                  ),
              ) && (
                <ul className="wb-admx-issues">
                  {build.issues
                    .filter(
                      (issue) =>
                        !issues.some(
                          (domainIssue) =>
                            domainIssue.code === issue.code &&
                            domainIssue.message === issue.message,
                        ),
                    )
                    .map((issue) => (
                      <li key={issue.code + issue.message}>{issue.message}</li>
                    ))}
                </ul>
              )}
            {view.template.policies.map((policy) => (
              <PolicyEditor
                key={policy.id}
                policy={policy}
                issues={issues}
                source={policySource(workspace, policy)}
                onOpenSource={onOpenSource}
                onReplaceSnapshot={() => {
                  if (!edit) return;
                  const replaced = replacePolicySnapshot(workspace, edit.template, policy.id);
                  if (replaced.kind !== "replaced") return;
                  setEditTemplate(replaced.template);
                }}
                onChange={(next) =>
                  setEditTemplate({
                    ...view.template,
                    policies: view.template.policies.map((candidate) =>
                      candidate.id === next.id ? next : candidate,
                    ),
                  })
                }
                onDraftValidityChange={setPolicyDraftValidity}
              />
            ))}
            <button
              className="wb-button wb-button--ghost"
              onClick={() =>
                setEditTemplate({
                  ...view.template,
                  policies: [...view.template.policies, createAuthoredPolicy()],
                })
              }
            >
              ＋ Add a policy with its own Registry target
            </button>
          </div>
        )}
        {view.kind === "preview" &&
          (() => {
            const result = administrativeTemplateBuild(view.template);
            if (result.status !== "compiled") {
              return (
                <ul className="wb-admx-issues">
                  {result.issues.map((issue) => (
                    <li key={issue.code + issue.message}>{issue.message}</li>
                  ))}
                </ul>
              );
            }
            return (
              <div className="wb-admx-preview">
                <p className="wb-dialog-lead">
                  Check the policy behaviour first, then the generated text. No content is uploaded.
                </p>
                <section className="wb-admx-summary" aria-labelledby="wb-admx-summary-title">
                  <h3 id="wb-admx-summary-title">Policies in this template</h3>
                  <ul>
                    {view.template.policies.map((policy) => (
                      <PolicySummary key={policy.id} policy={policy} />
                    ))}
                  </ul>
                </section>
                <OverlapNotice overlaps={overlaps} />
                <details>
                  <summary>{result.compiled.admxFileName}</summary>
                  <pre>{result.compiled.admx}</pre>
                </details>
                <details>
                  <summary>{result.compiled.admlFileName}</summary>
                  <pre>{result.compiled.adml}</pre>
                </details>
                <details>
                  <summary>IMPORT.md</summary>
                  <pre>{result.compiled.instructions}</pre>
                </details>
              </div>
            );
          })()}
      </div>
    </section>
  );
}
