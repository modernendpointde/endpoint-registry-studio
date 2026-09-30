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
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  return errors;
}

/**
 * Answers the app's own confirmation. The app opens no native prompt: a destructive or replacing
 * action asks through a designed alert dialog, so the test chooses an answer the way a reader does.
 */
async function answerConfirm(page: Page, answer: "accept" | "cancel", question?: string) {
  if (question !== undefined)
    await expect(page.getByRole("alertdialog", { name: question })).toBeVisible();
  await page.locator(`[role="alertdialog"] [data-answer="${answer}"]`).click();
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
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
  await page
    .getByRole("complementary", { name: "Deployment Package navigator" })
    .getByRole("button", { name: "New package" })
    .click();
  // The package exists immediately; its name is edited in the header of the view it opens.
  await expect(page.getByRole("textbox", { name: "Deployment Package name" })).toHaveValue(
    "Untitled Deployment Package",
  );
  await page.getByRole("textbox", { name: "Deployment Package name" }).fill(name);
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function addBinaryItem(page: Page, value = "00 ff 10") {
  const form = page.getByRole("form", { name: "Registry Item" });
  await form.getByRole("textbox", { name: "Registry path" }).fill("Software\\Contoso");
  await form.getByRole("textbox", { name: "Value name" }).fill("Payload");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("Binary");
  await form.getByRole("textbox", { name: "Registry value" }).fill(value);
  await form.getByRole("button", { name: "Add item" }).click();
}

async function addEligibleDwordItem(page: Page) {
  const form = page.getByRole("form", { name: "Registry Item" });
  await form
    .getByRole("textbox", { name: "Registry path" })
    .fill("Software\\Policies\\Contoso\\App");
  await form.getByRole("textbox", { name: "Value name" }).fill("Enabled");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
  await form.getByRole("spinbutton", { name: "Registry value" }).fill("1");
  await form.getByRole("button", { name: "Add item" }).click();
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
  const form = page.getByRole("form", { name: "Registry Item" });
  await form.getByRole("textbox", { name: "Registry path" }).fill("Software\\Contoso");
  await form.getByRole("textbox", { name: "Value name" }).fill("Payload");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("Binary");
  const value = form.getByRole("textbox", { name: "Registry value" });
  await value.fill("f");
  await expect(value).toHaveValue("f");
  await value.press("Tab");
  await expect(
    form.getByText("Binary values must contain two-digit hexadecimal bytes."),
  ).toBeVisible();
  await value.fill("00 ff 10");
  await form.getByRole("button", { name: "Add item" }).click();
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
  // The parsed review opens as soon as the file is accepted, without a confirmation step.
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
  await page.getByLabel("Open workspace or package file").setInputFiles(path);
  await answerConfirm(page, "accept");
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
  // The form itself is usable at this width: it stacks, and nothing overflows sideways.
  const form = page.getByRole("form", { name: "Registry Item" });
  await expect(form.getByRole("textbox", { name: "Registry path" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Add item" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const trigger = form.getByRole("button", { name: "Details…" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Registry Item details" });
  // Opened from the form, the advanced region is expanded because the reader asked for depth.
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeVisible();
  const help = dialog.getByRole("button", { name: "Help for Desired state" });
  await help.click();
  await expect(page.getByRole("dialog", { name: "Desired state" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Desired state help" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  // The disclosure header carries no nested interactive control of its own.
  await expect(
    dialog.locator("summary button, summary a, summary input, summary select"),
  ).toHaveCount(0);
  // The disclosure header is keyboard operable, not only clickable.
  const advanced = dialog.locator("summary", { hasText: "Advanced" });
  await advanced.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeHidden();
  await advanced.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expectNoCriticalAccessibilityViolations(page);
  expect(errors).toEqual([]);
});

test("asks its own questions instead of a native prompt", async ({ page }) => {
  const errors = await openApp(page);
  // A native prompt would be a regression, so the listener records one and the test fails on it.
  const nativePrompts: string[] = [];
  page.on("dialog", (dialog) => {
    nativePrompts.push(dialog.message());
    void dialog.dismiss();
  });
  await createPackage(page, "Own Dialog");

  await page.getByRole("button", { name: /More actions for Own Dialog/ }).click();
  await page.getByRole("menuitem", { name: "Delete package" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Delete Deployment Package “Own Dialog”?",
  });
  await expect(confirm).toBeVisible();
  // The safe answer owns the focus, so Enter never destroys anything by accident.
  await expect(confirm.locator('[data-answer="cancel"]')).toBeFocused();
  await expect(confirm).toContainText("cannot be undone");
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Own Dialog" })).toBeVisible();

  // A question asked out of an open dialog suspends that dialog: exactly one is on screen.
  await page.getByRole("button", { name: "Edit package" }).click();
  const editor = page.getByRole("dialog", { name: "Edit Deployment Package" });
  await editor.getByRole("textbox", { name: "Package name" }).fill("Renamed");
  await editor.getByRole("button", { name: "Cancel" }).click();
  const discard = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(discard).toBeVisible();
  await expect(editor).toBeHidden();
  await answerConfirm(page, "cancel");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Package name" })).toHaveValue("Renamed");
  await editor.getByRole("button", { name: "Cancel" }).click();
  await answerConfirm(page, "accept");
  await expect(editor).toHaveCount(0);

  // The same question answered with "delete" removes the package.
  await page.getByRole("button", { name: /More actions for Own Dialog/ }).click();
  await page.getByRole("menuitem", { name: "Delete package" }).click();
  await answerConfirm(page, "accept");
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  expect(nativePrompts).toEqual([]);
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

test("opens the separate administrative-template authoring workflow", async ({ page }) => {
  const errors = await openApp(page);
  await createPackage(page, "ADMX source");
  await addEligibleDwordItem(page);

  await page.getByRole("button", { name: /Administrative Templates/ }).click();
  const workspace = page.getByRole("region", { name: "Administrative Templates" });
  await expect(workspace).toBeVisible();
  await expect(workspace.getByRole("button", { name: "New template" })).toBeEnabled();
  await workspace.getByRole("button", { name: "New template" }).click();
  await expect(workspace.getByText("Compatible · Machine")).toBeVisible();
  await workspace.getByRole("checkbox", { name: /Enabled/ }).check();
  await workspace.getByRole("button", { name: "Add 1 accepted item" }).click();
  await expect(workspace.getByRole("textbox", { name: "Template name" })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Continue to review" })).toBeDisabled();

  // The package list stays reachable while the template surface is open, and unsaved authoring
  // survives the navigation instead of being silently dropped.
  await workspace.getByRole("textbox", { name: "Template name" }).fill("Contoso App");
  await page.getByRole("button", { name: /^Open ADMX source,/ }).click();
  await expect(page.getByRole("heading", { name: "ADMX source" })).toBeVisible();
  await page.getByRole("button", { name: /Administrative Templates/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Administrative Templates" })
      .getByRole("textbox", { name: "Template name" }),
  ).toHaveValue("Contoso App");
  expect(errors).toEqual([]);
});

test("keeps desktop chrome fixed while only the content pane scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await configureFooter(page);
  const errors = await openApp(page);
  await openLongWorkspace(page);

  const pane = page.locator(".wb-content-pane:not([hidden])");
  const before = await page.evaluate(() => ({
    windowY: window.scrollY,
    workbenchY: document.querySelector<HTMLElement>(".wb-workbench")?.scrollTop ?? -1,
    paneY: document.querySelector<HTMLElement>(".wb-content-pane:not([hidden])")?.scrollTop ?? -1,
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
    paneY: document.querySelector<HTMLElement>(".wb-content-pane:not([hidden])")?.scrollTop ?? -1,
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

test("keeps the memory chip readable without a horizontal header overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const errors = await openApp(page);

  const chip = page.getByRole("button", { name: /Memory only/ });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText("Memory only · Export before closing");

  const clipped = await chip.evaluate((element) => {
    const label = element.querySelector("span");
    return label === null ? 0 : label.scrollWidth - label.clientWidth;
  });
  expect(clipped).toBe(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("keeps the administrative-template label readable in the stacked rail", async ({ page }) => {
  // The rail lays its entries out in a row at this width, so the shortest useful min-width would
  // truncate the only label the product controls.
  await page.setViewportSize({ width: 720, height: 900 });
  const errors = await openApp(page);

  const label = page.locator(".wb-rail-entry--templates strong");
  await expect(label).toBeVisible();
  expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  await expect(label).toHaveText("Administrative Templates");
  expect(errors).toEqual([]);
});

test("offers both creation actions and starts a template from the entry point", async ({
  page,
}) => {
  const errors = await openApp(page);

  const overview = page.getByRole("region", { name: "Deployment Packages" });
  await expect(overview.getByRole("button", { name: "New package" })).toBeVisible();
  await overview.getByRole("button", { name: "New administrative template" }).click();

  const workspace = page.getByRole("region", { name: "Administrative Templates" });
  await expect(workspace.getByRole("textbox", { name: "Template name" })).toBeVisible();
  await expect(workspace.getByText(/defines its own Registry target/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps the notice clear of the shell actions and of the package header", async ({ page }) => {
  // The header wraps into three rows on narrow windows and the package card grows with its content, so
  // the notice may not use a fixed offset.
  for (const [width, height] of [
    [1280, 700],
    [380, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    const errors = await openApp(page);
    await page
      .getByRole("complementary", { name: "Deployment Package navigator" })
      .getByRole("button", { name: "New package" })
      .click();

    const form = page.getByRole("form", { name: "Registry Item" });
    await form.getByRole("textbox", { name: "Registry path" }).fill("Software\\Contoso\\Notice");
    await form.getByRole("textbox", { name: "Value name" }).fill("Enabled");
    await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
    await form.getByRole("spinbutton", { name: "Registry value" }).fill("1");
    await form.getByRole("button", { name: "Add item" }).click();

    // Below 960 px the document itself scrolls, so the header has to come back into the viewport, and
    // the shell re-measures the card on the next frame before the notice is compared with it.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const notice = page.locator(".wb-toast");
    await expect(notice).toBeVisible();
    const geometry = await page.evaluate(() => {
      const toast = document.querySelector(".wb-toast");
      const topbar = document.querySelector(".wb-topbar");
      const actions = document.querySelector(".wb-global-actions");
      const card = document.querySelector(".wb-canvas--package-detail > .wb-package-head");
      if (toast === null || topbar === null || actions === null || card === null) {
        throw new Error("notice geometry is incomplete");
      }
      const notice = toast.getBoundingClientRect();
      const header = topbar.getBoundingClientRect();
      const shell = actions.getBoundingClientRect();
      const heading = card.getBoundingClientRect();
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const hit = document.elementFromPoint(
        notice.left + notice.width / 2,
        notice.top + notice.height / 2,
      );
      return {
        belowHeader: notice.top >= header.bottom - 1,
        belowCard: notice.top >= heading.bottom - 1,
        overlapsShellActions: overlaps(notice, shell),
        overlapsCard: overlaps(notice, heading),
        insideViewport: notice.top >= 0 && notice.bottom <= window.innerHeight + 1,
        takesPointer: hit !== null && toast.contains(hit),
      };
    });
    const label = width + "x" + height;
    expect(geometry.belowHeader, label + " notice below the shell header").toBe(true);
    // The card carries the state of the package, so the notice starts below it instead of hiding it.
    expect(geometry.belowCard, label + " notice below the package header").toBe(true);
    expect(geometry.overlapsCard, label + " notice over the package header").toBe(false);
    expect(geometry.overlapsShellActions, label + " notice over the actions").toBe(false);
    expect(geometry.insideViewport, label + " notice inside the viewport").toBe(true);
    // It stays click-through, so the surface under it keeps taking clicks while it is up.
    expect(geometry.takesPointer, label + " notice takes the pointer").toBe(false);

    const pencil = page.getByRole("button", { name: "Rename Deployment Package" });
    await pencil.click();
    expect(
      await page
        .locator(".wb-package-name input")
        .evaluate((element) => element === document.activeElement),
    ).toBe(true);

    // A fresh notice for the scroll check: a notice dismisses itself after 3.5 seconds, so a loaded
    // machine must not turn this phase into a race against the first notice.
    await form.getByRole("textbox", { name: "Value name" }).fill("Second");
    await form.getByRole("button", { name: "Add item" }).click();
    await expect(notice).toBeVisible();

    // Scrolling must not push it out of the viewport: below 961 px the document itself scrolls, so both
    // measured boxes can leave the visible area while the notice stays fixed.
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      document
        .querySelectorAll<HTMLElement>(".wb-content-pane")
        .forEach((pane) => pane.scrollTo(0, pane.scrollHeight));
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const scrolled = await page.evaluate(() => {
      const toast = document.querySelector(".wb-toast");
      if (toast === null) throw new Error("notice disappeared before the scroll check");
      const box = toast.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, viewport: window.innerHeight };
    });
    expect(scrolled.top, label + " notice top after scrolling").toBeGreaterThanOrEqual(0);
    expect(scrolled.bottom, label + " notice bottom after scrolling").toBeLessThanOrEqual(
      scrolled.viewport + 1,
    );
    expect(errors).toEqual([]);
  }
});

/** Switches the running build to the requested theme and confirms that it took effect. */
async function setTheme(page: Page, theme: "light" | "dark" | "system") {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await page.locator(".wb-app").getAttribute("data-theme")) === theme) break;
    await page.getByRole("button", { name: "Change theme" }).click();
  }
  expect(await page.locator(".wb-app").getAttribute("data-theme")).toBe(theme);
}

/**
 * Contrast of every requested role against the surface it actually sits on. The roles are pairs of a
 * label and a selector, so a failure names the role instead of a number.
 */
async function measureRoles(page: Page, entries: ReadonlyArray<readonly [string, string]>) {
  // A colour caught mid-transition is reported in an interpolation space the parser does not read, so
  // every running transition has to finish before a role is measured.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  return page.evaluate(
    (list) => {
      // Chromium returns colour-mix results as color(srgb ... / alpha), hex and rgb for everything else.
      const channels = (value: string): [number, number, number] => {
        const text = value.trim();
        const hex = /^#([0-9a-f]{6})$/i.exec(text);
        if (hex?.[1] !== undefined) {
          const number = Number.parseInt(hex[1], 16);
          return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
        }
        const srgb = /^color\(srgb ([^)]+)\)$/.exec(text);
        if (srgb?.[1] !== undefined) {
          const parts = srgb[1]
            .split(/[\s/]+/)
            .filter((part) => part.length > 0)
            .map(Number);
          return [(parts[0] ?? 0) * 255, (parts[1] ?? 0) * 255, (parts[2] ?? 0) * 255];
        }
        const numbers = (text.match(/[\d.]+/g) ?? []).map(Number);
        return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
      };
      /** The alpha of a colour value, whichever syntax it uses. */
      const parseAlpha = (value: string): number => {
        if (value === "transparent") return 0;
        const rgba = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(value);
        if (rgba?.[1] !== undefined) return Number.parseFloat(rgba[1]);
        const srgb = /color\(srgb [^)]*\/\s*([\d.]+)\s*\)/.exec(value);
        if (srgb?.[1] !== undefined) return Number.parseFloat(srgb[1]);
        return 1;
      };
      /** The visible surface behind an element, compositing every translucent layer above the first opaque one. */
      const background = (element: Element): [number, number, number] => {
        const stack: Array<{ colour: [number, number, number]; alpha: number }> = [];
        let node: Element | null = element;
        while (node !== null) {
          const value = getComputedStyle(node).backgroundColor;
          const alpha = parseAlpha(value);
          if (alpha > 0) {
            stack.push({ colour: channels(value), alpha });
            if (alpha === 1) break;
          }
          node = node.parentElement;
        }
        let result: [number, number, number] = [255, 255, 255];
        for (const layer of stack.reverse()) {
          result = [
            layer.colour[0] * layer.alpha + result[0] * (1 - layer.alpha),
            layer.colour[1] * layer.alpha + result[1] * (1 - layer.alpha),
            layer.colour[2] * layer.alpha + result[2] * (1 - layer.alpha),
          ];
        }
        return result;
      };
      const linear = (value: number) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ([red, green, blue]: [number, number, number]) =>
        0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
      const ratio = (a: [number, number, number], b: [number, number, number]) =>
        Math.round(
          ((Math.max(luminance(a), luminance(b)) + 0.05) /
            (Math.min(luminance(a), luminance(b)) + 0.05)) *
            100,
        ) / 100;
      const results = list.map(([label, selector]) => {
        if (selector.includes("::")) {
          const host = document.querySelector(selector.split("::")[0] ?? "");
          if (host === null) throw new Error("the role is missing: " + selector);
          const pseudo = getComputedStyle(host, "::before");
          // Without content nothing is painted, yet a colour would still be reported.
          if (pseudo.content === "none" || pseudo.content === "") {
            throw new Error("the label is not painted: " + selector);
          }
          const painted = channels(pseudo.color);
          return { label, ratio: ratio(painted, background(host)) };
        }
        const element = document.querySelector(selector);
        if (element === null) throw new Error("the role is missing: " + selector);
        return {
          label,
          ratio: ratio(channels(getComputedStyle(element).color), background(element)),
        };
      });
      return results;
    },
    entries as unknown as Array<[string, string]>,
  );
}

/** The measured notice offset clears the view head, even if the transient notice has timed out. */
async function noticeClearsHead(page: Page, selector: string) {
  return page.evaluate((headSelector) => {
    const toast = document.querySelector(".wb-toast");
    const head = document.querySelector(headSelector);
    const root = document.querySelector(".wb-app");
    if (head === null || root === null)
      throw new Error("view head or app is missing: " + headSelector);
    const box = head.getBoundingClientRect();
    const offset = Number.parseFloat(getComputedStyle(root).getPropertyValue("--wb-notice-top"));
    const notice = toast?.getBoundingClientRect();
    const overlaps = notice
      ? notice.left < box.right &&
        notice.right > box.left &&
        notice.top < box.bottom &&
        notice.bottom > box.top
      : false;
    return { below: offset >= box.bottom - 1, overlaps };
  }, selector);
}

test("keeps the notice clear of the template and guide heads", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  const errors = await openApp(page);
  await createPackage(page, "Notice view");
  // The notice is raised on the package surface and then carried into the view that opens next.
  await addEligibleDwordItem(page);
  for (const [open, head] of [
    [/Administrative Templates/, ".wb-admx__head"],
    ["Help", ".wb-help__header"],
  ] as const) {
    await page.getByRole("button", { name: open }).click();
    // The shell re-measures the visible head on the next frame, so the notice is compared afterwards.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const geometry = await noticeClearsHead(page, head);
    expect(geometry.below, head + " notice below the view head").toBe(true);
    expect(geometry.overlaps, head + " notice over the view head").toBe(false);
  }
  expect(errors).toEqual([]);
});

test("switching template views never carries a primary button colour into the next view", async ({
  page,
}) => {
  // Reused buttons faded from the previous view's colour, so Cancel flashed in the primary blue.
  await openApp(page);
  await page
    .getByRole("complementary", { name: "Deployment Package navigator" })
    .getByRole("button", { name: /Administrative Templates/ })
    .click();
  await page.getByRole("button", { name: "New template" }).click();
  await page.getByRole("button", { name: "Start with my own Registry target" }).click();
  const colours = await page.evaluate(() => {
    const cancel = Array.from(document.querySelectorAll(".wb-admx__head button")).find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    if (!cancel) throw new Error("the Cancel action is missing");
    const probe = document.createElement("div");
    probe.style.background = getComputedStyle(document.documentElement)
      .getPropertyValue("--wb-surface-solid")
      .trim();
    document.body.append(probe);
    const ghost = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { cancel: getComputedStyle(cancel).backgroundColor, ghost };
  });
  expect(colours.cancel).toBe(colours.ghost);
});

test("keeps the administrative templates readable in both themes", async ({ page }) => {
  /*
   * The ADMX surface carries its own state, its candidate statuses, its issue list and the policy summary
   * with a class chip, so every level of it is measured in both themes.
   */
  test.slow();
  for (const theme of ["light", "dark"] as const) {
    const errors = await openApp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, theme);
    await createPackage(page, "ADMX contrast");
    await addEligibleDwordItem(page);
    await page.getByRole("button", { name: /Administrative Templates/ }).click();

    // The state of the surface sits in its header, and a candidate states its own status.
    await page.getByRole("button", { name: "New template" }).click();
    const pickerRoles = await measureRoles(page, [
      ["admx state", ".wb-admx__state"],
      ["candidate status", ".wb-admx-candidate__status"],
    ]);

    // The editor shows the template issues, the source match and the overlap notice.
    await page.getByRole("checkbox", { name: /Enabled/ }).check();
    await page.getByRole("button", { name: "Add 1 accepted item" }).click();
    // Issues block the preview and the download, so the header state reads as a warning.
    await expect(page.locator(".wb-admx__state")).toHaveAttribute("data-tone", "warning");
    const editorRoles = await measureRoles(page, [
      ["admx state with issues", ".wb-admx__state"],
      ["template issue", ".wb-admx-issues"],
      ["source match", ".wb-admx-policy__match"],
      ["overlap heading", ".wb-admx-overlaps h3"],
    ]);

    // A compiled template adds the policy summary with its class chip.
    const editor = page.locator(".wb-admx-editor");
    await editor.getByRole("textbox", { name: "Template name" }).fill("Northgate App");
    await editor.getByRole("textbox", { name: "Version" }).fill("1.0.0");
    await editor.getByRole("textbox", { name: "Vendor identifier" }).fill("Northgate");
    await editor.getByRole("textbox", { name: "Product identifier" }).fill("App");
    const policy = page.locator(".wb-admx-policy").first();
    await policy.getByRole("textbox", { name: "Policy identifier" }).fill("EnableFeature");
    await policy.getByRole("textbox", { name: "Category" }).fill("Northgate Widget");
    await policy.getByRole("textbox", { name: "Display name" }).fill("Enable feature");
    await policy.getByRole("textbox", { name: "Explanation" }).fill("Writes the configured value.");
    await policy.getByRole("combobox", { name: /Value mode for/ }).selectOption("Fixed");
    await policy
      .getByRole("combobox", { name: /Enabled behavior for/ })
      .selectOption("WritePresentValue");
    await policy
      .getByRole("combobox", { name: /Disabled behavior for/ })
      .selectOption("DeleteValue");
    await policy
      .getByRole("combobox", { name: /Not Configured behavior for/ })
      .selectOption("DeleteValue");
    await page.getByRole("button", { name: "Continue to review" }).click();
    const previewRoles = await measureRoles(page, [
      ["class chip", ".wb-admx-summary__class"],
      ["summary target", ".wb-admx-summary__item code"],
      ["preview summary", ".wb-admx-preview summary"],
    ]);

    for (const entry of [...pickerRoles, ...editorRoles, ...previewRoles]) {
      expect(entry.ratio, theme + " " + entry.label + " contrast").toBeGreaterThanOrEqual(4.5);
    }
    expect(errors).toEqual([]);
  }
});

test("keeps the guide readable in both themes", async ({ page }) => {
  test.slow();
  for (const theme of ["light", "dark"] as const) {
    const errors = await openApp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, theme);
    await page.getByRole("button", { name: "Help" }).click();

    // The reading surface: the selected topic, a group label, a note, a reference and an example.
    await page
      .getByRole("navigation", { name: "Help topics" })
      .getByRole("button", { name: "Create, review, and download an administrative template" })
      .click();
    const roles = await measureRoles(page, [
      ["selected topic", '.wb-help__topic[aria-current="true"]'],
      ["topic group label", ".wb-help__group h3"],
      ["topic list item", '.wb-help__topic:not([aria-current="true"])'],
      ["guide note", ".wb-help__note"],
      ["guide reference", ".wb-help__ref"],
      ["example caption", ".wb-help__example figcaption"],
      ["example note", ".wb-help__example p"],
    ]);
    for (const entry of roles) {
      expect(entry.ratio, theme + " " + entry.label + " contrast").toBeGreaterThanOrEqual(4.5);
    }
    expect(errors).toEqual([]);
  }
});

test("keeps template and guide headings aligned at narrow and ultrawide widths", async ({
  page,
}) => {
  test.slow();
  const errors = await openApp(page);
  for (const width of [380, 3440]) {
    for (const theme of ["light", "dark", "system"] as const) {
      await page.setViewportSize({ width, height: width === 380 ? 844 : 1440 });
      await page.emulateMedia({ colorScheme: theme === "system" ? "dark" : "light" });
      await page.reload();
      await setTheme(page, theme);
      await page.getByRole("button", { name: /Administrative Templates/ }).click();
      await page.getByRole("button", { name: "New template" }).click();
      await page.getByRole("button", { name: "Start with my own Registry target" }).click();
      const layout = await page.evaluate(() => {
        const heading = document.querySelector(".wb-admx__head");
        const card = document.querySelector(".wb-admx > .wb-surface");
        if (!heading || !card) throw new Error("template heading or working card is missing");
        const head = heading.getBoundingClientRect();
        const surface = card.getBoundingClientRect();
        return {
          headLeft: head.left,
          cardLeft: surface.left,
          headRight: head.right,
          cardRight: surface.right,
          headWidth: head.width,
          viewWidth: (
            document.querySelector(".wb-canvas--workspace") ?? heading
          ).getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(
        Math.abs(layout.headLeft - layout.cardLeft),
        `${width}px template left edge`,
      ).toBeLessThan(1);
      expect(
        Math.abs(layout.headRight - layout.cardRight),
        `${width}px template right edge`,
      ).toBeLessThan(1);
      // The template view fills its canvas on every display.
      expect(
        Math.abs(layout.headWidth - layout.viewWidth),
        `${width}px template width`,
      ).toBeLessThanOrEqual(1);
      expect(layout.overflow, `${width}px template overflow`).toBeLessThanOrEqual(1);

      await page.getByRole("button", { name: "Help" }).click();
      const guide = await page.evaluate(() => {
        const heading = document.querySelector(".wb-help__header");
        const view = document.querySelector(".wb-help");
        const topics = document.querySelector(".wb-help__topics");
        const article = document.querySelector(".wb-help__article");
        if (!heading || !view || !topics || !article)
          throw new Error("guide heading, view, topics or article is missing");
        const head = heading.getBoundingClientRect();
        const canvas = view.getBoundingClientRect();
        return {
          headLeft: head.left,
          viewLeft: canvas.left,
          headRight: head.right,
          viewRight: canvas.right,
          width: canvas.width,
          topicsBottom: topics.getBoundingClientRect().bottom,
          articleTop: article.getBoundingClientRect().top,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(Math.abs(guide.headLeft - guide.viewLeft), `${width}px guide left edge`).toBeLessThan(
        1,
      );
      expect(
        Math.abs(guide.headRight - guide.viewRight),
        `${width}px guide right edge`,
      ).toBeLessThan(1);
      expect(guide.overflow, `${width}px guide overflow`).toBeLessThanOrEqual(1);
      if (width === 380)
        expect(guide.articleTop, "narrow guide stacks after topics").toBeGreaterThanOrEqual(
          guide.topicsBottom,
        );
      await page.getByRole("button", { name: "Return to work" }).click();
    }
  }
  expect(errors).toEqual([]);
});

test("uses the dark palette for template and guide in System theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const errors = await openApp(page);
  await setTheme(page, "system");
  await page.getByRole("button", { name: /Administrative Templates/ }).click();
  const templateRoles = await measureRoles(page, [["template state", ".wb-admx__state"]]);
  await page.getByRole("button", { name: "Help" }).click();
  const guideRoles = await measureRoles(page, [
    ["guide group", ".wb-help__group h3"],
    ["guide topic", ".wb-help__topic"],
  ]);
  for (const entry of [...templateRoles, ...guideRoles])
    expect(entry.ratio, entry.label + " System dark contrast").toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]);
});

test("keeps small text readable in both themes", async ({ page }) => {
  /*
   * Two full authoring passes with fourteen measurements each, so the test is marked slow: the default
   * budget of 30 seconds was not enough on a loaded machine even though every step passes on its own.
   */
  test.slow();
  /*
   * The roles that measured too weak before 1.2.0: the table header, the package id, the state badge, the explanation
   * of the card, the quiet counter, the hint of an empty package and the column labels of the stacked list.
   * The navigator roles are included because the navigator became a light card: its label,
   * section names, entry details and footer note now sit on the card tones and have to stay readable there.
   */
  const filledRoles = [
    ["table header", ".wb-item-list__header span"],
    ["package id", ".wb-package-head__status code"],
    ["state badge", ".wb-state"],
    ["card explanation", ".wb-composer__heading p"],
    ["counter", ".wb-package-settings__count"],
    ["item status", ".wb-status-link"],
    ["registry hive", ".wb-target > span"],
    ["navigator label", ".wb-rail__topline .wb-eyebrow"],
    ["navigator group", ".wb-rail__group"],
    // The active entry sits on the accent tint, the least favourable ground of the navigator.
    ["navigator detail", '.wb-rail-entry[aria-current="page"] small'],
    ["navigator footer", ".wb-rail__privacy small"],
  ] as const;

  for (const theme of ["light", "dark"] as const) {
    const errors = await openApp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, theme);
    await page
      .getByRole("complementary", { name: "Deployment Package navigator" })
      .getByRole("button", { name: "New package" })
      .click();

    // The hint only exists while the package is empty, so it is measured in that state.
    const emptyRoles = await measureRoles(page, [["empty hint", ".wb-composer-intro__hint p"]]);

    const form = page.getByRole("form", { name: "Registry Item" });
    // A commit attempt on the empty form turns its summary line into the error tone. The button is
    // aria-disabled while the draft is invalid, so the attempt is made the way a reader makes it: Enter.
    await form.getByRole("textbox", { name: "Registry path" }).press("Enter");
    await expect(form.locator('.wb-composer__summary[data-invalid="true"]')).toBeVisible();
    const invalidRoles = await measureRoles(page, [
      ["invalid form summary", '.wb-composer__summary[data-invalid="true"]'],
    ]);
    await form
      .getByRole("textbox", { name: "Registry path" })
      .fill("Software\\Northgate\\Contrast");
    await form.getByRole("textbox", { name: "Value name" }).fill("Enabled");
    await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
    await form.getByRole("spinbutton", { name: "Registry value" }).fill("1");
    await form.getByRole("button", { name: "Add item" }).click();
    await expect(page.locator(".wb-item-row")).toHaveCount(1);
    // The success notice is a light card now; it is measured while it is still on screen.
    await expect(page.locator(".wb-toast")).toBeVisible();
    const noticeRoles = await measureRoles(page, [["notice", ".wb-toast p"]]);

    // At 380 px the list stacks, so its column labels only exist in this viewport.
    await page.setViewportSize({ width: 380, height: 844 });
    await expect(page.locator(".wb-item-row")).toHaveCount(1);
    const stackedRoles = await measureRoles(page, [
      ["stacked cell label", '.wb-item-row > [role="cell"]::before'],
    ]);

    await page.setViewportSize({ width: 1440, height: 900 });
    const measured = await measureRoles(page, filledRoles);

    /*
     * The dialog family carries the same load: the confirmation, the status line of a dialog footer and
     * the two feedback levels of a shared field rule.
     */
    await page.locator(".wb-package-head .wb-icon-button--menu").click();
    await page.getByRole("menuitem", { name: "Delete package" }).click();
    const confirmationRoles = await measureRoles(page, [
      ["confirmation eyebrow", '.wb-eyebrow[data-tone="danger"]'],
      ["confirmation message", ".wb-confirm__message"],
      ["confirmation accept", ".wb-confirm__accept"],
      ["confirmation cancel", ".wb-confirm__cancel"],
    ]);
    await answerConfirm(page, "cancel");

    // The review's file navigation left the navy ground for the band, so its text roles are measured.
    await page.getByRole("button", { name: "Review output" }).click();
    const review = page.getByRole("dialog", { name: "Untitled Deployment Package" });
    await expect(review).toBeVisible();
    const reviewRoles = await measureRoles(page, [
      ["review label", ".wb-review-identity > span:first-child"],
      ["review state", ".wb-review-readiness"],
      ["review fingerprint", ".wb-fingerprint"],
      ["review file detail", ".wb-review-file-nav small"],
      ["review mode", ".wb-segmented button"],
    ]);
    await review.getByRole("button", { name: "Close", exact: true }).click();
    await expect(review).toBeHidden();

    await page.getByRole("button", { name: "Details…" }).click();
    const itemDialog = page.getByRole("dialog", { name: "Registry Item details" });
    const dialogRoles = await measureRoles(page, [["dialog status", ".wb-dialog-status.is-ready"]]);
    // An incomplete byte is a field error, an unusually large Binary a field warning.
    await itemDialog.getByRole("combobox", { name: "Registry value type" }).selectOption("Binary");
    const valueField = itemDialog.getByRole("textbox", { name: "Registry value" });
    // Red feedback waits for a real interaction, so the field is engaged before it is filled.
    await valueField.click();
    await valueField.fill("00 ff 1");
    await valueField.blur();
    const errorRoles = await measureRoles(page, [["field error", ".wb-field__error"]]);
    await valueField.fill("00 ".repeat(4097).trim());
    const warningRoles = await measureRoles(page, [["field warning", ".wb-field__warning"]]);
    // The changed draft asks before it is dropped, and the test answers as a reader would.
    await itemDialog.getByRole("button", { name: "Cancel" }).click();
    await answerConfirm(page, "accept", "Discard unsaved changes?");

    for (const entry of [
      ...emptyRoles,
      ...invalidRoles,
      ...stackedRoles,
      ...noticeRoles,
      ...measured,
      ...confirmationRoles,
      ...reviewRoles,
      ...dialogRoles,
      ...errorRoles,
      ...warningRoles,
    ]) {
      expect(entry.ratio, theme + " " + entry.label + " contrast").toBeGreaterThanOrEqual(4.5);
    }
    expect(errors).toEqual([]);
  }
});
