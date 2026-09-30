import { statSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The layout contract of the package surface: form and header height, the shared field split, the maximum
 * content width, the mandatory viewport matrix with its pressure states, and the dialog that must open
 * without moving. Everything is measured on the running build, because the dialog scroll, the grid heights,
 * and the scroll responsibility of the shell only exist in a browser.
 */

/**
 * Brings an element into view without the actionability wait of scrollIntoViewIfNeeded: in the flat
 * windows of the matrix that wait could stall instead of failing, which is worse than a hard error.
 */
async function bringIntoView(locator: Locator) {
  await locator.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" }),
  );
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Geometry that must exist. A missing element or box fails the measurement instead of passing a bound. */
async function box(page: Page, selector: string): Promise<Box> {
  const locator = page.locator(selector).first();
  await expect(locator).toBeVisible();
  const measured = await locator.boundingBox();
  if (measured === null) throw new Error("no bounding box for " + selector);
  return measured;
}

/**
 * The same geometry has to hold across two render frames, so a value that is still settling cannot be
 * recorded as a result.
 */
async function stableBox(page: Page, selector: string): Promise<Box> {
  const first = await box(page, selector);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const second = await box(page, selector);
  expect(second, selector + " must be stable across frames").toEqual(first);
  return second;
}

/** Resets every scroll container and confirms the position, so no measurement inherits an earlier one. */
async function resetScrolls(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document
      .querySelectorAll<HTMLElement>(".wb-content-pane")
      .forEach((pane) => pane.scrollTo(0, 0));
    document.querySelectorAll<HTMLElement>(".wb-item-list").forEach((list) => list.scrollTo(0, 0));
  });
  const positions = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll<HTMLElement>(".wb-content-pane"));
    const lists = Array.from(document.querySelectorAll<HTMLElement>(".wb-item-list"));
    return {
      window: window.scrollY,
      panes: panes.map((pane) => pane.scrollTop),
      lists: lists.map((list) => list.scrollLeft),
    };
  });
  expect(positions.window).toBe(0);
  expect(positions.panes.every((value) => value === 0)).toBe(true);
  expect(positions.lists.every((value) => value === 0)).toBe(true);
}

/** The bottom of the area a reader actually sees, clipped by the scrolling pane and the fixed footer. */
async function visibleBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    let bottom = window.innerHeight;
    const pane = document.querySelector<HTMLElement>(".wb-content-pane:not([hidden])");
    if (pane !== null && pane.scrollHeight > pane.clientHeight + 1) {
      bottom = Math.min(bottom, pane.getBoundingClientRect().bottom);
    }
    const footer = document.querySelector<HTMLElement>(".wb-footer");
    if (footer !== null) {
      const rect = footer.getBoundingClientRect();
      if (rect.height > 0 && rect.top < bottom) bottom = rect.top;
    }
    return bottom;
  });
}

/** Which container scrolls the package surface at this viewport. */
async function scrollOwner(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".wb-content-pane:not([hidden])");
    const windowScrolls = document.documentElement.scrollHeight > window.innerHeight + 1;
    const paneScrolls = pane !== null && pane.scrollHeight > pane.clientHeight + 1;
    if (windowScrolls) return "document";
    if (paneScrolls) return "pane";
    return "none";
  });
}

async function openPackage(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page
    .getByRole("complementary", { name: "Deployment Package navigator" })
    .getByRole("button", { name: "New package" })
    .click();
  await resetScrolls(page);
}

async function addItem(
  page: Page,
  {
    path,
    name = "Enabled",
    type = "DWord",
    value = "1",
  }: { path: string; name?: string; type?: string; value?: string },
) {
  const form = page.getByRole("form", { name: "Registry Item" });
  await form.getByRole("textbox", { name: "Registry path" }).fill(path);
  if (type !== "KeyRecursive") await form.getByRole("textbox", { name: "Value name" }).fill(name);
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption(type);
  const control =
    type === "DWord"
      ? form.getByRole("spinbutton", { name: "Registry value" })
      : form.getByRole("textbox", { name: "Registry value" });
  await control.fill(value);
  await form.getByRole("button", { name: "Add item" }).click();
  await resetScrolls(page);
}

/** The reference state: one package, one valid HKLM DWORD item, no warning, nothing opened. */
async function referenceState(page: Page, width: number, height: number) {
  await openPackage(page, width, height);
  await addItem(page, { path: "Software\\Northgate\\Layout" });
  await expect(page.locator(".wb-item-row")).toHaveCount(1);
}

