import type { ChangeEvent, MutableRefObject, RefObject } from "react";

import type { RegistryWorkspace } from "../domain/workspace/workspace";
import type { ConfirmRequest } from "../shared/ui/confirm";
import type { Notice } from "./workspaceReducer";

export type ImportedContentResult =
  | { kind: "workspace"; workspace: RegistryWorkspace }
  | { kind: "package" }
  | { kind: "collision" }
  | { kind: "aborted" };

export type WorkspaceStatusTone = "memory" | "saving" | "saved" | "error";

export interface WorkspaceStatus {
  tone: WorkspaceStatusTone;
  text: string;
  ariaLabel?: string;
}

export interface WorkspaceLifecycleContext {
  workspace: RegistryWorkspace;
  modified: boolean;
  workspaceRef: MutableRefObject<RegistryWorkspace>;
  modifiedRef: MutableRefObject<boolean>;
  /** The app's one confirmation surface; a lifecycle asks for a decision instead of opening its own dialog. */
  requestConfirm(this: void, request: ConfirmRequest): Promise<boolean>;
  replaceWorkspace(this: void, workspace: RegistryWorkspace): void;
  commitWorkspace(this: void, workspace: RegistryWorkspace, modified?: boolean): void;
  resetWorkspace(this: void, workspace: RegistryWorkspace): void;
  setNotice?(this: void, notice?: Notice): void;
  applyImportedContent(this: void, content: string): Promise<ImportedContentResult>;
}

export interface WorkspaceLifecycle {
  status?: WorkspaceStatus;
  workspaceFileRef: RefObject<HTMLInputElement | null>;
  openWorkspace(this: void): void;
  readWorkspace(this: void, event: ChangeEvent<HTMLInputElement>): void;
  exportWorkspace(this: void): void;
  /** Resolves `true` only when the reader accepted replacing the current Workspace. */
  confirmNewWorkspace(this: void): Promise<boolean>;
  afterNewWorkspace(this: void, workspace: RegistryWorkspace): void;
  clearStoredWorkspace?(this: void): void | Promise<void>;
  clearStoredWorkspaceLabel?: string;
  privacyVariant: "web" | "docker";
  privacyText: string;
}

export type UseWorkspaceLifecycle = (context: WorkspaceLifecycleContext) => WorkspaceLifecycle;
