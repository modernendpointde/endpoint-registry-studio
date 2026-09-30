import { expect, test, type Page } from "@playwright/test";

const registryText =
  'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\Software\\Northgate\\Budget]\r\n"Enabled"=dword:00000001\r\n';

/**
 * The plan counts one activation per control decision. Typing counts zero, a native select counts one,
 * and choosing a file counts once although it opens an operating system dialog. A keyboard action that
 * triggers the commit counts once as well. This harness applies that rule, so an authoring regression
 * fails the recorded budgets.
 */
async function countActivations(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __activations?: number };
    state.__activations = 0;
    /**
     * Set while an eligible Enter is handled, together with the form it belongs to and the submit button
     * the browser activates for it. Only that keyboard-synthesised click is ignored; a later or unrelated
     * activation still counts.
     */
    let pendingKeyboardSubmit: { form: HTMLFormElement | null; submitter: Element | null } | null =
      null;
    const bump = () => {
      state.__activations = (state.__activations ?? 0) + 1;
    };
    document.addEventListener(
      "keydown",
      (event) => {
        // A held key and an IME composition do not express a decision of their own.
        if (event.key !== "Enter" || event.isComposing || event.repeat) return;
        const target = event.target as HTMLElement | null;
        if (!target || target.tagName === "TEXTAREA") return;
        const inputType = target instanceof HTMLInputElement ? target.type : undefined;
        const submits =
          target.tagName === "SELECT" ||
          (inputType !== undefined &&
            !["checkbox", "radio", "file", "button", "submit"].includes(inputType));
        if (!submits) return;
        const form =
          target instanceof HTMLInputElement || target instanceof HTMLSelectElement
            ? target.form
            : null;
        // An Enter that cannot submit a form commits nothing; the header fields work without one.
        if (form === null) return;
        pendingKeyboardSubmit = {
          form,
          /*
           * The dialogs connect their submit buttons through the form attribute, so the button is not a
           * descendant of the form. The form's element collection does include it, and that is where the
           * implicit submission looks for its default button as well.
           */
          submitter:
            Array.from(form.elements).find(
              (element) =>
                (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
                element.type === "submit",
            ) ?? null,
        };
        window.setTimeout(() => {
          pendingKeyboardSubmit = null;
        }, 0);
        bump();
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        const control = target?.closest("button, summary, [role='menuitem']") ?? null;
        if (!control) return;
        if (event.detail === 0 && pendingKeyboardSubmit) {
          const { form, submitter } = pendingKeyboardSubmit;
          const isThatSubmitter = submitter !== null && control === submitter;
          const isThatForm =
            form !== null &&
            (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) &&
            control.form === form;
          if (isThatSubmitter || (submitter === null && isThatForm)) return;
        }
        bump();
      },
      true,
    );
    document.addEventListener(
      "change",
      (event) => {
        const target = event.target as HTMLInputElement | HTMLSelectElement | null;
        if (!target) return;
        if (target.tagName === "SELECT") bump();
        else if (target.tagName === "INPUT" && ["checkbox", "radio", "file"].includes(target.type))
          bump();
      },
      true,
    );
  });
}

async function activations(page: Page) {
  return page.evaluate(() => (window as unknown as { __activations?: number }).__activations ?? 0);
}