/** The pressure states the plan requires for the matrix. */
async function pressureState(page: Page, kind: "long" | "template" | "warning" | "multiline") {
  if (kind === "long") {
    await addItem(page, {
      path: "Software\\Northgate\\" + "VeryLongSegment".repeat(6),
      name: "ValueNameThatIsFarTooLongForOneCell".repeat(3),
      type: "String",
      value: "AVeryLongUnbrokenValueThatMustStayInsideItsCell".repeat(4),
    });
    return;
  }
  if (kind === "template") {
    await addItem(page, { path: "Software\\Policies\\Northgate\\App", name: "EnableWidget" });
    return;
  }
  if (kind === "warning") {
    await addItem(page, { path: "Software\\WOW6432Node\\Northgate", name: "Mode" });
    return;
  }
  await addItem(page, {
    path: "Software\\Northgate\\Lines",
    name: "Lines",
    type: "MultiString",
    value: "Alpha\nBeta",
  });
}

test("the height contract holds for every viewport from 1280 x 700 upward", async ({ browser }) => {
  // This test walks several viewports, so it needs more than the default limit.
  test.setTimeout(120000);
  for (const [width, height] of [
    [1280, 700],
    [1280, 720],
    [1366, 768],
    [1436, 701],
    [1440, 900],
    [1600, 900],
    [1920, 1080],
    [2560, 1440],
    [3440, 1440],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await referenceState(page, width, height);
    const label = width + "x" + height;
    const composer = await stableBox(page, ".wb-composer");
    const head = await stableBox(page, ".wb-package-head");
    const row = await stableBox(page, ".wb-item-row");
    expect(composer.height, label + " composer").toBeLessThanOrEqual(260);
    expect(head.height, label + " head").toBeLessThanOrEqual(155);
    expect(row.y, label + " row top").toBeLessThanOrEqual(620);
    // The whole row has to sit in the visible area without scrolling, not only its top edge.
    expect(row.y + row.height, label + " row bottom").toBeLessThanOrEqual(
      await visibleBottom(page),
    );
  }
});

test("the surface uses the display width and keeps authoring above the list", async ({
  browser,
}) => {
  // This test walks several viewports, so it needs more than the default limit.
  test.setTimeout(90000);
  for (const width of [1024, 1440, 1920, 2560, 3440, 3840] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await referenceState(page, width, 900);
    const canvas = await box(page, ".wb-canvas--package-detail");
    const surface = await box(page, ".wb-canvas--package-detail > .wb-surface");
    const head = await box(page, ".wb-canvas--package-detail > .wb-package-head");
    const composer = await box(page, ".wb-composer");
    const toolbar = await box(page, ".wb-toolbar");
    expect(Math.abs(surface.x - head.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(head.x - composer.x)).toBeLessThanOrEqual(1);
    // The surface fills the view on every display instead of stopping at a fixed width.
    expect(Math.abs(surface.width - canvas.width), width + " surface width").toBeLessThanOrEqual(1);
    // On every display the list stacks below the form and shares its inner edge.
    expect(toolbar.y, width + " list below the form").toBeGreaterThanOrEqual(
      composer.y + composer.height - 1,
    );
    expect(Math.abs(composer.x - toolbar.x)).toBeLessThanOrEqual(1);
    const pathTitle = await box(page, ".wb-composer__grid .wb-field-title");
    const columnLabel = await box(page, ".wb-item-list__header span:first-child");
    expect(Math.abs(pathTitle.x - columnLabel.x)).toBeLessThanOrEqual(1);
    if (width >= 1024) {
      const clipped = await page
        .locator(".wb-package-name input")
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(clipped, "suggested name readable at " + width).toBeLessThanOrEqual(1);
    }
  }
});

test("the shell hands scrolling over between 960 and 961 px", async ({ page }) => {
  await referenceState(page, 960, 700);
  expect(await scrollOwner(page)).toBe("document");
  await referenceState(page, 961, 700);
  expect(await scrollOwner(page)).toBe("pane");
});

/** One matrix case: the same interactions and limits the plan requires at every viewport. */
async function expectMatrixCase(page: Page, width: number, height: number) {
  const label = width + "x" + height;
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(documentOverflow, label + " document").toBeLessThanOrEqual(1);

  const form = page.getByRole("form", { name: "Registry Item" });
  await bringIntoView(form);
  for (const name of ["Registry path", "Value name", "Registry value type", "Registry value"]) {
    const control = form
      .getByRole("textbox", { name })
      .or(form.getByRole("combobox", { name }))
      .or(form.getByRole("spinbutton", { name }))
      .first();
    await expect(control, label + " " + name).toBeVisible();
  }

  // The tool row wraps instead of overflowing and keeps its actions and filters operable.
  const toolbar = await page.locator(".wb-toolbar").evaluate((element) => ({
    overflow: element.scrollWidth - element.clientWidth,
    wraps: getComputedStyle(element).flexWrap,
  }));
  expect(toolbar.overflow, label + " toolbar").toBeLessThanOrEqual(1);
  expect(toolbar.wraps).toBe("wrap");
  // The import entry stays reachable here; the flow itself is covered by the budget guard.
  await expect(page.getByRole("button", { name: "Import Registry data" })).toBeEnabled();
  const search = page.getByRole("searchbox", { name: "Search Registry Items" });
  await bringIntoView(search);
  await search.fill("Northgate", { timeout: 5000 });
  await expect(page.locator(".wb-item-row"), label + " search keeps the row").toHaveCount(1);
  await search.fill("", { timeout: 5000 });
  await page
    .getByRole("combobox", { name: "Filter desired state" })
    .selectOption("Absent", { timeout: 5000 });
  await expect(page.locator(".wb-item-row"), label + " filter hides the row").toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Filter desired state" })
    .selectOption("All", { timeout: 5000 });
  await page
    .getByRole("combobox", { name: "Sort Registry Items" })
    .selectOption("valueName", { timeout: 5000 });
  await expect(page.locator(".wb-item-row"), label + " sort keeps the row").toHaveCount(1);

  // The details dialog opens, closes, and returns the focus to the form.
  const detailsTrigger = form.getByRole("button", { name: "Details…" });
  await bringIntoView(detailsTrigger);
  await detailsTrigger.click({ timeout: 5000 });
  const details = page.getByRole("dialog", { name: "Registry Item details" });
  await expect(details, label + " details").toBeVisible();
  await expect(details.getByRole("combobox", { name: "Desired state" }), label).toBeVisible();
  // The dialog takes the focus itself; without waiting for that, an Escape could land behind it.
  await expect(
    details.getByRole("textbox", { name: "Registry path" }),
    label + " dialog focus",
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(details, label + " details closed").toBeHidden({ timeout: 2000 });
  await expect(detailsTrigger, label + " focus return").toBeFocused();

  // The list scrolls only in its own container above 720 px; at most 720 px it stacks without overflow.
  const list = await page.locator(".wb-item-list").evaluate((element) => {
    const row = element.querySelector(".wb-item-row");
    return {
      overflow: element.scrollWidth - element.clientWidth,
      columns: row === null ? "" : getComputedStyle(row).gridTemplateColumns.split(" ").length,
    };
  });
  if (width <= 720) {
    expect(list.overflow, label + " stacked list").toBeLessThanOrEqual(1);
    expect(list.columns, label + " stacked columns").toBe(1);
  } else {
    expect(list.columns, label + " table columns").toBe(8);
    if (list.overflow > 0) {
      // What matters is that the last column and its actions are reachable inside the list viewport.
      await page
        .locator(".wb-item-list")
        .evaluate((element) => element.scrollTo(element.scrollWidth, 0));
      const actions = page
        .locator(".wb-item-row")
        .getByRole("button", { name: /More actions for/ });
      const actionsBox = await actions.boundingBox();
      const listBox = await page.locator(".wb-item-list").boundingBox();
      if (actionsBox === null || listBox === null) throw new Error(label + " no actions box");
      expect(actionsBox.x, label + " actions inside the list").toBeGreaterThanOrEqual(
        listBox.x - 1,
      );
      expect(
        actionsBox.x + actionsBox.width,
        label + " actions inside the list",
      ).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
    }
    await resetScrolls(page);
  }
}

const MATRIX_DESKTOP = [
  [1024, 768],
  [1152, 720],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3440, 1440],
] as const;

const MATRIX_EDGE = [
  [1280, 699],
  [1024, 600],
  [1093, 614],
  [910, 512],
  [1920, 512],
  [1024, 1440],
] as const;

const MATRIX_BREAKPOINTS = [
  [720, 900],
  [721, 900],
  [960, 900],
  [961, 900],
  [1180, 900],
  [1181, 900],
  [380, 844],
] as const;

for (const [group, cases] of [
  ["desktop", MATRIX_DESKTOP],
  ["edge", MATRIX_EDGE],
  ["breakpoint", MATRIX_BREAKPOINTS],
] as const) {
  test(
    "every " + group + " matrix viewport stays usable, capped, and free of horizontal overflow",
    async ({ browser }) => {
      // Three groups share the matrix, so each group stays far below the default test limit.
      test.setTimeout(240_000);
      for (const [width, height] of cases) {
        const context = await browser.newContext({ viewport: { width, height } });
        try {
          const page = await context.newPage();
          await referenceState(page, width, height);
          await expectMatrixCase(page, width, height);
        } finally {
          await context.close();
        }
      }
    },
  );
}

test("the pressure states keep the surface usable", async ({ browser }) => {
  // This test walks several viewports, so it needs more than the default limit.
  test.setTimeout(300000);
  for (const [width, height] of [
    [380, 844],
    [721, 900],
    [1024, 600],
    [1280, 700],
    [3440, 1440],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const label = width + "x" + height;
    // An empty package keeps its hint and exactly one import above the form.
    await openPackage(page, width, height);
    await expect(page.getByText(/holds no Registry Item yet/), label + " empty hint").toBeVisible();
    await expect(page.getByRole("button", { name: "Import Registry data" })).toHaveCount(1);
    const intro = await box(page, ".wb-composer-intro");
    const composer = await box(page, ".wb-composer");
    expect(intro.y, label + " import above the form").toBeLessThan(composer.y);

    for (const kind of ["long", "template", "warning", "multiline"] as const) {
      await openPackage(page, width, height);
      await pressureState(page, kind);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, label + " " + kind + " document").toBeLessThanOrEqual(1);
      await expect(page.locator(".wb-item-row"), label + " " + kind + " row").toHaveCount(1);
      if (kind === "template") {
        await expect(
          page.getByRole("button", { name: "Create template from selected items…" }),
          label + " template action",
        ).toBeVisible();
      }
      if (kind === "warning") {
        await expect(
          page.locator(".wb-item-row").getByRole("button", { name: "Warning" }),
          label + " warning",
        ).toBeVisible();
      }
      if (kind === "multiline") {
        await expect(page.locator(".wb-item-row strong"), label + " multiline item").toHaveText(
          "Lines",
        );
      }
      if (kind === "long") {
        const cells = await page.locator(".wb-item-row > [role='cell']").evaluateAll((elements) =>
          elements.map((element) => ({
            overflow: element.scrollWidth - element.clientWidth,
            clientWidth: element.clientWidth,
          })),
        );
        for (const cell of cells) {
          expect(cell.clientWidth, label + " long cell width").toBeGreaterThan(0);
          expect(cell.overflow, label + " long cell overflow").toBeLessThanOrEqual(1);
        }
      }
      await resetScrolls(page);
    }
  }
});

test("tab navigation keeps the focused control inside the visible area", async ({ browser }) => {
  // This test walks several viewports, so it needs more than the default limit.
  test.setTimeout(120000);
  for (const [width, height] of [
    [380, 844],
    [910, 512],
    [1024, 600],
    [1280, 700],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    try {
      const page = await context.newPage();
      await referenceState(page, width, height);
      const label = width + "x" + height;
      const bottom = await visibleBottom(page);
      // Start at the first form field, so the walk covers the fields, the actions and the tool row.
      await page
        .getByRole("form", { name: "Registry Item" })
        .getByRole("textbox", { name: "Registry path" })
        .focus();
      for (let step = 0; step < 12; step += 1) {
        const focused = await page.evaluate(() => {
          const element = document.activeElement;
          if (element === null) return null;
          const rect = element.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            name: element.getAttribute("aria-label") ?? element.tagName,
          };
        });
        if (focused === null) continue;
        expect(focused.bottom, label + " focused " + focused.name).toBeLessThanOrEqual(bottom + 1);
        expect(focused.top, label + " focused top " + focused.name).toBeGreaterThanOrEqual(-1);
        await page.keyboard.press("Tab");
      }
      // The row carries the item actions; from the focused row one Tab must reach them inside the list.
      await page.locator(".wb-item-row").focus();
      await page.keyboard.press("Tab");
      const insideList = await page.evaluate(() => {
        const list = document.querySelector(".wb-item-list");
        const active = document.activeElement;
        if (list === null || active === null) return null;
        const listRect = list.getBoundingClientRect();
        const rect = active.getBoundingClientRect();
        return (
          rect.top >= listRect.top - 1 &&
          rect.bottom <= listRect.bottom + 1 &&
          rect.left >= listRect.left - 1 &&
          rect.right <= listRect.right + 1
        );
      });
      expect(insideList, label + " row action inside the list").toBe(true);
    } finally {
      await context.close();
    }
  }
});

test("the form places its four fields on one shared split", async ({ page }) => {
  await referenceState(page, 1440, 900);
  const fields = await page.locator(".wb-composer__grid > .wb-field").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), right: Math.round(rect.right) };
    }),
  );
  const [pathField, nameField, typeField, valueField] = fields;
  if (!pathField || !nameField || !typeField || !valueField) {
    throw new Error("the form must render four fields");
  }
  expect(Math.abs(nameField.left - valueField.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(pathField.left - typeField.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(pathField.right - typeField.right)).toBeLessThanOrEqual(1);
  expect(valueField.left - typeField.left).toBeGreaterThan(100);
});

