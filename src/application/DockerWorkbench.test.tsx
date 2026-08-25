import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkspace } from "../domain/workspace/workspace";
import {
  createMemoryBackend,
  createWorkspaceHome,
  setPersistentWorkspaceHomeForTests,
} from "../platform/browser/persistentWorkspaceHome";
import { exportWorkspace } from "../serialization/workspaceSchema";
import {
  createDeploymentPackage,
  createRegistryItem,
  packageFingerprint,
} from "../domain/workspace/workspace";
import { GENERATOR_VERSION } from "../domain/registry/model";
import { DockerWorkbench } from "./DockerWorkbench";

function packageFileText(name: string, id?: string): string {
  const pkg = createDeploymentPackage({ id: id ?? "pkg-" + name, name });
  return JSON.stringify({
    schemaVersion: 7,
    kind: "registry-package",
    generatorVersion: GENERATOR_VERSION,
    fingerprint: packageFingerprint(pkg, GENERATOR_VERSION),
    sourceWorkspaceId: "picker-source",
    sourceWorkspaceName: "Picker source",
    package: pkg,
  });
}

function pickerCandidate(
  text: string,
  accept = vi
    .fn()
    .mockResolvedValue({ kind: "file" as const, fileName: "picked.registry-workspace.json" }),
) {
  return {
    text,
    home: { kind: "file" as const, fileName: "picked.registry-workspace.json" },
    accept,
  };
}

