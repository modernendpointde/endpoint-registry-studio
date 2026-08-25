import { describe, expect, it } from "vitest";

import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
} from "../domain/workspace/workspace";
import {
  removeItem,
  saveItem,
  savePackage,
  setItemEnabled,
  transferItem,
} from "./workspaceOperations";
import { selectVisiblePackages } from "./selectors";
import { createWorkbenchState, workbenchReducer } from "./workspaceReducer";

describe("Workbench model", () => {
  it("applies package and item changes without mutating the source Workspace", () => {
    const original = createWorkspace();
    const first = createDeploymentPackage({ name: "Zulu" });
    const second = createDeploymentPackage({ name: "Alpha" });
    const withPackages = savePackage(savePackage(original, first), second);
    const item = createRegistryItem();
    const withItem = saveItem(withPackages, first.id, item);
    const disabled = setItemEnabled(withItem, first.id, item.id, false);
    const copied = transferItem(disabled, first.id, second.id, item, "copy");
    const removed = removeItem(copied, first.id, item.id);

    expect(original.packages).toEqual([]);
    expect(withItem.packages[0]?.items[0]).toBe(item);
    expect(disabled.packages[0]?.items[0]?.enabled).toBe(false);
    expect(copied.packages[1]?.items[0]?.id).not.toBe(item.id);
    expect(removed.packages[0]?.items).toEqual([]);
  });

  it("derives filtered and sorted packages without changing their stored order", () => {
    const workspace = {
      ...createWorkspace(),
      packages: [
        createDeploymentPackage({ name: "Zulu" }),
        createDeploymentPackage({ name: "Alpha" }),
      ],
    };
    const visible = selectVisiblePackages(workspace, {
      search: "alp",
      method: "All",
      context: "All",
      sort: "name",
    });
    expect(visible.map((pkg) => pkg.name)).toEqual(["Alpha"]);
    expect(workspace.packages.map((pkg) => pkg.name)).toEqual(["Zulu", "Alpha"]);
  });

  it("keeps overlays mutually exclusive and clears dependent state atomically", () => {
    const pkg = createDeploymentPackage();
    let state = createWorkbenchState(createWorkspace(), "light");
    state = workbenchReducer(state, {
      type: "overlay/open",
      overlay: { kind: "package-editor", mode: "create", pkg, dirty: false },
    });
    state = workbenchReducer(state, { type: "overlay/dirty", dirty: true });
    expect(state.overlay).toMatchObject({ kind: "package-editor", dirty: true });

    state = workbenchReducer(state, {
      type: "overlay/open",
      overlay: { kind: "review", packageId: pkg.id },
    });
    expect(state.overlay).toEqual({ kind: "review", packageId: pkg.id });

    state = workbenchReducer(state, { type: "selection/mode", value: true });
    state = workbenchReducer(state, { type: "selection/toggle", packageId: pkg.id });
    state = workbenchReducer(state, { type: "selection/mode", value: false });
    expect(state.selected.size).toBe(0);
  });
});
