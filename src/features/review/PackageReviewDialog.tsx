import { useMemo, useState } from "react";

import {
  deploymentPackageLabel,
  packageFingerprint,
  type DeploymentPackage,
  type RegistryWorkspace,
} from "../../domain/workspace/workspace";
import {
  deploymentPackageName,
  deploymentPackageSummary,
  generateDeploymentPackageArtifacts,
  generateDeploymentPackageZip,
  packagePortalSettings,
} from "../../application/packageBuildService";
import { copyText } from "../../platform/browser/clipboard";
import { downloadArtifact } from "../../platform/browser/download";
import { packageReadiness } from "../../shared/ui/packageReadiness";
import { scriptPreview, type ScriptPreviewMode } from "../../shared/ui/outputPreview";
import { type PackageValidationIssue } from "../../domain/validation/workspaceValidation";
import { validatePackageForDownload } from "../../domain/validation/packageOutputValidation";
import { Dialog } from "../../shared/ui/Overlays";

export function PackageReviewDialog({
  workspace,
  pkg,
  onClose,
  onEditIssue,
  onNotice,
}: {
  workspace: RegistryWorkspace;
  pkg: DeploymentPackage;
  onClose: () => void;
  onEditIssue: (issue: PackageValidationIssue) => void;
  onNotice: (notice: { kind: "success" | "error" | "info"; message: string }) => void;
}) {
  const issues = useMemo(() => validatePackageForDownload(pkg), [pkg]);
  const readiness = packageReadiness(pkg, issues);
  const artifacts = useMemo(
    () => (readiness.downloadable ? generateDeploymentPackageArtifacts(workspace, pkg) : []),
    [pkg, readiness.downloadable, workspace],
  );
  const scripts = artifacts.filter(
    (artifact) => artifact.name.endsWith(".ps1") && typeof artifact.content === "string",
  );
  const [selectedName, setSelectedName] = useState(scripts[0]?.name ?? "");
  const [previewMode, setPreviewMode] = useState<ScriptPreviewMode>("configuration");
  const [wrap, setWrap] = useState(false);
  const selected = scripts.find((artifact) => artifact.name === selectedName) ?? scripts[0];
  const code = selected
    ? scriptPreview(String(selected.content), previewMode)
    : "No script is available until package issues are resolved.";
  const warnings = issues.filter((issue) => issue.severity === "Warning");
  const fingerprint = packageFingerprint(pkg);
  const authorize = () =>
    warnings.length === 0 ||
    window.confirm(
      `Review and accept these warnings before download:\n\n${warnings.map((issue) => `• ${issue.message}`).join("\n")}`,
    );
  const copy = (value: string, message: string) =>
    void copyText(value)
      .then(() => onNotice({ kind: "success", message }))
      .catch((error: unknown) =>
        onNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Clipboard copy failed.",
        }),
      );
  const download = (factory: () => Parameters<typeof downloadArtifact>[0], message: string) =>
    void (async () => {
      try {
        await downloadArtifact(factory());
        onNotice({ kind: "success", message });
      } catch (error) {
        onNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Download failed.",
        });
      }
    })();

  return (
    <Dialog
      title={deploymentPackageLabel(pkg)}
      eyebrow="Generated output"
      size="review"
      onClose={onClose}
      footer={
        <>
          <span className="wb-review-filename">
            {readiness.downloadable ? deploymentPackageName(pkg) : readiness.reason}
          </span>
          <button className="wb-button wb-button--ghost" onClick={onClose}>
            Close
          </button>
          <button
            className="wb-button wb-button--primary"
            disabled={!readiness.downloadable}
            onClick={() => {
              if (!authorize()) return;
              download(
                () => ({
                  name: deploymentPackageName(pkg),
                  mediaType: "application/zip",
                  content: generateDeploymentPackageZip(workspace, pkg),
                }),
                "Deployment Package downloaded",
              );
            }}
          >
            Download package
          </button>
        </>
      }
    >
      <div className="wb-review">
        <aside className="wb-review__sidebar">
          <div className="wb-review-identity">
            <span>Deployment Package</span>
            <strong>{deploymentPackageSummary(pkg)}</strong>
            <p>
              {pkg.items.length} Registry {pkg.items.length === 1 ? "Item" : "Items"}
            </p>
            <span className="wb-review-readiness" data-tone={readiness.tone}>
              {readiness.label}
              {readiness.reason ? ` · ${readiness.reason}` : ""}
            </span>
          </div>
          <button
            className="wb-fingerprint"
            onClick={() => copy(fingerprint, "Fingerprint copied")}
            aria-label={`Copy fingerprint ${fingerprint}`}
          >
            <span>Fingerprint</span>
            <code>{fingerprint}</code>
          </button>
          <nav className="wb-review-file-nav" aria-label="Generated files">
            <span>Generated scripts</span>
            {scripts.map((artifact) => (
              <button
                key={artifact.name}
                aria-current={selected?.name === artifact.name ? "page" : undefined}
                onClick={() => {
                  setSelectedName(artifact.name);
                  setPreviewMode("configuration");
                }}
              >
                <span aria-hidden="true">PS</span>
                <div>
                  <strong>{artifact.name}</strong>
                  <small>{artifact.purpose}</small>
                </div>
              </button>
            ))}
          </nav>
        </aside>
        <div className="wb-review__main">
          <div className="wb-review-toolbar">
            <div>
              <span>Script preview</span>
              <strong>{selected?.name ?? "Package issues"}</strong>
            </div>
            <div className="wb-segmented" aria-label="Script preview mode">
              <button
                aria-pressed={previewMode === "configuration"}
                onClick={() => setPreviewMode("configuration")}
              >
                Configuration block
              </button>
              <button aria-pressed={previewMode === "full"} onClick={() => setPreviewMode("full")}>
                Full script
              </button>
            </div>
            <button
              className="wb-button wb-button--quiet"
              role="switch"
              aria-checked={wrap}
              onClick={() => setWrap((current) => !current)}
            >
              Wrap lines
            </button>
            <button
              className="wb-button wb-button--quiet"
              disabled={!selected}
              onClick={() => copy(code, `${selected?.name ?? "Script"} copied`)}
            >
              Copy shown code
            </button>
            <button
              className="wb-button wb-button--quiet"
              disabled={!selected}
              onClick={() => {
                if (!selected || !authorize()) return;
                download(() => selected, `${selected.name} downloaded`);
              }}
            >
              Download file
            </button>
          </div>
          <pre className="wb-code" data-wrap={wrap} tabIndex={0}>
            {code}
          </pre>
          <div className="wb-review-panels">
            <details open>
              <summary>
                Package contents <span>{artifacts.length}</span>
              </summary>
              <ul>
                {artifacts.map((artifact) => (
                  <li key={artifact.path}>
                    <code>{artifact.path}</code>
                    <small>{artifact.purpose}</small>
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary>
                Intune settings <span>{packagePortalSettings(pkg).length}</span>
              </summary>
              <dl>
                {packagePortalSettings(pkg).map((setting) => (
                  <div key={setting.label}>
                    <dt>{setting.label}</dt>
                    <dd>
                      <strong>{setting.value}</strong>
                      <small>{setting.reason}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            <details open={issues.length > 0}>
              <summary>
                Validation <span>{issues.length}</span>
              </summary>
              {issues.length === 0 ? (
                <p>No blocking errors or warnings.</p>
              ) : (
                <ul>
                  {issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`}>
                      <button onClick={() => onEditIssue(issue)}>
                        <strong>{issue.severity}</strong>
                        <span>{issue.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