test("a wide form puts its four fields on one row with the controls on one line", async ({
  page,
}) => {
  await referenceState(page, 1920, 1080);
  const fields = await page.locator(".wb-composer__grid > .wb-field").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      // The control follows the title line in every field, including the hive and path pair.
      const control = element.children.item(1)?.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        controlTop: control === undefined ? -1 : Math.round(control.top),
      };
    }),
  );
  expect(fields).toHaveLength(4);
  const [pathField, nameField, typeField, valueField] = fields;
  if (!pathField || !nameField || !typeField || !valueField) {
    throw new Error("the form must render four fields");
  }
  for (const field of [nameField, typeField, valueField]) {
    expect(Math.abs(field.top - pathField.top), "field row").toBeLessThanOrEqual(1);
    expect(Math.abs(field.controlTop - pathField.controlTop), "control line").toBeLessThanOrEqual(
      1,
    );
  }
  // The path carries the hive and the longest text, the type the shortest.
  expect(pathField.width).toBeGreaterThan(nameField.width);
  expect(typeField.width).toBeLessThan(valueField.width);
});

test("the navigator runs flush from the top bar to the bottom edge", async ({ page }) => {
  for (const [width, height] of [
    [1280, 700],
    [1920, 1080],
  ] as const) {
    await referenceState(page, width, height);
    const topbar = await box(page, ".wb-topbar");
    const rail = await box(page, ".wb-rail");
    const note = await box(page, ".wb-rail__privacy");
    const label = width + "x" + height;
    expect(rail.x, label + " rail left edge").toBe(0);
    expect(Math.abs(rail.y - (topbar.y + topbar.height)), label + " rail top").toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(rail.y + rail.height - height), label + " rail bottom").toBeLessThanOrEqual(1);
    // The note at the foot of the navigator stays whole instead of being cut by the shell.
    expect(note.y + note.height, label + " note inside the rail").toBeLessThanOrEqual(
      rail.y + rail.height,
    );
  }
  // Stacked, the navigator is a band across the full width directly below the top bar.
  await referenceState(page, 960, 700);
  const topbar = await box(page, ".wb-topbar");
  const rail = await box(page, ".wb-rail");
  expect(rail.x).toBe(0);
  expect(Math.abs(rail.width - 960)).toBeLessThanOrEqual(1);
  expect(Math.abs(rail.y - (topbar.y + topbar.height))).toBeLessThanOrEqual(1);
});

