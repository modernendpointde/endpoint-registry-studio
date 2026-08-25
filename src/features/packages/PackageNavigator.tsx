import {
  deploymentPackageLabel,
  type DeploymentPackage,
  type RegistryWorkspace,
} from "../../domain/workspace/workspace";
import { packageReadiness } from "../../shared/ui/packageReadiness";
import type { PackageValidationIssue } from "../../domain/validation/workspaceValidation";
import { packageMethod } from "../registry-items/presentation";
import { englishUi } from "../../shared/localization/locale";

export function ProductMark() {
  return (
    <svg className="wb-product-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="9" />
      <path d="M10 9v14m0-9h7m-7 6h12m-5-6v4m5 2v4" />
      <circle cx="10" cy="9" r="1.7" />
      <circle cx="17" cy="14" r="1.7" />
      <circle cx="22" cy="20" r="1.7" />
    </svg>
  );
}

export function PackageNavigator({
  workspace,
  openPackageId,
  issues,
  onOverview,
  onOpen,
  onAdd,
}: {
  workspace: RegistryWorkspace;
  openPackageId?: string | undefined;
  issues: readonly PackageValidationIssue[];
  onOverview: () => void;
  onOpen: (pkg: DeploymentPackage) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="wb-rail" aria-label="Deployment Package navigator">
      <div className="wb-rail__topline">
        <div>
          <span>{englishUi.common.workspace.label}</span>
          <strong>{englishUi.packages.title}</strong>
        </div>
        <button className="wb-rail__add" aria-label={englishUi.packages.add} onClick={onAdd}>
          ＋
        </button>
      </div>
      <nav className="wb-rail__nav">
        <button
          className="wb-rail-entry wb-rail-entry--overview"
          aria-current={!openPackageId ? "page" : undefined}
          onClick={onOverview}
        >
          <span className="wb-rail-entry__icon" aria-hidden="true">
            ▦
          </span>
          <span>
            <strong>{englishUi.packages.all}</strong>
            <small>
              {workspace.packages.length} {workspace.packages.length === 1 ? "package" : "packages"}
            </small>
          </span>
        </button>
        {workspace.packages.map((pkg) => {
          const packageIssues = issues.filter((issue) => issue.packageId === pkg.id);
          const readiness = packageReadiness(pkg, packageIssues);
          return (
            <button
              key={pkg.id}
              className="wb-rail-entry"
              aria-current={openPackageId === pkg.id ? "page" : undefined}
              onClick={() => onOpen(pkg)}
              aria-label={`Open ${deploymentPackageLabel(pkg)}, ${readiness.label}${readiness.reason ? `, ${readiness.reason}` : ""}`}
            >
              <span className="wb-status-dot" data-tone={readiness.tone} />
              <span>
                <strong>{deploymentPackageLabel(pkg)}</strong>
                <small>
                  {packageMethod(pkg)} · {pkg.items.length}{" "}
                  {pkg.items.length === 1 ? "item" : "items"}
                </small>
              </span>
              <span className="wb-rail-entry__arrow" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
      </nav>
      <div className="wb-rail__privacy">
        <span aria-hidden="true">◉</span>
        <div>
          <strong>{englishUi.packages.localTitle}</strong>
          <small>{englishUi.packages.localSummary}</small>
        </div>
      </div>
    </aside>
  );
}
