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
  createWorkspace,
  deploymentPackageLabel,
  registryItemLabel,
  untitledPackageName,
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
import {
  isItemField,
  isPackageField,
  validateWorkspace,
  type ItemField,
  type PackageField,
} from "../domain/validation/workspaceValidation";
import { Dialog } from "../shared/ui/Overlays";
import { ConfirmDialog } from "../shared/ui/ConfirmDialog";
import { useAppConfirm } from "../shared/ui/confirm";
import { AppFooter } from "../shared/ui/AppFooter";
import { CloseGlyph, ImportGlyph, InfoGlyph } from "../shared/ui/icons";
import { PackageDialog, type PackageDialogMode } from "../features/packages/PackageDialog";
import { HelpWorkspace } from "../features/help/HelpWorkspace";
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
import { AdministrativeTemplatesWorkspace } from "../features/administrative-templates/AdministrativeTemplatesWorkspace";
import {
  administrativeTemplateArchiveName,
  buildAdministrativeTemplateArchive,
} from "./administrativeTemplateBuildService";
import {
  administrativeTemplateCandidates,
  itemsReferencedByTemplates,
} from "./administrativeTemplateOperations";
import type { AdministrativeTemplate } from "../domain/admx";
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
  updatePackage as updateWorkspacePackage,
} from "./workspaceOperations";
import { authorizePackageDownload } from "./packageDownloads";
import { commitRegistryImport } from "../features/import/registryImport";
import { packageImportDecision } from "../features/packages/workspaceImport";
import type { ImportedContentResult, UseWorkspaceLifecycle } from "./workspaceLifecycle";
import {
  continuationOf,
  createItemDraftState,
  isDraftDirtyAgainstSeries,
  seriesDraftState,
  type ItemContinuation,
  type ItemDraftState,
} from "../features/registry-items/itemDraftState";