test("the Registry Items card keeps the form and list together", async ({ page }) => {
  await referenceState(page, 1440, 900);
  const workspace = page.locator(".wb-registry-workspace");
  await expect(workspace.getByRole("heading", { name: "Registry Items" })).toBeVisible();
  // The count lives in the header only; the card no longer repeats it directly below.
  await expect(page.locator(".wb-package-settings__count")).toHaveText("1 Registry Item");
  await expect(workspace.locator(".wb-registry-workspace__heading")).toHaveText("Registry Items");
  await expect(workspace.getByRole("form", { name: "Registry Item" })).toBeVisible();
  await expect(workspace.locator(".wb-toolbar")).toBeVisible();
  await expect(workspace.locator(".wb-item-list")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registry Item", exact: true })).toBeVisible();
  await expect(page.getByText("Write the value this package deploys.")).toBeVisible();

  // The explanation shares the compact authoring line, leaving the list visible beneath it.
  const lines = await page.evaluate(() => {
    const heading = document.querySelector(".wb-composer__heading h3");
    const explanation = document.querySelector(".wb-composer__heading p");
    if (heading === null || explanation === null) {
      throw new Error("the form card heading is incomplete");
    }
    return {
      headingTop: heading.getBoundingClientRect().top,
      explanationTop: explanation.getBoundingClientRect().top,
    };
  });
  expect(Math.abs(lines.explanationTop - lines.headingTop)).toBeLessThanOrEqual(6);

  // Explaining itself may not cost the card its height budget.
  const composer = await box(page, ".wb-composer");
  expect(composer.height).toBeLessThanOrEqual(260);
});

test("a configured footer does not hide the first row or the form at the contract sizes", async ({
  browser,
}) => {
  /** A configured footer, so it cannot cover what the reader has to reach. */
  async function footerPage(width: number, height: number) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.route("**/config.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          applicationName: "Endpoint Registry Studio",
          accentColor: "#3157c8",
          footer: { items: [{ label: "Documentation", url: "https://example.invalid/docs" }] },
        }),
      });
    });
    return page;
  }
  for (const [width, height] of [
    [1280, 700],
    [1436, 701],
  ] as const) {
    const page = await footerPage(width, height);
    await referenceState(page, width, height);
    const composer = await box(page, ".wb-composer");
    const head = await box(page, ".wb-package-head");
    const row = await box(page, ".wb-item-row");
    expect(composer.height).toBeLessThanOrEqual(260);
    expect(head.height).toBeLessThanOrEqual(155);
    expect(row.y).toBeLessThanOrEqual(620);
    expect(row.y + row.height, width + "x" + height + " row with footer").toBeLessThanOrEqual(
      await visibleBottom(page),
    );
  }
  for (const [width, height] of [
    [380, 844],
    [910, 512],
    [1024, 600],
  ] as const) {
    const page = await footerPage(width, height);
    await referenceState(page, width, height);
    const details = page
      .getByRole("form", { name: "Registry Item" })
      .getByRole("button", { name: "Details…" });
    await bringIntoView(details);
    const detailsBox = await details.boundingBox();
    const bottom = await visibleBottom(page);
    expect(
      (detailsBox?.y ?? bottom + 1) + (detailsBox?.height ?? 0),
      width + "x" + height + " details",
    ).toBeLessThanOrEqual(bottom);
  }
});

