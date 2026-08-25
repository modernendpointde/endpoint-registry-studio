import { MAX_REGISTRY_JSON_BYTES } from "../../serialization/workspaceSchema";

const OPFS_FILE = "workspace.registry-workspace.json";
const HOME_DB = "endpoint-registry-studio-home";
const HOME_STORE = "home";
const TEXT_KEY = "workspace-json";
const HANDLE_KEY = "file-handle";

export type WorkspaceHome = { kind: "browser" } | { kind: "file"; fileName: string };

export interface WorkspaceOpenCandidate {
  text: string;
  home: WorkspaceHome;
  accept(): Promise<WorkspaceHome>;
}

export class FilePickerUnavailableError extends Error {
  constructor() {
    super("A file picker is not available in this browser.");
    this.name = "FilePickerUnavailableError";
  }
}

export interface WorkspaceHomeBackend {
  readText(): Promise<string | undefined>;
  writeText(text: string): Promise<void>;
  clearText(): Promise<void>;
}

type FileHandleLike = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: AllowSharedBufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
  }>;
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
};

type PickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types?: readonly { description: string; accept: Record<string, readonly string[]> }[];
  }) => Promise<FileHandleLike[]>;
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: readonly { description: string; accept: Record<string, readonly string[]> }[];
  }) => Promise<FileHandleLike>;
};

const workspaceType = [
  {
    description: "Registry Workspace",
    accept: { "application/json": [".json", ".registry-workspace.json"] },
  },
] as const;

function pickerHost(): PickerWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window;
}

export function createMemoryBackend(): WorkspaceHomeBackend {
  let text: string | undefined;
  return {
    readText() {
      return Promise.resolve(text);
    },
    writeText(next) {
      assertWorkspaceSize(next);
      text = next;
      return Promise.resolve();
    },
    clearText() {
      text = undefined;
      return Promise.resolve();
    },
  };
}

export function assertWorkspaceSize(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_REGISTRY_JSON_BYTES) {
    throw new Error(
      `Workspace exceeds the ${MAX_REGISTRY_JSON_BYTES.toLocaleString("en-US")}-byte limit.`,
    );
  }
}

async function openHomeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HOME_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HOME_STORE)) db.createObjectStore(HOME_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser workspace storage failed."));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await openHomeDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(HOME_STORE, "readonly").objectStore(HOME_STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error("Browser workspace read failed."));
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined")
    throw new Error("Browser workspace storage is unavailable.");
  const db = await openHomeDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(HOME_STORE, "readwrite")
        .objectStore(HOME_STORE)
        .put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Browser workspace write failed."));
    });
  } finally {
    db.close();
  }
}

async function idbDelete(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openHomeDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(HOME_STORE, "readwrite").objectStore(HOME_STORE).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Browser workspace clear failed."));
    });
  } finally {
    db.close();
  }
}

export function createOpfsBackend(): WorkspaceHomeBackend {
  return {
    async readText() {
      const root = await navigator.storage.getDirectory();
      try {
        const handle = await root.getFileHandle(OPFS_FILE);
        const file = await handle.getFile();
        if (file.size > MAX_REGISTRY_JSON_BYTES) {
          throw new Error(
            `Workspace exceeds the ${MAX_REGISTRY_JSON_BYTES.toLocaleString("en-US")}-byte limit.`,
          );
        }
        return await file.text();
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
        throw error;
      }
    },
    async writeText(text) {
      assertWorkspaceSize(text);
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(OPFS_FILE, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    },
    async clearText() {
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry(OPFS_FILE);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      }
    },
  };
}

export function createIndexedDbBackend(): WorkspaceHomeBackend {
  return {
    async readText() {
      const text = await idbGet<string>(TEXT_KEY);
      if (text !== undefined) assertWorkspaceSize(text);
      return text;
    },
    async writeText(text) {
      assertWorkspaceSize(text);
      await idbSet(TEXT_KEY, text);
    },
    async clearText() {
      await idbDelete(TEXT_KEY);
    },
  };
}

export async function createBrowserBackend(): Promise<WorkspaceHomeBackend> {
  if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function") {
    try {
      await navigator.storage.getDirectory();
      return createOpfsBackend();
    } catch {
      // Fall through to IndexedDB.
    }
  }
  if (typeof indexedDB !== "undefined") return createIndexedDbBackend();
  return createMemoryBackend();
}

async function persistPermission(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Persistence is best-effort.
  }
}