async function openApp(page: Page) {
  await countActivations(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
}

/** One committed item in full, so a sequence cannot pass on its activation count alone. */
async function expectItemRow(
  page: Page,
  { name, type, value, path }: { name: string; type: string; value: string; path: string },
) {
  const row = page.locator(".wb-item-row", { hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".wb-target span")).toHaveText("HKLM");
  await expect(row.locator(".wb-target code")).toHaveText(path);
  await expect(row.locator(".wb-target small")).toHaveText(name);
  await expect(row).toContainText(type);
  await expect(row.locator(".wb-item-value code")).toHaveText(value);
  await expect(row.locator(".wb-state")).toHaveText("Present");
  await expect(row.getByRole("switch")).toBeChecked();
}

/**
 * The same end state on both input paths: the given number of items in the package, and one enabled,
 * Present item with the given name, type, and value under the shared path.
 */
async function expectSingleItem(
  page: Page,
  {
    name,
    type,
    value,
    path = "Software\\Northgate\\Budget",
    items = 1,
  }: { name: string; type: string; value: string; path?: string; items?: number },
) {
  const navigator = page.getByRole("complementary", { name: "Deployment Package navigator" });
  await expect(
    navigator.getByText(new RegExp("· " + items + (items === 1 ? " item$" : " items$"))),
  ).toBeVisible();

  await expectItemRow(page, { name, type, value, path });
}

/** Creates a package and returns the permanent item form, with the shared authoring entries filled in. */
async function openFilledItemForm(page: Page, valueName: string) {
  const navigator = page.getByRole("complementary", { name: "Deployment Package navigator" });
  await navigator.getByRole("button", { name: "New package" }).click();

  const form = page.getByRole("form", { name: "Registry Item" });
  await form.getByRole("textbox", { name: "Registry path" }).fill("Software\\Northgate\\Budget");
  await form.getByRole("textbox", { name: "Value name" }).fill(valueName);
  return form;
}

test("sequence A: a package with one DWORD stays within three activations", async ({ page }) => {
  await openApp(page);
  const form = await openFilledItemForm(page, "Enabled");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
  await form.getByRole("spinbutton", { name: "Registry value" }).fill("1");
  await form.getByRole("button", { name: "Add item" }).click();

  await expectSingleItem(page, { name: "Enabled", type: "DWORD", value: "1" });
  // The measured cost equals the recorded budget, so one more activation fails this guard.
  expect(await activations(page)).toBe(3);
});

test("sequence A with the keyboard reaches the same item at the same cost", async ({ page }) => {
  await openApp(page);
  const navigator = page.getByRole("complementary", { name: "Deployment Package navigator" });
  const form = await openFilledItemForm(page, "Enabled");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
  const value = form.getByRole("spinbutton", { name: "Registry value" });
  await value.fill("1");
  await value.press("Enter");

  await expectSingleItem(page, { name: "Enabled", type: "DWORD", value: "1" });
  expect(await activations(page)).toBe(3);

  // A later, unrelated activation is not swallowed by the keyboard de-duplication.
  const afterCommit = await activations(page);
  await navigator.getByRole("button", { name: /All packages/ }).click();
  expect(await activations(page)).toBe(afterCommit + 1);
});

test("one activation creates a package and its header name takes effect while it is typed", async ({
  page,
}) => {
  await openApp(page);
  const navigator = page.getByRole("complementary", { name: "Deployment Package navigator" });
  await navigator.getByRole("button", { name: "New package" }).click();
  const name = page.getByRole("textbox", { name: "Deployment Package name" });
  await expect(name).toHaveValue("Untitled Deployment Package");
  await name.fill("Budget name");
  // Typing costs nothing, and an Enter here submits nothing, so it costs nothing either.
  await name.press("Enter");

  await expect(page.getByRole("heading", { name: "Budget name" })).toBeVisible();
  expect(await activations(page)).toBe(1);
  // The Enter never reaches the item form, so the package is still empty.
  await expect(page.getByText(/This package holds no Registry Item yet/)).toBeVisible();
});

test("the guard ignores composing, repeated, toggle, and multi-line Enter", async ({ page }) => {
  await openApp(page);
  const form = await openFilledItemForm(page, "Enabled");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
  const value = form.getByRole("spinbutton", { name: "Registry value" });
  await value.fill("1");

  // A held Enter cancels the browser's own submission, a composing Enter keeps its composition, and
  // neither counts as a decision.
  const beforeComposition = await activations(page);
  const dispatched = await value.evaluate((element) => {
    const repeat = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    return {
      repeatCancelled: !element.dispatchEvent(repeat),
      composingCancelled: !element.dispatchEvent(composing),
    };
  });
  expect(dispatched.repeatCancelled).toBe(true);
  expect(dispatched.composingCancelled).toBe(false);
  expect(await activations(page)).toBe(beforeComposition);
  await expect(form).toBeVisible();

  // A toggle is not a commit target; the dialog cancels Enter from one.
  await form.getByRole("button", { name: "Details…" }).click();
  const details = page.getByRole("dialog", { name: "Registry Item details" });
  const beforeToggle = await activations(page);
  await details.getByRole("checkbox", { name: "Enabled" }).press("Enter");
  expect(await activations(page)).toBe(beforeToggle);
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");

  // A multi-line value keeps its line break and does not commit.
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("MultiString");
  const beforeMultiline = await activations(page);
  const textarea = form.getByRole("textbox", { name: "Registry value" });
  await textarea.fill("first");
  await textarea.press("Enter");
  await textarea.pressSequentially("second");
  expect(await activations(page)).toBe(beforeMultiline);
  await expect(form).toBeVisible();
  await expect(textarea).toHaveValue("first\nsecond");
});

test("sequence D: a String value costs two activations", async ({ page }) => {
  await openApp(page);
  // A new item starts as String, so the type choice does not cost an activation here.
  const form = await openFilledItemForm(page, "Caption");
  await form.getByRole("textbox", { name: "Registry value" }).fill("Northgate");
  await form.getByRole("button", { name: "Add item" }).click();

  await expectSingleItem(page, { name: "Caption", type: "SZ", value: "Northgate" });
  expect(await activations(page)).toBe(2);
});

test("sequence B: five values under one path stay within seven activations", async ({ page }) => {
  await openApp(page);
  const form = await openFilledItemForm(page, "Value1");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
  await form.getByRole("spinbutton", { name: "Registry value" }).fill("1");
  await form.getByRole("button", { name: "Add item" }).click();

  // The carried path and type mean each further value costs one activation: adding it.
  for (const name of ["Value2", "Value3", "Value4", "Value5"]) {
    await form.getByRole("textbox", { name: "Value name" }).fill(name);
    await form.getByRole("spinbutton", { name: "Registry value" }).fill("1");
    await form.getByRole("button", { name: "Add item" }).click();
  }

  await expectSingleItem(page, { name: "Value1", type: "DWORD", value: "1", items: 5 });
  // Every one of the five values has to be a complete item, not just the first and the last.
  for (const name of ["Value1", "Value2", "Value3", "Value4", "Value5"]) {
    await expectItemRow(page, {
      name,
      type: "DWORD",
      value: "1",
      path: "Software\\Northgate\\Budget",
    });
  }
  expect(await activations(page)).toBe(7);
});

test("the overview and the navigator both create a package for one activation", async ({
  page,
}) => {
  await openApp(page);

  const overview = page.getByRole("region", { name: "Deployment Packages" });
  await overview.getByRole("button", { name: "New package" }).click();
  await expect(page.getByRole("heading", { name: "Untitled Deployment Package" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await activations(page)).toBe(1);

  const navigator = page.getByRole("complementary", { name: "Deployment Package navigator" });
  await navigator.getByRole("button", { name: "New package" }).click();
  // The second suggestion steps on, so the packages stay distinguishable.
  await expect(page.getByRole("heading", { name: "Untitled Deployment Package 2" })).toBeVisible();
  expect(await activations(page)).toBe(2);
});

test("sequence B with the keyboard reaches the same five values at the same cost", async ({
  page,
}) => {
  await openApp(page);
  const form = await openFilledItemForm(page, "Value1");
  await form.getByRole("combobox", { name: "Registry value type" }).selectOption("DWord");
  const value = form.getByRole("spinbutton", { name: "Registry value" });

  for (const name of ["Value1", "Value2", "Value3", "Value4", "Value5"]) {
    await form.getByRole("textbox", { name: "Value name" }).fill(name);
    await value.fill("1");
    await value.press("Enter");
  }

  await expectSingleItem(page, { name: "Value1", type: "DWORD", value: "1", items: 5 });
  // The keyboard path reaches the same five complete items as the pointer path.
  for (const name of ["Value1", "Value2", "Value3", "Value4", "Value5"]) {
    await expectItemRow(page, {
      name,
      type: "DWORD",
      value: "1",
      path: "Software\\Northgate\\Budget",
    });
  }
  expect(await activations(page)).toBe(7);
});

test("sequence C with the keyboard imports the file at the same cost", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "Import Registry data" }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Import Registry data" });
  await dialog.getByLabel("Choose Registry file").setInputFiles({
    name: "budget.reg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(registryText, "utf8"),
  });
  await expect(dialog.getByText("1 item", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Import 1 item" }).press("Enter");

  await expectSingleItem(page, {
    name: "Enabled",
    type: "DWORD",
    value: "1",
    path: "Software\\Northgate\\Budget",
  });
  expect(await activations(page)).toBe(3);
});

test("sequence C: importing a Registry file stays within three activations", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "Import Registry data" }).click();
  const dialog = page.getByRole("dialog", { name: "Import Registry data" });
  await dialog.getByLabel("Choose Registry file").setInputFiles({
    name: "budget.reg",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(registryText, "utf8"),
  });
  await expect(dialog.getByText("1 item", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Import 1 item" }).click();

  await expectSingleItem(page, {
    name: "Enabled",
    type: "DWORD",
    value: "1",
    path: "Software\\Northgate\\Budget",
  });
  expect(await activations(page)).toBe(3);
});