test("the package name shows that it can be renamed", async ({ page }) => {
  await referenceState(page, 1440, 900);
  const name = page.locator(".wb-package-name input");
  const pencil = page.getByRole("button", { name: "Rename Deployment Package" });

  // The line is a field without hover: a permanent underline, and the name still drawn muted while it is
  // the suggestion, so a touch reader sees that the name is not fixed.
  const rest = await name.evaluate((element) => ({
    underline: Number.parseFloat(getComputedStyle(element).borderBottomWidth),
    suggested: element.getAttribute("data-suggested"),
    color: getComputedStyle(element).color,
    title: element.getAttribute("title"),
  }));
  expect(rest.underline).toBeGreaterThanOrEqual(1);
  expect(rest.suggested).toBe("true");
  expect(rest.title).toBe("Rename this Deployment Package");
  await expect(pencil).toBeVisible();

  // The pencil focuses the field and selects the whole name for an immediate overwrite.
  await pencil.click();
  await expect(name).toBeFocused();
  expect(
    await name.evaluate((element) => {
      const field = element as HTMLInputElement;
      return field.selectionStart === 0 && field.selectionEnd === field.value.length;
    }),
  ).toBe(true);
  await page.keyboard.type("Renamed package");
  await expect(page.getByRole("heading", { name: "Renamed package" })).toBeVisible();

  // A renamed package leaves the suggestion state, so the name is drawn as a chosen name from then on.
  const renamed = await name.evaluate((element) => ({
    suggested: element.getAttribute("data-suggested"),
    color: getComputedStyle(element).color,
  }));
  expect(renamed.suggested).toBeNull();
  expect(renamed.color).not.toBe(rest.color);

  // A click inside the field keeps the caret, so one part of a long name stays editable.
  await name.click();
  expect(
    await name.evaluate((element) => {
      const field = element as HTMLInputElement;
      return (field.selectionStart ?? 0) === (field.selectionEnd ?? 0);
    }),
  ).toBe(true);

  // The affordance must not push the header past its height budget.
  const head = await box(page, ".wb-package-head");
  expect(head.height).toBeLessThanOrEqual(155);
});

