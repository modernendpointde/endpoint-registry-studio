import { expect, test, type Locator, type Page } from "@playwright/test";

const LONG_VALUE = "V".repeat(180);
const LONG_NAME = "N".repeat(120);
const LONG_PATH = "Software\\" + "P".repeat(120);
const LONG_DESCRIPTION = "D".repeat(120);

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openApp(page: Page) {
  const errors = captureRuntimeErrors(page);
  await page.goto("/");
  const memoryNotice = page.getByRole("dialog", { name: "Not saved in this tab" });
  if ((await memoryNotice.count()) === 1) {
    await memoryNotice.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  return errors;
}

function overflowWorkspace() {
  return {
    schemaVersion: 7,
    kind: "registry-workspace",
    generatorVersion: "1.0.1",
    id: "11111111-1111-4111-8111-111111111199",
    name: "Overflow Workspace",
    packages: [
      {
        id: "22222222-2222-4222-8222-222222222299",
        name: "Overflow Package",
        deployment: {
          method: "Remediation",
          runContext: "System",
          runIn64BitPowerShell: true,
          enforceSignatureCheck: false,
        },
        items: [
          {
            id: "33333333-3333-4333-8333-333333333399",
            enabled: true,
            registry: {
              desiredState: "Present",
              deletionMode: "Value",
              hive: "HKEY_LOCAL_MACHINE",
              keyPath: LONG_PATH,
              valueName: LONG_NAME,
              value: { type: "String", data: LONG_VALUE },
              view: "Auto",
              rollbackMode: "None",
              rollbackValue: { type: "String", data: "" },
            },
            userHive: { includeDefaultUser: false },
            description: LONG_DESCRIPTION,
          },
        ],
      },
    ],
  };
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("Missing bounding box.");
  return value;
}

function endsBefore(left: { x: number; width: number }, right: { x: number }, tolerance = 1) {
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + tolerance);
}

async function assertTruncated(locator: Locator) {
  const overflow = await locator.evaluate(
    (element) => (element as HTMLElement).scrollWidth - (element as HTMLElement).clientWidth,
  );
  expect(overflow).toBeGreaterThan(24);
}

test("keeps long Registry Item fields inside their table cells", async ({ page }) => {
  const errors = await openApp(page);
  await page.getByLabel("Open workspace or package file").setInputFiles({
    name: "overflow.registry-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(overflowWorkspace())),
  });
  await page.getByRole("button", { name: "Open Overflow Package, Ready" }).click();
  await expect(page.getByRole("heading", { name: "Overflow Package" })).toBeVisible();

  const row = page.locator(".wb-item-row").first();
  await expect(row).toBeVisible();

  for (const width of [1280, 1920] as const) {
    await page.setViewportSize({ width, height: 800 });
    await expect(row).toBeVisible();

    const label = row.locator("strong");
    const description = row.locator('[role="cell"]').nth(1).locator("small");
    const target = row.locator(".wb-target");
    const path = row.locator(".wb-target code");
    const valueName = row.locator(".wb-target small");
    const type = row.locator('[role="cell"]').nth(3);
    const value = row.locator(".wb-item-value code");
    const state = row.locator(".wb-state");
    const status = row.getByRole("button", { name: "Ready" });
    const actions = row.locator(".wb-icon-button--menu");

    const rowBox = await box(row);
    const labelBox = await box(label);
    const descriptionBox = await box(description);
    const targetBox = await box(target);
    const pathBox = await box(path);
    const valueNameBox = await box(valueName);
    const typeBox = await box(type);
    const valueBox = await box(value);
    const stateBox = await box(state);
    const statusBox = await box(status);
    const actionsBox = await box(actions);

    endsBefore(labelBox, targetBox);
    endsBefore(descriptionBox, targetBox);
    endsBefore(pathBox, typeBox);
    endsBefore(valueNameBox, typeBox);
    endsBefore(valueBox, stateBox);
    endsBefore(stateBox, statusBox);
    endsBefore(statusBox, actionsBox);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    expect(rowBox.height).toBeLessThan(96);

    await assertTruncated(label);
    await assertTruncated(description);
    await assertTruncated(path);
    await assertTruncated(valueName);
    await assertTruncated(value);

    expect(await value.getAttribute("title")).toBeNull();
    expect(await label.getAttribute("title")).toBeNull();
    const longTitles = await row
      .locator("[title]")
      .evaluateAll((elements) =>
        elements
          .map((element) => element.getAttribute("title") ?? "")
          .filter((title) => title.length > 80),
      );
    expect(longTitles).toEqual([]);

    await expect(state).toHaveText("Present");
    await expect(status).toBeVisible();
    await actions.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});
