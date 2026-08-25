import { useRef } from "react";

import { packageSlug } from "../../application/packageBuildService";
import type {
  UseWorkspaceLifecycle,
  WorkspaceLifecycle,
} from "../../application/workspaceLifecycle";
import { exportWorkspace } from "../../serialization/workspaceSchema";
import { englishUi } from "../../shared/localization/locale";
import { webWorkspaceCopy } from "../../shared/localization/en/web";
import { downloadArtifact } from "./download";

export const useTransientWorkspaceLifecycle: UseWorkspaceLifecycle = (
  context,
): WorkspaceLifecycle => {
  const workspaceFileRef = useRef<HTMLInputElement>(null);

  return {
    startupNotice: webWorkspaceCopy.startupNotice,
    workspaceFileRef,
    openWorkspace: () => workspaceFileRef.current?.click(),
    readWorkspace: () => undefined,
    exportWorkspace: () => {
      const workspace = context.workspaceRef.current;
      void downloadArtifact({
        name: `${packageSlug(workspace.name)}.registry-workspace.json`,
        mediaType: "application/json;charset=utf-8",
        content: exportWorkspace(workspace),
      })
        .then(() => {
          context.commitWorkspace(workspace, false);
          context.setNotice?.({
            kind: "success",
            message: englishUi.common.workspace.saved,
          });
        })
        .catch((error: unknown) => {
          context.setNotice?.({
            kind: "error",
            message: error instanceof Error ? error.message : englishUi.common.workspace.saveFailed,
          });
        });
    },
    confirmNewWorkspace: () => window.confirm(webWorkspaceCopy.startNewMemory),
    afterNewWorkspace: (workspace) => context.resetWorkspace(workspace),
    privacyVariant: "web",
    privacyText: webWorkspaceCopy.privacy,
  };
};