test("the header keeps the identity and the state card in two columns", async ({ page }) => {
  await referenceState(page, 1280, 700);
  const identity = await box(page, ".wb-package-head__identity");
  const status = await box(page, ".wb-package-head__status");
  const actions = await box(page, ".wb-page-actions");

  // The state card and the actions share the right column, so the header is not four stacked bands.
  expect(identity.x + identity.width).toBeLessThanOrEqual(status.x + 1);
  expect(actions.y).toBeGreaterThanOrEqual(status.y + status.height - 1);

  // The longest delivery method keeps the pill row on one line and the height budget intact.
  await page.getByRole("button", { name: /^Delivery method for/ }).click();
  await page.getByRole("menuitem", { name: /Intune Win32 app source/ }).click();
  await expect(page.getByRole("button", { name: /^Delivery method for/ })).toHaveText(
    /Intune Win32 app source/,
  );
  const pillTops = await page
    .locator(".wb-setting-menu")
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(pillTops).size).toBe(1);
  const head = await box(page, ".wb-package-head");
  expect(head.height).toBeLessThanOrEqual(155);
});
test("the stacked list keeps every field and its label at 380 px", async ({ page }) => {
  await referenceState(page, 380, 844);
  const labels = await page
    .locator(".wb-item-row > [role='cell']")
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-cell-label")));
  expect(labels).toEqual([
    "Enabled",
    "Registry Item",
    "Registry target",
    "Type",
    "Value",
    "State",
    "Status",
    "Actions",
  ]);
  await expect(page.locator(".wb-item-list__header")).toHaveCount(1);
  await expect(page.locator(".wb-item-row")).toHaveCount(1);
  await expect(page.locator(".wb-item-row").getByRole("switch")).toBeChecked();
  const painted = await page
    .locator(".wb-item-row > [role='cell']")
    .evaluateAll((cells) =>
      cells.map((cell) => getComputedStyle(cell, "::before").content.replaceAll('"', "")),
    );
  expect(painted).toEqual(labels);
});

