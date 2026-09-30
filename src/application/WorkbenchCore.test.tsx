import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RUNTIME_CONFIG } from "./runtimeConfig";
import { RELEASE_VERSION } from "../version";
import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
} from "../domain/workspace/workspace";
import { exportRegistryPackage, exportWorkspace } from "../serialization/workspaceSchema";
import {
  createMemoryBackend,
  createWorkspaceHome,
  setPersistentWorkspaceHomeForTests,
} from "../platform/browser/persistentWorkspaceHome";
import { DockerWorkbench } from "./DockerWorkbench";
import { answerConfirm } from "../test/confirmDialog";

const createObjectURL = vi.fn(() => "blob:test");

function browserTextFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: vi.fn(() => Promise.resolve(bytes.slice().buffer)),
  } as unknown as File;
}

function utf16LeFile(name: string, content: string): File {
  const bytes = new Uint8Array(2 + content.length * 2);
  bytes.set([0xff, 0xfe]);
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: vi.fn(() => Promise.resolve(bytes.slice().buffer)),
  } as unknown as File;
}

function renderApp() {
  return render(<DockerWorkbench runtimeConfig={DEFAULT_RUNTIME_CONFIG} />);
}

/** Creates a package from the navigator: one activation, and its detail view opens. */
async function createPackageNow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByRole("complementary", { name: "Deployment Package navigator" })).getByRole(
      "button",
      { name: "New package" },
    ),
  );
}

/** The header name belongs to the package and takes effect while it is typed. */
async function renamePackage(user: ReturnType<typeof userEvent.setup>, name: string) {
  const field = screen.getByRole("textbox", { name: "Deployment Package name" });
  await user.clear(field);
  await user.type(field, name);
}

/** The deployment settings stay behind one disclosure in the package editor. */
async function openPackageEditor(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "Edit package" }));
  return screen.getByRole("dialog", { name: "Edit Deployment Package" });
}

/** The deployment settings live behind one disclosure, so a test that changes them opens it first. */
async function openDeploymentSettings(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  const details = within(dialog)
    .getByText("Deployment", { selector: "summary strong" })
    .closest("details")!;
  if (details.hasAttribute("open")) return;
  await user.click(within(dialog).getByText("Deployment", { selector: "summary strong" }));
  expect(details).toHaveAttribute("open");
}

async function createPackage(user: ReturnType<typeof userEvent.setup>, name = "Security Baseline") {
  await createPackageNow(user);
  await renamePackage(user, name);
}

async function createPackageWithOptions(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  method: "Remediation" | "PlatformScript" | "Win32App",
  context: "System" | "LoggedOnUser" = "System",
) {
  await createPackage(user, name);
  const dialog = await openPackageEditor(user);
  await openDeploymentSettings(user, dialog);
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Script delivery method" }),
    method,
  );
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Run script as" }),
    context,
  );
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
}

/** The permanent Registry Item form of the open package detail. */
function composer(): HTMLElement {
  return screen.getByRole("form", { name: "Registry Item" });
}

/** The line under the form that names the desired state and every setting that is not at its default. */
function composerSummary(): HTMLElement {
  return composer().querySelector(".wb-composer__summary") as HTMLElement;
}

/** Fills the four primary fields of the form, so a test can commit without opening the dialog. */
async function fillComposer(
  user: ReturnType<typeof userEvent.setup>,
  fields: { path?: string; name?: string; type?: string; value?: string } = {},
) {
  const form = composer();
  if (fields.path !== undefined) {
    const path = within(form).getByRole("textbox", { name: "Registry path" });
    await user.clear(path);
    await user.type(path, fields.path);
  }
  if (fields.name !== undefined)
    await user.type(within(form).getByRole("textbox", { name: "Value name" }), fields.name);
  if (fields.type !== undefined)
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry value type" }),
      fields.type,
    );
  if (fields.value !== undefined) {
    const value = within(form).getByRole(fields.type === "DWord" ? "spinbutton" : "textbox", {
      name: "Registry value",
    });
    await user.clear(value);
    await user.type(value, fields.value);
  }
}

/** Commits the draft from the form itself, which is where the common case is authored now. */
async function commitItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(composer()).getByRole("button", { name: "Add item" }));
}

/** Opens the dialog on the same draft, which is where every uncommon setting lives. */
async function openItemDetails(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(within(composer()).getByRole("button", { name: "Details…" }));
  return screen.getByRole("dialog", { name: "Registry Item details" });
}

/** Applies the depth changes back to the draft; nothing is committed into the package yet. */
async function applyItemDetails(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: "Apply details" }));
}

async function addDwordItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  path = "Software\\Northgate",
) {
  await fillComposer(user, { path, name, type: "DWord", value: "1" });
  await commitItem(user);
}

function itemRow(name: string): HTMLElement {
  return screen
    .getByText(name, { selector: ".wb-item-row strong" })
    .closest(".wb-item-row") as HTMLElement;
}

async function createPackageWith32BitPowerShell(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await createPackage(user, name);
  const dialog = await openPackageEditor(user);
  await openDeploymentSettings(user, dialog);
  await user.click(within(dialog).getByRole("checkbox", { name: /Use 64-bit PowerShell/ }));
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
}

/** Opens the Advanced disclosure, which holds every setting that is not part of the common case. */
async function openAdvancedItemSettings(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  const advanced = advancedSettings(dialog);
  if (advanced.hasAttribute("open")) return;
  await user.click(within(dialog).getByText("Advanced", { selector: "summary strong" }));
  expect(advanced).toHaveAttribute("open");
}

function advancedSettings(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByText("Advanced", { selector: "summary strong" }).closest("details")!;
}

