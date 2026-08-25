import { afterEach, describe, expect, it, vi } from "vitest";

import { exportWorkspace } from "../../serialization/workspaceSchema";
import { createWorkspace } from "../../domain/workspace/workspace";
import { MAX_REGISTRY_JSON_BYTES } from "../../serialization/workspaceSchema";
import {
  createMemoryBackend,
  createOpfsBackend,
  createWorkspaceHome,
} from "./persistentWorkspaceHome";

const originalOpenPicker = Object.getOwnPropertyDescriptor(window, "showOpenFilePicker");
const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
const originalWebdriver = Object.getOwnPropertyDescriptor(navigator, "webdriver");

afterEach(() => {
  if (originalOpenPicker) Object.defineProperty(window, "showOpenFilePicker", originalOpenPicker);
  else delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  if (originalStorage) Object.defineProperty(navigator, "storage", originalStorage);
  else delete (navigator as unknown as Record<string, unknown>).storage;
  if (originalWebdriver) Object.defineProperty(navigator, "webdriver", originalWebdriver);
  else delete (navigator as unknown as Record<string, unknown>).webdriver;
  vi.restoreAllMocks();
});

function installOpenPicker(text: string, name = "picked.registry-workspace.json") {
  const file = {
    size: new TextEncoder().encode(text).byteLength,
    text: () => Promise.resolve(text),
  };
  const handle = {
    name,
    getFile: vi.fn().mockResolvedValue(file),
    createWritable: vi.fn(),
  };
  Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
  Object.defineProperty(window, "showOpenFilePicker", {
    configurable: true,
    value: vi.fn().mockResolvedValue([handle]),
  });
  return handle;
}

describe("workspace home", () => {
  it("round-trips a Workspace through the browser store", async () => {
    const home = createWorkspaceHome(createMemoryBackend());
    const text = exportWorkspace(createWorkspace({ name: "Stored" }));
    await expect(home.restore()).resolves.toBeUndefined();
    await expect(home.persist(text, { kind: "browser" })).resolves.toEqual({ kind: "browser" });
    await expect(home.restore()).resolves.toEqual({ text, home: { kind: "browser" } });
  });

  it("rejects an oversized Workspace before writing", async () => {
    const home = createWorkspaceHome(createMemoryBackend());
    const text = "x".repeat(MAX_REGISTRY_JSON_BYTES + 1);
    await expect(home.persist(text, { kind: "browser" })).rejects.toThrow(/byte limit/);
    await expect(home.restore()).resolves.toBeUndefined();
  });

  it("clears the stored Workspace", async () => {
    const home = createWorkspaceHome(createMemoryBackend());
    const text = exportWorkspace(createWorkspace({ name: "Stored" }));
    await home.persist(text, { kind: "browser" });
    await home.clear();
    await expect(home.restore()).resolves.toBeUndefined();
  });

  it("keeps the previous browser copy until a picked Workspace is accepted", async () => {
    const backend = createMemoryBackend();
    const home = createWorkspaceHome(backend);
    const stored = exportWorkspace(createWorkspace({ name: "Stored" }));
    const picked = exportWorkspace(createWorkspace({ name: "Picked" }));
    await home.persist(stored, { kind: "browser" });
    installOpenPicker(picked);

    const candidate = await home.openFromPicker();

    expect(candidate).toMatchObject({
      text: picked,
      home: { kind: "file", fileName: "picked.registry-workspace.json" },
    });
    await expect(backend.readText()).resolves.toBe(stored);
    await expect(candidate?.accept()).resolves.toEqual({
      kind: "file",
      fileName: "picked.registry-workspace.json",
    });
    await expect(candidate?.accept()).resolves.toEqual({
      kind: "file",
      fileName: "picked.registry-workspace.json",
    });
    await expect(backend.readText()).resolves.toBe(picked);
  });

  it("returns no OPFS Workspace only for a missing file", async () => {
    const missing = new DOMException("Missing", "NotFoundError");
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockRejectedValue(missing),
        }),
      },
    });

    await expect(createOpfsBackend().readText()).resolves.toBeUndefined();
  });

  it("propagates genuine OPFS read failures", async () => {
    const failure = new DOMException("The file cannot be read.", "NotReadableError");
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockRejectedValue(failure),
        }),
      },
    });

    await expect(createOpfsBackend().readText()).rejects.toBe(failure);
  });
});
