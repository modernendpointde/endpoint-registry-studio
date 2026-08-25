import {
  deploymentPackageLabel,
  type DeploymentPackage,
  type RegistryWorkspace,
} from "../../domain/workspace/workspace";
import { packageReadiness } from "../../shared/ui/packageReadiness";
import type { PackageValidationIssue } from "../../domain/validation/workspaceValidation";
import { ActionMenu } from "../../shared/ui/Overlays";
import { packageMethod, runContext } from "../registry-items/presentation";

export function PackageOverview({
  workspace,
  packages,
  issues,
  search,
  methodFilter,
  contextFilter,
  sort,
  selectMode,
  selected,
  openMenuId,
  onSearch,
  onMethodFilter,
  onContextFilter,
  onSort,
  onSelectMode,
  onClearSelection,
  onToggleSelected,
  onAdd,
  onImport,
  onOpen,
  onReview,
  onDownload,
  onDownloadSelected,
  onDownloadAll,
  onEdit,
  onDuplicate,
  onDelete,
  onMenu,
}: {
  workspace: RegistryWorkspace;
  packages: readonly DeploymentPackage[];
  issues: readonly PackageValidationIssue[];
  search: string;
  methodFilter: string;
  contextFilter: string;
  sort: string;
  selectMode: boolean;
  selected: Set<string>;
  openMenuId?: string | undefined;
  onSearch: (value: string) => void;
  onMethodFilter: (value: string) => void;
  onContextFilter: (value: string) => void;
  onSort: (value: string) => void;
  onSelectMode: (value: boolean) => void;
  onClearSelection: () => void;
  onToggleSelected: (id: string) => void;
  onAdd: () => void;
  onImport?: () => void;
  onOpen: (pkg: DeploymentPackage) => void;
  onReview: (pkg: DeploymentPackage) => void;
  onDownload: (pkg: DeploymentPackage) => void;
  onDownloadSelected: () => void;
  onDownloadAll: () => void;
  onEdit: (pkg: DeploymentPackage) => void;
  onDuplicate: (pkg: DeploymentPackage) => void;
  onDelete: (pkg: DeploymentPackage) => void;
  onMenu: (id?: string) => void;
}) {
  const errors = issues.filter((issue) => issue.severity === "Error").length;
  const warnings = issues.filter((issue) => issue.severity === "Warning").length;
  const incomplete = workspace.packages.filter((pkg) => pkg.items.length === 0).length;
  const allDownloadable =
    workspace.packages.length > 0 &&
    workspace.packages.every(
      (pkg) =>
        packageReadiness(
          pkg,
          issues.filter((issue) => issue.packageId === pkg.id),
        ).downloadable,
    );
  const selectedDownloadable =
    selected.size > 0 &&
    workspace.packages
      .filter((pkg) => selected.has(pkg.id))
      .every(
        (pkg) =>
          packageReadiness(
            pkg,
            issues.filter((issue) => issue.packageId === pkg.id),
          ).downloadable,
      );
  const workspaceStatus =
    workspace.packages.length === 0
      ? { label: "Empty workspace", detail: "No Deployment Packages", tone: "empty" }
      : errors
        ? {
            label: `${errors} ${errors === 1 ? "error" : "errors"}`,
            detail: "Resolve before download",
            tone: "error",
          }
        : incomplete
          ? {
              label: "Incomplete",
              detail:
                incomplete === 1
                  ? "1 package needs a Registry Item"
                  : `${incomplete} packages need Registry Items`,
              tone: "warning",
            }
          : warnings
            ? {
                label: `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
                detail: "Review before download",
                tone: "warning",
              }
            : {
                label: "Ready",
                detail: `${workspace.packages.length} ${workspace.packages.length === 1 ? "package" : "packages"}`,
                tone: "ready",
              };

  return (
    <section className="wb-canvas" aria-labelledby="packages-heading">
      <header className="wb-page-head">
        <div>
          <span className="wb-eyebrow">Workspace overview</span>
          <h1 id="packages-heading">Deployment Packages</h1>
          <p>
            {workspace.packages.length} {workspace.packages.length === 1 ? "package" : "packages"}
          </p>
        </div>
        <div className="wb-workspace-status" data-tone={workspaceStatus.tone}>
          <span className="wb-status-dot" />
          <div>
            <strong>{workspaceStatus.label}</strong>
            <small>{workspaceStatus.detail}</small>
          </div>
        </div>
      </header>

      <div className="wb-surface">
        {workspace.packages.length > 0 && (
          <div className="wb-commandbar">
            <div className="wb-commandbar__primary">
              <button className="wb-button wb-button--primary" onClick={onAdd}>
                ＋ Add package
              </button>
              {onImport && (
                <button className="wb-button wb-button--ghost" onClick={onImport}>
                  Import Registry data
                </button>
              )}
              <button
                className="wb-button wb-button--ghost"
                disabled={workspace.packages.length === 0}
                aria-pressed={selectMode}
                onClick={() => onSelectMode(!selectMode)}
              >
                {selectMode ? "Done" : "Select"}
              </button>
              {selectMode && selected.size > 0 && (
                <button className="wb-button wb-button--quiet" onClick={onClearSelection}>
                  Clear selection
                </button>
              )}
            </div>
            <div className="wb-commandbar__secondary">
              <button
                className="wb-button wb-button--ghost"
                disabled={!selectMode || !selectedDownloadable}
                onClick={onDownloadSelected}
              >
                Download selected
              </button>
              <button
                className="wb-button wb-button--ghost"
                disabled={!allDownloadable}
                onClick={onDownloadAll}
              >
                Download all
              </button>
            </div>
          </div>
        )}

        {workspace.packages.length > 0 && (
          <div className="wb-filterbar">
            <label className="wb-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Search Deployment Packages"
                placeholder="Search packages or Registry targets"
                value={search}
                onChange={(event) => onSearch(event.target.value)}
              />
            </label>
            <select
              aria-label="Filter deployment method"
              value={methodFilter}
              onChange={(event) => onMethodFilter(event.target.value)}
            >
              <option value="All">All methods</option>
              <option value="Remediation">Intune Remediation</option>
              <option value="PlatformScript">Platform Script</option>
              <option value="Win32App">Win32 App</option>
            </select>
            <select
              aria-label="Filter run context"
              value={contextFilter}
              onChange={(event) => onContextFilter(event.target.value)}
            >
              <option value="All">All contexts</option>
              <option value="System">SYSTEM</option>
              <option value="LoggedOnUser">Logged-on user</option>
            </select>
            <select
              aria-label="Sort Deployment Packages"
              value={sort}
              onChange={(event) => onSort(event.target.value)}
            >
              <option value="name">Package name</option>
              <option value="method">Deployment method</option>
              <option value="items">Item count</option>
            </select>
          </div>
        )}

        {workspace.packages.length === 0 ? (
          <div className="wb-empty-state">
            <div className="wb-empty-state__glyph" aria-hidden="true">
              ＋
            </div>
            <span>Get started</span>
            <h2>Add your first Deployment Package</h2>
            <p>
              A Deployment Package groups Registry Items that are deployed together using one Intune
              method and run context.
            </p>
            <div>
              <button className="wb-button wb-button--primary" onClick={onAdd}>
                Add package
              </button>
              {onImport && (
                <button className="wb-button wb-button--ghost" onClick={onImport}>
                  Import Registry data
                </button>
              )}
            </div>
          </div>
        ) : packages.length === 0 ? (
          <div className="wb-empty-state wb-empty-state--compact">
            <h2>No matching packages</h2>
            <p>Change the current search or filters.</p>
          </div>
        ) : (
          <div className="wb-package-list" role="table" aria-label="Deployment Packages">
            <div className="wb-package-list__header" role="row">
              <span role="columnheader">Package</span>
              <span role="columnheader">Method / context</span>
              <span role="columnheader">Registry Items</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Actions</span>
            </div>
            {packages.map((pkg) => {
              const packageIssues = issues.filter((issue) => issue.packageId === pkg.id);
              const readiness = packageReadiness(pkg, packageIssues);
              const activate = () => (selectMode ? onToggleSelected(pkg.id) : onOpen(pkg));
              return (
                <div
                  key={pkg.id}
                  className="wb-package-row"
                  role="row"
                  tabIndex={0}
                  data-package-id={pkg.id}
                  data-selected={selected.has(pkg.id)}
                  onClick={(event) => {
                    if (
                      event.target === event.currentTarget ||
                      (event.target as HTMLElement).closest("[data-open-package]")
                    )
                      activate();
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      activate();
                    }
                  }}
                >
                  <div className="wb-package-row__identity" role="cell" data-open-package>
                    {selectMode && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${deploymentPackageLabel(pkg)}`}
                        checked={selected.has(pkg.id)}
                        onChange={() => onToggleSelected(pkg.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    )}
                    <span className="wb-package-symbol" aria-hidden="true">
                      {pkg.deployment.method === "Win32App"
                        ? "W32"
                        : pkg.deployment.method === "PlatformScript"
                          ? "PS"
                          : "RM"}
                    </span>
                    <div>
                      <strong>{deploymentPackageLabel(pkg)}</strong>
                    </div>
                  </div>
                  <div role="cell" data-open-package>
                    <strong>{packageMethod(pkg)}</strong>
                    <small>{runContext(pkg)}</small>
                  </div>
                  <div role="cell" data-open-package>
                    <strong>{pkg.items.length}</strong>
                    <small>{pkg.items.length === 1 ? "Registry Item" : "Registry Items"}</small>
                  </div>
                  <div role="cell" data-open-package>
                    <span className="wb-readiness" data-tone={readiness.tone}>
                      <span className="wb-status-dot" />
                      {readiness.label}
                    </span>
                    {readiness.reason && <small title={readiness.reason}>{readiness.reason}</small>}
                  </div>
                  <div className="wb-package-row__actions" role="cell">
                    <button
                      className="wb-button wb-button--quiet"
                      onClick={(event) => {
                        event.stopPropagation();
                        onReview(pkg);
                      }}
                    >
                      Review
                    </button>
                    <button
                      className="wb-button wb-button--quiet"
                      disabled={!readiness.downloadable}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDownload(pkg);
                      }}
                    >
                      Download
                    </button>
                    <ActionMenu
                      label={`More actions for ${deploymentPackageLabel(pkg)}`}
                      open={openMenuId === pkg.id}
                      onOpenChange={(open) => onMenu(open ? pkg.id : undefined)}
                      actions={[
                        { label: "Open package", onSelect: () => onOpen(pkg) },
                        {
                          label: "Edit package",
                          onSelect: () => onEdit(pkg),
                        },
                        {
                          label: "Duplicate package",
                          onSelect: () => onDuplicate(pkg),
                        },
                        { label: "Delete package", tone: "danger", onSelect: () => onDelete(pkg) },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
