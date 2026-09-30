import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebWorkbench } from "./WebWorkbench";
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from "./runtimeConfig";

const createObjectURL = vi.fn(() => "blob:web-workspace");

const memoryNoticeConfig: RuntimeConfig = {
  ...DEFAULT_RUNTIME_CONFIG,
  footer: {
    items: [
      { kind: "github", label: "GitHub", url: "https://github.com/example/repo" },
      { kind: "privacy", label: "Privacy", url: "./privacy" },
    ],
  },
};

describe("WebWorkspaceLifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("starts empty on every mount and never exposes stored-workspace controls", async () => {
    const first = render(<WebWorkbench />);
    expect(document.querySelector(".wb-app")?.classList.contains("wb-app--with-footer")).toBe(
      false,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Memory only · Export before closing")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), {
      target: { value: "Transient work" },
    });
    first.unmount();

    render(<WebWorkbench />);
    expect(screen.getByText("Memory only · Export before closing")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
      "Untitled Workspace",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    await user.click(screen.getByRole("button", { name: "Privacy and local processing" }));
    expect(
      screen.queryByRole("button", { name: "Delete workspace from this browser" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the memory chip visible and opens the privacy dialog from it", async () => {
    const user = userEvent.setup();
    render(<WebWorkbench runtimeConfig={memoryNoticeConfig} />);

    const chip = screen.getByRole("button", { name: /Memory only/ });
    expect(chip).toBeVisible();
    expect(chip).toHaveTextContent("Memory only · Export before closing");

    await user.click(chip);
    expect(screen.getByRole("dialog", { name: "Privacy" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close Privacy" }));
    expect(chip).toBeVisible();
  });

  it("does not steal focus at mount and reaches the chip with Tab", async () => {
    const user = userEvent.setup();
    render(<WebWorkbench />);

    expect(screen.queryByRole("dialog")).toBeNull();
    const chip = screen.getByRole("button", { name: /Memory only/ });
    const nameInput = screen.getByRole("textbox", { name: "Workspace name" });
    nameInput.focus();
    expect(nameInput).toHaveFocus();
    await user.tab();
    expect(chip).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Privacy" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Privacy" })).toBeNull();
    await waitFor(() => expect(chip).toHaveFocus());
  });

  it("exports through a Blob download and then clears the modified guard", async () => {
    const user = userEvent.setup();
    render(<WebWorkbench />);
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), {
      target: { value: "Transient work" },
    });
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /Memory only/ })).toBeVisible();

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("never touches persistent storage APIs and restores nothing on remount", () => {
    const idbOpen = vi.fn(() => {
      throw new Error("indexedDB must not be used by the web variant");
    });
    const getDirectory = vi.fn(() => {
      throw new Error("OPFS must not be used by the web variant");
    });
    const storagePersist = vi.fn(() => {
      throw new Error("storage.persist must not be used by the web variant");
    });
    const showOpen = vi.fn(() => {
      throw new Error("showOpenFilePicker must not be used by the web variant");
    });
    const showSave = vi.fn(() => {
      throw new Error("showSaveFilePicker must not be used by the web variant");
    });
    vi.stubGlobal("indexedDB", { open: idbOpen });
    const originalStorage = Object.getOwnPropertyDescriptor(window.navigator, "storage");
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: { getDirectory, persist: storagePersist },
    });
    const originalOpen = Object.getOwnPropertyDescriptor(window, "showOpenFilePicker");
    const originalSave = Object.getOwnPropertyDescriptor(window, "showSaveFilePicker");
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: showOpen });
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: showSave });
    try {
      const first = render(<WebWorkbench />);
      fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), {
        target: { value: "Ephemeral work" },
      });
      first.unmount();

      render(<WebWorkbench />);
      expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
        "Untitled Workspace",
      );
      expect(idbOpen).not.toHaveBeenCalled();
      expect(getDirectory).not.toHaveBeenCalled();
      expect(storagePersist).not.toHaveBeenCalled();
      expect(showOpen).not.toHaveBeenCalled();
      expect(showSave).not.toHaveBeenCalled();
    } finally {
      if (originalStorage) Object.defineProperty(window.navigator, "storage", originalStorage);
      else delete (window.navigator as { storage?: unknown }).storage;
      if (originalOpen) Object.defineProperty(window, "showOpenFilePicker", originalOpen);
      else delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
      if (originalSave) Object.defineProperty(window, "showSaveFilePicker", originalSave);
      else delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
      vi.unstubAllGlobals();
    }
  });

  it("renders a validated footer from runtime configuration after the main surface", async () => {
    const user = userEvent.setup();
    render(<WebWorkbench runtimeConfig={memoryNoticeConfig} />);
    expect(document.querySelector(".wb-app")?.classList.contains("wb-app--with-footer")).toBe(true);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Endpoint Registry Studio")).toBeVisible();
    expect(within(footer).getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("Privacy").closest("footer")?.getAttribute("aria-label")).toBe(
      "Product links",
    );
  });
});