describe("DockerWorkspaceLifecycle", () => {
  beforeEach(() => {
    setPersistentWorkspaceHomeForTests(createWorkspaceHome(createMemoryBackend()));
    vi.restoreAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("restores a browser Workspace and exposes the persistent status", async () => {
    const stored = createWorkspace({ name: "Restored Workspace" });
    const home = createWorkspaceHome(createMemoryBackend());
    await home.persist(exportWorkspace(stored), { kind: "browser" });
    setPersistentWorkspaceHomeForTests(home);

    render(<DockerWorkbench />);

    expect(await screen.findByDisplayValue("Restored Workspace")).toBeVisible();
    expect(screen.getByText("✓ Saved locally")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Not saved in this tab" })).toBeNull();
    expect(screen.queryByText(/Not saved in this tab/)).toBeNull();
  });

  it("autosaves modified work and asks before replacing it with New", async () => {
    const home = createWorkspaceHome(createMemoryBackend());
    const persist = vi.spyOn(home, "persist");
    setPersistentWorkspaceHomeForTests(home);
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    await waitFor(() => expect(screen.getByText("✓ Saved locally")).toBeVisible());

    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), {
      target: { value: "Keep me" },
    });
    expect(screen.getByText("Saving…")).toBeVisible();
    await waitFor(() => expect(persist).toHaveBeenCalled(), { timeout: 1_500 });

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(window.confirm).toHaveBeenCalledWith(
      "Start a new Workspace? The copy stored on this device will be replaced.",
    );
    expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue("Keep me");
  });

  it("offers deletion of the stored browser copy", async () => {
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    await user.click(screen.getByRole("button", { name: "About" }));
    await user.click(screen.getByRole("button", { name: "Privacy and local processing" }));
    expect(
      screen.getByRole("button", { name: "Delete workspace from this browser" }),
    ).toBeVisible();
  });

  it("imports a picked package directly without reopening the hidden file input", async () => {
    const backend = createMemoryBackend();
    const home = createWorkspaceHome(backend);
    const accept = vi.fn();
    const openFromPicker = vi
      .spyOn(home, "openFromPicker")
      .mockResolvedValue(pickerCandidate(packageFileText("Picker Package"), accept));
    setPersistentWorkspaceHomeForTests(home);
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    await waitFor(() => expect(screen.getByText("✓ Saved locally")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect((await screen.findAllByText("Picker Package")).length).toBeGreaterThan(0);
    expect(openFromPicker).toHaveBeenCalledTimes(1);
    expect(inputClick).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    await waitFor(async () => {
      const stored = await backend.readText();
      expect(stored && JSON.parse(stored)).toMatchObject({
        kind: "registry-workspace",
        packages: [expect.objectContaining({ name: "Picker Package" })],
      });
    });
  });

  it("opens the collision overlay for a picked duplicate package", async () => {
    const id = "duplicate-package";
    const existing = createDeploymentPackage({
      id,
      name: "Existing Package",
      items: [createRegistryItem()],
    });
    const backend = createMemoryBackend();
    const home = createWorkspaceHome(backend);
    const storedText = exportWorkspace({
      ...createWorkspace({ name: "Seeded Workspace" }),
      packages: [existing],
    });
    await home.persist(storedText, { kind: "browser" });
    const candidate = pickerCandidate(packageFileText("Clashing Package", id));
    const openFromPicker = vi.spyOn(home, "openFromPicker").mockResolvedValue(candidate);
    setPersistentWorkspaceHomeForTests(home);
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    await waitFor(() => expect(screen.getByDisplayValue("Seeded Workspace")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("dialog", { name: "Package import conflict" })).toBeVisible();
    expect(openFromPicker).toHaveBeenCalledTimes(1);
    expect(candidate.accept).not.toHaveBeenCalled();
    await expect(backend.readText()).resolves.toBe(storedText);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(backend.readText()).resolves.toBe(storedText);
  });

  it("opens a picked workspace file and shows its content", async () => {
    const backend = createMemoryBackend();
    const home = createWorkspaceHome(backend);
    const storedText = exportWorkspace(createWorkspace({ name: "Stored Workspace" }));
    const pickedText = exportWorkspace(createWorkspace({ name: "Picked Workspace" }));
    await home.persist(storedText, { kind: "browser" });
    const candidate = pickerCandidate(
      pickedText,
      vi.fn(async () => {
        await backend.writeText(pickedText);
        return { kind: "file" as const, fileName: "picked.registry-workspace.json" };
      }),
    );
    const openFromPicker = vi.spyOn(home, "openFromPicker").mockResolvedValue(candidate);
    setPersistentWorkspaceHomeForTests(home);
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    await waitFor(() => expect(screen.getByDisplayValue("Stored Workspace")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByDisplayValue("Picked Workspace")).toBeVisible();
    expect(openFromPicker).toHaveBeenCalledTimes(1);
    expect(inputClick).not.toHaveBeenCalled();
    expect(candidate.accept).toHaveBeenCalledTimes(1);
    await expect(backend.readText()).resolves.toBe(pickedText);
  });

  it("keeps the last stored copy when picked JSON is invalid", async () => {
    const backend = createMemoryBackend();
    const home = createWorkspaceHome(backend);
    const storedText = exportWorkspace(createWorkspace({ name: "Stored Workspace" }));
    await home.persist(storedText, { kind: "browser" });
    const candidate = pickerCandidate("not-json");
    vi.spyOn(home, "openFromPicker").mockResolvedValue(candidate);
    setPersistentWorkspaceHomeForTests(home);
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    await waitFor(() => expect(screen.getByDisplayValue("Stored Workspace")).toBeVisible());

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("File is not valid JSON.")).toBeVisible();
    expect(candidate.accept).not.toHaveBeenCalled();
    await expect(backend.readText()).resolves.toBe(storedText);
  });

  it("keeps the last stored copy when modified-Workspace replacement is cancelled", async () => {
    const backend = createMemoryBackend();
    const home = createWorkspaceHome(backend);
    const storedText = exportWorkspace(createWorkspace({ name: "Stored Workspace" }));
    await home.persist(storedText, { kind: "browser" });
    const candidate = pickerCandidate(
      exportWorkspace(createWorkspace({ name: "Replacement Workspace" })),
    );
    vi.spyOn(home, "openFromPicker").mockResolvedValue(candidate);
    setPersistentWorkspaceHomeForTests(home);
    const user = userEvent.setup();
    render(<DockerWorkbench />);
    const name = await screen.findByDisplayValue("Stored Workspace");
    fireEvent.change(name, {
      target: { value: "Modified Workspace" },
    });
    expect(screen.getByText("Saving…")).toBeVisible();
    vi.mocked(window.confirm).mockReturnValueOnce(false);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(window.confirm).toHaveBeenCalledWith("Replace the modified Workspace?");
    expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
      "Modified Workspace",
    );
    expect(candidate.accept).not.toHaveBeenCalled();
    await expect(backend.readText()).resolves.toBe(storedText);
  });
});
