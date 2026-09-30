import { useRef, type KeyboardEvent } from "react";

import {
  deploymentPackageLabel,
  packageFingerprint,
  registryItemLabel,
  type DeploymentPackage,
  type RegistryItem,
} from "../../domain/workspace/workspace";
import { packageReadiness } from "../../shared/ui/packageReadiness";
import {
  isItemField,
  isPackageField,
  type ItemField,
  type PackageField,
  type PackageValidationIssue,
} from "../../domain/validation/workspaceValidation";
import { ActionMenu } from "../../shared/ui/Overlays";
import {
  ChevronGlyph,
  ContextGlyph,
  ImportGlyph,
  InfoGlyph,
  ItemListGlyph,
  MethodGlyph,
  PackageGlyph,
  PencilGlyph,
  SearchGlyph,
} from "../../shared/ui/icons";
import { RegistryItemComposer } from "../registry-items/RegistryItemComposer";
import type { RequestConfirm } from "../../shared/ui/confirm";
import type { ItemDraftState } from "../registry-items/itemDraftState";
import {
  isSuggestedPackageName,
  itemValue,
  packageMethod,
  packageOutputLabel,
  runContext,
  shortHive,
  technicalType,
} from "../registry-items/presentation";
import { DEPLOYMENT_TARGET_DEFINITIONS } from "../../domain/workspace/deployment";

