import type { RuntimeTheme } from "./runtimeConfig";
import type {
  DeploymentPackage,
  RegistryItem,
  RegistryPackage,
  RegistryWorkspace,
} from "../domain/workspace/workspace";
import type { ItemField } from "../domain/validation/workspaceValidation";
import type { PackageDialogMode } from "../features/packages/PackageDialog";
import type { RegistryItemDialogMode } from "../features/registry-items/RegistryItemDialog";

export interface Notice {
  kind: "success" | "error" | "info";
  message: string;
}

export type WorkbenchOverlay =
  | {
      kind: "package-editor";
      mode: PackageDialogMode;
      pkg: DeploymentPackage;
      replacingId?: string;
      dirty: boolean;
    }
  | {
      kind: "item-editor";
      mode: RegistryItemDialogMode;
      packageId: string;
      item: RegistryItem;
      replacingId?: string;
      focusField?: ItemField;
      dirty: boolean;
    }
  | { kind: "review"; packageId: string }
  | { kind: "transfer"; packageId: string; item: RegistryItem }
  | { kind: "registry-import"; packageId?: string }
  | { kind: "utility"; page: "about" | "privacy" }
  | {
      kind: "package-collision";
      filePackage: RegistryPackage;
      collision: "package-id" | "item-id";
    };

export interface WorkbenchState {
  workspace: RegistryWorkspace;
  modified: boolean;
  theme: RuntimeTheme;
  openPackageId: string | undefined;
  packageSearch: string;
  methodFilter: string;
  contextFilter: string;
  packageSort: string;
  itemSearch: string;
  stateFilter: string;
  itemSort: string;
  selectMode: boolean;
  selected: Set<string>;
  openMenuId: string | undefined;
  overlay: WorkbenchOverlay | undefined;
  notice: Notice | undefined;
}

export function createWorkbenchState(
  workspace: RegistryWorkspace,
  theme: RuntimeTheme,
): WorkbenchState {
  return {
    workspace,
    modified: false,
    theme,
    packageSearch: "",
    methodFilter: "All",
    contextFilter: "All",
    packageSort: "name",
    itemSearch: "",
    stateFilter: "All",
    itemSort: "path",
    selectMode: false,
    selected: new Set(),
    openPackageId: undefined,
    openMenuId: undefined,
    overlay: undefined,
    notice: undefined,
  };
}

export type WorkbenchAction =
  | { type: "workspace/commit"; workspace: RegistryWorkspace; modified?: boolean }
  | { type: "workspace/open"; workspace: RegistryWorkspace }
  | { type: "workspace/reset"; workspace: RegistryWorkspace }
  | { type: "package/open"; packageId: string | undefined }
  | { type: "package/search"; value: string }
  | { type: "package/method"; value: string }
  | { type: "package/context"; value: string }
  | { type: "package/sort"; value: string }
  | { type: "item/search"; value: string }
  | { type: "item/state"; value: string }
  | { type: "item/sort"; value: string }
  | { type: "selection/mode"; value: boolean }
  | { type: "selection/toggle"; packageId: string }
  | { type: "selection/clear" }
  | { type: "menu/open"; id: string | undefined }
  | { type: "overlay/open"; overlay: WorkbenchOverlay }
  | { type: "overlay/dirty"; dirty: boolean }
  | { type: "overlay/close" }
  | { type: "notice/set"; notice: Notice | undefined }
  | { type: "theme/set"; theme: RuntimeTheme };

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "workspace/commit":
      return { ...state, workspace: action.workspace, modified: action.modified ?? true };
    case "workspace/open":
      return {
        ...state,
        workspace: action.workspace,
        modified: false,
        openPackageId: undefined,
        selectMode: false,
        selected: new Set(),
        overlay: undefined,
      };
    case "workspace/reset":
      return createWorkbenchState(action.workspace, state.theme);
    case "package/open":
      return { ...state, openPackageId: action.packageId, itemSearch: "", openMenuId: undefined };
    case "package/search":
      return { ...state, packageSearch: action.value };
    case "package/method":
      return { ...state, methodFilter: action.value };
    case "package/context":
      return { ...state, contextFilter: action.value };
    case "package/sort":
      return { ...state, packageSort: action.value };
    case "item/search":
      return { ...state, itemSearch: action.value };
    case "item/state":
      return { ...state, stateFilter: action.value };
    case "item/sort":
      return { ...state, itemSort: action.value };
    case "selection/mode":
      return {
        ...state,
        selectMode: action.value,
        selected: action.value ? state.selected : new Set(),
      };
    case "selection/toggle": {
      const selected = new Set(state.selected);
      if (selected.has(action.packageId)) selected.delete(action.packageId);
      else selected.add(action.packageId);
      return { ...state, selected };
    }
    case "selection/clear":
      return { ...state, selected: new Set() };
    case "menu/open":
      return { ...state, openMenuId: action.id };
    case "overlay/open":
      return { ...state, overlay: action.overlay, openMenuId: undefined };
    case "overlay/dirty":
      return state.overlay &&
        (state.overlay.kind === "package-editor" || state.overlay.kind === "item-editor")
        ? { ...state, overlay: { ...state.overlay, dirty: action.dirty } }
        : state;
    case "overlay/close":
      return { ...state, overlay: undefined };
    case "notice/set":
      return { ...state, notice: action.notice };
    case "theme/set":
      return { ...state, theme: action.theme };
  }
}
