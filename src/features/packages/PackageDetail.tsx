import type { KeyboardEvent } from "react";

import {
  deploymentPackageLabel,
  packageFingerprint,
  registryItemLabel,
  type DeploymentPackage,
  type RegistryItem,
} from "../../domain/workspace/workspace";
import { packageReadiness } from "../../shared/ui/packageReadiness";
import type {
  ItemField,
  PackageValidationIssue,
} from "../../domain/validation/workspaceValidation";
import { ActionMenu } from "../../shared/ui/Overlays";
import {
  itemValue,
  packageMethod,
  runContext,
  shortHive,
  technicalType,
} from "../registry-items/presentation";

export function PackageDetail({
  pkg,
  issues,
  search,
  stateFilter,
  sort,
  openMenuId,
  showImport,
  onSearch,
  onStateFilter,
  onSort,
  onEditPackage,
  onDuplicatePackage,
  onDeletePackage,
  onReview,
  onDownload,
  onAddItem,
  onImport,
  onEditItem,
  onDuplicateItem,
  onSetEnabled,
  onCopyPath,
  onTransfer,
  onDeleteItem,
  onMenu,
}: {
  pkg: DeploymentPackage;
  issues: readonly PackageValidationIssue[];
  search: string;
  stateFilter: string;
  sort: string;
  openMenuId?: string | undefined;
  showImport: boolean;
  onSearch: (value: string) => void;
  onStateFilter: (value: string) => void;
  onSort: (value: string) => void;
  onEditPackage: () => void;
  onDuplicatePackage: () => void;
  onDeletePackage: () => void;
  onReview: () => void;
  onDownload: () => void;
  onAddItem: () => void;
  onImport: () => void;
  onEditItem: (item: RegistryItem, focusField?: ItemField) => void;
  onDuplicateItem: (item: RegistryItem) => void;
  onSetEnabled: (item: RegistryItem, enabled: boolean) => void;
  onCopyPath: (item: RegistryItem) => void;
  onTransfer: (item: RegistryItem) => void;
  onDeleteItem: (item: RegistryItem) => void;
  onMenu: (id?: string) => void;
}) {
  const readiness = packageReadiness(pkg, issues);
  const query = search.toLocaleLowerCase();
  const visibleItems = [...pkg.items]
    .filter((item) => stateFilter === "All" || item.registry.desiredState === stateFilter)
    .filter((item) =>
      [
        item.registry.hive,
        item.registry.keyPath,
        item.registry.valueName,
        itemValue(item),
        item.description,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    )
    .sort((left, right) =>
      sort === "valueName"
        ? registryItemLabel(left).localeCompare(registryItemLabel(right))
        : left.registry.keyPath.localeCompare(right.registry.keyPath),
    );

  const rowKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: RegistryItem) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onEditItem(item);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "d") {
      event.preventDefault();
      onDuplicateItem(item);
    } else if (event.key === "Delete") {
      event.preventDefault();
      onDeleteItem(item);
    }
  };

  return (
    <section className="wb-canvas" aria-labelledby="package-heading">
      <header className="wb-package-head">
        <div className="wb-package-head__identity">
          <span className="wb-eyebrow">Deployment Package</span>
          <h1 id="package-heading">{deploymentPackageLabel(pkg)}</h1>
          <p>
            {packageMethod(pkg)} · {runContext(pkg)} · {pkg.items.length} Registry{" "}
            {pkg.items.length === 1 ? "Item" : "Items"}
          </p>
        </div>
        <div className="wb-package-head__status">
          <span className="wb-readiness" data-tone={readiness.tone}>
            <span className="wb-status-dot" />
            {readiness.label}
          </span>
          {readiness.reason && <small>{readiness.reason}</small>}
          <code>{packageFingerprint(pkg)}</code>
        </div>
        <div className="wb-page-actions">
          <button className="wb-button wb-button--ghost" onClick={onEditPackage}>
            Edit package
          </button>
          <button className="wb-button wb-button--ghost" onClick={onReview}>
            Review output
          </button>
          <button
            className="wb-button wb-button--primary"
            disabled={!readiness.downloadable}
            onClick={onDownload}
          >
            Download package
          </button>
          <ActionMenu
            label={`More actions for ${deploymentPackageLabel(pkg)}`}
            open={openMenuId === `package:${pkg.id}`}
            onOpenChange={(open) => onMenu(open ? `package:${pkg.id}` : undefined)}
            actions={[
              { label: "Duplicate package", onSelect: onDuplicatePackage },
              { label: "Delete package", tone: "danger", onSelect: onDeletePackage },
            ]}
          />
        </div>
      </header>

      <div className="wb-surface">
        {pkg.items.length > 0 && (
          <div className="wb-commandbar">
            <div className="wb-commandbar__primary">
              <button className="wb-button wb-button--primary" onClick={onAddItem}>
                ＋ Add item
              </button>
              {showImport && (
                <button className="wb-button wb-button--ghost" onClick={onImport}>
                  Import Registry data
                </button>
              )}
            </div>
          </div>
        )}
        {pkg.items.length === 0 ? (
          <div className="wb-empty-state">
            <div className="wb-empty-state__glyph" aria-hidden="true">
              ⌘
            </div>
            <span>Empty package</span>
            <h2>Add the first Registry Item</h2>
            <p>Add or import at least one enabled Registry Item to generate package output.</p>
            <div>
              <button className="wb-button wb-button--primary" onClick={onAddItem}>
                Add item
              </button>
              {showImport && (
                <button className="wb-button wb-button--ghost" onClick={onImport}>
                  Import Registry data
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="wb-filterbar">
              <label className="wb-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  aria-label="Search Registry Items"
                  placeholder="Search path, value, or data"
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                />
              </label>
              <select
                aria-label="Filter desired state"
                value={stateFilter}
                onChange={(event) => onStateFilter(event.target.value)}
              >
                <option value="All">All states</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
              </select>
              <select
                aria-label="Sort Registry Items"
                value={sort}
                onChange={(event) => onSort(event.target.value)}
              >
                <option value="path">Registry path</option>
                <option value="valueName">Value name</option>
              </select>
            </div>
            {visibleItems.length === 0 ? (
              <div className="wb-empty-state wb-empty-state--compact">
                <h2>No matching Registry Items</h2>
                <p>Change the current search or state filter.</p>
              </div>
            ) : (
              <div className="wb-item-list" role="table" aria-label="Registry Items">
                <div className="wb-item-list__header" role="row">
                  <span role="columnheader">Enabled</span>
                  <span role="columnheader">Registry Item</span>
                  <span role="columnheader">Registry target</span>
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Value</span>
                  <span role="columnheader">State</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Actions</span>
                </div>
                {visibleItems.map((item) => {
                  const itemIssues = issues.filter((issue) => issue.itemId === item.id);
                  const itemError = itemIssues.some((issue) => issue.severity === "Error");
                  const itemWarning = itemIssues.some((issue) => issue.severity === "Warning");
                  return (
                    <div
                      key={item.id}
                      className="wb-item-row"
                      role="row"
                      tabIndex={0}
                      data-item-id={item.id}
                      onKeyDown={(event) => rowKeyDown(event, item)}
                      onDoubleClick={() => onEditItem(item)}
                    >
                      <div role="cell">
                        <label className="wb-toggle">
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`${item.enabled ? "Disable" : "Enable"} ${registryItemLabel(item)}`}
                            checked={item.enabled}
                            onChange={(event) => onSetEnabled(item, event.target.checked)}
                          />
                          <span />
                        </label>
                      </div>
                      <div role="cell">
                        <strong>{registryItemLabel(item)}</strong>
                        {item.description && <small>{item.description}</small>}
                      </div>
                      <button
                        className="wb-target"
                        role="cell"
                        title="Copy full Registry path"
                        onClick={() => onCopyPath(item)}
                      >
                        <span>{shortHive(item)}</span>
                        <code>{item.registry.keyPath}</code>
                        <small>{item.registry.valueName || "Default value"}</small>
                      </button>
                      <div role="cell">
                        <code>
                          {item.registry.desiredState === "Present" ? technicalType(item) : "—"}
                        </code>
                      </div>
                      <div className="wb-item-value" role="cell">
                        <code>{itemValue(item)}</code>
                      </div>
                      <div role="cell">
                        <span className="wb-state" data-state={item.registry.desiredState}>
                          {item.registry.desiredState}
                        </span>
                      </div>
                      <div role="cell">
                        <button
                          className="wb-status-link"
                          disabled={itemIssues.length === 0}
                          data-tone={itemError ? "error" : itemWarning ? "warning" : "ready"}
                          onClick={() =>
                            itemIssues[0] &&
                            onEditItem(item, itemIssues[0].field as ItemField | undefined)
                          }
                        >
                          {itemError ? "Error" : itemWarning ? "Warning" : "Ready"}
                        </button>
                      </div>
                      <div role="cell">
                        <ActionMenu
                          label={`More actions for ${registryItemLabel(item)}`}
                          open={openMenuId === item.id}
                          onOpenChange={(open) => onMenu(open ? item.id : undefined)}
                          actions={[
                            {
                              label: "Edit item",
                              onSelect: () => onEditItem(item),
                            },
                            {
                              label: "Duplicate item",
                              onSelect: () => onDuplicateItem(item),
                            },
                            { label: "Copy Registry path", onSelect: () => onCopyPath(item) },
                            { label: "Move or copy item", onSelect: () => onTransfer(item) },
                            {
                              label: "Delete item",
                              tone: "danger",
                              onSelect: () => onDeleteItem(item),
                            },
                          ]}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