async function filePermission(handle: FileHandleLike, interactive: boolean): Promise<boolean> {
  const mode = { mode: "readwrite" as const };
  const query = handle.queryPermission ? await handle.queryPermission(mode) : "prompt";
  if (query === "granted") return true;
  if (!interactive || !handle.requestPermission) return false;
  return (await handle.requestPermission(mode)) === "granted";
}

export function createWorkspaceHome(backend: WorkspaceHomeBackend) {
  let fileHandle: FileHandleLike | undefined;

  return {
    async restore(): Promise<{ text: string; home: WorkspaceHome } | undefined> {
      const storedHandle = await idbGet<FileHandleLike>(HANDLE_KEY).catch(() => undefined);
      if (storedHandle && (await filePermission(storedHandle, true))) {
        const file = await storedHandle.getFile();
        if (file.size > MAX_REGISTRY_JSON_BYTES) {
          throw new Error(
            `Workspace exceeds the ${MAX_REGISTRY_JSON_BYTES.toLocaleString("en-US")}-byte limit.`,
          );
        }
        fileHandle = storedHandle;
        const text = await file.text();
        await persistPermission();
        return { text, home: { kind: "file", fileName: storedHandle.name } };
      }
      const text = await backend.readText();
      if (text === undefined || text === "") return undefined;
      await persistPermission();
      return { text, home: { kind: "browser" } };
    },

    async persist(text: string, home: WorkspaceHome): Promise<WorkspaceHome> {
      assertWorkspaceSize(text);
      if (home.kind === "file" && fileHandle && (await filePermission(fileHandle, false))) {
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        await backend.writeText(text);
        await persistPermission();
        return { kind: "file", fileName: fileHandle.name };
      }
      await backend.writeText(text);
      await persistPermission();
      return { kind: "browser" };
    },

    async saveToFile(text: string, suggestedName: string): Promise<WorkspaceHome> {
      assertWorkspaceSize(text);
      const host = pickerHost();
      if (!host?.showSaveFilePicker || (typeof navigator !== "undefined" && navigator.webdriver)) {
        throw new FilePickerUnavailableError();
      }
      const handle = await host.showSaveFilePicker({
        suggestedName,
        types: workspaceType,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      fileHandle = handle;
      await idbSet(HANDLE_KEY, handle).catch(() => undefined);
      await backend.writeText(text);
      await persistPermission();
      return { kind: "file", fileName: handle.name };
    },

    async openFromPicker(): Promise<WorkspaceOpenCandidate | undefined> {
      const host = pickerHost();
      if (!host?.showOpenFilePicker || (typeof navigator !== "undefined" && navigator.webdriver))
        return undefined;
      const [handle] = await host.showOpenFilePicker({
        multiple: false,
        types: workspaceType,
      });
      if (!handle) return undefined;
      const file = await handle.getFile();
      if (file.size > MAX_REGISTRY_JSON_BYTES) {
        throw new Error(
          `Workspace exceeds the ${MAX_REGISTRY_JSON_BYTES.toLocaleString("en-US")}-byte limit.`,
        );
      }
      const text = await file.text();
      const home: WorkspaceHome = { kind: "file", fileName: handle.name };
      let acceptance: Promise<WorkspaceHome> | undefined;
      return {
        text,
        home,
        accept() {
          acceptance ??= (async () => {
            await backend.writeText(text);
            await idbSet(HANDLE_KEY, handle).catch(() => undefined);
            fileHandle = handle;
            await persistPermission();
            return home;
          })();
          return acceptance;
        },
      };
    },

    async rememberBrowserCopy(text: string): Promise<void> {
      await backend.writeText(text);
      await persistPermission();
    },

    async clear(): Promise<void> {
      fileHandle = undefined;
      await backend.clearText();
      await idbDelete(HANDLE_KEY).catch(() => undefined);
    },

    filePickerAvailable(): boolean {
      if (typeof navigator !== "undefined" && navigator.webdriver) return false;
      const host = pickerHost();
      return Boolean(host?.showOpenFilePicker && host.showSaveFilePicker);
    },
  };
}

export type WorkspaceHomeApi = ReturnType<typeof createWorkspaceHome>;

let homeApi: WorkspaceHomeApi | undefined;
let homeApiPromise: Promise<WorkspaceHomeApi> | undefined;

export async function getPersistentWorkspaceHome(): Promise<WorkspaceHomeApi> {
  if (homeApi) return homeApi;
  homeApiPromise ??= createBrowserBackend().then((backend) => {
    homeApi = createWorkspaceHome(backend);
    return homeApi;
  });
  return homeApiPromise;
}

export function setPersistentWorkspaceHomeForTests(api: WorkspaceHomeApi): void {
  homeApi = api;
  homeApiPromise = Promise.resolve(api);
}
