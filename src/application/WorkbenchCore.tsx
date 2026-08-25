import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from "./runtimeConfig";
import { GENERATOR_VERSION, RELEASE_VERSION } from "../version";
import {
  cloneDeploymentPackage,
  cloneRegistryItem,
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  deploymentPackageLabel,
  registryItemLabel,
  type DeploymentPackage,
  type RegistryItem,
} from "../domain/workspace/workspace";
import {
  deploymentPackageName,
  generateDeploymentPackageZip,
  generateWorkspacePackagesZip,
  workspaceArchiveName,
} from "./packageBuildService";
import { copyText } from "../platform/browser/clipboard";
import {
  importPackageAsCopy,
  importRegistryJson,
  MAX_REGISTRY_JSON_BYTES,
} from "../serialization/workspaceSchema";
import { readUtf8TextFile } from "../platform/browser/files";
import { downloadArtifact } from "../platform/browser/download";
import { englishUi } from "../shared/localization/locale";
import { countLabel } from "../shared/ui/grammar";
import { validateGeneratedPackageOutput } from "../domain/validation/packageOutputValidation";
import { validateWorkspace, type ItemField } from "../domain/validation/workspaceValidation";
import { Dialog } from "../shared/ui/Overlays";
import { AppFooter } from "../shared/ui/AppFooter";
import { PackageDialog, type PackageDialogMode } from "../features/packages/PackageDialog";
import {
  PackageDetail,
  PackageNavigator,
  PackageOverview,
  ProductMark,
} from "../features/packages/PackageSurfaces";
import { PackageReviewDialog } from "../features/review/PackageReviewDialog";
import { RegistryImportDialog } from "../features/import/RegistryImportDialog";
import {
  RegistryItemDialog,
  type RegistryItemDialogMode,
} from "../features/registry-items/RegistryItemDialog";
import { TransferDialog } from "../features/registry-items/TransferDialog";
import { selectPackage, selectSelectedPackages, selectVisiblePackages } from "./selectors";
import {
  createWorkbenchState,
  workbenchReducer,
  type Notice,
  type WorkbenchOverlay,
} from "./workspaceReducer";
import {
  removeItem,
  removePackage,
  renameWorkspace,
  saveItem as saveWorkspaceItem,
  savePackage as saveWorkspacePackage,
  setItemEnabled as setWorkspaceItemEnabled,
  transferItem as transferWorkspaceItem,
} from "./workspaceOperations";
import { authorizePackageDownload } from "./packageDownloads";
import { commitRegistryImport } from "../features/import/registryImport";
import { packageImportDecision } from "../features/packages/workspaceImport";
import type { ImportedContentResult, UseWorkspaceLifecycle } from "./workspaceLifecycle";