describe("Endpoint Registry Studio workbench", () => {
  beforeEach(() => {
    setPersistentWorkspaceHomeForTests(createWorkspaceHome(createMemoryBackend()));
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders a neutral empty Workspace in the new Package Workbench", () => {
    renderApp();

    expect(
      screen.getByRole("complementary", { name: "Deployment Package navigator" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
    expect(screen.getByText("Empty workspace")).toBeVisible();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Import Registry data" }).length).toBeGreaterThan(
      0,
    );
  });

  it("opens the separate Administrative Templates workflow from the navigator", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    expect(screen.getByRole("region", { name: "Administrative Templates" })).toBeVisible();
    expect(screen.getByText("No administrative template drafts")).toBeVisible();
    expect(screen.getByRole("button", { name: "New template" })).toBeEnabled();
    expect(screen.getByText(/define its own Registry targets/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Go to Deployment Packages" }));
    expect(screen.queryByRole("region", { name: "Administrative Templates" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  });

  it("explains that existing Registry Items cannot become policy settings", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Policy Source");
    await addDwordItem(user, "Secret");

    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));

    expect(screen.getByText(/none of them can be represented/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review compatibility" })).toBeEnabled();
  });

  it("does not carry a template draft into a different Workspace", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "ADMX source");
    await addDwordItem(user, "Enabled", "Software\\Policies\\Northgate\\App");
    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /^Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));
    await user.type(screen.getByRole("textbox", { name: "Template name" }), "Draft A");
    expect(screen.getByRole("textbox", { name: "Template name" })).toHaveValue("Draft A");

    await user.click(screen.getByRole("button", { name: "New" }));
    await answerConfirm(user, "accept", "Start a new Workspace?");

    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    expect(screen.queryByRole("textbox", { name: "Template name" })).toBeNull();
    expect(screen.getByText(/define its own Registry targets/)).toBeVisible();
  });

  it("authors a template with its own Registry target and no package at all", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("button", { name: "Start with my own Registry target" }));

    const workspace = screen.getByRole("region", { name: "Administrative Templates" });
    await user.type(
      within(workspace).getByRole("textbox", { name: /Registry path for/ }),
      "Software\\Policies\\Northgate\\Widget",
    );
    await user.type(
      within(workspace).getByRole("textbox", { name: /Value name for/ }),
      "EnableWidget",
    );
    await user.selectOptions(
      within(workspace).getByRole("combobox", { name: /Registry value type for/ }),
      "DWord",
    );

    expect(within(workspace).getByText(/defines its own Registry target/)).toBeVisible();
    await user.type(within(workspace).getByRole("spinbutton", { name: /Registry value for/ }), "7");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Template name" }),
      "Northgate App",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Version" }), "1.0.0");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Vendor identifier" }),
      "Northgate",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Product identifier" }), "App");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Policy identifier" }),
      "EnableFeature",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Category" }), "Northgate App");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Display name" }),
      "Enable feature",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Explanation" }), "Writes it.");
    await user.selectOptions(
      within(workspace).getByRole("combobox", { name: "Value mode for EnableWidget" }),
      "Fixed",
    );
    await user.selectOptions(
      within(workspace).getByRole("combobox", { name: "Enabled behavior for EnableWidget" }),
      "WritePresentValue",
    );
    await user.selectOptions(
      within(workspace).getByRole("combobox", { name: "Disabled behavior for EnableWidget" }),
      "DeleteValue",
    );
    await user.selectOptions(
      within(workspace).getByRole("combobox", { name: "Not Configured behavior for EnableWidget" }),
      "DeleteValue",
    );

    expect(within(workspace).getByRole("button", { name: "Continue to review" })).toBeEnabled();

    await user.click(within(workspace).getByRole("button", { name: "Continue to review" }));
    expect(within(workspace).getByText("Policies in this template")).toBeVisible();
    expect(within(workspace).getByText("App.admx")).toBeVisible();
    await user.click(within(workspace).getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it("returns to the package list rather than the last opened package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Policy Source");
    expect(screen.getByRole("button", { name: "Add item" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    await user.click(screen.getByRole("button", { name: "Go to Deployment Packages" }));

    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
  });

  it("asks before replacing a Workspace while template authoring is unsaved", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "ADMX source");
    await addDwordItem(user, "Enabled", "Software\\Policies\\Northgate\\App");
    // Exporting clears the modified flag, so only the template draft stays unsaved.
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /^Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));

    fireEvent.change(screen.getByLabelText("Open workspace or package file"), {
      target: {
        files: [browserTextFile("other.json", exportWorkspace(createWorkspace({ name: "Other" })))],
      },
    });

    const question = await answerConfirm(user, "cancel", "Replace the modified Workspace?");
    // The template draft is the only unsaved work, and the cancelled question keeps it.
    expect(question).toHaveTextContent("Unexported changes are discarded.");
    expect(screen.getByRole("textbox", { name: "Template name" })).toBeInTheDocument();
  });

  it("starts template authoring from a package and preselects only enabled items", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "ADMX source");
    await addDwordItem(user, "Enabled", "Software\\Policies\\Northgate\\App");
    await addDwordItem(user, "SwitchedOff", "Software\\Policies\\Northgate\\App");
    await user.click(within(itemRow("SwitchedOff")).getByRole("switch"));

    await user.click(screen.getByRole("button", { name: /Create template from selected items/ }));

    const workspace = screen.getByRole("region", { name: "Administrative Templates" });
    expect(within(workspace).getByRole("checkbox", { name: /^Enabled/ })).toBeChecked();
    expect(within(workspace).getByRole("checkbox", { name: /^SwitchedOff/ })).not.toBeChecked();
    expect(within(workspace).getByRole("button", { name: "Add 1 accepted item" })).toBeEnabled();
  });

  it("shows which administrative templates use the items of a package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "ADMX source");
    await addDwordItem(user, "Enabled", "Software\\Policies\\Northgate\\App");
    await user.click(screen.getByRole("button", { name: /Create template from selected items/ }));
    const workspace = screen.getByRole("region", { name: "Administrative Templates" });
    await user.click(within(workspace).getByRole("button", { name: "Add 1 accepted item" }));
    await user.type(
      within(workspace).getByRole("textbox", { name: "Template name" }),
      "Northgate policy",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Version" }), "1.0.0");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Vendor identifier" }),
      "Northgate",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Product identifier" }), "App");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Policy identifier" }),
      "EnableFeature",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Category" }), "Northgate App");
    await user.type(
      within(workspace).getByRole("textbox", { name: "Display name" }),
      "Enable feature",
    );
    await user.type(within(workspace).getByRole("textbox", { name: "Explanation" }), "Writes it.");
    await user.click(within(workspace).getByRole("button", { name: "Save draft to Workspace" }));

    await user.click(screen.getByRole("button", { name: /^Open ADMX source,/ }));
    expect(screen.getByText("Used by administrative templates:")).toBeVisible();
    expect(screen.getByRole("button", { name: "Northgate policy" })).toBeVisible();
  });

  it("does not discard unsaved authoring when a package starts template authoring", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "ADMX source");
    await addDwordItem(user, "Enabled", "Software\\Policies\\Northgate\\App");
    await user.click(screen.getByRole("button", { name: /Create template from selected items/ }));
    const workspace = screen.getByRole("region", { name: "Administrative Templates" });
    await user.click(within(workspace).getByRole("button", { name: "Add 1 accepted item" }));
    await user.type(within(workspace).getByRole("textbox", { name: "Template name" }), "Draft");

    await user.click(screen.getByRole("button", { name: /^Open ADMX source,/ }));
    await user.click(screen.getByRole("button", { name: /Create template from selected items/ }));

    await answerConfirm(user, "cancel", "Discard unsaved administrative template changes?");
    expect(screen.getByRole("textbox", { name: "Template name" })).toHaveValue("Draft");
  });

  it("creates a package, opens its detail immediately, and keeps navigation visible", async () => {
    const user = userEvent.setup();
    renderApp();

    await createPackage(user);

    expect(screen.getByRole("heading", { name: "Security Baseline" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Open Security Baseline,/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Incomplete")).toBeVisible();
    expect(screen.getByText("Add at least one Registry Item.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download package" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Add item" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Import Registry data" })).toHaveLength(1);
  });

  it("creates a package with one activation and an editable header name", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageNow(user);

    // The suggested name is valid on its own, so renaming stays optional, and no dialog stands in between.
    expect(screen.getByRole("heading", { name: "Untitled Deployment Package" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();

    // The name takes effect while it is typed.
    await renamePackage(user, "Renamed immediately");
    expect(screen.getByRole("heading", { name: "Renamed immediately" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Open Renamed immediately,/ })).toBeVisible();
  });

  it("makes a repeated suggested name distinguishable", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageNow(user);
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    await createPackageNow(user);
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    await createPackageNow(user);

    // Every further suggestion steps on, so no two packages are created with the same name.
    expect(screen.getByRole("heading", { name: "Untitled Deployment Package 3" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Open Untitled Deployment Package,/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Open Untitled Deployment Package 2,/ }),
    ).toBeVisible();
  });

  it("creates a package from the overview with the same single activation", async () => {
    const user = userEvent.setup();
    renderApp();
    const overview = screen.getByRole("region", { name: "Deployment Packages" });
    await user.click(within(overview).getByRole("button", { name: "New package" }));

    // The second entry point creates and opens the package as directly as the navigator does.
    expect(screen.getByRole("heading", { name: "Untitled Deployment Package" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Open Untitled Deployment Package,/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("changes the delivery method and the run context from the package header", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Header settings");

    // Both settings are visible as values and one click away, without the package editor.
    const method = screen.getByRole("button", {
      name: "Delivery method for Header settings: Intune Remediation",
    });
    expect(method).toHaveTextContent("Intune Remediation");
    await user.click(method);
    // Every entry names the scripts that method produces, not only its label.
    for (const entry of [
      "Intune Remediation · Detect.ps1, Remediate.ps1, and DryRun.ps1",
      "Intune Platform Script · Apply.ps1 and DryRun.ps1",
      "Intune Win32 app source · Install.ps1, Detect.ps1, and Uninstall.ps1 where defined",
    ]) {
      expect(screen.getByRole("menuitem", { name: entry })).toBeVisible();
    }
    await user.click(
      screen.getByRole("menuitem", { name: "Intune Platform Script · Apply.ps1 and DryRun.ps1" }),
    );
    expect(
      screen.getByRole("button", {
        name: "Delivery method for Header settings: Intune Platform Script",
      }),
    ).toHaveTextContent("Intune Platform Script");
    expect(screen.queryByRole("dialog")).toBeNull();

    expect(screen.getByText("Delivery method changed")).toBeVisible();
    const context = screen.getByRole("button", {
      name: "Run context for Header settings: SYSTEM",
    });
    expect(context).toHaveTextContent("SYSTEM");
    await user.click(context);
    await user.click(screen.getByRole("menuitem", { name: "Logged-on user" }));
    expect(
      screen.getByRole("button", {
        name: "Run context for Header settings: Logged-on user",
      }),
    ).toHaveTextContent("Logged-on user");
    expect(screen.getByText("Package run context changed")).toBeVisible();
  });
  it("keeps an emptied package name in its field and reports the missing name", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Protected name");
    await addDwordItem(user, "Enabled", "Software\\Northgate\\Named");
    // A complete package is downloadable; an emptied name is then the only thing left to fix.
    expect(screen.getByRole("button", { name: "Download package" })).toBeEnabled();

    const field = screen.getByRole("textbox", { name: "Deployment Package name" });
    await user.clear(field);

    // The input buffer stays empty instead of being reset, and the package reports it.
    expect(field).toHaveValue("");
    expect(screen.getByText("Package name is required.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download package" })).toBeDisabled();

    await user.type(field, "Back again");
    expect(screen.getByRole("heading", { name: "Back again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Download package" })).toBeEnabled();
  });

  it("never adds an item when Enter is pressed in the package name", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Enter in name");
    // A complete draft that a commit would accept, so the name field is the only thing under test.
    await fillComposer(user, {
      path: "Software\\Northgate\\Name",
      name: "Named",
      type: "DWord",
      value: "1",
    });
    await user.type(screen.getByRole("textbox", { name: "Deployment Package name" }), "{Enter}");

    expect(screen.getByText(/This package holds no Registry Item yet/)).toBeVisible();

    // The very same draft commits from the value field, so the Enter above was the name field's.
    await user.type(
      within(composer()).getByRole("spinbutton", { name: "Registry value" }),
      "{Enter}",
    );
    expect(itemRow("Named")).toBeVisible();
  });

  it("switches between package detail and overview without losing the package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Browser Baseline");

    await user.click(screen.getByRole("button", { name: /All packages/ }));
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
    expect(screen.getAllByText("Browser Baseline").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^Open Browser Baseline,/ }));
    expect(screen.getByRole("heading", { name: "Browser Baseline" })).toBeVisible();
  });

  it("keeps package editing compact and opens a clicked package row", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Browser Baseline", "PlatformScript", "LoggedOnUser");

    await user.click(screen.getByRole("button", { name: "Edit package" }));
    const edit = screen.getByRole("dialog", { name: "Edit Deployment Package" });
    expect(within(edit).getByRole("combobox", { name: "Script delivery method" })).toHaveValue(
      "PlatformScript",
    );
    const name = within(edit).getByRole("textbox", { name: "Package name" });
    await user.clear(name);
    await user.type(name, "Browser Policy");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));

    await user.click(screen.getByRole("button", { name: /All packages/ }));
    const row = screen.getByRole("row", { name: /Browser Policy.*Platform Script/ });
    expect(within(row).getByRole("button", { name: "Download" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download all" })).toBeDisabled();
    await user.click(row);
    expect(screen.getByRole("heading", { name: "Browser Policy" })).toBeVisible();
  });

  it("does not add an invalid Registry Item and keeps the draft for a correction", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);

    const form = composer();
    const path = within(form).getByRole("textbox", { name: "Registry path" });
    expect(path).toHaveAttribute("placeholder", "Software\\Vendor\\Product");
    // The form does not go red before the reader interacted with it or attempted a commit.
    expect(within(form).queryByText(/non-empty relative/)).not.toBeInTheDocument();

    await commitItem(user);
    expect(within(form).getByText(/non-empty relative/)).toBeVisible();
    expect(path).toHaveAttribute("aria-invalid", "true");
    // Nothing was committed, and the typed draft is still in the form.
    expect(screen.getByText(/This package holds no Registry Item yet/)).toBeVisible();
  });

  it("keeps partial Binary input visible and adds only complete hexadecimal bytes", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);

    await fillComposer(user, { path: "Software\\Northgate", name: "Payload", type: "Binary" });
    const value = within(composer()).getByRole("textbox", { name: "Registry value" });

    await user.type(value, "f");
    expect(value).toHaveValue("f");
    await commitItem(user);
    expect(within(composer()).getByText(/two-digit hexadecimal bytes/i)).toBeVisible();

    await user.clear(value);
    await user.type(value, "00 ff 10");
    await commitItem(user);

    expect(within(itemRow("Payload")).getByText("BINARY")).toBeVisible();
  });

  it("adds, edits, duplicates, enables, and deletes a DWORD item", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Policy Package");
    await addDwordItem(user, "Enabled");

    expect(within(itemRow("Enabled")).getByText("DWORD")).toBeVisible();
    expect(screen.getByRole("button", { name: "Download package" })).toBeEnabled();

    await user.click(
      within(itemRow("Enabled")).getByRole("button", { name: "More actions for Enabled" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Enabled" })).getByRole("menuitem", {
        name: "Edit item",
      }),
    );
    const edit = screen.getByRole("dialog", { name: "Edit Registry Item" });
    const path = within(edit).getByRole("textbox", { name: "Registry path" });
    await user.clear(path);
    await user.type(path, "Software\\Northgate\\Managed");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));
    expect(within(itemRow("Enabled")).getByText("Software\\Northgate\\Managed")).toBeVisible();

    await user.click(
      within(itemRow("Enabled")).getByRole("button", { name: "More actions for Enabled" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Enabled" })).getByRole("menuitem", {
        name: "Duplicate item",
      }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Duplicate Registry Item" })).getByRole("button", {
        name: "Create copy",
      }),
    );
    expect(screen.getAllByText("Enabled", { selector: ".wb-item-row strong" })).toHaveLength(2);

    const first = screen
      .getAllByText("Enabled", { selector: ".wb-item-row strong" })[0]!
      .closest(".wb-item-row") as HTMLElement;
    await user.click(within(first).getByRole("switch"));
    expect(within(first).getByRole("switch")).not.toBeChecked();
    await user.click(within(first).getByRole("button", { name: "More actions for Enabled" }));
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Enabled" })).getByRole("menuitem", {
        name: "Delete item",
      }),
    );
    await answerConfirm(user, "accept", "Delete Registry Item “Enabled”?");
    expect(screen.getAllByText("Enabled", { selector: ".wb-item-row strong" })).toHaveLength(1);
  }, 10_000);

  it("keeps the last Registry path in the form and deletes a package from its detail view", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Keep Path");
    await addDwordItem(user, "First", "Software\\Northgate\\Shared");
    // The form continues the series in place instead of opening a second editor.
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Shared",
    );
    expect(within(composer()).getByRole("combobox", { name: "Registry hive" })).toHaveValue(
      "HKEY_LOCAL_MACHINE",
    );

    await user.click(screen.getByRole("button", { name: "More actions for Keep Path" }));
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Keep Path" })).getByRole(
        "menuitem",
        { name: "Delete package" },
      ),
    );
    await answerConfirm(user, "accept", "Delete Deployment Package “Keep Path”?");
    expect(screen.queryByRole("button", { name: /^Open Keep Path,/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  });

  it("moves a typed hive prefix into the hive and strips it from the path", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Prefix Path");
    const form = composer();
    const pathInput = within(form).getByRole("textbox", { name: "Registry path" });

    await user.clear(pathInput);
    await user.type(pathInput, "HKEY_CURRENT_USER\\Software\\Northgate\\Prefixed");

    // The selector follows the typed prefix while the field still shows what was typed.
    expect(within(form).getByRole("combobox", { name: "Registry hive" })).toHaveValue(
      "HKEY_CURRENT_USER",
    );

    await user.tab();
    expect(pathInput).toHaveValue("Software\\Northgate\\Prefixed");
    expect(within(form).getByText(/Recognised HKEY_CURRENT_USER/)).toBeVisible();
  });

  it("reports an unsupported hive prefix and refuses to add the item", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Unsupported Prefix");
    const form = composer();
    const pathInput = within(form).getByRole("textbox", { name: "Registry path" });

    await user.clear(pathInput);
    await user.type(pathInput, "HKCR\\Software\\Bad");
    await user.type(within(form).getByRole("textbox", { name: "Value name" }), "Bad");
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry value type" }),
      "DWord",
    );
    await user.tab();

    expect(within(form).getByText(/HKCR is not supported/)).toBeVisible();
    await commitItem(user);
    expect(screen.getByText(/This package holds no Registry Item yet/)).toBeVisible();
  });

  it("keeps a stored path whose first segment is literally named HKLM", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Literal Hive Segment");
    await addDwordItem(user, "Literal", "HKLM\\HKLM\\Software\\Vendor");

    await user.click(
      within(itemRow("Literal")).getByRole("button", { name: "More actions for Literal" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Literal" })).getByRole("menuitem", {
        name: "Edit item",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit Registry Item" });
    const pathInput = within(dialog).getByRole("textbox", { name: "Registry path" });

    // Opening and saving without touching the path must not re-split it.
    expect(pathInput).toHaveValue("HKLM\\Software\\Vendor");
    expect(within(dialog).getByRole("combobox", { name: "Registry hive" })).toHaveValue(
      "HKEY_LOCAL_MACHINE",
    );
    const nameInput = within(dialog).getByRole("textbox", { name: "Value name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await user.click(
      within(itemRow("Renamed")).getByRole("button", { name: "More actions for Renamed" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Renamed" })).getByRole("menuitem", {
        name: "Edit item",
      }),
    );
    const reopened = screen.getByRole("dialog", { name: "Edit Registry Item" });
    expect(within(reopened).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "HKLM\\Software\\Vendor",
    );
  });

  it("clears the user hive target when a prefix changes the hive", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Prefix Reset");
    const dialog = await openItemDetails(user);

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    await user.click(within(dialog).getByRole("radio", { name: "All existing user profiles" }));
    expect(within(dialog).getByRole("radio", { name: "All existing user profiles" })).toBeChecked();
    await openAdvancedItemSettings(user, dialog);

    const pathInput = within(dialog).getByRole("textbox", { name: "Registry path" });
    await user.clear(pathInput);
    await user.type(pathInput, "HKLM\\Software\\Northgate\\Machine");
    await user.tab();

    expect(within(dialog).getByRole("combobox", { name: "Registry hive" })).toHaveValue(
      "HKEY_LOCAL_MACHINE",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    for (const name of [
      "Currently signed-in users",
      "All existing user profiles",
      "All existing profiles and Default User",
    ]) {
      expect(within(dialog).getByRole("radio", { name })).not.toBeChecked();
    }
  });

  it("changes fields dynamically for Absent, SYSTEM HKCU, and Win32 Revert", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Win32 User Policy", "Win32App");
    const dialog = await openItemDetails(user);

    expect(within(dialog).getByRole("checkbox", { name: "Enabled" })).toBeChecked();
    expect(within(dialog).getByRole("combobox", { name: "Registry value type" })).toBeVisible();
    // A Win32 App package shows Revert behavior as a region of its own, without a second disclosure.
    expect(within(dialog).getByRole("combobox", { name: "Revert behavior" })).toHaveValue("None");
    expect(within(dialog).queryByRole("combobox", { name: "Delete behavior" })).toBeNull();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    expect(within(dialog).getByRole("radio", { name: "Currently signed-in users" })).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: "All existing user profiles" })).toBeVisible();
    expect(
      within(dialog).getByRole("radio", { name: "All existing profiles and Default User" }),
    ).toBeVisible();
    expect(within(dialog).queryByText("Target profile")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("combobox", { name: "User hive target" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: /Most recently used/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: /Specific SID/ })).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("radio", { name: "All existing profiles and Default User" }),
    );
    expect(
      within(dialog).getByRole("radio", { name: "All existing profiles and Default User" }),
    ).toBeChecked();
    expect(
      within(dialog).getByText(/Default User uses C:\\Users\\Default\\NTUSER.DAT/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("radio", { name: "Currently signed-in users" }));
    expect(
      within(dialog).queryByText(/Default User uses C:\\Users\\Default\\NTUSER.DAT/),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "All existing user profiles" }));
    expect(within(dialog).getByRole("radio", { name: "All existing user profiles" })).toBeChecked();
    expect(
      within(dialog).queryByText(/Default User uses C:\\Users\\Default\\NTUSER.DAT/),
    ).not.toBeInTheDocument();

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Desired state" }),
      "Absent",
    );
    expect(
      within(dialog).queryByRole("combobox", { name: "Registry value type" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Delete behavior" }),
      "KeyRecursive",
    );
    expect(within(dialog).queryByRole("textbox", { name: "Value name" })).not.toBeInTheDocument();

    expect(within(dialog).getByRole("combobox", { name: "Revert behavior" })).toHaveValue("None");
    expect(
      within(dialog).queryByRole("option", { name: "Set a defined value" }),
    ).not.toBeInTheDocument();
  });

  it("names every setting that is not at its default in the summary line of the form", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Compact editor");
    const form = composer();

    // The common case shows the four primary fields and states the desired state.
    expect(composerSummary()).toHaveTextContent("Present");
    expect(composerSummary()).not.toHaveTextContent("Registry32");
    // The hive selector is attached to the path field instead of standing beside it as its own field.
    const hive = within(form).getByRole("combobox", { name: "Registry hive" });
    const path = within(form).getByRole("textbox", { name: "Registry path" });
    expect(hive.closest(".wb-field")).toBe(path.closest(".wb-field"));
    expect(path).toBeVisible();
    expect(within(form).getByRole("textbox", { name: "Value name" })).toBeVisible();
    expect(within(form).getByRole("combobox", { name: "Registry value type" })).toBeVisible();
    expect(within(form).getByRole("textbox", { name: "Registry value" })).toBeVisible();
    expect(
      within(form).queryByRole("combobox", { name: "Revert behavior" }),
    ).not.toBeInTheDocument();
    expect(
      within(form).queryByRole("combobox", { name: "Delete behavior" }),
    ).not.toBeInTheDocument();

    // Depth is changed in the dialog and reaches the draft, which the summary line then states.
    const dialog = await openItemDetails(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Registry view" }),
      "Both",
    );
    await user.click(within(dialog).getByRole("checkbox", { name: "Enabled" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Operator note");
    await applyItemDetails(user, dialog);

    expect(composerSummary()).toHaveTextContent("View Both");
    expect(composerSummary()).toHaveTextContent("Excluded from generated scripts");
    expect(composerSummary()).toHaveTextContent("Description: Operator note");

    // A long description is truncated in the summary instead of pushing the line apart.
    const again = await openItemDetails(user);
    const description = within(again).getByRole("textbox", { name: "Description" });
    await user.clear(description);
    await user.type(description, "Operator note that is far too long for one summary line");
    await applyItemDetails(user, again);
    expect(composerSummary()).toHaveTextContent("…");
    expect(composerSummary()).not.toHaveTextContent("summary line");
  });

  it("names the effective view when Auto does not follow what its label suggests", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWith32BitPowerShell(user, "Narrow host");
    expect(composerSummary()).toHaveTextContent(
      "View Auto · resolves to Registry32 in this package",
    );
  });

  it("shows the delete scope for an Absent item instead of hiding it", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Removal");
    const dialog = await openItemDetails(user);

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Desired state" }),
      "Absent",
    );
    const scope = within(dialog).getByRole("combobox", { name: "Delete behavior" });
    expect(scope).toBeVisible();
    expect(
      within(dialog).queryByRole("combobox", { name: "Registry value type" }),
    ).not.toBeInTheDocument();
    await applyItemDetails(user, dialog);

    // The form follows the same field activation and states the scope it applies.
    expect(composerSummary()).toHaveTextContent("Desired state Absent · deletes the value");
    expect(
      within(composer()).queryByRole("combobox", { name: "Registry value type" }),
    ).not.toBeInTheDocument();

    const again = await openItemDetails(user);
    await user.selectOptions(
      within(again).getByRole("combobox", { name: "Delete behavior" }),
      "KeyRecursive",
    );
    await applyItemDetails(user, again);
    expect(composerSummary()).toHaveTextContent("deletes the key and everything below it");
    expect(
      within(composer()).queryByRole("textbox", { name: "Value name" }),
    ).not.toBeInTheDocument();
  });

  it("resolves the SYSTEM HKCU target error for this item only", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Item scoped");
    const form = composer();
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    await user.type(
      within(form).getByRole("textbox", { name: "Registry path" }),
      "Software\\Northgate\\User",
    );
    await user.type(within(form).getByRole("textbox", { name: "Value name" }), "Mode");

    // The summary states the missing target; the commit opens the dialog on that field, not while typing.
    expect(composerSummary()).toHaveTextContent("User hive target required");
    await commitItem(user);
    const dialog = screen.getByRole("dialog", { name: "Registry Item details" });
    expect(within(dialog).getByText(/Choose which user hive SYSTEM should target/)).toBeVisible();
    expect(within(dialog).getByText(/changes this item only/)).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Target all existing profiles" }));
    expect(within(dialog).getByRole("radio", { name: "All existing user profiles" })).toBeChecked();
    expect(
      within(dialog).queryByText(/Choose which user hive SYSTEM should target/),
    ).not.toBeInTheDocument();

    await applyItemDetails(user, dialog);
    await commitItem(user);
    expect(itemRow("Mode")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    const row = screen.getByRole("row", { name: /Item scoped.*SYSTEM/ });
    expect(within(row).getByText("SYSTEM")).toBeVisible();
  });

  it("resolves the SYSTEM HKCU target error for the whole package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Package scoped");
    const form = composer();
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    await user.type(
      within(form).getByRole("textbox", { name: "Registry path" }),
      "Software\\Northgate\\User",
    );
    await user.type(within(form).getByRole("textbox", { name: "Value name" }), "Mode");
    await commitItem(user);
    const dialog = screen.getByRole("dialog", { name: "Registry Item details" });

    expect(within(dialog).getByText(/every item in the package/)).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Run this package as logged-on user" }),
    );

    // The package-scoped resolution answers the question by removing it for every item.
    expect(
      within(dialog).queryByRole("radio", { name: "All existing user profiles" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Package run context changed")).toBeVisible();
    await applyItemDetails(user, dialog);
    await commitItem(user);
    expect(itemRow("Mode")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /All packages/ }));
    expect(screen.getByRole("row", { name: /Package scoped.*Logged-on user/ })).toBeVisible();
  });

  it("offers both resolutions when the editor opens on the reported field", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Opened from status", "Remediation", "LoggedOnUser");
    const form = composer();
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    await user.type(
      within(form).getByRole("textbox", { name: "Registry path" }),
      "Software\\Northgate\\User",
    );
    await user.type(within(form).getByRole("textbox", { name: "Value name" }), "Mode");
    await commitItem(user);
    expect(itemRow("Mode")).toBeVisible();

    // The package becomes a SYSTEM package, so its HKCU item now needs a user hive target.
    await user.click(screen.getByRole("button", { name: "Edit package" }));
    const edit = screen.getByRole("dialog", { name: "Edit Deployment Package" });
    await user.selectOptions(
      within(edit).getByRole("combobox", { name: "Run script as" }),
      "System",
    );
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));

    // Opening the item from its reported status shows the message and both resolutions at once.
    await user.click(within(itemRow("Mode")).getByRole("button", { name: "Error" }));
    const reopened = screen.getByRole("dialog", { name: "Edit Registry Item" });
    expect(within(reopened).getByText(/Choose which user hive SYSTEM should target/)).toBeVisible();
    // The named field is the choice group, so the group itself takes the focus.
    await waitFor(() =>
      expect(within(reopened).getByRole("group", { name: "User hive target" })).toHaveFocus(),
    );
    expect(
      within(reopened).getByRole("button", { name: "Target all existing profiles" }),
    ).toBeVisible();
    expect(
      within(reopened).getByRole("button", { name: "Run this package as logged-on user" }),
    ).toBeVisible();

    await user.click(
      within(reopened).getByRole("button", { name: "Target all existing profiles" }),
    );
    expect(
      within(reopened).queryByText(/Choose which user hive SYSTEM should target/),
    ).not.toBeInTheDocument();
  });

  it("opens the collapsed region that holds a validation target", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "WOW risk");
    await fillComposer(user, { path: "Software\\WOW6432Node\\Northgate", name: "Mode" });
    await commitItem(user);

    // The item saves with a warning, and opening that warning reveals the field it names.
    const row = itemRow("Mode");
    await user.click(within(row).getByRole("button", { name: "Warning" }));
    const reopened = screen.getByRole("dialog", { name: "Edit Registry Item" });
    expect(advancedSettings(reopened)).toHaveAttribute("open");
    expect(within(reopened).getByText(/WOW6432Node/)).toBeVisible();
    await waitFor(() =>
      expect(within(reopened).getByRole("combobox", { name: "Registry view" })).toHaveFocus(),
    );

    // The opening is not a lock: the region collapses again on request.
    await user.click(within(reopened).getByText("Advanced", { selector: "summary strong" }));
    expect(advancedSettings(reopened)).not.toHaveAttribute("open");
  });

  it("states a whitespace-only description instead of hiding it", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Blank note");
    const dialog = await openItemDetails(user);

    // The schema keeps the raw text and the generated documentation prints it, so the summary does too.
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), " ");
    await applyItemDetails(user, dialog);
    expect(composerSummary()).toHaveTextContent("Description: whitespace only");
  });

  it("opens the package editor for a warning that names a package setting", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Elevation warning", "Remediation", "LoggedOnUser");
    await addDwordItem(user, "MachineValue", "Software\\Northgate\\Machine");

    // The elevation warning belongs to the package run context, so its row link opens that editor.
    await user.click(within(itemRow("MachineValue")).getByRole("button", { name: "Warning" }));
    const editor = screen.getByRole("dialog", { name: "Edit Deployment Package" });
    expect(within(editor).getByRole("combobox", { name: "Run script as" })).toHaveValue(
      "LoggedOnUser",
    );
    // The named control takes the focus and the reported message stays beside it.
    await waitFor(() =>
      expect(within(editor).getByRole("combobox", { name: "Run script as" })).toHaveFocus(),
    );
    expect(within(editor).getByText(/HKLM normally requires elevation/)).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Edit Registry Item" })).not.toBeInTheDocument();
  });

  it("focuses the Default User choice when validation names it", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Default user");
    const form = composer();
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    await user.type(
      within(form).getByRole("textbox", { name: "Registry path" }),
      "Software\\Northgate\\User",
    );
    await user.type(within(form).getByRole("textbox", { name: "Value name" }), "Mode");
    const dialog = await openItemDetails(user);
    await user.click(
      within(dialog).getByRole("radio", { name: "All existing profiles and Default User" }),
    );
    await applyItemDetails(user, dialog);
    await commitItem(user);

    await user.click(within(itemRow("Mode")).getByRole("button", { name: "Warning" }));
    const reopened = screen.getByRole("dialog", { name: "Edit Registry Item" });
    await waitFor(() =>
      expect(
        within(reopened).getByRole("radio", { name: "All existing profiles and Default User" }),
      ).toHaveFocus(),
    );
  });

  it("focuses the value field for an oversized Binary warning", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Large payload");
    await fillComposer(user, { path: "Software\\Northgate", name: "Payload", type: "Binary" });
    // Just over the size at which a Binary value is reported as unusually large.
    fireEvent.change(within(composer()).getByRole("textbox", { name: "Registry value" }), {
      target: { value: "00 ".repeat(4097).trim() },
    });
    await commitItem(user);

    // The warning belongs to this item's value, so its row link opens the item editor on that field.
    await user.click(within(itemRow("Payload")).getByRole("button", { name: "Warning" }));
    const reopened = screen.getByRole("dialog", { name: "Edit Registry Item" });
    await waitFor(() =>
      expect(within(reopened).getByRole("textbox", { name: "Registry value" })).toHaveFocus(),
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit Deployment Package" }),
    ).not.toBeInTheDocument();
  });

  it("opens the item on its first field when the issue names no field at all", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Platform once", "PlatformScript");
    await addDwordItem(user, "RunsOnce", "Software\\Northgate\\Once");

    // The platform-once warning carries no field, so the editor opens on its default target.
    await user.click(within(itemRow("RunsOnce")).getByRole("button", { name: "Warning" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Registry Item" });
    await waitFor(() =>
      expect(within(dialog).getByRole("textbox", { name: "Registry path" })).toHaveFocus(),
    );
  });

  it("imports pasted Registry text through parse and review", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Import Target");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });
    expect(
      within(dialog).queryByRole("textbox", { name: "Registry text" }),
    ).not.toBeInTheDocument();
    fireEvent.paste(document, {
      clipboardData: {
        getData: () =>
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Northgate]\n"Imported"=dword:00000001',
      },
    });
    expect(within(dialog).getByText("Clipboard")).toBeVisible();
    expect(within(dialog).getByText("1 item")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Import 1 item" }));
    expect(itemRow("Imported")).toBeVisible();
    expect(screen.queryByText(/Imported from line/)).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search Registry Items" }), "missing");
    expect(screen.getByText("No matching Registry Items")).toBeVisible();
  });

  it("creates a Deployment Package from an empty Workspace import", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });
    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: {
        files: [
          browserTextFile(
            "policies.reg",
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Northgate]\n"Policy"=dword:00000001',
          ),
        ],
      },
    });
    expect(await within(dialog).findByText("policies.reg")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Import 1 item" }));
    expect(screen.getByRole("heading", { name: "policies" })).toBeVisible();
    expect(itemRow("Policy")).toBeVisible();
  });

  it("presents imported delete operations without stale type or value data", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Delete import");
    await user.click(screen.getByRole("button", { name: "Import Registry data" }));
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });
    fireEvent.paste(document, {
      clipboardData: {
        getData: () =>
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Northgate]\n"Removed"=-',
      },
    });
    expect(within(dialog).getAllByText("Delete value").length).toBeGreaterThan(0);
    expect(within(dialog).queryByText("String", { selector: "dd" })).not.toBeInTheDocument();
  });

  it("keeps the import picker inert until requested and reports parser errors", async () => {
    const user = userEvent.setup();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    renderApp();
    await createPackage(user, "Import Target");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });
    expect(inputClick).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Choose .reg file" }));
    expect(inputClick).toHaveBeenCalledTimes(1);
    const fileInput = within(dialog).getByLabelText("Choose Registry file");
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(within(dialog).getByText("Add a Registry source")).toBeVisible();
    fireEvent.paste(document, {
      clipboardData: { getData: () => "not Registry data" },
    });
    expect(within(dialog).getByText("1 error")).toBeVisible();
    expect(
      within(dialog).getByText("No Registry items could be parsed from this source."),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Import 0 items" })).toBeDisabled();
  });

  it("imports selected items when the parser skipped unsupported lines", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Partial import");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });
    fireEvent.paste(document, {
      clipboardData: {
        getData: () =>
          'REGEDIT4\n\n[HKEY_LOCAL_MACHINE\\Software\\Northgate]\n"Policy"=dword:00000001\n[HKEY_CLASSES_ROOT\\Bad]\n"X"="no"',
      },
    });
    expect(within(dialog).getByText("1 item")).toBeVisible();
    expect(within(dialog).getByText("3 errors")).toBeVisible();
    expect(within(dialog).getByText(/Missing or unsupported Registry Editor header/)).toBeVisible();
    expect(within(dialog).getByText(/Unsupported hive/)).toBeVisible();
    expect(within(dialog).getByText(/Value belongs to an unsupported key/)).toBeVisible();
    expect(
      within(dialog).getByText(
        "Skipped lines stay out of the import. Selected items can still be imported.",
      ),
    ).toBeVisible();
    const importButton = within(dialog).getByRole("button", { name: "Import 1 item" });
    expect(importButton).toBeEnabled();
    await user.click(importButton);
    expect(itemRow("Policy")).toBeVisible();
    expect(screen.queryByText("X", { selector: ".wb-item-row strong" })).not.toBeInTheDocument();
  });

  it("uploads a UTF-16LE Registry file through the shared parser preview", async () => {
    const user = userEvent.setup();
    const registryText =
      'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\Software\\Northgate]\r\n"Greeting"="Grüße"\r\n';
    renderApp();
    await createPackage(user, "Unicode import");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [utf16LeFile("unicode.reg", registryText)] },
    });
    expect(await within(dialog).findByText("unicode.reg")).toBeVisible();
    expect(within(dialog).getByText("1 item")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Import 1 item" }));

    expect(within(itemRow("Greeting")).getByText("Grüße")).toBeVisible();
  });

  it("shows the parsed review as soon as a source is accepted", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Immediate review");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: {
        files: [
          browserTextFile(
            "instant.reg",
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Northgate]\n"Instant"=dword:00000001',
          ),
        ],
      },
    });

    // No intermediate confirmation: the review is the first thing the user sees after a source.
    expect(await within(dialog).findByText("instant.reg")).toBeVisible();
    expect(within(dialog).getByText("1 item")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Import 1 item" })).toBeEnabled();
  });

  it("discards a stale file read when a newer clipboard source arrives", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Stale read");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    let release: () => void = () => undefined;
    const pending = new Promise<ArrayBuffer>((resolve) => {
      release = () =>
        resolve(
          new TextEncoder().encode(
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\FromFile]\n"File"=dword:00000001',
          ).buffer,
        );
    });
    const slow = {
      name: "slow.reg",
      size: 0,
      arrayBuffer: vi.fn(() => pending),
    } as unknown as File;

    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [slow] },
    });

    // A newer source arrives while the file is still loading.
    fireEvent.paste(document, {
      clipboardData: {
        getData: () =>
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\FromPaste]\n"Paste"=dword:00000001',
      },
    });
    expect(await within(dialog).findByText("Clipboard")).toBeVisible();

    // The late file result must not replace the newer source.
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(dialog).getByText("Clipboard")).toBeVisible();
    expect(within(dialog).getByText("Paste")).toBeVisible();
    expect(within(dialog).queryByText("File")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("slow.reg")).not.toBeInTheDocument();
  });

  it("returns to the source stage when the review is replaced", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Replace review");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    fireEvent.paste(document, {
      clipboardData: {
        getData: () =>
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Pasted]\n"Pasted"=dword:00000001',
      },
    });
    expect(await within(dialog).findByText("Clipboard")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(within(dialog).queryByText("Clipboard")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Add a Registry source")).toBeVisible();
  });

  it("keeps only the newest of two competing file reads", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Competing reads");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    const deferred = (text: string) => {
      let release: () => void = () => undefined;
      const promise = new Promise<ArrayBuffer>((resolve) => {
        release = () => resolve(new TextEncoder().encode(text).buffer);
      });
      return { promise, release: () => release() };
    };
    const first = deferred(
      'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\First]\n"First"=dword:00000001',
    );
    const second = deferred(
      'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Second]\n"Second"=dword:00000001',
    );
    const fileInput = within(dialog).getByLabelText("Choose Registry file");
    const asFile = (name: string, promise: Promise<ArrayBuffer>) =>
      ({ name, size: 0, arrayBuffer: vi.fn(() => promise) }) as unknown as File;

    fireEvent.change(fileInput, { target: { files: [asFile("first.reg", first.promise)] } });
    fireEvent.change(fileInput, { target: { files: [asFile("second.reg", second.promise)] } });

    // The older read resolves first and must be discarded.
    first.release();
    await first.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(dialog).queryByText("first.reg")).not.toBeInTheDocument();

    second.release();
    await second.promise;
    expect(await within(dialog).findByText("second.reg")).toBeVisible();
    expect(within(dialog).getByText("Second")).toBeVisible();
  });

  it("discards a stale file error when a newer source arrives", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Stale error");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    let fail: (error: Error) => void = () => undefined;
    const failing = {
      name: "broken.reg",
      size: 0,
      arrayBuffer: vi.fn(
        () =>
          new Promise<ArrayBuffer>((_resolve, reject) => {
            fail = (error) => reject(error);
          }),
      ),
    } as unknown as File;
    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [failing] },
    });

    fireEvent.paste(document, {
      clipboardData: {
        getData: () =>
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Fresh]\n"Fresh"=dword:00000001',
      },
    });
    expect(await within(dialog).findByText("Clipboard")).toBeVisible();

    fail(new Error("The selected file could not be read."));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      within(dialog).queryByText("The selected file could not be read."),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText("Clipboard")).toBeVisible();
  });

  it("reports an empty file as an empty file, not as an empty clipboard", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Empty file");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [browserTextFile("empty.reg", "")] },
    });

    expect(
      await within(dialog).findByText("The selected file contains no Registry text."),
    ).toBeVisible();
    expect(within(dialog).queryByText("Clipboard is empty.")).not.toBeInTheDocument();
  });

  it("accepts a dropped .reg file", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Dropped file");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });
    const well = within(dialog).getByText("Add a Registry source").closest(".wb-source-well")!;

    fireEvent.drop(well, {
      dataTransfer: {
        files: [
          browserTextFile(
            "dropped.reg",
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Dropped]\n"Dropped"=dword:00000001',
          ),
        ],
      },
    });

    expect(await within(dialog).findByText("dropped.reg")).toBeVisible();
    expect(within(dialog).getByText("Dropped")).toBeVisible();
  });

  it("reads the clipboard through the button", async () => {
    const user = userEvent.setup();
    const readText = vi.fn(() =>
      Promise.resolve(
        'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\FromButton]\n"FromButton"=dword:00000001',
      ),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    renderApp();
    await createPackage(user, "Clipboard button");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    await user.click(within(dialog).getByRole("button", { name: "Paste from clipboard" }));

    expect(await within(dialog).findByText("Clipboard")).toBeVisible();
    expect(within(dialog).getByText("FromButton")).toBeVisible();
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it("discards a stale clipboard result when a newer file arrives", async () => {
    const user = userEvent.setup();
    let resolveClipboard: (text: string) => void = () => undefined;
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveClipboard = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    renderApp();
    await createPackage(user, "Stale clipboard");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    await user.click(within(dialog).getByRole("button", { name: "Paste from clipboard" }));
    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: {
        files: [
          browserTextFile(
            "newer.reg",
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Newer]\n"Newer"=dword:00000001',
          ),
        ],
      },
    });
    expect(await within(dialog).findByText("newer.reg")).toBeVisible();

    resolveClipboard(
      'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\FromClipboard]\n"FromClipboard"=dword:00000001',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(dialog).getByText("newer.reg")).toBeVisible();
    expect(within(dialog).queryByText("FromClipboard")).not.toBeInTheDocument();
  });

  it("discards a stale clipboard error when a newer file arrives", async () => {
    const user = userEvent.setup();
    let rejectClipboard: (error: Error) => void = () => undefined;
    const readText = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectClipboard = reject;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    renderApp();
    await createPackage(user, "Stale clipboard error");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    await user.click(within(dialog).getByRole("button", { name: "Paste from clipboard" }));
    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: {
        files: [
          browserTextFile(
            "winner.reg",
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Winner]\n"Winner"=dword:00000001',
          ),
        ],
      },
    });
    expect(await within(dialog).findByText("winner.reg")).toBeVisible();

    rejectClipboard(new Error("denied"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      within(dialog).queryByText("Clipboard access was denied or failed."),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText("winner.reg")).toBeVisible();
  });

  it("carries the path, the type, and the view into the next item of a series", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Series");
    await fillComposer(user, {
      path: "Software\\Northgate\\Series",
      name: "First",
      type: "DWord",
      value: "1",
    });
    const dialog = await openItemDetails(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Registry view" }),
      "Registry64",
    );
    // Change fields that must not carry over into the next item.
    await user.click(within(dialog).getByRole("checkbox", { name: "Enabled" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Not carried");
    await applyItemDetails(user, dialog);

    await commitItem(user);

    expect(itemRow("First")).toBeVisible();
    // The form stays with a fresh draft that carries only path, type, and view.
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Series",
    );
    expect(within(composer()).getByRole("combobox", { name: "Registry value type" })).toHaveValue(
      "DWord",
    );
    expect(composerSummary()).toHaveTextContent("View Registry64");
    // Every other field keeps its default.
    expect(composerSummary()).not.toHaveTextContent("Excluded from generated scripts");
    expect(composerSummary()).not.toHaveTextContent("Description:");
    const nextName = within(composer()).getByRole("textbox", { name: "Value name" });
    // The carried type resets the value instead of reusing the previous one.
    expect(within(composer()).getByRole("spinbutton", { name: "Registry value" })).toHaveValue(0);
    expect(nextName).toHaveValue("");
    await waitFor(() => expect(nextName).toHaveFocus());

    // The continued draft carries its own identity.
    await user.type(nextName, "Second");
    await commitItem(user);
    expect(itemRow("Second")).toBeVisible();
    expect(itemRow("First").dataset.itemId).not.toBe(itemRow("Second").dataset.itemId);
  });

  it("saves the item when Enter is pressed in a text field", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Enter saves");
    await fillComposer(user, {
      path: "Software\\Northgate\\Enter",
      name: "Entered",
      type: "DWord",
      value: "1",
    });

    await user.keyboard("{Enter}");

    expect(itemRow("Entered")).toBeVisible();
  });

  it("keeps a MultiString line break when Enter is pressed", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "MultiString break");
    await fillComposer(user, { name: "Lines", type: "MultiString" });
    const lines = within(composer()).getByRole("textbox", { name: "Registry value" });
    await user.type(lines, "Alpha{Enter}Beta");

    // A textarea keeps its line break instead of saving.
    expect(lines).toHaveValue("Alpha\nBeta");
    expect(screen.getByText(/This package holds no Registry Item yet/)).toBeVisible();
  });

  it("adds the item when Ctrl plus Enter is pressed", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Ctrl Enter");
    await fillComposer(user, {
      path: "Software\\Northgate\\Shortcut",
      name: "Shortcut",
      type: "DWord",
      value: "1",
    });

    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(itemRow("Shortcut")).toBeVisible();
    // The form keeps the series state instead of closing.
    expect(within(composer()).getByRole("textbox", { name: "Value name" })).toHaveValue("");
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Shortcut",
    );
  });

  it("clears the series continuation when the same Workspace is reopened", async () => {
    const user = userEvent.setup();
    const pkg = createDeploymentPackage({ id: "continuation-package", name: "Continuation" });
    const workspace = createWorkspace({
      id: "continuation-workspace",
      name: "Continuation",
      packages: [pkg],
    });
    const workspaceFile = () => browserTextFile("workspace.json", exportWorkspace(workspace));
    renderApp();

    const input = screen.getByLabelText("Open workspace or package file");
    fireEvent.change(input, { target: { files: [workspaceFile()] } });
    await user.click(await screen.findByRole("button", { name: /^Open Continuation,/ }));

    await addDwordItem(user, "Carried", "Software\\Northgate\\Carried");
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Carried",
    );

    // Reopening the same document replaces the Workspace with the same package id.
    fireEvent.change(input, { target: { files: [workspaceFile()] } });
    await answerConfirm(user, "accept", "Replace the modified Workspace?");
    await user.click(await screen.findByRole("button", { name: /^Open Continuation,/ }));

    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue("");
    expect(within(composer()).getByRole("combobox", { name: "Registry value type" })).toHaveValue(
      "String",
    );
  });

  it("carries the hive into the next item of a series", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "HKCU series", "Remediation", "LoggedOnUser");
    const form = composer();
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );
    await fillComposer(user, { path: "Software\\Northgate\\Hive", name: "Hive" });
    await commitItem(user);

    expect(itemRow("Hive")).toBeVisible();
    expect(within(composer()).getByRole("combobox", { name: "Registry hive" })).toHaveValue(
      "HKEY_CURRENT_USER",
    );
  });

  it("adds the item when Meta plus Enter is pressed", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Meta Enter");
    await fillComposer(user, {
      path: "Software\\Northgate\\Meta",
      name: "Meta",
      type: "DWord",
    });
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(itemRow("Meta")).toBeVisible();
  });

  it("saves when Enter is pressed in a select", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Enter in select");
    await fillComposer(user, {
      path: "Software\\Northgate\\Selected",
      name: "Selected",
      type: "DWord",
      value: "1",
    });
    const type = within(composer()).getByRole("combobox", { name: "Registry value type" });
    type.focus();
    await user.keyboard("{Enter}");

    expect(itemRow("Selected")).toBeVisible();
  });

  it("does not save when Enter is pressed on a toggle", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Enter on toggle");
    await fillComposer(user, { path: "Software\\Northgate\\Toggle", name: "Boxed" });
    const dialog = await openItemDetails(user);
    const enabled = within(dialog).getByRole("checkbox", { name: "Enabled" });
    // A browser submits the form when Enter is pressed on a toggle, so the form cancels the event.
    expect(fireEvent.keyDown(enabled, { key: "Enter", cancelable: true })).toBe(false);
    expect(within(dialog).getByRole("checkbox", { name: "Enabled" })).toBeChecked();
    expect(screen.getByRole("dialog", { name: "Registry Item details" })).toBeVisible();
    expect(
      screen.queryByText("Boxed", { selector: ".wb-item-row strong" }),
    ).not.toBeInTheDocument();
  });

  it("asks a destructive question in its own dialog instead of a native prompt", async () => {
    const user = userEvent.setup();
    // A native prompt would be a regression: the app owns this question now.
    const nativePrompt = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp();
    await createPackage(user, "Own Dialog");
    await addDwordItem(user, "Enabled");

    await user.click(
      within(itemRow("Enabled")).getByRole("button", { name: "More actions for Enabled" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Enabled" })).getByRole("menuitem", {
        name: "Delete item",
      }),
    );

    const question = await answerConfirm(user, "cancel", "Delete Registry Item “Enabled”?");
    expect(question).toHaveTextContent("This cannot be undone.");
    expect(itemRow("Enabled")).toBeVisible();
    expect(nativePrompt).not.toHaveBeenCalled();
  });

  it("asks before a destructive save and keeps the draft when it is declined", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Destructive");
    await fillComposer(user, { path: "Software\\Northgate\\Gone" });
    const dialog = await openItemDetails(user);
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Desired state" }),
      "Absent",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Delete behavior" }),
      "KeyRecursive",
    );
    await applyItemDetails(user, dialog);

    await commitItem(user);
    const question = await answerConfirm(user, "cancel", "Add this Registry Item?");
    expect(question).toHaveTextContent("authorizes recursive deletion");
    // Declining keeps the draft, so the reader does not have to type the path again.
    expect(screen.getByText(/This package holds no Registry Item yet/)).toBeVisible();
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Gone",
    );

    // Accepting the same action adds the item exactly once.
    await commitItem(user);
    await answerConfirm(user, "accept", "Add this Registry Item?");
    expect(itemRow("Gone")).toBeVisible();
  });

  it("clears the series continuation when a Workspace is replaced through the file picker", async () => {
    const user = userEvent.setup();
    const pkg = createDeploymentPackage({ id: "picker-package", name: "Picked" });
    const workspace = createWorkspace({ id: "picker-workspace", name: "Picked", packages: [pkg] });
    const text = exportWorkspace(workspace);
    const file = {
      name: "picked.json",
      size: text.length,
      text: () => Promise.resolve(text),
    } as unknown as File;
    const handle = {
      name: "picked.json",
      getFile: vi.fn().mockResolvedValue(file),
      createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn() }),
    };
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue([handle]),
    });
    renderApp();

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: /^Open Picked,/ }));
    await addDwordItem(user, "Carried", "Software\\Northgate\\Picked");
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Picked",
    );

    // The picker replaces the document instead of resetting it, with the same identifiers.
    await user.click(screen.getByRole("button", { name: "Open" }));
    await answerConfirm(user, "accept", "Replace the modified Workspace?");
    await user.click(await screen.findByRole("button", { name: /^Open Picked,/ }));
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue("");
  });

  it("copies and moves Registry Items between packages with independent IDs", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Source");
    await addDwordItem(user, "Setting");
    const sourceId = itemRow("Setting").dataset.itemId;
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    await createPackage(user, "Target");
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    await user.click(screen.getByRole("button", { name: /^Open Source,/ }));

    await user.click(
      within(itemRow("Setting")).getByRole("button", { name: "More actions for Setting" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Setting" })).getByRole("menuitem", {
        name: "Move or copy item",
      }),
    );
    let transfer = screen.getByRole("dialog", { name: "Move or copy Registry Item" });
    await user.click(within(transfer).getByRole("radio", { name: /Copy item/ }));
    await user.click(within(transfer).getByRole("button", { name: "Copy item" }));

    await user.click(screen.getByRole("button", { name: /^Open Target,/ }));
    expect(itemRow("Setting").dataset.itemId).not.toBe(sourceId);
    await user.click(
      within(itemRow("Setting")).getByRole("button", { name: "More actions for Setting" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Setting" })).getByRole("menuitem", {
        name: "Move or copy item",
      }),
    );
    transfer = screen.getByRole("dialog", { name: "Move or copy Registry Item" });
    await user.click(within(transfer).getByRole("button", { name: "Move item" }));
    expect(screen.getByText(/This package holds no Registry Item yet/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Open Source,/ }));
    expect(screen.getAllByText("Setting", { selector: ".wb-item-row strong" })).toHaveLength(2);
  });

  it("reports Clipboard and download failures instead of showing false success", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Browser failures");
    await addDwordItem(user, "Setting");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await user.click(within(itemRow("Setting")).getByTitle("Copy full Registry path"));
    expect(await screen.findByText("Clipboard access was denied or failed.")).toBeVisible();

    createObjectURL.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    await user.click(screen.getByRole("button", { name: "Download package" }));
    expect(await screen.findByText("The browser could not start the download.")).toBeVisible();
  });

  it("supports package search, filters, selection, duplication, bulk download, and deletion", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Remediation Package");
    await addDwordItem(user, "One");
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    await createPackageWithOptions(user, "Platform Package", "PlatformScript");
    await addDwordItem(user, "Two");
    await user.click(screen.getByRole("button", { name: /All packages/ }));

    const search = screen.getByRole("searchbox", { name: "Search Deployment Packages" });
    await user.type(search, "Platform");
    expect(
      screen.getByText("Platform Package", { selector: ".wb-package-row strong" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Remediation Package", { selector: ".wb-package-row strong" }),
    ).not.toBeInTheDocument();
    await user.clear(search);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter deployment method" }),
      "PlatformScript",
    );
    expect(
      screen.getByText("Platform Package", { selector: ".wb-package-row strong" }),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter deployment method" }),
      "All",
    );

    await user.click(screen.getByRole("button", { name: "Select" }));
    const platformRow = screen
      .getByText("Platform Package", { selector: ".wb-package-row strong" })
      .closest(".wb-package-row") as HTMLElement;
    await user.click(
      within(platformRow).getByRole("checkbox", { name: "Select Platform Package" }),
    );
    await user.click(screen.getByRole("button", { name: "Download selected" }));
    await answerConfirm(user, "accept", "Download 1 Deployment Package?");
    await user.click(screen.getByRole("button", { name: "Download all" }));
    await answerConfirm(user, "accept", "Download 2 Deployment Packages?");
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Done" }));

    await user.click(
      within(platformRow).getByRole("button", { name: "More actions for Platform Package" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Platform Package" })).getByRole(
        "menuitem",
        { name: "Duplicate package" },
      ),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Duplicate Deployment Package" })).getByRole(
        "button",
        { name: "Create copy" },
      ),
    );
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    expect(
      screen.getByText("Platform Package copy", { selector: ".wb-package-row strong" }),
    ).toBeVisible();
    const copyRow = screen
      .getByText("Platform Package copy", { selector: ".wb-package-row strong" })
      .closest(".wb-package-row") as HTMLElement;
    await user.click(
      within(copyRow).getByRole("button", { name: "More actions for Platform Package copy" }),
    );
    await user.click(
      within(
        screen.getByRole("menu", { name: "More actions for Platform Package copy" }),
      ).getByRole("menuitem", { name: "Delete package" }),
    );
    await answerConfirm(user, "accept", "Delete Deployment Package “Platform Package copy”?");
    expect(
      screen.queryByText("Platform Package copy", { selector: ".wb-package-row strong" }),
    ).not.toBeInTheDocument();
  });

  it("operates action menus with focus, Arrow keys, Home, End, and Escape", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Keyboard Package");
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    const opener = screen.getByRole("button", { name: "More actions for Keyboard Package" });
    await user.click(opener);
    const menu = screen.getByRole("menu", { name: "More actions for Keyboard Package" });
    expect(within(menu).getByRole("menuitem", { name: "Open package" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(menu).getByRole("menuitem", { name: "Delete package" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Edit package" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Keyboard Package" })).getByRole(
        "menuitem",
        { name: "Edit package" },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Edit Deployment Package" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("protects a modified in-memory Workspace from accidental unload", () => {
    renderApp();
    const unchanged = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unchanged);
    expect(unchanged.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), {
      target: { value: "Modified Workspace" },
    });
    const modified = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(true);
  });

  it("protects unsaved administrative-template edits and clears the guard on cancel", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "ADMX source");
    await addDwordItem(user, "Enabled", "Software\\Policies\\Northgate\\App");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.click(screen.getByRole("button", { name: /Administrative Templates/ }));
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));

    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await answerConfirm(user, "accept", "Discard unsaved administrative template changes?");
    const cancelled = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(false);
  });

  it("does not let a delayed Workspace read overwrite newer edits", async () => {
    const user = userEvent.setup();
    const imported = createWorkspace({ name: "Imported Workspace" });
    const bytes = new TextEncoder().encode(exportWorkspace(imported));
    let finishRead: ((value: ArrayBuffer) => void) | undefined;
    const file = {
      name: "workspace.json",
      size: bytes.byteLength,
      arrayBuffer: vi.fn(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            finishRead = resolve;
          }),
      ),
    } as unknown as File;
    renderApp();
    const input = screen.getByLabelText("Open workspace or package file");

    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), {
      target: { value: "Newer local edit" },
    });
    finishRead?.(bytes.slice().buffer);

    await answerConfirm(user, "cancel", "Replace the modified Workspace?");
    expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue("Newer local edit");
  });

  it("reports a rejected Workspace file read without changing the Workspace", async () => {
    const file = {
      name: "workspace.json",
      size: 10,
      arrayBuffer: vi.fn().mockRejectedValue(new Error("device disappeared")),
    } as unknown as File;
    renderApp();

    fireEvent.change(screen.getByLabelText("Open workspace or package file"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("The selected file could not be read.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue(
      "Untitled Workspace",
    );
  });

  it("round trips Workspace and package JSON and resolves ID collisions explicitly", async () => {
    const user = userEvent.setup();
    const item = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Portable",
        valueName: "One",
      },
    });
    const pkg = createDeploymentPackage({ name: "Portable Package", items: [item] });
    const workspace = createWorkspace({ name: "Portable", packages: [pkg] });
    renderApp();
    const input = screen.getByLabelText("Open workspace or package file");
    fireEvent.change(input, {
      target: {
        files: [browserTextFile("workspace.json", exportWorkspace(workspace))],
      },
    });
    expect(await screen.findByRole("button", { name: /^Open Portable Package,/ })).toBeVisible();
    fireEvent.change(input, {
      target: {
        files: [browserTextFile("package.json", exportRegistryPackage(workspace, pkg))],
      },
    });
    const collision = await screen.findByRole("dialog", { name: "Package import conflict" });
    await user.click(within(collision).getByRole("button", { name: "Import as copy" }));
    expect(screen.getByRole("heading", { name: "Portable Package copy" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    const ids = screen
      .getAllByText(/Portable Package/, { selector: ".wb-package-row strong" })
      .map((node) => (node.closest(".wb-package-row") as HTMLElement).dataset.packageId);
    expect(new Set(ids).size).toBe(2);
  });

  it("never offers destructive replacement for an item-ID-only package collision", async () => {
    const user = userEvent.setup();
    const shared = createRegistryItem({
      registry: {
        ...createRegistryItem().registry,
        keyPath: "Software\\Existing",
        valueName: "Keep",
      },
    });
    const existing = createDeploymentPackage({ name: "Existing", items: [shared] });
    const imported = createDeploymentPackage({
      name: "Imported",
      items: [
        {
          ...shared,
          registry: { ...shared.registry, keyPath: "Software\\Imported" },
        },
      ],
    });
    const currentWorkspace = createWorkspace({ packages: [existing] });
    const sourceWorkspace = createWorkspace({ packages: [imported] });
    renderApp();
    const input = screen.getByLabelText("Open workspace or package file");

    fireEvent.change(input, {
      target: {
        files: [browserTextFile("workspace.json", exportWorkspace(currentWorkspace))],
      },
    });
    expect(await screen.findByRole("button", { name: /^Open Existing,/ })).toBeVisible();

    fireEvent.change(input, {
      target: {
        files: [browserTextFile("package.json", exportRegistryPackage(sourceWorkspace, imported))],
      },
    });

    const collision = await screen.findByRole("dialog", { name: "Package import conflict" });
    expect(within(collision).queryByRole("button", { name: "Replace package" })).toBeNull();
    expect(within(collision).getByText(/already belongs to another package/)).toBeVisible();
    await user.click(within(collision).getByRole("button", { name: "Import as copy" }));
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    expect(screen.getByText("Existing", { selector: ".wb-package-row strong" })).toBeVisible();
    expect(screen.getByText("Imported copy", { selector: ".wb-package-row strong" })).toBeVisible();
  });

  it("reviews updated scripts and downloads the current package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Combined Settings");
    await addDwordItem(user, "First");
    await addDwordItem(user, "Second");

    await user.click(screen.getByRole("button", { name: "Review output" }));
    const review = screen.getByRole("dialog", { name: "Combined Settings" });
    expect(within(review).getByText(/2 Registry Items/)).toBeVisible();
    expect(within(review).getByText(/ValueName = 'First'/)).toBeVisible();
    expect(within(review).getByText(/ValueName = 'Second'/)).toBeVisible();
    await user.click(within(review).getByRole("button", { name: "Full script" }));
    expect(within(review).getByText(/# Deployment Package: Combined Settings/)).toBeVisible();
    await user.click(within(review).getByRole("button", { name: "Download package" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("requires warning acknowledgement for an individual generated file", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "User machine settings", "Remediation", "LoggedOnUser");
    await addDwordItem(user, "WarningValue");
    await user.click(screen.getByRole("button", { name: "Review output" }));
    const review = screen.getByRole("dialog", { name: "User machine settings" });
    await user.click(within(review).getByRole("button", { name: "Download file" }));
    await answerConfirm(user, "cancel", "Download with open warnings?");
    expect(createObjectURL).not.toHaveBeenCalled();
    await user.click(within(review).getByRole("button", { name: "Download file" }));
    await answerConfirm(user, "accept", "Download with open warnings?");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("sends a package-owned warning from the review to the package editor", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Review routing", "Remediation", "LoggedOnUser");
    await addDwordItem(user, "MachineValue", "Software\\Northgate\\Machine");

    // The review routes every package-owned field where the package is edited, as the row link does.
    await user.click(screen.getByRole("button", { name: "Review output" }));
    const review = screen.getByRole("dialog", { name: "Review routing" });
    await user.click(within(review).getByText(/^Validation/, { selector: "summary" }));
    await user.click(
      within(review).getByRole("button", { name: /HKLM normally requires elevation/ }),
    );

    const editor = screen.getByRole("dialog", { name: "Edit Deployment Package" });
    // The named control lives in the disclosure, so the disclosure has to be open to reach it.
    expect(
      within(editor).getByText("Deployment", { selector: "summary strong" }).closest("details"),
    ).toHaveAttribute("open");
    await waitFor(() =>
      expect(within(editor).getByRole("combobox", { name: "Run script as" })).toHaveFocus(),
    );
    expect(within(editor).getByText(/HKLM normally requires elevation/)).toBeVisible();
    const runContext = within(editor).getByRole("combobox", { name: "Run script as" });
    expect(runContext).toHaveAttribute("aria-invalid", "false");

    // The message follows the draft and disappears with the state that caused it.
    await user.selectOptions(runContext, "System");
    expect(within(editor).queryByText(/HKLM normally requires elevation/)).toBeNull();
  });

  it("marks the package name as invalid while validation names it", async () => {
    const user = userEvent.setup();
    // A stored package may carry an empty name; the review then reports it as a package error.
    const item = createRegistryItem({
      id: "named-item",
      registry: {
        desiredState: "Present",
        hive: "HKEY_LOCAL_MACHINE",
        keyPath: "Software\\Northgate",
        valueName: "Mode",
        value: { type: "DWord", data: 1 },
        view: "Registry64",
        deletionMode: "Value",
        rollbackMode: "None",
        rollbackValue: { type: "DWord", data: 0 },
      },
    });
    const workspace = createWorkspace({
      id: "unnamed-workspace",
      name: "Unnamed",
      packages: [createDeploymentPackage({ id: "unnamed-package", name: "", items: [item] })],
    });
    renderApp();
    fireEvent.change(screen.getByLabelText("Open workspace or package file"), {
      target: { files: [browserTextFile("workspace.json", exportWorkspace(workspace))] },
    });
    await user.click(
      await screen.findByRole("button", { name: /^Open Untitled Deployment Package,/ }),
    );
    await user.click(screen.getByRole("button", { name: "Review output" }));
    const review = screen.getByRole("dialog", { name: "Untitled Deployment Package" });
    await user.click(within(review).getByText(/^Validation/, { selector: "summary" }));
    await user.click(within(review).getByRole("button", { name: /Package name is required/ }));

    const editor = screen.getByRole("dialog", { name: "Edit Deployment Package" });
    const name = within(editor).getByRole("textbox", { name: "Package name" });
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-invalid", "true");
    const describedBy = name.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent("Package name is required.");

    // The message tracks the draft, so correcting the name clears it again.
    await user.type(name, "Named again");
    expect(name).toHaveAttribute("aria-invalid", "false");
    expect(within(editor).queryByText("Package name is required.")).toBeNull();
  });

  it("opens help in a portal, closes it with Escape, and returns focus", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);
    await openItemDetails(user);
    const help = screen.getByRole("button", { name: "Help for Desired state" });
    await user.click(help);
    const popover = screen.getByRole("dialog", { name: "Desired state" });
    expect(popover.parentElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Desired state" })).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });

  it("associates a field error with its control in the form", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);
    const path = within(composer()).getByRole("textbox", { name: "Registry path" });
    await commitItem(user);
    const feedbackId = path.getAttribute("aria-describedby");
    expect(feedbackId).toBeTruthy();
    expect(document.getElementById(feedbackId!)).toHaveTextContent("Enter a non-empty relative");
    // The form is not an overlay, so it never hides the application from assistive technology.
    expect(document.querySelector(".wb-app")).not.toHaveAttribute("aria-hidden");
  });

  it("isolates the dialog background and returns focus to the form", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);
    const trigger = within(composer()).getByRole("button", { name: "Details…" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Registry Item details" })).toBeVisible();
    expect(document.querySelector(".wb-app")).toHaveAttribute("aria-hidden", "true");
    await user.keyboard("{Escape}");
    expect(document.querySelector(".wb-app")).not.toHaveAttribute("aria-hidden");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("cycles theme and keeps About and Privacy controls functional", async () => {
    const user = userEvent.setup();
    renderApp();
    const theme = screen.getByRole("button", { name: "Change theme" });
    await user.click(theme);
    expect(document.querySelector(".wb-app")).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("button", { name: "About" }));
    const about = screen.getByRole("dialog", { name: "About Endpoint Registry Studio" });
    expect(
      within(about).getByText(`Release ${RELEASE_VERSION} / Generator contract ${RELEASE_VERSION}`),
    ).toBeVisible();
    await user.click(within(about).getByRole("button", { name: "Privacy and local processing" }));
    expect(screen.getByRole("dialog", { name: "Privacy" })).toBeVisible();
  });

  it("keeps one draft per package while navigating, and discards it on request", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Draft source");
    // An untouched series draft is not unsaved work, so nothing offers to discard it yet.
    expect(within(composer()).queryByRole("button", { name: "Discard draft" })).toBeNull();

    await fillComposer(user, { path: "Software\\Northgate\\Draft", name: "DraftValue" });
    expect(within(composer()).getByRole("button", { name: "Discard draft" })).toBeVisible();

    // Leaving the package for the overview keeps the draft without asking anything.
    await user.click(screen.getByRole("button", { name: /All packages/ }));
    expect(screen.queryByRole("form", { name: "Registry Item" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Open Draft source,/ }));
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Northgate\\Draft",
    );
    expect(within(composer()).getByRole("textbox", { name: "Value name" })).toHaveValue(
      "DraftValue",
    );

    // A changed draft is offered for discard, and the confirmation decides.
    await user.click(within(composer()).getByRole("button", { name: "Discard draft" }));
    await answerConfirm(user, "cancel", "Discard this Registry Item draft?");
    expect(within(composer()).getByRole("textbox", { name: "Value name" })).toHaveValue(
      "DraftValue",
    );

    await user.click(within(composer()).getByRole("button", { name: "Discard draft" }));
    await answerConfirm(user, "accept", "Discard this Registry Item draft?");
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue("");
    expect(within(composer()).queryByRole("button", { name: "Discard draft" })).toBeNull();
  });

  it("counts a changed draft as unsaved work without putting it into the package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Draft guard");
    await addDwordItem(user, "Kept", "Software\\Northgate\\Kept");
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const fingerprint = document.querySelector(".wb-package-head__status code")?.textContent;

    // The carried series draft is untouched, so it does not protect the page from unloading.
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await fillComposer(user, { name: "Half typed" });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    // The draft stays out of the package: no item, no fingerprint change, no extra item count.
    expect(screen.queryByText("Half typed", { selector: ".wb-item-row strong" })).toBeNull();
    expect(document.querySelector(".wb-package-head__status code")?.textContent).toBe(fingerprint);
    expect(
      screen.getByRole("complementary", { name: "Deployment Package navigator" }),
    ).toHaveTextContent("· 1 item");
  });

  it("asks about a changed draft before deleting its package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Draft delete");
    await fillComposer(user, { name: "Half typed" });

    // The first confirmation deletes the package, the second one answers for the draft.
    await user.click(screen.getByRole("button", { name: "More actions for Draft delete" }));
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Draft delete" })).getByRole(
        "menuitem",
        { name: "Delete package" },
      ),
    );
    await answerConfirm(user, "accept", "Delete Deployment Package “Draft delete”?");
    await answerConfirm(user, "cancel", "Discard this Registry Item draft?");
    expect(screen.getByRole("heading", { name: "Draft delete" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "More actions for Draft delete" }));
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Draft delete" })).getByRole(
        "menuitem",
        { name: "Delete package" },
      ),
    );
    await answerConfirm(user, "accept", "Delete Deployment Package “Draft delete”?");
    await answerConfirm(user, "accept", "Discard this Registry Item draft?");
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  });

  it("asks before replacing a Workspace while a draft is changed", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Draft replace");
    await fillComposer(user, { name: "Half typed" });
    // Exporting clears the modified flag, so only the draft stays unsaved.
    await user.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("Open workspace or package file"), {
      target: {
        files: [
          browserTextFile(
            "workspace.json",
            exportWorkspace(createWorkspace({ name: "Replacement" })),
          ),
        ],
      },
    });
    await answerConfirm(user, "cancel", "Replace the modified Workspace?");
    expect(screen.getByRole("heading", { name: "Draft replace" })).toBeVisible();
  });

  it("keeps an unsupported path prefix an error when the hive is changed", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Unsupported switch");
    // A committed item gives the form a valid series state to fall back on.
    await addDwordItem(user, "Kept", "Software\\Northgate\\Kept");

    const form = composer();
    const pathInput = within(form).getByRole("textbox", { name: "Registry path" });
    await user.clear(pathInput);
    await user.type(pathInput, "HKCR\\Software\\Bad");
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Registry hive" }),
      "HKEY_CURRENT_USER",
    );

    // The field keeps what was typed and stays an error, so the commit cannot store the old path.
    expect(pathInput).toHaveValue("HKCR\\Software\\Bad");
    expect(within(form).getByText(/HKCR is not supported/)).toBeVisible();
    await commitItem(user);
    expect(
      screen.getByRole("complementary", { name: "Deployment Package navigator" }),
    ).toHaveTextContent("· 1 item");
    expect(screen.getAllByText("Kept", { selector: ".wb-item-row strong" })).toHaveLength(1);
  });

  it("blocks a commit whose item would conflict with an item that is already there", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Conflicts");
    await addDwordItem(user, "Enabled", "Software\\Northgate\\Conflicts");

    // The same target with a different value is a conflict, not a second value.
    await fillComposer(user, {
      path: "Software\\Northgate\\Conflicts",
      name: "Enabled",
      type: "DWord",
      value: "2",
    });
    await commitItem(user);
    expect(
      screen.getByRole("complementary", { name: "Deployment Package navigator" }),
    ).toHaveTextContent("· 1 item");
    expect(within(composer()).getByText(/conflicts with another item/i)).toBeVisible();

    // A different value name is not a conflict, so the same form commits.
    const name = within(composer()).getByRole("textbox", { name: "Value name" });
    await user.clear(name);
    await user.type(name, "Enabled2");
    await commitItem(user);
    expect(
      screen.getByRole("complementary", { name: "Deployment Package navigator" }),
    ).toHaveTextContent("· 2 items");
  });

  it("drops the draft of a package that an imported replacement takes over", async () => {
    const user = userEvent.setup();
    const existing = createDeploymentPackage({ id: "replaced-package", name: "Replaced" });
    const incoming = createDeploymentPackage({ id: "replaced-package", name: "Replaced" });
    renderApp();
    const input = screen.getByLabelText("Open workspace or package file");
    fireEvent.change(input, {
      target: {
        files: [
          browserTextFile(
            "workspace.json",
            exportWorkspace(
              createWorkspace({ id: "replaced-workspace", name: "Replaced", packages: [existing] }),
            ),
          ),
        ],
      },
    });
    await user.click(await screen.findByRole("button", { name: /^Open Replaced,/ }));
    await fillComposer(user, { path: "Software\\Northgate\\Gone", name: "Half typed" });

    // A package file that reuses the identifier asks whether the existing package is replaced.
    fireEvent.change(input, {
      target: {
        files: [
          browserTextFile(
            "package.json",
            exportRegistryPackage(
              createWorkspace({ id: "incoming-workspace", name: "Incoming", packages: [incoming] }),
              incoming,
            ),
          ),
        ],
      },
    });
    const collision = await screen.findByRole("dialog", { name: "Package import conflict" });

    await user.click(within(collision).getByRole("button", { name: "Replace package" }));
    await answerConfirm(user, "cancel", "Discard this Registry Item draft?");
    expect(screen.getByRole("dialog", { name: "Package import conflict" })).toBeVisible();

    await user.click(within(collision).getByRole("button", { name: "Replace package" }));
    await answerConfirm(user, "accept", "Discard this Registry Item draft?");
    // The replacement takes the content over wholesale, so the old draft cannot survive it.
    expect(within(composer()).getByRole("textbox", { name: "Registry path" })).toHaveValue("");
    expect(within(composer()).queryByRole("button", { name: "Discard draft" })).toBeNull();
  });

  it("keeps the summary line neutral until a commit is attempted", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Neutral summary");
    // The empty form is incomplete, but red is delayed until a commit is attempted.
    expect(composerSummary()).toHaveAttribute("data-invalid", "false");
    await commitItem(user);
    expect(composerSummary()).toHaveAttribute("data-invalid", "true");
    await fillComposer(user, { path: "Software\\Northgate\\Neutral", name: "Value" });
    expect(composerSummary()).toHaveAttribute("data-invalid", "false");
  });

  it("opens the guide from the header and returns to the workbench", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("region", { name: "How this works" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Start here" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Return to work" }));
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  });
});
it("offers both creation actions at the navigator and in the overview", async () => {
  const user = userEvent.setup();
  renderApp();
  const navigator = screen.getByRole("complementary", { name: "Deployment Package navigator" });
  const overview = screen.getByRole("region", { name: "Deployment Packages" });

  for (const scope of [navigator, overview]) {
    expect(within(scope).getByRole("button", { name: "New package" })).toBeVisible();
    expect(
      within(scope).getByRole("button", { name: "New administrative template" }),
    ).toBeVisible();
  }

  // The template action reaches the template workspace directly, without a question in between.
  await user.click(within(overview).getByRole("button", { name: "New administrative template" }));
  expect(screen.getByRole("region", { name: "Administrative Templates" })).toBeVisible();
});

it("shows what the deployment will do and keeps the settings behind one disclosure", async () => {
  const user = userEvent.setup();
  renderApp();
  await createPackage(user, "Deployment line");
  const dialog = await openPackageEditor(user);
  const deployment = within(dialog)
    .getByText("Deployment", { selector: "summary strong" })
    .closest("details")!;

  expect(deployment).not.toHaveAttribute("open");
  expect(deployment.querySelector("summary")).toHaveTextContent(
    "Intune Remediation · SYSTEM · 64-bit",
  );

  await openDeploymentSettings(user, dialog);
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Script delivery method" }),
    "Win32App",
  );
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Run script as" }),
    "LoggedOnUser",
  );
  await user.click(within(dialog).getByRole("checkbox", { name: /Use 64-bit PowerShell/ }));
  expect(deployment.querySelector("summary")).toHaveTextContent(
    "Intune Win32 app source · Logged-on user · 32-bit",
  );
});
