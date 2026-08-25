import { expect, test, type Page } from "@playwright/test";

async function installStorageSpies(page: Page) {
  await page.addInitScript(() => {
    const record = {
      idbOpen: 0,
      getDirectory: 0,
      persist: 0,
      openPicker: 0,
      savePicker: 0,
      localStorageGet: 0,
      localStorageSet: 0,
      sessionStorageGet: 0,
      sessionStorageSet: 0,
      historyPush: 0,
      historyReplace: 0,
    };
    const probe = (marker: string) => (): never => {
      record[marker as keyof typeof record] += 1;
      throw new Error("Storage API " + marker + " must not be used by the web variant");
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: { open: probe("idbOpen") },
    });
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: {
        getDirectory: probe("getDirectory"),
        persist: probe("persist"),
      },
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: probe("openPicker"),
    });
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: probe("savePicker"),
    });
    for (const [name, marker] of [
      [window.localStorage, "localStorage"],
      [window.sessionStorage, "sessionStorage"],
    ] as const) {
      const get = probe(marker === "localStorage" ? "localStorageGet" : "sessionStorageGet");
      const set = probe(marker === "localStorage" ? "localStorageSet" : "sessionStorageSet");
      Object.defineProperty(name.constructor.prototype, "getItem", {
        configurable: true,
        value: get,
      });
      Object.defineProperty(name.constructor.prototype, "setItem", {
        configurable: true,
        value: set,
      });
    }
    const historyPush = probe("historyPush");
    Object.defineProperty(window.history, "pushState", {
      configurable: true,
      value: historyPush,
    });
    const historyReplace = probe("historyReplace");
    Object.defineProperty(window.history, "replaceState", {
      configurable: true,
      value: historyReplace,
    });
    (window as unknown as { __storageCalls: typeof record }).__storageCalls = record;
  });
}

test("web artifact never calls persistent storage APIs and restores nothing on reload", async ({
  page,
}) => {
  await installStorageSpies(page);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("dialog", { name: "Not saved in this tab" })).toBeVisible();
  await expect(page.getByText("Memory only")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Not saved in this tab/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  await page.getByRole("button", { name: "Add package" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Deployment Package" });
  await dialog.getByRole("textbox", { name: "Package name" }).fill("No Storage");
  await dialog.getByRole("button", { name: "Add package" }).click();
  await expect(page.getByText("Saved locally")).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("dialog", { name: "Not saved in this tab" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
    "Untitled Workspace",
  );
  await expect(page.getByText("No Storage")).toHaveCount(0);

  const calls = await page.evaluate(
    () => (globalThis as unknown as { __storageCalls: Record<string, number> }).__storageCalls,
  );
  expect(calls).toEqual({
    idbOpen: 0,
    getDirectory: 0,
    persist: 0,
    openPicker: 0,
    savePicker: 0,
    localStorageGet: 0,
    localStorageSet: 0,
    sessionStorageGet: 0,
    sessionStorageSet: 0,
    historyPush: 0,
    historyReplace: 0,
  });
  expect(errors).toEqual([]);
});
