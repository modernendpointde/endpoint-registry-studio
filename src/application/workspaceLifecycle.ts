import type { ChangeEvent, MutableRefObject, RefObject } from "react";

import type { RegistryWorkspace } from "../domain/workspace/workspace";
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

export interface StartupNotice {
  title: string;
  body: readonly string[];
  acknowledgeLabel: string;
  privacyLabel: string;
  selfHostLabel: string;
}

export interface WorkspaceLifecycleContext {
  workspace: RegistryWorkspace;
  modified: boolean;
  workspaceRef: MutableRefObject<RegistryWorkspace>;
  modifiedRef: MutableRefObject<boolean>;
  replaceWorkspace(this: void, workspace: RegistryWorkspace): void;
  commitWorkspace(this: void, workspace: RegistryWorkspace, modified?: boolean): void;
  resetWorkspace(this: void, workspace: RegistryWorkspace): void;
  setNotice?(this: void, notice?: Notice): void;
  applyImportedContent(this: void, content: string): ImportedContentResult;
}

export interface WorkspaceLifecycle {
  status?: WorkspaceStatus;
  startupNotice?: StartupNotice;
  workspaceFileRef: RefObject<HTMLInputElement | null>;
  openWorkspace(this: void): void;
  readWorkspace(this: void, event: ChangeEvent<HTMLInputElement>): void;
  exportWorkspace(this: void): void;
  confirmNewWorkspace(this: void): boolean;
  afterNewWorkspace(this: void, workspace: RegistryWorkspace): void;
  clearStoredWorkspace?(this: void): void;
  clearStoredWorkspaceLabel?: string;
  privacyVariant: "web" | "docker";
  privacyText: string;
}

export type UseWorkspaceLifecycle = (context: WorkspaceLifecycleContext) => WorkspaceLifecycle;
