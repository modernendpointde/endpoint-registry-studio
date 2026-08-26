import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RUNTIME_CONFIG } from "./runtimeConfig";
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

async function createPackage(user: ReturnType<typeof userEvent.setup>, name = "Security Baseline") {
  await user.click(screen.getByRole("button", { name: /Add package$/i }));
  const dialog = screen.getByRole("dialog", { name: "Add Deployment Package" });
  const nameInput = within(dialog).getByRole("textbox", { name: "Package name" });
  await user.clear(nameInput);
  await user.type(nameInput, name);
  await user.click(within(dialog).getByRole("button", { name: "Add package" }));
}

async function createPackageWithOptions(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  method: "Remediation" | "PlatformScript" | "Win32App",
  context: "System" | "LoggedOnUser" = "System",
) {
  await user.click(screen.getByRole("button", { name: /Add package$/i }));
  const dialog = screen.getByRole("dialog", { name: "Add Deployment Package" });
  const nameInput = within(dialog).getByRole("textbox", { name: "Package name" });
  await user.clear(nameInput);
  await user.type(nameInput, name);
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Deployment method" }),
    method,
  );
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Run script as" }),
    context,
  );
  await user.click(within(dialog).getByRole("button", { name: "Add package" }));
}

async function addDwordItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  path = "Software\\Contoso",
) {
  await user.click(screen.getByRole("button", { name: /Add item/ }));
  const dialog = screen.getByRole("dialog", { name: "Add Registry Item" });
  const pathInput = within(dialog).getByRole("textbox", { name: "Registry path" });
  await user.clear(pathInput);
  await user.type(pathInput, path);
  await user.type(within(dialog).getByRole("textbox", { name: "Value name" }), name);
  await user.selectOptions(
    within(dialog).getByRole("combobox", { name: "Registry value type" }),
    "DWord",
  );
  const value = within(dialog).getByRole("spinbutton", { name: "Registry value" });
  await user.clear(value);
  await user.type(value, "1");
  await user.click(within(dialog).getByRole("button", { name: "Add item" }));
}

function itemRow(name: string): HTMLElement {
  return screen
    .getByText(name, { selector: ".wb-item-row strong" })
    .closest(".wb-item-row") as HTMLElement;
}