test("the details dialog opens at the top with the advanced region expanded", async ({ page }) => {
  // This test walks several viewports, so it needs more than the default limit.
  test.setTimeout(60000);
  await referenceState(page, 1440, 900);
  await page
    .getByRole("form", { name: "Registry Item" })
    .getByRole("button", { name: "Details…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Registry Item details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeVisible();

  for (const wait of [100, 300, 700]) {
    await page.waitForTimeout(wait);
    expect(
      await page.locator(".wb-dialog__body").evaluate((element) => Math.round(element.scrollTop)),
    ).toBe(0);
  }
  await expect(dialog.getByRole("textbox", { name: "Registry path" })).toBeFocused();
  await expect(dialog.getByText("Registry type and value must match exactly.")).toBeVisible();
  await expect(dialog.locator(".wb-editor-section__heading > span")).toHaveCount(0);
  // The advanced content starts on the same field edge as the sections above it.
  const sectionField = await box(page, ".wb-editor-section .wb-form-grid");
  const advancedField = await box(page, ".wb-disclosure__content .wb-form-grid");
  expect(Math.abs(sectionField.x - advancedField.x)).toBeLessThanOrEqual(1);

  await page.locator(".wb-dialog__body").evaluate((element) => element.scrollTo(0, 400));
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page
    .getByRole("form", { name: "Registry Item" })
    .getByRole("button", { name: "Details…" })
    .click();
  await expect(page.getByRole("dialog", { name: "Registry Item details" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(
    await page.locator(".wb-dialog__body").evaluate((element) => Math.round(element.scrollTop)),
  ).toBe(0);
});

test("toggling the advanced region by keyboard keeps it in sight", async ({ page }) => {
  await referenceState(page, 1440, 900);
  await page
    .getByRole("form", { name: "Registry Item" })
    .getByRole("button", { name: "Details…" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Registry Item details" });
  const summary = dialog.locator("summary", { hasText: "Advanced" });
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeVisible();
  await summary.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeHidden();
  await summary.press("Enter");
  await expect(dialog.getByRole("combobox", { name: "Desired state" })).toBeVisible();
  await expect(summary).toBeInViewport();
});

test("the permanent form shows only the type specific hint", async ({ page }) => {
  await referenceState(page, 1440, 900);
  const form = page.getByRole("form", { name: "Registry Item" });
  await expect(form.getByText("Registry type and value must match exactly.")).toBeHidden();
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("MultiString");
  await expect(form.getByText("One value per line. Order is significant.")).toBeVisible();
});

test("a validation navigation still reveals the field it names", async ({ page }) => {
  await openPackage(page, 1440, 900);
  await addItem(page, { path: "Software\\WOW6432Node\\Layout", name: "Mode" });
  await page.locator(".wb-item-row").getByRole("button", { name: "Warning" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Registry Item" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Registry view" })).toBeFocused();
  await expect(dialog.locator("details.wb-disclosure")).toHaveAttribute("open", "");
});

test("the package surface is captured for visual review at five sizes", async ({
  browser,
}, testInfo) => {
  // This test walks several viewports, so it needs more than the default limit.
  test.setTimeout(120000);
  const artifact = testInfo.project.name.includes("docker") ? "docker" : "web";
  for (const [width, height] of [
    [380, 844],
    [1024, 600],
    [1280, 700],
    [1440, 900],
    [3440, 1440],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await referenceState(page, width, height);
    const file = testInfo.outputPath("surface-" + artifact + "-" + width + "x" + height + ".png");
    await page.locator(".wb-canvas--package-detail").screenshot({ path: file });
    expect(file).toContain(".png");
    expect(statSync(file).size, artifact + " " + width + "x" + height).toBeGreaterThan(10_000);
  }
});

test("the form sits on the card surface without a second band above the list", async ({ page }) => {
  // The three roles of that area in both themes: the card surface, the one band and the plain header.
  for (const theme of ["light", "dark"] as const) {
    await referenceState(page, 1440, 900);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if ((await page.locator(".wb-app").getAttribute("data-theme")) === theme) break;
      await page.getByRole("button", { name: "Change theme" }).click();
    }
    expect(await page.locator(".wb-app").getAttribute("data-theme")).toBe(theme);
    const surfaces = await page.evaluate(() => {
      /** Resolve a token the way the browser paints it, so formats cannot differ. */
      const resolve = (token: string) => {
        const probe = document.createElement("div");
        probe.style.background = getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim();
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      };
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error("missing " + selector);
        return getComputedStyle(element).backgroundColor;
      };
      return {
        solid: resolve("--wb-surface-solid"),
        band: resolve("--wb-band"),
        composer: read(".wb-composer"),
        listHeader: read(".wb-item-list__header"),
        toolbar: read(".wb-toolbar"),
      };
    });
    // The form is the solid card surface, the tool row is the band, and the list header adds no second.
    expect(surfaces.composer, theme + " composer surface").toBe(surfaces.solid);
    expect(surfaces.toolbar, theme + " tool row band").toBe(surfaces.band);
    expect(surfaces.listHeader, theme + " list header").toBe("rgba(0, 0, 0, 0)");
  }
});

test("search and filters wrap as one group and never leave a select alone", async ({ page }) => {
  for (const [width, height] of [
    [1280, 720],
    [1366, 768],
    [1920, 1080],
  ] as const) {
    await referenceState(page, width, height);
    const tops = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".wb-toolbar__filters > *")).map((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    );
    expect(tops.length, width + " filter controls").toBe(3);
    expect(new Set(tops).size, width + " one line").toBe(1);
  }
});

test("no visible text is set below 12 px", async ({ page }) => {
  // The smallest text of the interface is 12 px, in every view and dialog a reader opens.
  const tooSmall = () =>
    page.evaluate(() => {
      const findings: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const element = node.parentElement;
        if (!text || element === null) continue;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        if (style.visibility === "hidden" || box.width === 0 || box.height === 0) continue;
        if (parseFloat(style.fontSize) < 12)
          findings.push(style.fontSize + " " + text.slice(0, 40));
      }
      return findings;
    });

  await referenceState(page, 1440, 900);
  expect(await tooSmall(), "package detail").toEqual([]);
  await page.getByRole("button", { name: "Details…" }).click();
  expect(await tooSmall(), "item details").toEqual([]);
  // Dialogs are closed by their own buttons: Escape could arrive before the dialog owns the focus.
  const details = page.getByRole("dialog", { name: "Registry Item details" });
  await details.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(details).toBeHidden();
  await page.getByRole("button", { name: "Review output" }).click();
  expect(await tooSmall(), "review").toEqual([]);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".wb-dialog-layer")).toHaveCount(0);
  await page.locator(".wb-rail-entry--overview").click();
  expect(await tooSmall(), "overview").toEqual([]);
});

test("every column label of the item list fits its column", async ({ page }) => {
  // The labels follow the eyebrow type; a label wider than its column ran past the inner edge.
  for (const [width, height] of [
    [1280, 700],
    [1920, 1080],
  ] as const) {
    await referenceState(page, width, height);
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".wb-item-list__header > span")).flatMap((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const text = range.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return text.right > box.right + 0.5
          ? [cell.textContent + " " + (text.right - box.right)]
          : [];
      }),
    );
    expect(overflow, width + " px").toEqual([]);
  }
});