export function WorkbenchCore({
  runtimeConfig = DEFAULT_RUNTIME_CONFIG,
  useWorkspaceLifecycle,
}: {
  runtimeConfig?: RuntimeConfig;
  useWorkspaceLifecycle: UseWorkspaceLifecycle;
}) {
  const [state, dispatch] = useReducer(workbenchReducer, undefined, () =>
    createWorkbenchState(createWorkspace(), runtimeConfig.defaultTheme),
  );
  const [memoryNoticeOpen, setMemoryNoticeOpen] = useState(true);
  const {
    workspace,
    modified,
    theme,
    openPackageId,
    packageSearch,
    methodFilter,
    contextFilter,
    packageSort,
    itemSearch,
    stateFilter,
    itemSort,
    selectMode,
    selected,
    openMenuId,
    overlay,
    notice,
  } = state;
  const workspaceReadRequest = useRef(0);
  const workspaceRef = useRef(workspace);
  const modifiedRef = useRef(modified);
  const [lastItemTarget, setLastItemTarget] = useState<
    Record<string, { hive: RegistryItem["registry"]["hive"]; keyPath: string }>
  >({});
  const workspaceNameId = useId();
  workspaceRef.current = workspace;
  modifiedRef.current = modified;

  useEffect(() => {
    setLastItemTarget({});
  }, [workspace.id]);

  const issues = useMemo(
    () => [
      ...validateWorkspace(workspace),
      ...workspace.packages.flatMap(validateGeneratedPackageOutput),
    ],
    [workspace],
  );
  const openPackage = selectPackage(workspace, openPackageId);
  const reviewPackage =
    overlay?.kind === "review" ? selectPackage(workspace, overlay.packageId) : undefined;
  const visiblePackages = useMemo(
    () =>
      selectVisiblePackages(workspace, {
        search: packageSearch,
        method: methodFilter,
        context: contextFilter,
        sort: packageSort,
      }),
    [contextFilter, methodFilter, packageSearch, packageSort, workspace],
  );

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "notice/set", notice: undefined }),
      3500,
    );
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    if (!modified) return;
    const protectUnsavedWorkspace = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedWorkspace);
    return () => window.removeEventListener("beforeunload", protectUnsavedWorkspace);
  }, [modified]);

  const setNotice = useCallback(
    (next?: Notice) => dispatch({ type: "notice/set", notice: next }),
    [],
  );
  const setEditorDirty = useCallback(
    (dirty: boolean) => dispatch({ type: "overlay/dirty", dirty }),
    [],
  );
  const setWorkspace = useCallback(
    (next: typeof workspace, markModified = true) =>
      dispatch({ type: "workspace/commit", workspace: next, modified: markModified }),
    [],
  );
  const replaceWorkspace = useCallback(
    (next: typeof workspace) => dispatch({ type: "workspace/open", workspace: next }),
    [],
  );
  const resetWorkspaceState = useCallback(
    (next: typeof workspace) => dispatch({ type: "workspace/reset", workspace: next }),
    [],
  );

  const applyImportedContent = useCallback(
    (content: string): ImportedContentResult => {
      try {
        const imported = importRegistryJson(content);
        if (imported.kind === "workspace") {
          if (modifiedRef.current && !window.confirm(englishUi.common.workspace.replaceModified))
            return { kind: "aborted" };
          setNotice({ kind: "success", message: englishUi.common.workspace.opened });
          return { kind: "workspace", workspace: imported.workspace };
        }
        const decision = packageImportDecision(workspaceRef.current, imported.package);
        if (decision.kind === "collision") {
          dispatch({
            type: "overlay/open",
            overlay: {
              kind: "package-collision",
              filePackage: imported.package,
              collision: decision.collision,
            },
          });
          return { kind: "collision" };
        }
        setWorkspace(saveWorkspacePackage(workspaceRef.current, imported.package.package));
        dispatch({ type: "package/open", packageId: imported.package.package.id });
        setNotice({ kind: "success", message: englishUi.packages.notices.imported });
        return { kind: "package" };
      } catch (error) {
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : englishUi.common.workspace.openFailed,
        });
        return { kind: "aborted" };
      }
    },
    [dispatch, modifiedRef, setNotice, setWorkspace, workspaceRef],
  );

  const lifecycle = useWorkspaceLifecycle({
    workspace,
    modified,
    workspaceRef,
    modifiedRef,
    replaceWorkspace,
    commitWorkspace: setWorkspace,
    resetWorkspace: resetWorkspaceState,
    setNotice,
    applyImportedContent,
  });

  const closeEditor = useCallback(
    (force = false) => {
      if (
        !force &&
        overlay &&
        (overlay.kind === "package-editor" || overlay.kind === "item-editor") &&
        overlay.dirty &&
        !window.confirm(englishUi.registryItems.editor.discard)
      )
        return false;
      dispatch({ type: "overlay/close" });
      return true;
    },
    [overlay],
  );

  const prepareEditor = () => {
    if (
      overlay &&
      (overlay.kind === "package-editor" || overlay.kind === "item-editor") &&
      !closeEditor()
    )
      return false;
    return true;
  };
  const openPackageEditor = (
    mode: PackageDialogMode,
    pkg: DeploymentPackage,
    replacingId?: string,
  ) => {
    if (!prepareEditor()) return;
    dispatch({
      type: "overlay/open",
      overlay: {
        kind: "package-editor",
        mode,
        pkg,
        dirty: false,
        ...(replacingId ? { replacingId } : {}),
      },
    });
  };
  const openItemEditor = (
    mode: RegistryItemDialogMode,
    pkg: DeploymentPackage,
    item: RegistryItem,
    replacingId?: string,
    focusField?: ItemField,
  ) => {
    if (!prepareEditor()) return;
    dispatch({
      type: "overlay/open",
      overlay: {
        kind: "item-editor",
        mode,
        packageId: pkg.id,
        item,
        dirty: false,
        ...(replacingId ? { replacingId } : {}),
        ...(focusField ? { focusField } : {}),
      },
    });
  };

  const savePackage = (pkg: DeploymentPackage) => {
    if (overlay?.kind !== "package-editor") return;
    setWorkspace(saveWorkspacePackage(workspace, pkg, overlay.replacingId));
    dispatch({ type: "package/open", packageId: pkg.id });
    setNotice({
      kind: "success",
      message:
        overlay.mode === "edit"
          ? englishUi.packages.notices.updated
          : englishUi.packages.notices.added,
    });
    closeEditor(true);
  };
  const saveItem = (item: RegistryItem) => {
    if (overlay?.kind !== "item-editor") return;
    setWorkspace(saveWorkspaceItem(workspace, overlay.packageId, item, overlay.replacingId));
    setLastItemTarget((current) => ({
      ...current,
      [overlay.packageId]: { hive: item.registry.hive, keyPath: item.registry.keyPath },
    }));
    setNotice({
      kind: "success",
      message:
        overlay.mode === "edit"
          ? englishUi.registryItems.notices.updated
          : englishUi.registryItems.notices.added,
    });
    closeEditor(true);
  };
  const deletePackage = (pkg: DeploymentPackage) => {
    if (!window.confirm(`Delete Deployment Package “${deploymentPackageLabel(pkg)}”?`)) return;
    setWorkspace(removePackage(workspace, pkg.id));
    if (selected.has(pkg.id)) dispatch({ type: "selection/toggle", packageId: pkg.id });
    if (openPackageId === pkg.id) dispatch({ type: "package/open", packageId: undefined });
    dispatch({ type: "overlay/close" });
    setNotice({ kind: "success", message: englishUi.packages.notices.deleted });
  };
  const deleteItem = (pkg: DeploymentPackage, item: RegistryItem) => {
    if (!window.confirm(`Delete Registry Item “${registryItemLabel(item)}”?`)) return;
    setWorkspace(removeItem(workspace, pkg.id, item.id));
    setNotice({ kind: "success", message: englishUi.registryItems.notices.deleted });
  };
  const setItemEnabled = (pkg: DeploymentPackage, item: RegistryItem, enabled: boolean) =>
    setWorkspace(setWorkspaceItemEnabled(workspace, pkg.id, item.id, enabled));
  const copyPath = (item: RegistryItem) =>
    void copyText(
      `${item.registry.hive}\\${item.registry.keyPath}\\${item.registry.valueName || "(Default)"}`,
    )
      .then(() =>
        setNotice({ kind: "success", message: englishUi.registryItems.notices.pathCopied }),
      )
      .catch((error: unknown) =>
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Registry path could not be copied.",
        }),
      );
  const commitTransfer = (targetPackageId: string, action: "move" | "copy") => {
    if (overlay?.kind !== "transfer") return;
    setWorkspace(
      transferWorkspaceItem(workspace, overlay.packageId, targetPackageId, overlay.item, action),
    );
    dispatch({ type: "overlay/close" });
    setNotice({
      kind: "success",
      message:
        action === "move"
          ? englishUi.registryItems.notices.moved
          : englishUi.registryItems.notices.copied,
    });
  };

  const authorizePackages = (packages: DeploymentPackage[], bulk = false) => {
    const result = authorizePackageDownload(packages, bulk);
    if (!result.allowed) {
      setNotice({ kind: result.tone, message: result.message });
      return false;
    }
    return result.confirmation ? window.confirm(result.confirmation) : true;
  };
  const downloadPackage = (pkg: DeploymentPackage) => {
    if (!authorizePackages([pkg])) return;
    void (async () => {
      try {
        await downloadArtifact({
          name: deploymentPackageName(pkg),
          mediaType: "application/zip",
          content: generateDeploymentPackageZip(workspace, pkg),
        });
        setNotice({ kind: "success", message: englishUi.packages.notices.downloaded });
      } catch (error) {
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Download failed.",
        });
      }
    })();
  };
  const downloadPackages = (packages: DeploymentPackage[], scope: "selected" | "all") => {
    if (!authorizePackages(packages, true)) return;
    void (async () => {
      try {
        await downloadArtifact({
          name: workspaceArchiveName(workspace, scope),
          mediaType: "application/zip",
          content: generateWorkspacePackagesZip(workspace, new Set(packages.map((pkg) => pkg.id))),
        });
        setNotice({
          kind: "success",
          message: `${countLabel(packages.length, "Deployment Package")} downloaded`,
        });
      } catch (error) {
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : "Download failed.",
        });
      }
    })();
  };

  const importPackage = (
    filePackage: Extract<WorkbenchOverlay, { kind: "package-collision" }>["filePackage"],
    replace = false,
  ) => {
    const pkg = replace ? filePackage.package : importPackageAsCopy(filePackage);
    setWorkspace(
      saveWorkspacePackage(workspace, pkg, replace ? filePackage.package.id : undefined),
    );
    dispatch({ type: "package/open", packageId: pkg.id });
    dispatch({ type: "overlay/close" });
    setNotice({
      kind: "success",
      message: replace
        ? englishUi.packages.notices.replaced
        : englishUi.packages.notices.importedCopy,
    });
  };

  const readWorkspace = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const request = ++workspaceReadRequest.current;
    void readUtf8TextFile(file, MAX_REGISTRY_JSON_BYTES)
      .then((content) => {
        if (request !== workspaceReadRequest.current) return;
        try {
          const applied = applyImportedContent(content);
          if (applied.kind === "workspace") lifecycle.afterNewWorkspace(applied.workspace);
        } catch (error) {
          setNotice({
            kind: "error",
            message: error instanceof Error ? error.message : englishUi.common.workspace.openFailed,
          });
        }
      })
      .catch((error: unknown) => {
        if (request !== workspaceReadRequest.current) return;
        setNotice({
          kind: "error",
          message: error instanceof Error ? error.message : englishUi.common.workspace.openFailed,
        });
      });
  };

  const resetWorkspace = () => {
    const empty = createWorkspace();
    const hasWork =
      modified || workspace.packages.length > 0 || workspace.name.trim() !== empty.name;
    if (hasWork && !lifecycle.confirmNewWorkspace()) return;
    if (
      overlay &&
      (overlay.kind === "package-editor" || overlay.kind === "item-editor") &&
      !closeEditor()
    )
      return;
    const next = createWorkspace();
    lifecycle.afterNewWorkspace(next);
  };
  const selectedPackages = selectSelectedPackages(workspace, selected);
  const selfHostItem = runtimeConfig.footer.items.find((item) => item.kind === "github");

  return (
    <div
      className={"wb-app" + (runtimeConfig.footer.items.length > 0 ? " wb-app--with-footer" : "")}
      data-theme={theme}
      style={{ "--wb-accent": runtimeConfig.accentColor } as CSSProperties}
    >
      <header className="wb-topbar">
        <div className="wb-brand">
          {runtimeConfig.logo ? <img src={runtimeConfig.logo} alt="" /> : <ProductMark />}
          <div>
            <strong>{runtimeConfig.applicationName}</strong>
            {runtimeConfig.organizationName && <span>{runtimeConfig.organizationName}</span>}
          </div>
        </div>
        <div className="wb-workspace-name">
          <label className="wb-workspace-name__label" htmlFor={workspaceNameId}>
            {englishUi.common.workspace.label}
          </label>
          <input
            id={workspaceNameId}
            aria-label={englishUi.common.workspace.nameLabel}
            value={workspace.name}
            onChange={(event) => setWorkspace(renameWorkspace(workspace, event.target.value))}
          />
          {lifecycle.status && (
            <span
              className="wb-workspace-persist"
              data-tone={lifecycle.status.tone}
              aria-live="polite"
              {...(lifecycle.status.ariaLabel ? { "aria-label": lifecycle.status.ariaLabel } : {})}
            >
              <span className="is-on">{lifecycle.status.text}</span>
            </span>
          )}
        </div>
        <nav className="wb-global-actions" aria-label={englishUi.common.workspace.actionsLabel}>
          <button onClick={resetWorkspace}>{englishUi.common.actions.newWorkspace}</button>
          <button onClick={lifecycle.openWorkspace}>{englishUi.common.actions.open}</button>
          <input
            ref={lifecycle.workspaceFileRef}
            className="wb-visually-hidden"
            aria-label={englishUi.common.workspace.openFileLabel}
            type="file"
            accept=".json,application/json"
            onChange={readWorkspace}
          />
          <button onClick={lifecycle.exportWorkspace}>
            {englishUi.common.actions.exportWorkspace}
          </button>
          <div className="wb-utility-actions">
            <button
              className="wb-icon-button"
              aria-label={englishUi.common.utility.changeTheme}
              title={`Theme: ${theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"}`}
              onClick={() =>
                dispatch({
                  type: "theme/set",
                  theme: theme === "light" ? "dark" : theme === "dark" ? "system" : "light",
                })
              }
            >
              {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"}
            </button>
            <button
              className="wb-icon-button"
              aria-label={englishUi.common.utility.about}
              onClick={() =>
                dispatch({ type: "overlay/open", overlay: { kind: "utility", page: "about" } })
              }
            >
              ?
            </button>
          </div>
        </nav>
      </header>

      <main className="wb-workbench" aria-label="Registry deployment Workspace">
        <PackageNavigator
          workspace={workspace}
          openPackageId={openPackageId}
          issues={issues}
          onOverview={() => dispatch({ type: "package/open", packageId: undefined })}
          onOpen={(pkg) => dispatch({ type: "package/open", packageId: pkg.id })}
          onAdd={() => openPackageEditor("create", createDeploymentPackage())}
        />
        <div className="wb-content-pane">
          {openPackage ? (
            <PackageDetail
              pkg={openPackage}
              issues={issues.filter((issue) => issue.packageId === openPackage.id)}
              search={itemSearch}
              stateFilter={stateFilter}
              sort={itemSort}
              openMenuId={openMenuId}
              showImport={runtimeConfig.showImport}
              onSearch={(value) => dispatch({ type: "item/search", value })}
              onStateFilter={(value) => dispatch({ type: "item/state", value })}
              onSort={(value) => dispatch({ type: "item/sort", value })}
              onEditPackage={() => openPackageEditor("edit", openPackage, openPackage.id)}
              onDuplicatePackage={() =>
                openPackageEditor("duplicate", cloneDeploymentPackage(openPackage))
              }
              onDeletePackage={() => deletePackage(openPackage)}
              onReview={() => {
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "review", packageId: openPackage.id },
                });
              }}
              onDownload={() => downloadPackage(openPackage)}
              onAddItem={() => {
                const blank = createRegistryItem();
                const last = lastItemTarget[openPackage.id];
                openItemEditor(
                  "create",
                  openPackage,
                  last
                    ? {
                        ...blank,
                        registry: {
                          ...blank.registry,
                          hive: last.hive,
                          keyPath: last.keyPath,
                        },
                      }
                    : blank,
                );
              }}
              onImport={() =>
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "registry-import", packageId: openPackage.id },
                })
              }
              onEditItem={(item, focusField) =>
                openItemEditor("edit", openPackage, item, item.id, focusField)
              }
              onDuplicateItem={(item) =>
                openItemEditor("duplicate", openPackage, cloneRegistryItem(item))
              }
              onSetEnabled={(item, enabled) => setItemEnabled(openPackage, item, enabled)}
              onCopyPath={copyPath}
              onTransfer={(item) =>
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "transfer", packageId: openPackage.id, item },
                })
              }
              onDeleteItem={(item) => deleteItem(openPackage, item)}
              onMenu={(id) => dispatch({ type: "menu/open", id })}
            />
          ) : (
            <PackageOverview
              workspace={workspace}
              packages={visiblePackages}
              issues={issues}
              search={packageSearch}
              methodFilter={methodFilter}
              contextFilter={contextFilter}
              sort={packageSort}
              selectMode={selectMode}
              selected={selected}
              openMenuId={openMenuId}
              onSearch={(value) => dispatch({ type: "package/search", value })}
              onMethodFilter={(value) => dispatch({ type: "package/method", value })}
              onContextFilter={(value) => dispatch({ type: "package/context", value })}
              onSort={(value) => dispatch({ type: "package/sort", value })}
              onSelectMode={(value) => dispatch({ type: "selection/mode", value })}
              onClearSelection={() => dispatch({ type: "selection/clear" })}
              onToggleSelected={(id) => dispatch({ type: "selection/toggle", packageId: id })}
              onAdd={() => openPackageEditor("create", createDeploymentPackage())}
              {...(runtimeConfig.showImport
                ? {
                    onImport: () =>
                      dispatch({
                        type: "overlay/open",
                        overlay: { kind: "registry-import" },
                      }),
                  }
                : {})}
              onOpen={(pkg) => dispatch({ type: "package/open", packageId: pkg.id })}
              onReview={(pkg) =>
                dispatch({ type: "overlay/open", overlay: { kind: "review", packageId: pkg.id } })
              }
              onDownload={downloadPackage}
              onDownloadSelected={() => downloadPackages(selectedPackages, "selected")}
              onDownloadAll={() => downloadPackages(workspace.packages, "all")}
              onEdit={(pkg) => openPackageEditor("edit", pkg, pkg.id)}
              onDuplicate={(pkg) => openPackageEditor("duplicate", cloneDeploymentPackage(pkg))}
              onDelete={deletePackage}
              onMenu={(id) => dispatch({ type: "menu/open", id })}
            />
          )}
        </div>
      </main>

      <AppFooter
        items={runtimeConfig.footer.items}
        identity={runtimeConfig.organizationName || runtimeConfig.applicationName}
      />

      {overlay?.kind === "package-editor" && (
        <PackageDialog
          initialPackage={overlay.pkg}
          mode={overlay.mode}
          onDirtyChange={setEditorDirty}
          onSave={savePackage}
          onCancel={() => closeEditor()}
        />
      )}
      {overlay?.kind === "item-editor" &&
        (() => {
          const pkg = workspace.packages.find((candidate) => candidate.id === overlay.packageId);
          return pkg ? (
            <RegistryItemDialog
              initialItem={overlay.item}
              deploymentPackage={pkg}
              mode={overlay.mode}
              {...(overlay.focusField ? { focusField: overlay.focusField } : {})}
              onDirtyChange={setEditorDirty}
              onSave={saveItem}
              onCancel={() => closeEditor()}
            />
          ) : null;
        })()}
      {reviewPackage && (
        <PackageReviewDialog
          workspace={workspace}
          pkg={reviewPackage}
          onClose={() => dispatch({ type: "overlay/close" })}
          onEditIssue={(issue) => {
            if (
              issue.scope === "package" ||
              issue.field === "name" ||
              issue.field === "method" ||
              issue.field === "runContext"
            )
              openPackageEditor("edit", reviewPackage, reviewPackage.id);
            else {
              const item = reviewPackage.items.find((candidate) => candidate.id === issue.itemId);
              if (item) openItemEditor("edit", reviewPackage, item, item.id, issue.field);
            }
          }}
          onNotice={setNotice}
        />
      )}
      {overlay?.kind === "transfer" && (
        <TransferDialog
          item={overlay.item}
          sourcePackageId={overlay.packageId}
          packages={workspace.packages}
          onCommit={commitTransfer}
          onClose={() => dispatch({ type: "overlay/close" })}
        />
      )}
      {overlay?.kind === "registry-import" && (
        <RegistryImportDialog
          onClose={() => dispatch({ type: "overlay/close" })}
          onImport={(entries, source) => {
            const result = commitRegistryImport(workspace, entries, overlay.packageId, source);
            const target = result.workspace.packages.find((pkg) => pkg.id === result.packageId);
            setWorkspace(result.workspace);
            dispatch({ type: "package/open", packageId: result.packageId });
            dispatch({ type: "overlay/close" });
            setNotice({
              kind: "success",
              message: target
                ? `${countLabel(entries.length, "Registry Item")} imported into ${deploymentPackageLabel(target)}`
                : `${countLabel(entries.length, "Registry Item")} imported`,
            });
          }}
        />
      )}
      {overlay?.kind === "package-collision" && (
        <Dialog
          title="Package import conflict"
          eyebrow="Import conflict"
          size="small"
          onClose={() => dispatch({ type: "overlay/close" })}
          footer={
            <>
              <button
                className="wb-button wb-button--ghost"
                onClick={() => dispatch({ type: "overlay/close" })}
              >
                Cancel
              </button>
              <button
                className="wb-button wb-button--ghost"
                onClick={() => importPackage(overlay.filePackage)}
              >
                Import as copy
              </button>
              {overlay.collision === "package-id" && (
                <button
                  className="wb-button wb-button--primary"
                  onClick={() => importPackage(overlay.filePackage, true)}
                >
                  Replace package
                </button>
              )}
            </>
          }
        >
          <p className="wb-dialog-lead">
            {overlay.collision === "package-id"
              ? `A Deployment Package with the ID used by “${deploymentPackageLabel(overlay.filePackage.package)}” already exists. Replace that package or import an independent copy.`
              : `A Registry Item ID from “${deploymentPackageLabel(overlay.filePackage.package)}” already belongs to another package. Import an independent copy to preserve the existing Workspace.`}
          </p>
        </Dialog>
      )}
      {overlay?.kind === "utility" && overlay.page === "about" && (
        <Dialog
          title="About Endpoint Registry Studio"
          eyebrow="Local Intune package authoring"
          size="small"
          onClose={() => dispatch({ type: "overlay/close" })}
          footer={
            <button
              className="wb-button wb-button--primary"
              onClick={() => dispatch({ type: "overlay/close" })}
            >
              Done
            </button>
          }
        >
          <div className="wb-about">
            <ProductMark />
            <p>Build reliable Windows Registry deployment packages for Microsoft Intune.</p>
            <code>
              Release {RELEASE_VERSION} / Generator contract {GENERATOR_VERSION}
            </code>
            <button
              className="wb-link-button"
              onClick={() =>
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "utility", page: "privacy" },
                })
              }
            >
              Privacy and local processing
            </button>
          </div>
        </Dialog>
      )}
      {overlay?.kind === "utility" && overlay.page === "privacy" && (
        <Dialog
          title="Privacy"
          eyebrow="Local by design"
          size="small"
          onClose={() => dispatch({ type: "overlay/close" })}
          footer={
            <button
              className="wb-button wb-button--primary"
              onClick={() => dispatch({ type: "overlay/close" })}
            >
              Done
            </button>
          }
        >
          <p className="wb-dialog-lead">{lifecycle.privacyText}</p>
          {lifecycle.clearStoredWorkspace && (
            <button className="wb-button wb-button--ghost" onClick={lifecycle.clearStoredWorkspace}>
              {lifecycle.clearStoredWorkspaceLabel}
            </button>
          )}
        </Dialog>
      )}
      {lifecycle.startupNotice && memoryNoticeOpen && (
        <Dialog
          title={lifecycle.startupNotice.title}
          size="notice"
          variant="quiet"
          initialFocus="#wb-memory-notice-continue"
          onClose={() => setMemoryNoticeOpen(false)}
          footer={
            <>
              <button
                id="wb-memory-notice-continue"
                className="wb-button wb-button--primary"
                onClick={() => setMemoryNoticeOpen(false)}
              >
                {lifecycle.startupNotice.acknowledgeLabel}
              </button>
              <span className="wb-notice-links">
                <button
                  type="button"
                  className="wb-link-button"
                  onClick={() => {
                    setMemoryNoticeOpen(false);
                    dispatch({
                      type: "overlay/open",
                      overlay: { kind: "utility", page: "privacy" },
                    });
                  }}
                >
                  {lifecycle.startupNotice.privacyLabel}
                </button>
                {selfHostItem && (
                  <a href={selfHostItem.url} target="_blank" rel="noopener noreferrer">
                    {lifecycle.startupNotice.selfHostLabel}
                  </a>
                )}
              </span>
            </>
          }
        >
          {lifecycle.startupNotice.body.map((paragraph) => (
            <p key={paragraph} className="wb-dialog-lead">
              {paragraph}
            </p>
          ))}
        </Dialog>
      )}
      {notice && (
        <div
          className="wb-toast"
          data-tone={notice.kind}
          aria-live={notice.kind === "error" ? "assertive" : "polite"}
        >
          <span className="wb-status-dot" />
          <p>{notice.message}</p>
          <button
            aria-label={englishUi.common.utility.dismissNotification}
            onClick={() => setNotice(undefined)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
