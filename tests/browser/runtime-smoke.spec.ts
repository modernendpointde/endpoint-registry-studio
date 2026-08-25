import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const registryText =
  'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\r\n"Greeting"="Grüße"\r\n';

async function expectNoCriticalAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
}

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openApp(page: Page, path = "/") {
  const errors = captureRuntimeErrors(page);
  await page.goto(path);
  const memoryNotice = page.getByRole("dialog", { name: "Not saved in this tab" });
  if ((await memoryNotice.count()) === 1) {
    await memoryNotice.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  return errors;
}

async function configureFooter(page: Page) {
  await page.route("**/config.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        applicationName: "Endpoint Registry Studio",
        organizationName: "Example Operations",
        footer: {
          items: [{ kind: "privacy", label: "Privacy policy", url: "./privacy-policy.html" }],
        },
      }),
    });
  });
}

async function openLongWorkspace(page: Page, count = 12) {
  const workspace = JSON.parse(
    readFileSync(
      new URL("../../samples/01-hklm-dword.registry-workspace.json", import.meta.url),
      "utf8",
    ),
  ) as { packages: Array<Record<string, unknown>> };
  const template = workspace.packages[0];
  if (!template) throw new Error("Sample workspace package is missing.");
  workspace.packages = Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
    name: `Shell package ${index + 1}`,
    items: [],
  }));
  await page.getByLabel("Open workspace or package file").setInputFiles({
    name: "shell-layout.registry-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(workspace)),
  });
  await expect(page.getByRole("row", { name: /Shell package 12.*Incomplete/ })).toBeVisible();
}

