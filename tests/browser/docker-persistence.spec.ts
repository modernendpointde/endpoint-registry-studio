import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function openLongWorkspace(page: Page) {
  const workspace = JSON.parse(
    readFileSync(
      new URL("../../samples/01-hklm-dword.registry-workspace.json", import.meta.url),
      "utf8",
    ),
  ) as { packages: Array<Record<string, unknown>> };
  const template = workspace.packages[0];
  if (!template) throw new Error("Sample workspace package is missing.");
  workspace.packages = Array.from({ length: 12 }, (_, index) => ({
    ...template,
    id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
    name: `Docker shell package ${index + 1}`,
    items: [],
  }));
  await page.getByLabel("Open workspace or package file").setInputFiles({
    name: "docker-shell-layout.registry-workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(workspace)),
  });
  await expect(
    page.getByRole("row", { name: /Docker shell package 12.*Incomplete/ }),
  ).toBeVisible();
}

async function addBinaryItem(page: Page) {
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Registry Item" });
  await dialog.getByRole("textbox", { name: "Registry path" }).fill("Software\Contoso");
  await dialog.getByRole("textbox", { name: "Value name" }).fill("Payload");
  await dialog.getByRole("combobox", { name: "Registry value type" }).selectOption("Binary");
  await dialog.getByRole("textbox", { name: "Registry value" }).fill("00 ff 10");
  await dialog.getByRole("button", { name: "Add item" }).click();
}

test("docker artifact persists, restores and can clear the stored browser copy", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Not saved in this tab" })).toHaveCount(0);
  await expect(page.getByText(/Not saved in this tab/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add package" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Deployment Package" });
  await dialog.getByRole("textbox", { name: "Package name" }).fill("Persistent Package");
  await dialog.getByRole("button", { name: "Add package" }).click();
  await expect(page.getByRole("heading", { name: "Persistent Package" })).toBeVisible();
  await addBinaryItem(page);
  await expect(page.getByText("✓ Saved locally")).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("row", { name: /Persistent Package.*Ready/ })).toBeVisible();
  await expect(page.getByText("✓ Saved locally")).toBeVisible();

  await page.getByRole("button", { name: "About" }).click();
  await page.getByRole("button", { name: "Privacy and local processing" }).click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Delete workspace from this browser" }).click();
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
    "Untitled Workspace",
  );
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
    "Untitled Workspace",
  );
  await expect(page.getByRole("row", { name: /Persistent Package.*Ready/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("docker artifact uses the desktop content-pane scroll shell", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
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
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  await openLongWorkspace(page);

  const pane = page.locator(".wb-content-pane");
  await pane.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator(".wb-workbench").evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    await page.locator(".wb-footer").evaluate((element) => element.getBoundingClientRect().bottom),
  ).toBeCloseTo(800, 0);
});