test("the Workspace name keeps its full width beside the memory notice at 380 px", async ({
  page,
}) => {
  await openPackage(page, 380, 844);
  const name = page.getByRole("textbox", { name: "Workspace name" });
  const fits = await name.evaluate((input) => input.scrollWidth <= input.clientWidth);
  expect(fits).toBe(true);
  const field = await box(page, ".wb-workspace-name__field");
  const notice = await box(page, ".wb-workspace-persist");
  expect(notice.y).toBeGreaterThanOrEqual(field.y + field.height);
});

test("the package name underline keeps its distance from the settings pills", async ({ page }) => {
  // The underline belongs to the name; the settings form their own line below it at every width.
  for (const [width, height] of [
    [1280, 700],
    [1920, 1080],
    [380, 844],
  ] as const) {
    await openPackage(page, width, height);
    const line = await box(page, ".wb-package-name input");
    const settings = await box(page, ".wb-package-settings");
    expect(settings.y - (line.y + line.height), width + " px gap").toBeGreaterThanOrEqual(6);
  }
});

test("the package name shows a rounded focus ring around its line", async ({ page }) => {
  // The ring moves from the borderless field to its heading, so it has to stay visible and rounded there.
  await openPackage(page, 1440, 900);
  const name = page.getByRole("textbox", { name: "Deployment Package name" });
  await name.focus();
  const ring = await page.evaluate(() => {
    const input = document.querySelector(".wb-package-name input");
    const heading = document.querySelector(".wb-package-name");
    if (input === null || heading === null) throw new Error("the package name is missing");
    const field = getComputedStyle(input);
    const line = getComputedStyle(heading);
    return {
      fieldOutline: field.outlineStyle,
      lineOutline: line.outlineStyle,
      lineWidth: line.outlineWidth,
      lineRadius: line.borderTopLeftRadius,
    };
  });
  expect(ring.fieldOutline).toBe("none");
  expect(ring.lineOutline).toBe("solid");
  expect(ring.lineWidth).toBe("3px");
  expect(ring.lineRadius).not.toBe("0px");
});

test("selects, search fields and single-line fields take the size of the buttons beside them", async ({
  page,
}) => {
  // Without a size of their own, the selects and the search field inherited the body text and looked
  // almost twice as large as the buttons of the same row. Every control is measured as it is painted:
  // the text on the element that carries it, the height on the bordered box, which for the search field
  // is the label around its input.
  const measure = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const text = element.querySelector("input") ?? element;
        return {
          fontSize: getComputedStyle(text).fontSize,
          height: Math.round(element.getBoundingClientRect().height),
        };
      });
  const expectLike = async (reference: string, selectors: readonly string[]) => {
    const expected = await measure(reference);
    for (const selector of selectors) {
      const measured = await measure(selector);
      expect(measured.fontSize, selector + " font size").toBe(expected.fontSize);
      expect(measured.height, selector + " height").toBe(expected.height);
    }
  };

  await referenceState(page, 1440, 900);
  await expectLike(".wb-toolbar .wb-button", [
    ".wb-toolbar select",
    ".wb-toolbar .wb-search",
    ".wb-composer .wb-field input",
    ".wb-composer .wb-field select",
  ]);

  await page.locator(".wb-rail-entry--overview").click();
  await expect(page.locator(".wb-filterbar")).toBeVisible();
  await expectLike(".wb-commandbar .wb-button", [
    ".wb-filterbar select",
    ".wb-filterbar .wb-search",
  ]);
});