async function createPackage(page: Page, name = "Browser Package") {
  await page.getByRole("button", { name: "Add package" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Deployment Package" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Package name" }).fill(name);
  await dialog.getByRole("button", { name: "Add package" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function addBinaryItem(page: Page, value = "00 ff 10") {
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Registry Item" });
  await expect(dialog.getByRole("textbox", { name: "Registry path" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Registry path" }).fill("Software\\Contoso");
  await dialog.getByRole("textbox", { name: "Value name" }).fill("Payload");
  await dialog.getByRole("combobox", { name: "Registry value type" }).selectOption("Binary");
  await dialog.getByRole("textbox", { name: "Registry value" }).fill(value);
  await dialog.getByRole("button", { name: "Add item" }).click();
}

test("loads the production build at root and a nested path without console errors", async ({
  page,
}) => {
  const rootErrors = await openApp(page);
  await expectNoCriticalAccessibilityViolations(page);
  expect(rootErrors).toEqual([]);

  const nestedErrors = await openApp(page, "/tools/registry-studio/");
  await expect(page.getByText("Workspace data is processed locally.")).toBeVisible();
  await expectNoCriticalAccessibilityViolations(page);
  expect(nestedErrors).toEqual([]);
});

test("creates a package, preserves partial Binary input, saves it, and reviews output", async ({
  page,
}) => {
  const errors = await openApp(page);
  await createPackage(page);
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Registry Item" });
  await dialog.getByRole("textbox", { name: "Registry path" }).fill("Software\\Contoso");
  await dialog.getByRole("textbox", { name: "Value name" }).fill("Payload");
  await dialog.getByRole("combobox", { name: "Registry value type" }).selectOption("Binary");
  const value = dialog.getByRole("textbox", { name: "Registry value" });
  await value.fill("f");
  await expect(value).toHaveValue("f");
  await value.press("Tab");
  await expect(
    dialog.getByText("Binary values must contain two-digit hexadecimal bytes."),
  ).toBeVisible();
  await value.fill("00 ff 10");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("cell", { name: "BINARY" })).toBeVisible();
  await page.getByRole("button", { name: "Review output" }).click();
  await expect(page.getByRole("dialog", { name: "Browser Package" })).toBeVisible();
  await expectNoCriticalAccessibilityViolations(page);
  expect(errors).toEqual([]);
});

test("uploads UTF-16LE Registry bytes and imports the shared parser preview", async ({ page }) => {
  const errors = await openApp(page);
  await createPackage(page, "Unicode Package");
  await page.getByRole("button", { name: "Import Registry data" }).click();
  const dialog = page.getByRole("dialog", { name: "Import Registry data" });
  const bytes = Buffer.alloc(2 + registryText.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < registryText.length; index += 1) {
    bytes.writeUInt16LE(registryText.charCodeAt(index), 2 + index * 2);
  }
  await dialog.getByLabel("Choose Registry file").setInputFiles({
    name: "unicode.reg",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect(dialog.getByText("unicode.reg")).toBeVisible();
  await dialog.getByRole("button", { name: "Review items" }).click();
  await expect(dialog.getByText("1 item", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Import 1 item" }).click();
  await expect(page.getByText("Grüße")).toBeVisible();
  expect(errors).toEqual([]);
});

test("downloads and reopens a Workspace with real browser file handling", async ({ page }) => {
  const errors = await openApp(page);
  await createPackage(page, "Portable Workspace");
  await addBinaryItem(page);
  await expect(page.getByText("Saved locally")).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  const memoryNotice = page.getByRole("dialog", { name: "Not saved in this tab" });
  if ((await memoryNotice.count()) === 1) {
    await memoryNotice.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
    "Untitled Workspace",
  );
  await expect(page.getByRole("row", { name: /Portable Workspace.*Ready/ })).toHaveCount(0);
  // The reloaded web workspace is empty (memory only); rebuild content for a real export.
  await createPackage(page, "Portable Workspace");
  await addBinaryItem(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Workspace download did not produce a local file.");
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Changed locally");
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByLabel("Open workspace or package file").setInputFiles(path);
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
    "Untitled Workspace",
  );
  await expect(page.getByRole("row", { name: /Portable Workspace.*Ready/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("manages dialog/help focus and narrow viewport overlays without clipping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openApp(page);
  await createPackage(page, "Narrow Package");
  const trigger = page.getByRole("button", { name: "Add item" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Add Registry Item" });
  const help = dialog.getByRole("button", { name: "Help for Desired state" });
  await help.click();
  await expect(page.getByRole("dialog", { name: "Desired state" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Desired state help" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expectNoCriticalAccessibilityViolations(page);
  expect(errors).toEqual([]);
});

test("downloads a complete package as a real ZIP", async ({ page }) => {
  const errors = await openApp(page);
  await createPackage(page, "Download Package");
  await addBinaryItem(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download package", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await download.path()).toBeTruthy();
  expect(errors).toEqual([]);
});

test("keeps desktop chrome fixed while only the content pane scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await configureFooter(page);
  const errors = await openApp(page);
  await openLongWorkspace(page);

  const pane = page.locator(".wb-content-pane");
  const before = await page.evaluate(() => ({
    windowY: window.scrollY,
    workbenchY: document.querySelector<HTMLElement>(".wb-workbench")?.scrollTop ?? -1,
    paneY: document.querySelector<HTMLElement>(".wb-content-pane")?.scrollTop ?? -1,
    topbarTop: document.querySelector(".wb-topbar")?.getBoundingClientRect().top ?? -1,
    railTop: document.querySelector(".wb-rail")?.getBoundingClientRect().top ?? -1,
    footerBottom: document.querySelector(".wb-footer")?.getBoundingClientRect().bottom ?? -1,
  }));
  await pane.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = await page.evaluate(() => ({
    windowY: window.scrollY,
    workbenchY: document.querySelector<HTMLElement>(".wb-workbench")?.scrollTop ?? -1,
    topbarTop: document.querySelector(".wb-topbar")?.getBoundingClientRect().top ?? -1,
    railTop: document.querySelector(".wb-rail")?.getBoundingClientRect().top ?? -1,
    railBottom: document.querySelector(".wb-rail")?.getBoundingClientRect().bottom ?? -1,
    footerBottom: document.querySelector(".wb-footer")?.getBoundingClientRect().bottom ?? -1,
  }));

  expect(before.windowY).toBe(0);
  expect(before.workbenchY).toBe(0);
  expect(before.paneY).toBe(0);
  expect(after.windowY).toBe(0);
  expect(after.workbenchY).toBe(0);
  expect(after.topbarTop).toBeCloseTo(before.topbarTop, 0);
  expect(after.railTop).toBeCloseTo(before.railTop, 0);
  expect(after.railBottom).toBeLessThanOrEqual(800);
  expect(after.footerBottom).toBeCloseTo(before.footerBottom, 0);
  expect(after.footerBottom).toBeCloseTo(800, 0);
  expect(errors).toEqual([]);
});

test("keeps natural page scrolling at the 960px breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 668 });
  await configureFooter(page);
  const errors = await openApp(page);
  await openLongWorkspace(page);

  const metrics = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    railHeight: document.querySelector(".wb-rail")?.getBoundingClientRect().height ?? 0,
    paneY: document.querySelector<HTMLElement>(".wb-content-pane")?.scrollTop ?? -1,
  }));
  expect(metrics.documentHeight).toBeGreaterThan(metrics.viewportHeight);
  expect(metrics.railHeight).toBeLessThan(metrics.viewportHeight);
  expect(metrics.paneY).toBe(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("keeps the narrow footer fixed and hides its identity", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 800 });
  await configureFooter(page);
  const errors = await openApp(page);

  const footer = page.locator(".wb-footer");
  await expect(footer).toHaveCSS("position", "fixed");
  await expect(footer.locator(".wb-footer__identity")).toHaveCSS("display", "none");
  expect(await footer.evaluate((element) => element.getBoundingClientRect().bottom)).toBeCloseTo(
    800,
    0,
  );
  expect(errors).toEqual([]);
});