describe("Endpoint Registry Studio workbench", () => {
  beforeEach(() => {
    setPersistentWorkspaceHomeForTests(createWorkspaceHome(createMemoryBackend()));
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
    expect(within(edit).getByRole("combobox", { name: "Deployment method" })).toHaveValue(
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

  it("does not save invalid Registry Items and cancels without changing the package", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);

    await user.click(screen.getByRole("button", { name: /Add item/ }));
    const dialog = screen.getByRole("dialog", { name: "Add Registry Item" });
    const path = within(dialog).getByRole("textbox", { name: "Registry path" });
    expect(path).toHaveFocus();
    expect(path).toHaveAttribute("placeholder", "Software\\Vendor\\Product");
    expect(within(dialog).queryByText(/non-empty relative/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add item" }));
    expect(within(dialog).getByText(/Resolve 1 blocking issue/)).toBeVisible();
    expect(path).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog", { name: "Add Registry Item" })).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add Registry Item" })).not.toBeInTheDocument();
    expect(screen.getByText("Empty package")).toBeVisible();
  });

  it("keeps partial Binary input visible and saves only complete hexadecimal bytes", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);

    await user.click(screen.getByRole("button", { name: /Add item/ }));
    const dialog = screen.getByRole("dialog", { name: "Add Registry Item" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Registry path" }),
      "Software\\Contoso",
    );
    await user.type(within(dialog).getByRole("textbox", { name: "Value name" }), "Payload");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Registry value type" }),
      "Binary",
    );
    const value = within(dialog).getByRole("textbox", { name: "Registry value" });

    await user.type(value, "f");
    expect(value).toHaveValue("f");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));
    expect(within(dialog).getByText(/two-digit hexadecimal bytes/i)).toBeVisible();

    await user.clear(value);
    await user.type(value, "00 ff 10");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));

    expect(screen.queryByRole("dialog", { name: "Add Registry Item" })).not.toBeInTheDocument();
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
    await user.type(path, "Software\\Contoso\\Managed");
    await user.click(within(edit).getByRole("button", { name: "Save changes" }));
    expect(within(itemRow("Enabled")).getByText("Software\\Contoso\\Managed")).toBeVisible();

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
    expect(screen.getAllByText("Enabled", { selector: ".wb-item-row strong" })).toHaveLength(1);
  });

  it("reuses the last Registry path on Add item and deletes a package from its detail view", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user, "Keep Path");
    await addDwordItem(user, "First", "Software\\Contoso\\Shared");
    await user.click(screen.getByRole("button", { name: /Add item/ }));
    const add = screen.getByRole("dialog", { name: "Add Registry Item" });
    expect(within(add).getByRole("textbox", { name: "Registry path" })).toHaveValue(
      "Software\\Contoso\\Shared",
    );
    expect(within(add).getByRole("combobox", { name: "Registry hive" })).toHaveValue(
      "HKEY_LOCAL_MACHINE",
    );
    await user.click(within(add).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "More actions for Keep Path" }));
    await user.click(
      within(screen.getByRole("menu", { name: "More actions for Keep Path" })).getByRole(
        "menuitem",
        { name: "Delete package" },
      ),
    );
    expect(screen.queryByRole("button", { name: /^Open Keep Path,/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deployment Packages" })).toBeVisible();
  });

  it("changes fields dynamically for Absent, SYSTEM HKCU, and Win32 Revert", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackageWithOptions(user, "Win32 User Policy", "Win32App");
    await user.click(screen.getByRole("button", { name: /Add item/ }));
    const dialog = screen.getByRole("dialog", { name: "Add Registry Item" });

    expect(within(dialog).getByRole("checkbox", { name: "Enabled" })).toBeChecked();
    expect(within(dialog).getByRole("combobox", { name: "Registry value type" })).toBeVisible();
    expect(
      within(dialog)
        .getByText("Revert behavior", { selector: "summary strong" })
        .closest("details"),
    ).not.toHaveAttribute("open");
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
    await user.click(within(dialog).getByText("Delete behavior", { selector: "summary strong" }));
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Delete behavior" }),
      "KeyRecursive",
    );
    expect(within(dialog).queryByRole("textbox", { name: "Value name" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByText("Revert behavior", { selector: "summary strong" }));
    expect(within(dialog).getByRole("combobox", { name: "Revert behavior" })).toHaveValue("None");
    expect(
      within(dialog).queryByRole("option", { name: "Set a defined value" }),
    ).not.toBeInTheDocument();
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
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\n"Imported"=dword:00000001',
      },
    });
    expect(within(dialog).getByText("Clipboard")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Review items" }));
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
            'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\n"Policy"=dword:00000001',
          ),
        ],
      },
    });
    expect(await within(dialog).findByText("policies.reg")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Review items" }));
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
          'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\n"Removed"=-',
      },
    });
    await user.click(within(dialog).getByRole("button", { name: "Review items" }));
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
    expect(within(dialog).getByRole("button", { name: "Review items" })).toBeDisabled();
    fireEvent.paste(document, {
      clipboardData: { getData: () => "not Registry data" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Review items" }));
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
          'REGEDIT4\n\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\n"Policy"=dword:00000001\n[HKEY_CLASSES_ROOT\\Bad]\n"X"="no"',
      },
    });
    await user.click(within(dialog).getByRole("button", { name: "Review items" }));
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
      'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\r\n"Greeting"="Grüße"\r\n';
    renderApp();
    await createPackage(user, "Unicode import");
    await user.click(screen.getAllByRole("button", { name: "Import Registry data" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [utf16LeFile("unicode.reg", registryText)] },
    });
    expect(await within(dialog).findByText("unicode.reg")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Review items" }));
    expect(within(dialog).getByText("1 item")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Import 1 item" }));

    expect(within(itemRow("Greeting")).getByText("Grüße")).toBeVisible();
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
    expect(screen.getByText("Empty package")).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "Download all" }));
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

  it("does not let a delayed Workspace read overwrite newer edits", async () => {
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
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    finishRead?.(bytes.slice().buffer);

    await waitFor(() =>
      expect(window.confirm).toHaveBeenCalledWith("Replace the modified Workspace?"),
    );
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
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(within(review).getByRole("button", { name: "Download file" }));
    expect(createObjectURL).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(within(review).getByRole("button", { name: "Download file" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("opens help in a portal, closes it with Escape, and returns focus", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);
    await user.click(screen.getByRole("button", { name: /Add item/ }));
    const help = screen.getByRole("button", { name: "Help for Desired state" });
    await user.click(help);
    const popover = screen.getByRole("dialog", { name: "Desired state" });
    expect(popover.parentElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Desired state" })).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });

  it("isolates dialog background and associates field errors with their controls", async () => {
    const user = userEvent.setup();
    renderApp();
    await createPackage(user);
    const trigger = screen.getByRole("button", { name: /Add item/ });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Add Registry Item" });
    expect(document.querySelector(".wb-app")).toHaveAttribute("aria-hidden", "true");
    const path = within(dialog).getByRole("textbox", { name: "Registry path" });
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));
    const feedbackId = path.getAttribute("aria-describedby");
    expect(feedbackId).toBeTruthy();
    expect(document.getElementById(feedbackId!)).toHaveTextContent("Enter a non-empty relative");
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
    await user.click(screen.getByRole("button", { name: "About" }));
    const about = screen.getByRole("dialog", { name: "About Endpoint Registry Studio" });
    expect(within(about).getByText("Release 1.0.1 / Generator contract 1.0.1")).toBeVisible();
    await user.click(within(about).getByRole("button", { name: "Privacy and local processing" }));
    expect(screen.getByRole("dialog", { name: "Privacy" })).toBeVisible();
  });
});