export function PackageDetail({
  pkg,
  requestConfirm,
  issues,
  templateReferences,
  eligibleItemCount,
  search,
  stateFilter,
  sort,
  openMenuId,
  showImport,
  onSearch,
  onStateFilter,
  onSort,
  onEditPackage,
  onRenamePackage,
  onSetMethod,
  onSetRunContext,
  onDuplicatePackage,
  onDeletePackage,
  onReview,
  onDownload,
  draftState,
  draftDirty,
  onDraftChange,
  onCommitDraft,
  onOpenItemDetails,
  onDiscardDraft,
  onImport,
  onCreateAdministrativeTemplate,
  onOpenTemplate,
  onEditItem,
  onDuplicateItem,
  onSetEnabled,
  onCopyPath,
  onTransfer,
  onDeleteItem,
  onMenu,
}: {
  pkg: DeploymentPackage;
  /** The app's one confirmation surface, handed to the inline form for its destructive-shape check. */
  requestConfirm: RequestConfirm;
  issues: readonly PackageValidationIssue[];
  templateReferences: ReadonlyArray<{
    item: RegistryItem;
    references: ReadonlyArray<{ templateId: string; templateName: string }>;
  }>;
  eligibleItemCount: number;
  search: string;
  stateFilter: string;
  sort: string;
  openMenuId?: string | undefined;
  showImport: boolean;
  onSearch: (value: string) => void;
  onStateFilter: (value: string) => void;
  onSort: (value: string) => void;
  onEditPackage: (focusField?: PackageField) => void;
  /** The header name is part of the package: it takes effect while it is typed. */
  onRenamePackage: (name: string) => void;
  /** Both settings take effect immediately, so the header states what the package produces. */
  onSetMethod: (method: DeploymentPackage["deployment"]["method"]) => void;
  onSetRunContext: (context: DeploymentPackage["deployment"]["runContext"]) => void;
  onDuplicatePackage: () => void;
  onDeletePackage: () => void;
  onReview: () => void;
  onDownload: () => void;
  draftState: ItemDraftState;
  draftDirty: boolean;
  onDraftChange: (next: ItemDraftState) => void;
  onCommitDraft: (item: RegistryItem) => void;
  onOpenItemDetails: (focusField?: ItemField) => void;
  onDiscardDraft: () => void;
  onImport: () => void;
  onCreateAdministrativeTemplate: () => void;
  onOpenTemplate: (templateId: string) => void;
  onEditItem: (item: RegistryItem, focusField?: ItemField) => void;
  onDuplicateItem: (item: RegistryItem) => void;
  onSetEnabled: (item: RegistryItem, enabled: boolean) => void;
  onCopyPath: (item: RegistryItem) => void;
  onTransfer: (item: RegistryItem) => void;
  onDeleteItem: (item: RegistryItem) => void;
  onMenu: (id?: string) => void;
}) {
  const packageNameRef = useRef<HTMLInputElement>(null);
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
    <section className="wb-canvas wb-canvas--package-detail" aria-labelledby="package-heading">
      <header className="wb-package-head wb-view-head">
        <div className="wb-package-head__identity">
          <span className="wb-eyebrow">
            <PackageGlyph />
            Deployment Package
          </span>
          {/*
           * The heading carries the name and the input inside it edits that name in place. The pencil is
           * outside the heading on purpose: inside it, its label would join the heading's accessible name.
           * A name that is still the suggestion is drawn muted, and the permanent underline says that the
           * line is a field.
           */}
          <div className="wb-package-name-row">
            <h1 id="package-heading" className="wb-package-name">
              <input
                ref={packageNameRef}
                aria-label="Deployment Package name"
                title="Rename this Deployment Package"
                data-suggested={isSuggestedPackageName(pkg.name) ? "true" : undefined}
                value={pkg.name}
                onChange={(event) => onRenamePackage(event.target.value)}
              />
            </h1>
            <button
              type="button"
              className="wb-package-rename"
              aria-label="Rename Deployment Package"
              title="Rename this Deployment Package"
              onClick={() => {
                // Only this control replaces the whole name, so a click inside the field keeps its caret.
                packageNameRef.current?.focus();
                packageNameRef.current?.select();
              }}
            >
              <PencilGlyph />
            </button>
          </div>
          <div className="wb-package-settings">
            {/*
             * The delivery method and the run context decide what the package produces and how HKCU
             * items behave, so they are visible and one click away instead of sitting behind the
             * package editor. Each pill shows its current value and opens the menu that changes it.
             */}
            <ActionMenu
              label={`Delivery method for ${deploymentPackageLabel(pkg)}: ${packageMethod(pkg)}`}
              tone="accent"
              open={openMenuId === `method:${pkg.id}`}
              onOpenChange={(open) => onMenu(open ? `method:${pkg.id}` : undefined)}
              trigger={
                <>
                  <MethodGlyph />
                  <span>{packageMethod(pkg)}</span>
                  <ChevronGlyph />
                </>
              }
              actions={DEPLOYMENT_TARGET_DEFINITIONS.map((definition) => ({
                label: `${definition.label} · ${packageOutputLabel(definition.id)}`,
                onSelect: () => onSetMethod(definition.id),
              }))}
            />
            <ActionMenu
              label={`Run context for ${deploymentPackageLabel(pkg)}: ${runContext(pkg)}`}
              open={openMenuId === `context:${pkg.id}`}
              onOpenChange={(open) => onMenu(open ? `context:${pkg.id}` : undefined)}
              trigger={
                <>
                  <ContextGlyph />
                  <span>{runContext(pkg)}</span>
                  <ChevronGlyph />
                </>
              }
              actions={[
                { label: "SYSTEM", onSelect: () => onSetRunContext("System") },
                { label: "Logged-on user", onSelect: () => onSetRunContext("LoggedOnUser") },
              ]}
            />
            <span className="wb-package-settings__count">
              <ItemListGlyph />
              {pkg.items.length} Registry {pkg.items.length === 1 ? "Item" : "Items"}
            </span>
          </div>
        </div>
        <div className="wb-package-head__aside">
          {/*
           * Status and actions share the second column, so the header height is the taller of the two
           * columns instead of the sum of four stacked bands. The package ID sits next to the state, and
           * the reason, when there is one, gets its own line.
           */}
          <div className="wb-package-head__status" data-tone={readiness.tone}>
            <span className="wb-readiness" data-tone={readiness.tone}>
              <span className="wb-status-dot" />
              {readiness.label}
            </span>
            <code>{packageFingerprint(pkg)}</code>
            {readiness.reason && <small>{readiness.reason}</small>}
          </div>
          <div className="wb-page-actions">
            <button className="wb-button wb-button--ghost" onClick={() => onEditPackage()}>
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
        </div>
      </header>

      <div className="wb-surface wb-registry-workspace">
        <div className="wb-registry-workspace__heading">
          {/* The header above already states how many items the package holds, so the card only names itself. */}
          <h2 className="wb-eyebrow">
            <ItemListGlyph />
            Registry Items
          </h2>
        </div>
        {pkg.items.length === 0 && (
          <div className="wb-composer-intro">
            <div className="wb-composer-intro__hint">
              <InfoGlyph />
              <p>
                This package holds no Registry Item yet. Add the first one below, or bring in an
                existing Registry file.
              </p>
            </div>
            {showImport && (
              <button className="wb-button wb-button--ghost" onClick={onImport}>
                <ImportGlyph />
                Import Registry data
              </button>
            )}
          </div>
        )}
        <RegistryItemComposer
          deploymentPackage={pkg}
          requestConfirm={requestConfirm}
          state={draftState}
          draftDirty={draftDirty}
          onStateChange={onDraftChange}
          onCommit={onCommitDraft}
          onOpenDetails={onOpenItemDetails}
          onDiscard={onDiscardDraft}
        />
        {templateReferences.length > 0 && (
          <div className="wb-template-links">
            <span>Used by administrative templates:</span>
            {[
              ...new Map(
                templateReferences.flatMap((entry) =>
                  entry.references.map((reference) => [reference.templateId, reference] as const),
                ),
              ).values(),
            ].map((reference) => (
              <button
                key={reference.templateId}
                className="wb-button wb-button--quiet"
                onClick={() => onOpenTemplate(reference.templateId)}
              >
                {reference.templateName}
              </button>
            ))}
          </div>
        )}
        {pkg.items.length > 0 && (
          <>
            <div className="wb-toolbar">
              <div className="wb-toolbar__actions">
                {showImport && (
                  <button className="wb-button wb-button--ghost" onClick={onImport}>
                    <ImportGlyph />
                    Import Registry data
                  </button>
                )}
                {eligibleItemCount > 0 && (
                  <button
                    className="wb-button wb-button--ghost"
                    onClick={onCreateAdministrativeTemplate}
                  >
                    Create template from selected items…
                  </button>
                )}
              </div>
              {/* Search and filters wrap as one group, so a single select never ends up alone on a line. */}
              <div className="wb-toolbar__filters">
                <label className="wb-search">
                  <SearchGlyph />
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
                      <div role="cell" data-cell-label="Enabled">
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
                      <div role="cell" data-cell-label="Registry Item">
                        <strong>{registryItemLabel(item)}</strong>
                        {item.description && <small>{item.description}</small>}
                      </div>
                      <button
                        data-cell-label="Registry target"
                        className="wb-target"
                        role="cell"
                        title="Copy full Registry path"
                        onClick={() => onCopyPath(item)}
                      >
                        <span>{shortHive(item)}</span>
                        <code>{item.registry.keyPath}</code>
                        <small>{item.registry.valueName || "Default value"}</small>
                      </button>
                      <div role="cell" data-cell-label="Type">
                        <code>
                          {item.registry.desiredState === "Present" ? technicalType(item) : "—"}
                        </code>
                      </div>
                      <div className="wb-item-value" role="cell" data-cell-label="Value">
                        <code>{itemValue(item)}</code>
                      </div>
                      <div role="cell" data-cell-label="State">
                        <span className="wb-state" data-state={item.registry.desiredState}>
                          {item.registry.desiredState}
                        </span>
                      </div>
                      <div role="cell" data-cell-label="Status">
                        <button
                          className="wb-status-link"
                          disabled={itemIssues.length === 0}
                          data-tone={itemError ? "error" : itemWarning ? "warning" : "ready"}
                          onClick={() => {
                            const issue = itemIssues[0];
                            if (!issue) return;
                            // A package-owned field is fixed where the package is edited; every other
                            // issue belongs to this item, with a focus target when one is known.
                            if (isPackageField(issue.field)) onEditPackage(issue.field);
                            else if (isItemField(issue.field)) onEditItem(item, issue.field);
                            else onEditItem(item);
                          }}
                        >
                          <span className="wb-status-dot" />
                          {itemError ? "Error" : itemWarning ? "Warning" : "Ready"}
                        </button>
                      </div>
                      <div role="cell" data-cell-label="Actions">
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