/** How an item commit is reported: a new item in the package, or a change to an existing one. */
type ItemCommitMode = "create" | "edit";

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
  const { requestConfirm, pending: pendingConfirm, settle: settleConfirm } = useAppConfirm();
  const {
    workspace,
    modified,
    theme,
    view,
    templatesDirty,
    workspaceRevision,
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
  const templatesDirtyRef = useRef(templatesDirty);
  const [lastItemTarget, setLastItemTarget] = useState<Record<string, ItemContinuation>>({});
  /**
   * One Registry Item draft per package, in memory only. It never reaches the Workspace document, the
   * export, the fingerprint, or the persistent autosave, and it survives navigation inside the session.
   */
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraftState>>({});
  const [templatePick, setTemplatePick] = useState<{
    token: number;
    selected: string[];
    openTemplateId?: string;
    newTemplate?: boolean;
  }>();
  const workspaceNameId = useId();
  /**
   * The draft of the open package. A package that was never edited has no stored draft yet, so the
   * fallback is memoized: a fresh identity on every render would remount the details dialog endlessly.
   */
  const openDraftState = useMemo(
    () =>
      openPackageId === undefined
        ? undefined
        : (itemDrafts[openPackageId] ?? seriesDraftState(lastItemTarget[openPackageId])),
    [itemDrafts, lastItemTarget, openPackageId],
  );
  const draftsDirty = useMemo(
    () =>
      Object.entries(itemDrafts).some(([packageId, state]) =>
        isDraftDirtyAgainstSeries(state, lastItemTarget[packageId]),
      ),
    [itemDrafts, lastItemTarget],
  );
  const draftsDirtyRef = useRef(draftsDirty);
  draftsDirtyRef.current = draftsDirty;
  workspaceRef.current = workspace;
  modifiedRef.current = modified;
  templatesDirtyRef.current = templatesDirty;

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

  /**
   * The shell measures the chrome the notice has to stay clear of: its own header, which wraps into up
   * to three rows on narrow windows, and the head of the open view (`wb-view-head`), which carries the
   * state or the actions the notice must not hide. Both offsets are published as one custom property,
   * because a hard-coded value cannot survive either.
   */
  const appRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = appRef.current;
    if (root === null) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const header = root.querySelector<HTMLElement>(".wb-topbar");
      const headerBox = header === null ? undefined : header.getBoundingClientRect();
      // Every view keeps its head in the document; a hidden pane has no box, so the maximum is the visible one.
      const headBottom = [...root.querySelectorAll<HTMLElement>(".wb-view-head")].reduce(
        (bottom, head) => Math.max(bottom, head.getBoundingClientRect().bottom),
        0,
      );
      /*
       * The header height is the lower bound on purpose: it does not scroll away, so the notice stays in
       * the viewport even when the document scrolls and both measured boxes leave the visible area.
       */
      root.style.setProperty(
        "--wb-notice-top",
        `${Math.round(Math.max(headerBox?.height ?? 0, headerBox?.bottom ?? 0, headBottom))}px`,
      );
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    observer?.observe(root);
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--wb-notice-top");
    };
  }, [openPackageId, view]);

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
    const editorDirty =
      overlay?.kind === "package-editor" ||
      overlay?.kind === "item-editor" ||
      overlay?.kind === "item-details"
        ? overlay.dirty
        : false;
    if (!modified && !editorDirty && !templatesDirty && !draftsDirty) return;
    const protectUnsavedWorkspace = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedWorkspace);
    return () => window.removeEventListener("beforeunload", protectUnsavedWorkspace);
  }, [draftsDirty, modified, overlay, templatesDirty]);

  const setNotice = useCallback(
    (next?: Notice) => dispatch({ type: "notice/set", notice: next }),
    [],
  );
  const setEditorDirty = useCallback(
    (dirty: boolean) => dispatch({ type: "overlay/dirty", dirty }),
    [],
  );
  const setTemplatesDirty = useCallback(
    (dirty: boolean) => dispatch({ type: "templates/dirty", dirty }),
    [],
  );
  const clearTemplatePick = useCallback(() => setTemplatePick(undefined), []);
  const startAdministrativeTemplate = useCallback(() => {
    setTemplatePick({ token: Date.now(), selected: [], newTemplate: true });
    dispatch({ type: "view/set", view: "administrative-templates" });
  }, []);
  const setWorkspace = useCallback(
    (next: typeof workspace, markModified = true) =>
      dispatch({ type: "workspace/commit", workspace: next, modified: markModified }),
    [],
  );
  const replaceWorkspace = useCallback((next: typeof workspace) => {
    setLastItemTarget({});
    setItemDrafts({});
    dispatch({ type: "workspace/open", workspace: next });
  }, []);
  const resetWorkspaceState = useCallback((next: typeof workspace) => {
    setLastItemTarget({});
    setItemDrafts({});
    dispatch({ type: "workspace/reset", workspace: next });
  }, []);

  const applyImportedContent = useCallback(
    async (content: string): Promise<ImportedContentResult> => {
      try {
        const imported = importRegistryJson(content);
        if (imported.kind === "workspace") {
          if (
            (modifiedRef.current || templatesDirtyRef.current || draftsDirtyRef.current) &&
            !(await requestConfirm({
              title: englishUi.common.workspace.replaceModified,
              message:
                "Opening this file replaces the Workspace in the editor. Unexported changes are discarded.",
              confirmLabel: "Replace Workspace",
              tone: "danger",
            }))
          )
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
    [dispatch, modifiedRef, requestConfirm, setNotice, setWorkspace, workspaceRef],
  );

  const lifecycle = useWorkspaceLifecycle({
    workspace,
    modified,
    workspaceRef,
    modifiedRef,
    replaceWorkspace,
    requestConfirm,
    commitWorkspace: setWorkspace,
    resetWorkspace: resetWorkspaceState,
    setNotice,
    applyImportedContent,
  });

  const closeEditor = useCallback(
    async (force = false) => {
      if (
        !force &&
        overlay &&
        (overlay.kind === "package-editor" ||
          overlay.kind === "item-editor" ||
          overlay.kind === "item-details") &&
        overlay.dirty &&
        !(await requestConfirm({
          title: englishUi.registryItems.editor.discard,
          message: "The fields you changed in this dialog are not saved.",
          confirmLabel: englishUi.common.confirm.discardChanges,
          cancelLabel: englishUi.common.confirm.keepEditing,
          tone: "danger",
        }))
      )
        return false;
      dispatch({ type: "overlay/close" });
      return true;
    },
    [overlay, requestConfirm],
  );

  const prepareEditor = async () => {
    if (
      overlay &&
      (overlay.kind === "package-editor" ||
        overlay.kind === "item-editor" ||
        overlay.kind === "item-details") &&
      !(await closeEditor())
    )
      return false;
    return true;
  };
  const openPackageEditor = async (
    mode: PackageDialogMode,
    pkg: DeploymentPackage,
    replacingId?: string,
    focusField?: PackageField,
  ) => {
    if (!(await prepareEditor())) return;
    dispatch({
      type: "overlay/open",
      overlay: {
        kind: "package-editor",
        mode,
        pkg,
        dirty: false,
        ...(replacingId ? { replacingId } : {}),
        ...(focusField ? { focusField } : {}),
      },
    });
  };
  /**
   * Creating a package costs one activation: it exists immediately with a valid suggested name, and its
   * detail view opens, where the header name is edited in place.
   */
  const createPackageImmediately = async () => {
    if (!(await prepareEditor())) return;
    const pkg = createDeploymentPackage({ name: untitledPackageName(workspace.packages) });
    dispatch({ type: "view/set", view: "packages" });
    setWorkspace(saveWorkspacePackage(workspace, pkg));
    dispatch({ type: "package/open", packageId: pkg.id });
    setNotice({ kind: "success", message: englishUi.packages.notices.added });
  };
  /**
   * The header name belongs to the package and takes effect while it is typed. A temporarily empty name
   * stays in the input buffer; the package validation reports it instead of the field resetting the text.
   */
  /** The delivery method and the run context are edited in the package header and take effect at once. */
  const setPackageMethod = (
    packageId: string,
    method: DeploymentPackage["deployment"]["method"],
  ) => {
    setWorkspace(
      updateWorkspacePackage(workspace, packageId, (pkg) => ({
        ...pkg,
        deployment: { ...pkg.deployment, method },
      })),
    );
    setNotice({ kind: "success", message: englishUi.packages.notices.methodChanged });
  };
  const setPackageRunContext = (
    packageId: string,
    runContext: DeploymentPackage["deployment"]["runContext"],
  ) => {
    setWorkspace(
      updateWorkspacePackage(workspace, packageId, (pkg) => ({
        ...pkg,
        deployment: { ...pkg.deployment, runContext },
      })),
    );
    setNotice({ kind: "success", message: englishUi.packages.notices.contextChanged });
  };
  const renamePackage = (packageId: string, name: string) =>
    setWorkspace(updateWorkspacePackage(workspace, packageId, (pkg) => ({ ...pkg, name })));
  const openItemEditor = async (
    mode: RegistryItemDialogMode,
    pkg: DeploymentPackage,
    item: RegistryItem,
    replacingId?: string,
    focusField?: ItemField,
  ) => {
    if (!(await prepareEditor())) return;
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
      message: englishUi.packages.notices.updated,
    });
    void closeEditor(true);
  };
  /**
   * Commits an item into a package. The package and the mode are explicit, so a surface without an editor
   * overlay, such as the inline form in the package detail, commits through the same routine; the series
   * continuation is keyed by the package either way.
   */
  const applyItem = (
    packageId: string,
    item: RegistryItem,
    { replacingId, mode }: { replacingId?: string; mode: ItemCommitMode },
  ) => {
    setWorkspace(saveWorkspaceItem(workspace, packageId, item, replacingId));
    setLastItemTarget((current) => ({ ...current, [packageId]: continuationOf(item) }));
    setNotice({
      kind: "success",
      message:
        mode === "edit"
          ? englishUi.registryItems.notices.updated
          : englishUi.registryItems.notices.added,
    });
  };
  const saveItem = (item: RegistryItem) => {
    if (overlay?.kind !== "item-editor") return;
    applyItem(overlay.packageId, item, {
      ...(overlay.replacingId ? { replacingId: overlay.replacingId } : {}),
      mode: overlay.mode === "edit" ? "edit" : "create",
    });
    void closeEditor(true);
  };
  /**
   * The inline form commits through the same routine as the dialog, and then continues the series in
   * place: the form keeps its hive, path, type, and view, and the next item starts fresh.
   */
  const commitDraftItem = (packageId: string, item: RegistryItem) => {
    applyItem(packageId, item, { mode: "create" });
    setItemDrafts((entries) => ({
      ...entries,
      [packageId]: seriesDraftState(continuationOf(item)),
    }));
  };
  const updateItemDraft = (packageId: string, current: ItemDraftState) =>
    setItemDrafts((entries) => ({ ...entries, [packageId]: current }));
  const discardItemDraft = async (packageId: string) => {
    const draft = itemDrafts[packageId];
    if (!draft || !isDraftDirtyAgainstSeries(draft, lastItemTarget[packageId])) return;
    if (
      !(await requestConfirm({
        title: englishUi.registryItems.editor.discardDraft,
        message:
          "The half-typed Registry Item is cleared from this package's form. Nothing was added to the package.",
        confirmLabel: englishUi.common.confirm.discardDraft,
        tone: "danger",
      }))
    )
      return;
    setItemDrafts((entries) => ({
      ...entries,
      [packageId]: seriesDraftState(lastItemTarget[packageId], draft.draft.id),
    }));
  };
  const openItemDetails = (packageId: string, focusField?: ItemField) =>
    dispatch({
      type: "overlay/open",
      overlay: {
        kind: "item-details",
        packageId,
        dirty: false,
        ...(focusField ? { focusField } : {}),
      },
    });
  const applyItemDetails = (packageId: string, next: ItemDraftState) => {
    updateItemDraft(packageId, next);
    dispatch({ type: "overlay/close" });
  };

  /**
   * The item editor offers this as the second resolution for a SYSTEM package that already targets
   * HKEY_CURRENT_USER. It changes the package, not the item, so every item in the package is affected.
   */
  const changeItemRunContext = (
    pkg: DeploymentPackage,
    runContext: DeploymentPackage["deployment"]["runContext"],
  ) => {
    setWorkspace(
      updateWorkspacePackage(workspace, pkg.id, (current) => ({
        ...current,
        deployment: { ...current.deployment, runContext },
      })),
    );
    setNotice({ kind: "success", message: englishUi.packages.notices.contextChanged });
  };

  const deletePackage = async (pkg: DeploymentPackage) => {
    if (
      !(await requestConfirm({
        title: `Delete Deployment Package “${deploymentPackageLabel(pkg)}”?`,
        message:
          "The package and its Registry Items are removed from the Workspace. This cannot be undone.",
        confirmLabel: "Delete package",
        tone: "danger",
      }))
    )
      return;
    const draft = itemDrafts[pkg.id];
    if (
      draft &&
      isDraftDirtyAgainstSeries(draft, lastItemTarget[pkg.id]) &&
      !(await requestConfirm({
        title: englishUi.registryItems.editor.discardDraft,
        message:
          "The half-typed Registry Item of this package is cleared together with the package.",
        confirmLabel: englishUi.common.confirm.discardDraft,
        tone: "danger",
      }))
    )
      return;
    setWorkspace(removePackage(workspace, pkg.id));
    setItemDrafts((entries) => {
      if (!(pkg.id in entries)) return entries;
      const remaining = { ...entries };
      delete remaining[pkg.id];
      return remaining;
    });
    if (selected.has(pkg.id)) dispatch({ type: "selection/toggle", packageId: pkg.id });
    if (openPackageId === pkg.id) dispatch({ type: "package/open", packageId: undefined });
    dispatch({ type: "overlay/close" });
    setNotice({ kind: "success", message: englishUi.packages.notices.deleted });
  };
  const deleteItem = async (pkg: DeploymentPackage, item: RegistryItem) => {
    if (
      !(await requestConfirm({
        title: `Delete Registry Item “${registryItemLabel(item)}”?`,
        message: "The Registry Item is removed from this package. This cannot be undone.",
        confirmLabel: "Delete item",
        tone: "danger",
      }))
    )
      return;
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

  const authorizePackages = async (packages: DeploymentPackage[], bulk = false) => {
    const result = authorizePackageDownload(packages, bulk);
    if (!result.allowed) {
      setNotice({ kind: result.tone, message: result.message });
      return false;
    }
    if (!result.confirmation) return true;
    return requestConfirm({
      title: bulk
        ? `Download ${countLabel(packages.length, "Deployment Package")}?`
        : "Download this Deployment Package?",
      message: result.confirmation,
      confirmLabel: englishUi.common.confirm.download,
    });
  };
  const downloadPackage = async (pkg: DeploymentPackage) => {
    if (!(await authorizePackages([pkg]))) return;
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
  const downloadPackages = async (packages: DeploymentPackage[], scope: "selected" | "all") => {
    if (!(await authorizePackages(packages, true))) return;
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

  const importPackage = async (
    filePackage: Extract<WorkbenchOverlay, { kind: "package-collision" }>["filePackage"],
    replace = false,
  ) => {
    const pkg = replace ? filePackage.package : importPackageAsCopy(filePackage);
    /**
     * Replacing a package replaces its content wholesale under the same identifier, so the draft of that
     * package cannot survive it: a changed one is confirmed first, and the series continuation goes with
     * the content it belonged to.
     */
    if (replace) {
      const draft = itemDrafts[pkg.id];
      if (
        draft &&
        isDraftDirtyAgainstSeries(draft, lastItemTarget[pkg.id]) &&
        !(await requestConfirm({
          title: englishUi.registryItems.editor.discardDraft,
          message:
            "Replacing the package takes its content over wholesale, so the half-typed Registry Item cannot survive it.",
          confirmLabel: englishUi.common.confirm.discardDraft,
          tone: "danger",
        }))
      )
        return;
    }
    setWorkspace(
      saveWorkspacePackage(workspace, pkg, replace ? filePackage.package.id : undefined),
    );
    if (replace) {
      setItemDrafts((entries) => {
        if (!(pkg.id in entries)) return entries;
        const remaining = { ...entries };
        delete remaining[pkg.id];
        return remaining;
      });
      setLastItemTarget((current) => {
        if (!(pkg.id in current)) return current;
        const remaining = { ...current };
        delete remaining[pkg.id];
        return remaining;
      });
    }
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
      .then(async (content) => {
        if (request !== workspaceReadRequest.current) return;
        try {
          const applied = await applyImportedContent(content);
          // The question the import may ask is an await window, so the read has to be re-checked.
          if (request !== workspaceReadRequest.current) return;
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

  const resetWorkspace = async () => {
    const empty = createWorkspace();
    const hasWork =
      modified ||
      templatesDirty ||
      draftsDirty ||
      workspace.packages.length > 0 ||
      workspace.administrativeTemplates.length > 0 ||
      workspace.name.trim() !== empty.name;
    if (hasWork && !(await lifecycle.confirmNewWorkspace())) return;
    if (
      overlay &&
      (overlay.kind === "package-editor" ||
        overlay.kind === "item-editor" ||
        overlay.kind === "item-details") &&
      !(await closeEditor())
    )
      return;
    const next = createWorkspace();
    lifecycle.afterNewWorkspace(next);
  };
  const selectedPackages = selectSelectedPackages(workspace, selected);
  const downloadAdministrativeTemplate = (template: AdministrativeTemplate) => {
    void (async () => {
      try {
        await downloadArtifact({
          name: administrativeTemplateArchiveName(template),
          mediaType: "application/zip",
          content: buildAdministrativeTemplateArchive(template),
        });
        setNotice({ kind: "success", message: "Administrative template downloaded." });
      } catch (error) {
        setNotice({
          kind: "error",
          message:
            error instanceof Error ? error.message : "Administrative template download failed.",
        });
      }
    })();
  };
  /**
   * Starts template authoring from a package. Only enabled, eligible items are preselected: eligibility
   * and inclusion are different questions, and a disabled script item must not slip into a policy.
   */
  const requestTemplatePick = (packageId: string) => {
    const preselected = administrativeTemplateCandidates(workspace)
      .filter(
        (candidate) =>
          candidate.packageId === packageId &&
          candidate.status === "accepted" &&
          candidate.item.enabled,
      )
      .map((candidate) => candidate.item.id);
    setTemplatePick({ token: Date.now(), selected: preselected });
    dispatch({ type: "view/set", view: "administrative-templates" });
  };
  return (
    <div
      className={"wb-app" + (runtimeConfig.footer.items.length > 0 ? " wb-app--with-footer" : "")}
      data-theme={theme}
      ref={appRef}
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
          {/* The line around the field carries its focus ring, as the package name does. */}
          <span className="wb-workspace-name__field">
            <input
              id={workspaceNameId}
              aria-label={englishUi.common.workspace.nameLabel}
              value={workspace.name}
              onChange={(event) => setWorkspace(renameWorkspace(workspace, event.target.value))}
            />
          </span>
          {lifecycle.status &&
            (lifecycle.status.tone === "memory" ? (
              <button
                type="button"
                className="wb-workspace-persist wb-workspace-persist--action"
                data-tone={lifecycle.status.tone}
                {...(lifecycle.status.ariaLabel
                  ? { "aria-label": lifecycle.status.ariaLabel }
                  : {})}
                onClick={() =>
                  dispatch({
                    type: "overlay/open",
                    overlay: { kind: "utility", page: "privacy" },
                  })
                }
              >
                <span className="wb-status-dot" />
                <span className="is-on">{lifecycle.status.text}</span>
              </button>
            ) : (
              <span
                className="wb-workspace-persist"
                data-tone={lifecycle.status.tone}
                aria-live="polite"
                {...(lifecycle.status.ariaLabel
                  ? { "aria-label": lifecycle.status.ariaLabel }
                  : {})}
              >
                <span className="is-on">{lifecycle.status.text}</span>
              </span>
            ))}
        </div>
        <nav className="wb-global-actions" aria-label={englishUi.common.workspace.actionsLabel}>
          <button onClick={() => void resetWorkspace()}>
            {englishUi.common.actions.newWorkspace}
          </button>
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
              aria-label={englishUi.common.utility.help}
              onClick={() => dispatch({ type: "view/set", view: "help" })}
            >
              ?
            </button>
          </div>
        </nav>
      </header>

      <main className="wb-workbench" aria-label="Registry deployment Workspace">
        <PackageNavigator
          workspace={workspace}
          activeView={view}
          openPackageId={openPackageId}
          issues={issues}
          onOverview={() => {
            dispatch({ type: "view/set", view: "packages" });
            dispatch({ type: "package/open", packageId: undefined });
          }}
          onOpen={(pkg) => {
            dispatch({ type: "view/set", view: "packages" });
            dispatch({ type: "package/open", packageId: pkg.id });
          }}
          onNewPackage={() => {
            void createPackageImmediately();
          }}
          onNewTemplate={() => {
            dispatch({ type: "view/set", view: "administrative-templates" });
            startAdministrativeTemplate();
          }}
          onAdministrativeTemplates={() =>
            dispatch({ type: "view/set", view: "administrative-templates" })
          }
        />
        <div className="wb-content-pane" hidden={view !== "packages"}>
          {openPackage ? (
            <PackageDetail
              pkg={openPackage}
              requestConfirm={requestConfirm}
              issues={issues.filter((issue) => issue.packageId === openPackage.id)}
              templateReferences={itemsReferencedByTemplates(workspace, openPackage)}
              eligibleItemCount={
                administrativeTemplateCandidates(workspace).filter(
                  (candidate) =>
                    candidate.packageId === openPackage.id && candidate.status === "accepted",
                ).length
              }
              onCreateAdministrativeTemplate={() => requestTemplatePick(openPackage.id)}
              onOpenTemplate={(templateId) => {
                setTemplatePick({ token: Date.now(), selected: [], openTemplateId: templateId });
                dispatch({ type: "view/set", view: "administrative-templates" });
              }}
              search={itemSearch}
              stateFilter={stateFilter}
              sort={itemSort}
              openMenuId={openMenuId}
              showImport={runtimeConfig.showImport}
              onSearch={(value) => dispatch({ type: "item/search", value })}
              onStateFilter={(value) => dispatch({ type: "item/state", value })}
              onSort={(value) => dispatch({ type: "item/sort", value })}
              onEditPackage={(focusField) =>
                void openPackageEditor("edit", openPackage, openPackage.id, focusField)
              }
              onRenamePackage={(name) => renamePackage(openPackage.id, name)}
              onSetMethod={(method) => setPackageMethod(openPackage.id, method)}
              onSetRunContext={(context) => setPackageRunContext(openPackage.id, context)}
              onDuplicatePackage={() =>
                void openPackageEditor("duplicate", cloneDeploymentPackage(openPackage))
              }
              onDeletePackage={() => void deletePackage(openPackage)}
              onReview={() => {
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "review", packageId: openPackage.id },
                });
              }}
              onDownload={() => void downloadPackage(openPackage)}
              draftState={openDraftState ?? seriesDraftState(undefined)}
              draftDirty={
                openDraftState
                  ? isDraftDirtyAgainstSeries(openDraftState, lastItemTarget[openPackage.id])
                  : false
              }
              onDraftChange={(next) => updateItemDraft(openPackage.id, next)}
              onCommitDraft={(item) => commitDraftItem(openPackage.id, item)}
              onOpenItemDetails={(focusField) => openItemDetails(openPackage.id, focusField)}
              onDiscardDraft={() => void discardItemDraft(openPackage.id)}
              onImport={() =>
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "registry-import", packageId: openPackage.id },
                })
              }
              onEditItem={(item, focusField) =>
                void openItemEditor("edit", openPackage, item, item.id, focusField)
              }
              onDuplicateItem={(item) =>
                void openItemEditor("duplicate", openPackage, cloneRegistryItem(item))
              }
              onSetEnabled={(item, enabled) => setItemEnabled(openPackage, item, enabled)}
              onCopyPath={copyPath}
              onTransfer={(item) =>
                dispatch({
                  type: "overlay/open",
                  overlay: { kind: "transfer", packageId: openPackage.id, item },
                })
              }
              onDeleteItem={(item) => void deleteItem(openPackage, item)}
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
              onNewPackage={() => void createPackageImmediately()}
              onNewTemplate={() => startAdministrativeTemplate()}
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
              onDownload={(pkg) => void downloadPackage(pkg)}
              onDownloadSelected={() => void downloadPackages(selectedPackages, "selected")}
              onDownloadAll={() => void downloadPackages(workspace.packages, "all")}
              onEdit={(pkg) => void openPackageEditor("edit", pkg, pkg.id)}
              onDuplicate={(pkg) =>
                void openPackageEditor("duplicate", cloneDeploymentPackage(pkg))
              }
              onDelete={(pkg) => void deletePackage(pkg)}
              onMenu={(id) => dispatch({ type: "menu/open", id })}
            />
          )}
        </div>
        <div className="wb-content-pane" hidden={view !== "administrative-templates"}>
          <AdministrativeTemplatesWorkspace
            key={workspaceRevision}
            workspace={workspace}
            requestConfirm={requestConfirm}
            pickRequest={templatePick}
            onPickHandled={clearTemplatePick}
            onWorkspaceChange={setWorkspace}
            onDownload={downloadAdministrativeTemplate}
            onDirtyChange={setTemplatesDirty}
            onOpenSource={(packageId) => {
              dispatch({ type: "view/set", view: "packages" });
              dispatch({ type: "package/open", packageId });
            }}
            onGoToPackages={() => {
              dispatch({ type: "view/set", view: "packages" });
              dispatch({ type: "package/open", packageId: undefined });
            }}
          />
        </div>
        <div className="wb-content-pane" hidden={view !== "help"}>
          <HelpWorkspace
            onReturnToWork={() => dispatch({ type: "view/set", view: "packages" })}
            onOpenAbout={() =>
              dispatch({ type: "overlay/open", overlay: { kind: "utility", page: "about" } })
            }
          />
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
          {...(overlay.focusField ? { focusField: overlay.focusField } : {})}
          onDirtyChange={setEditorDirty}
          onSave={savePackage}
          onCancel={() => void closeEditor()}
        />
      )}
      {overlay?.kind === "item-editor" &&
        (() => {
          const pkg = workspace.packages.find((candidate) => candidate.id === overlay.packageId);
          return pkg ? (
            <RegistryItemDialog
              key={overlay.item.id}
              initialState={createItemDraftState(overlay.item)}
              deploymentPackage={pkg}
              requestConfirm={requestConfirm}
              mode={overlay.mode}
              {...(overlay.focusField ? { focusField: overlay.focusField } : {})}
              onDirtyChange={setEditorDirty}
              onSave={saveItem}
              onChangeRunContext={(runContext) => changeItemRunContext(pkg, runContext)}
              onCancel={() => void closeEditor()}
            />
          ) : null;
        })()}
      {overlay?.kind === "item-details" &&
        (() => {
          const pkg = workspace.packages.find((candidate) => candidate.id === overlay.packageId);
          return pkg && openDraftState ? (
            <RegistryItemDialog
              key={openDraftState.draft.id}
              initialState={openDraftState}
              deploymentPackage={pkg}
              requestConfirm={requestConfirm}
              mode="details"
              {...(overlay.focusField ? { focusField: overlay.focusField } : {})}
              onDirtyChange={setEditorDirty}
              onApplyDraft={(next) => applyItemDetails(overlay.packageId, next)}
              onChangeRunContext={(runContext) => changeItemRunContext(pkg, runContext)}
              onCancel={() => void closeEditor()}
            />
          ) : null;
        })()}
      {reviewPackage && (
        <PackageReviewDialog
          workspace={workspace}
          pkg={reviewPackage}
          requestConfirm={requestConfirm}
          onClose={() => dispatch({ type: "overlay/close" })}
          onEditIssue={(issue) => {
            // A package-scope issue, or an item issue whose field belongs to the package, is fixed in
            // the package editor, with the named control focused and the message beside it.
            if (issue.scope === "package" || isPackageField(issue.field)) {
              void openPackageEditor(
                "edit",
                reviewPackage,
                reviewPackage.id,
                isPackageField(issue.field) ? issue.field : undefined,
              );
              return;
            }
            const item = reviewPackage.items.find((candidate) => candidate.id === issue.itemId);
            if (item)
              void openItemEditor(
                "edit",
                reviewPackage,
                item,
                item.id,
                isItemField(issue.field) ? issue.field : undefined,
              );
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
          eyebrowGlyph={<ImportGlyph />}
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
                onClick={() => void importPackage(overlay.filePackage)}
              >
                Import as copy
              </button>
              {overlay.collision === "package-id" && (
                <button
                  className="wb-button wb-button--primary"
                  onClick={() => void importPackage(overlay.filePackage, true)}
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
          eyebrowGlyph={<InfoGlyph />}
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
          eyebrowGlyph={<InfoGlyph />}
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
            <button
              className="wb-button wb-button--ghost"
              onClick={() => void lifecycle.clearStoredWorkspace?.()}
            >
              {lifecycle.clearStoredWorkspaceLabel}
            </button>
          )}
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
            <CloseGlyph />
          </button>
        </div>
      )}
      {pendingConfirm && <ConfirmDialog request={pendingConfirm} onResolve={settleConfirm} />}
    </div>
  );
}
