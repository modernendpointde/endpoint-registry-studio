import { useEffect, useRef, useState } from "react";

import { createWorkspace } from "../domain/workspace/workspace";
import { downloadArtifact } from "../platform/browser/download";
import {
  FilePickerUnavailableError,
  getPersistentWorkspaceHome,
  type WorkspaceHome,
} from "../platform/browser/persistentWorkspaceHome";
import { englishUi } from "../shared/localization/locale";
import { dockerWorkspaceCopy } from "../shared/localization/en/docker";
import { exportWorkspace, importRegistryJson } from "../serialization/workspaceSchema";
import { packageSlug } from "./packageBuildService";
import type { UseWorkspaceLifecycle, WorkspaceLifecycle } from "./workspaceLifecycle";

export const useDockerWorkspaceLifecycle: UseWorkspaceLifecycle = (context): WorkspaceLifecycle => {
  const {
    applyImportedContent,
    commitWorkspace,
    modified,
    modifiedRef,
    replaceWorkspace,
    resetWorkspace,
    setNotice,
    workspace,
    workspaceRef,
  } = context;
  const workspaceFileRef = useRef<HTMLInputElement>(null);
  const homeRef = useRef<WorkspaceHome>({ kind: "browser" });
  const restoredRef = useRef(false);
  const persistTimer = useRef(0);
  const [home, setHome] = useState<WorkspaceHome>({ kind: "browser" });
  const [persistError, setPersistError] = useState(false);
  homeRef.current = home;

  useEffect(() => {
    let cancelled = false;
    void getPersistentWorkspaceHome()
      .then((api) => api.restore())
      .then((result) => {
        if (cancelled) return;
        restoredRef.current = true;
        if (!result) return;
        const imported = importRegistryJson(result.text);
        if (imported.kind !== "workspace") return;
        replaceWorkspace(imported.workspace);
        setHome(result.home);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        restoredRef.current = true;
        setNotice?.({
          kind: "error",
          message:
            error instanceof Error ? error.message : englishUi.common.workspace.storedOpenFailed,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [replaceWorkspace, setNotice]);

  useEffect(() => {
    if (!restoredRef.current || !modified) return;
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void getPersistentWorkspaceHome()
        .then((api) => api.persist(exportWorkspace(workspaceRef.current), homeRef.current))
        .then((next) => {
          setPersistError(false);
          setHome(next);
          commitWorkspace(workspaceRef.current, false);
        })
        .catch(() => setPersistError(true));
    }, 400);
    return () => window.clearTimeout(persistTimer.current);
  }, [commitWorkspace, modified, workspace, workspaceRef]);

  useEffect(() => {
    const flush = () => {
      if (!restoredRef.current || !modifiedRef.current) return;
      void getPersistentWorkspaceHome().then((api) =>
        api.persist(exportWorkspace(workspaceRef.current), homeRef.current),
      );
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [modifiedRef, workspaceRef]);

  return {
    status: persistError
      ? { tone: "error", text: dockerWorkspaceCopy.homeSaveFailed }
      : modified
        ? {
            tone: "saving",
            text: dockerWorkspaceCopy.homeSaving,
            ariaLabel: englishUi.common.workspace.unsaved,
          }
        : { tone: "saved", text: dockerWorkspaceCopy.homeSaved },
    workspaceFileRef,
    openWorkspace: () => {
      void getPersistentWorkspaceHome().then(async (api) => {
        try {
          const picked = await api.openFromPicker();
          if (!picked) {
            workspaceFileRef.current?.click();
            return;
          }
          const applied = applyImportedContent(picked.text);
          if (applied.kind === "workspace") {
            const nextHome = await picked.accept();
            replaceWorkspace(applied.workspace);
            setHome(nextHome);
            setPersistError(false);
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setNotice?.({
            kind: "error",
            message: error instanceof Error ? error.message : englishUi.common.workspace.openFailed,
          });
        }
      });
    },
    readWorkspace: () => undefined,
    exportWorkspace: () => {
      const workspace = workspaceRef.current;
      const text = exportWorkspace(workspace);
      const suggestedName = `${packageSlug(workspace.name)}.registry-workspace.json`;
      void getPersistentWorkspaceHome().then(async (api) => {
        try {
          const next = await api.saveToFile(text, suggestedName);
          setPersistError(false);
          setHome(next);
          commitWorkspace(workspace, false);
          setNotice?.({ kind: "success", message: englishUi.common.workspace.saved });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (error instanceof FilePickerUnavailableError) {
            try {
              await downloadArtifact({
                name: suggestedName,
                mediaType: "application/json;charset=utf-8",
                content: text,
              });
              await api.rememberBrowserCopy(text);
              setPersistError(false);
              setHome({ kind: "browser" });
              commitWorkspace(workspace, false);
              setNotice?.({ kind: "success", message: englishUi.common.workspace.saved });
            } catch (downloadError) {
              setPersistError(true);
              setNotice?.({
                kind: "error",
                message:
                  downloadError instanceof Error
                    ? downloadError.message
                    : englishUi.common.workspace.saveFailed,
              });
            }
            return;
          }
          setPersistError(true);
        }
      });
    },
    confirmNewWorkspace: () =>
      window.confirm(
        home.kind === "file" ? dockerWorkspaceCopy.startNewFile : dockerWorkspaceCopy.startNew,
      ),
    afterNewWorkspace: (workspace) => {
      resetWorkspace(workspace);
      setHome({ kind: "browser" });
      void getPersistentWorkspaceHome().then(async (api) => {
        await api.clear();
        await api.persist(exportWorkspace(workspace), { kind: "browser" });
      });
    },
    clearStoredWorkspace: () => {
      if (!window.confirm(dockerWorkspaceCopy.clearBrowserConfirm)) return;
      const workspace = createWorkspace();
      resetWorkspace(workspace);
      setHome({ kind: "browser" });
      void getPersistentWorkspaceHome().then(async (api) => {
        await api.clear();
        await api.persist(exportWorkspace(workspace), { kind: "browser" });
      });
    },
    clearStoredWorkspaceLabel: dockerWorkspaceCopy.clearBrowser,
    privacyVariant: "docker",
    privacyText: dockerWorkspaceCopy.privacy,
  };
};
