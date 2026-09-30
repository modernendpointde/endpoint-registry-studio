import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdministrativeTemplate,
  createPolicyDraftFromItem,
  type AdministrativeTemplate,
  type AdministrativeTemplatePolicy,
} from "../../domain/admx";
import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  type RegistryItem,
} from "../../domain/workspace/workspace";
import type { RegistryWorkspace } from "../../domain/workspace/workspace";
import type { RequestConfirm } from "../../shared/ui/confirm";
import { AdministrativeTemplatesWorkspace } from "./AdministrativeTemplatesWorkspace";

/** The app hands this surface one confirmation; the tests answer it without a dialog. */
const requestConfirm = vi.fn<RequestConfirm>(() => Promise.resolve(true));

function compatibleItem(name: string) {
  return createRegistryItem({
    registry: {
      ...createRegistryItem().registry,
      keyPath: "Software\\Policies\\Northgate\\App",
      valueName: name,
      value: { type: "DWord", data: 1 },
    },
  });
}

function policyDraft(
  overrides: Partial<AdministrativeTemplatePolicy> = {},
  source: RegistryItem = compatibleItem("Enabled"),
): AdministrativeTemplatePolicy {
  const created = createPolicyDraftFromItem(source, createDeploymentPackage());
  if (created.status !== "created") throw new Error("expected an accepted item");
  return {
    ...created.policy,
    policyId: "EnableFeature",
    displayName: "Enable feature",
    explainText: "Writes the configured value.",
    category: "Northgate Widget",
    valueMode: "Fixed",
    enabledBehavior: { kind: "WritePresentValue" },
    disabledBehavior: { kind: "DeleteValue" },
    notConfiguredBehavior: { kind: "DeleteValue" },
    ...overrides,
  };
}

function completeTemplate(overrides: Partial<AdministrativeTemplate> = {}): AdministrativeTemplate {
  return createAdministrativeTemplate({
    id: "template-1",
    name: "Northgate App",
    version: "1.0.0",
    vendorId: "Northgate",
    productId: "App",
    policies: [
      policyDraft(),
      policyDraft({ id: "duplicate-policy", policyId: "EnableFeatureAgain" }),
    ],
    ...overrides,
  });
}

function renderDialog(includeCompatible = true, templates: AdministrativeTemplate[] = []) {
  const compatible = compatibleItem("Enabled");
  const rejected = compatibleItem("Secret");
  rejected.registry.desiredState = "Absent";
  const workspace = createWorkspace({
    packages: [
      createDeploymentPackage({
        name: "Source package",
        items: includeCompatible ? [compatible, rejected] : [rejected],
      }),
    ],
    administrativeTemplates: templates,
  });
  const onWorkspaceChange = vi.fn<(workspace: RegistryWorkspace) => void>();
  const onDownload = vi.fn<(template: AdministrativeTemplate) => void>();
  const view = render(
    <div className="wb-app">
      <AdministrativeTemplatesWorkspace
        workspace={workspace}
        requestConfirm={requestConfirm}
        onWorkspaceChange={onWorkspaceChange}
        onDownload={onDownload}
        onDirtyChange={vi.fn()}
        onGoToPackages={vi.fn()}
        onOpenSource={vi.fn()}
        onPickHandled={vi.fn()}
      />
    </div>,
  );
  const rerender = (next: RegistryWorkspace) =>
    view.rerender(
      <div className="wb-app">
        <AdministrativeTemplatesWorkspace
          workspace={next}
          requestConfirm={requestConfirm}
          onWorkspaceChange={onWorkspaceChange}
          onDownload={onDownload}
          onDirtyChange={vi.fn()}
          onGoToPackages={vi.fn()}
          onOpenSource={vi.fn()}
          onPickHandled={vi.fn()}
        />
      </div>,
    );
  return { onWorkspaceChange, onDownload, workspace, rerender };
}

function renderWorkspace(workspace: RegistryWorkspace) {
  return renderWithRequest(workspace, undefined);
}

async function fillAuthoredPolicy(
  user: ReturnType<typeof userEvent.setup>,
  region: HTMLElement,
): Promise<void> {
  await user.type(
    within(region).getByRole("textbox", { name: /Registry path for/ }),
    "Software\\Policies\\Northgate\\Widget",
  );
  await user.type(within(region).getByRole("textbox", { name: /Value name for/ }), "EnableWidget");
  await user.selectOptions(
    within(region).getByRole("combobox", { name: /Registry value type for/ }),
    "DWord",
  );
  const value = within(region).getByRole("spinbutton", { name: /Registry value for/ });
  await user.clear(value);
  await user.type(value, "1");
  await user.type(within(region).getByRole("textbox", { name: "Template name" }), "Northgate App");
  await user.type(within(region).getByRole("textbox", { name: "Version" }), "1.0.0");
  await user.type(within(region).getByRole("textbox", { name: "Vendor identifier" }), "Northgate");
  await user.type(within(region).getByRole("textbox", { name: "Product identifier" }), "App");
  await user.type(
    within(region).getByRole("textbox", { name: "Policy identifier" }),
    "EnableFeature",
  );
  await user.type(within(region).getByRole("textbox", { name: "Category" }), "Northgate App");
  await user.type(within(region).getByRole("textbox", { name: "Display name" }), "Enable feature");
  await user.type(within(region).getByRole("textbox", { name: "Explanation" }), "Writes it.");
  await user.selectOptions(
    within(region).getByRole("combobox", { name: /Value mode for/ }),
    "Fixed",
  );
  await user.selectOptions(
    within(region).getByRole("combobox", { name: /Enabled behavior for/ }),
    "WritePresentValue",
  );
  await user.selectOptions(
    within(region).getByRole("combobox", { name: /Disabled behavior for/ }),
    "DeleteValue",
  );
  await user.selectOptions(
    within(region).getByRole("combobox", { name: /Not Configured behavior for/ }),
    "DeleteValue",
  );
}

function renderWithRequest(
  workspace: RegistryWorkspace,
  pickRequest: { token: number; selected: string[]; newTemplate?: boolean } | undefined,
) {
  const onWorkspaceChange = vi.fn<(workspace: RegistryWorkspace) => void>();
  const onDownload = vi.fn<(template: AdministrativeTemplate) => void>();
  const element = (current: RegistryWorkspace, request: typeof pickRequest) => (
    <div className="wb-app">
      <AdministrativeTemplatesWorkspace
        workspace={current}
        requestConfirm={requestConfirm}
        pickRequest={request}
        onWorkspaceChange={onWorkspaceChange}
        onDownload={onDownload}
        onDirtyChange={vi.fn()}
        onGoToPackages={vi.fn()}
        onOpenSource={vi.fn()}
        onPickHandled={vi.fn()}
      />
    </div>
  );
  const view = render(element(workspace, pickRequest));
  const rerender = (next: RegistryWorkspace) => view.rerender(element(next, pickRequest));
  const rerenderWithRequest = (request: NonNullable<typeof pickRequest>) =>
    view.rerender(element(workspace, request));
  return { onWorkspaceChange, onDownload, rerender, rerenderWithRequest };
}

describe("AdministrativeTemplatesWorkspace", () => {
  beforeEach(() => {
    requestConfirm.mockReset();
    requestConfirm.mockResolvedValue(true);
  });

  it("keeps rejected Registry Items visible with exact reasons", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));

    expect(screen.getByText("Compatible · Machine")).toBeVisible();
    expect(screen.getByText(/requires desired state Present/)).toBeVisible();
    expect(screen.getByText(/look like secrets, tokens, credentials, or keys/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Secret/ })).toBeDisabled();
  });

  it("opens assessment details when every Registry Item is rejected", async () => {
    const user = userEvent.setup();
    renderDialog(false);
    const open = screen.getByRole("button", { name: "New template" });

    expect(open).toBeEnabled();
    await user.click(open);
    expect(screen.getByText(/requires desired state Present/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Add 0 accepted items" })).toBeDisabled();
  });

  it("saves an incomplete draft but keeps preview blocked", async () => {
    const user = userEvent.setup();
    const { onWorkspaceChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));

    const dialog = screen.getByRole("region", { name: "Administrative Templates" });
    expect(within(dialog).getByRole("button", { name: "Continue to review" })).toBeDisabled();
    expect(within(dialog).getByText("Template name is required.")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Save draft to Workspace" }));

    expect(onWorkspaceChange).toHaveBeenCalledOnce();
    const saved = onWorkspaceChange.mock.calls[0]![0];
    expect(saved.administrativeTemplates).toHaveLength(1);
    expect(saved.administrativeTemplates[0]!.policies).toHaveLength(1);
  });

  it("requires explicit authored choices before preview and download", async () => {
    const user = userEvent.setup();
    const { onDownload } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));
    const dialog = screen.getByRole("region", { name: "Administrative Templates" });

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Template name" }), {
      target: { value: "Northgate App" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Version" }), {
      target: { value: "1.0.0" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Vendor identifier" }), {
      target: { value: "Northgate" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Product identifier" }), {
      target: { value: "App" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Policy identifier" }), {
      target: { value: "EnableFeature" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Category" }), {
      target: { value: "Northgate App" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Display name" }), {
      target: { value: "Enable feature" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Explanation" }), {
      target: { value: "Writes the configured value." },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Value mode for Enabled" }), {
      target: { value: "ProfileInput" },
    });
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Enabled behavior for Enabled" }),
      { target: { value: "WritePresentValue" } },
    );
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Disabled behavior for Enabled" }),
      { target: { value: "DeleteValue" } },
    );
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Not Configured behavior for Enabled" }),
      { target: { value: "DeleteValue" } },
    );
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Minimum DWORD" }), {
      target: { value: "0" },
    });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "Maximum DWORD" }), {
      target: { value: "1" },
    });

    expect(within(dialog).getByRole("button", { name: "Continue to review" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Continue to review" }));
    expect(within(dialog).getByText("Policies in this template")).toBeVisible();
    expect(within(dialog).getByText(/Enabled: Writes the configured value/)).toBeVisible();
    expect(within(dialog).getByText("App.admx")).toBeVisible();
    expect(within(dialog).getByText("en-US/App.adml")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Download template" }));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("does not save a stale value while a fixed DWORD draft is invalid", async () => {
    const user = userEvent.setup();
    const { onWorkspaceChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));
    const dialog = screen.getByRole("region", { name: "Administrative Templates" });

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Disabled behavior for Enabled" }),
      "WriteFixedValue",
    );
    await user.clear(within(dialog).getByRole("spinbutton", { name: "Disabled fixed value" }));

    expect(within(dialog).getByText("Enter an integer from 0 to 4294967295.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save draft to Workspace" })).toBeDisabled();
    expect(onWorkspaceChange).not.toHaveBeenCalled();
  });

  it("blocks saving DWORD bounds that schema 8 cannot reload", async () => {
    const user = userEvent.setup();
    const { onWorkspaceChange } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /Enabled/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 accepted item" }));
    const dialog = screen.getByRole("region", { name: "Administrative Templates" });

    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Value mode for Enabled" }),
      "ProfileInput",
    );
    await user.type(within(dialog).getByRole("spinbutton", { name: "Minimum DWORD" }), "-1");

    expect(within(dialog).getByText(/dwordMin must be an unsigned 32-bit integer/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save draft to Workspace" })).toBeDisabled();
    expect(onWorkspaceChange).not.toHaveBeenCalled();
  });

  it("blocks review when two policies target the same Registry value", async () => {
    const user = userEvent.setup();
    const duplicated = completeTemplate();
    renderDialog(true, [duplicated]);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("region", { name: "Administrative Templates" });

    expect(within(dialog).getByText(/write the same Registry value/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Continue to review" })).toBeDisabled();
  });

  it("shows an overlap when a Deployment Package affects the same Registry value", async () => {
    const user = userEvent.setup();
    const template = completeTemplate({ name: "Northgate App", policies: [policyDraft()] });
    renderDialog(true, [template]);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("region", { name: "Administrative Templates" });

    const notice = within(dialog).getByText("Also affected by Deployment Packages");
    expect(notice).toBeVisible();
    expect(within(dialog).getByText(/affects the same Registry value as policy/)).toBeVisible();
    expect(within(dialog).getByText(/not a\s+verified Intune conflict/)).toBeVisible();
  });

  it("drops a selection whose source item disappeared before it was accepted", async () => {
    const user = userEvent.setup();
    const { workspace, rerender } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /^Enabled/ }));
    expect(screen.getByRole("button", { name: "Add 1 accepted item" })).toBeEnabled();

    // The package list can be edited while this surface stays mounted.
    rerender(
      createWorkspace({
        packages: [createDeploymentPackage({ name: "Source package", items: [] })],
        administrativeTemplates: workspace.administrativeTemplates,
      }),
    );

    expect(screen.getByRole("button", { name: "Add 0 accepted items" })).toBeDisabled();
  });

  it("drops a selection whose source item became ineligible", async () => {
    const user = userEvent.setup();
    const { workspace, rerender } = renderDialog();
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /^Enabled/ }));

    const nowRejected = compatibleItem("Enabled");
    nowRejected.registry.desiredState = "Absent";
    rerender(
      createWorkspace({
        packages: [createDeploymentPackage({ name: "Source package", items: [nowRejected] })],
        administrativeTemplates: workspace.administrativeTemplates,
      }),
    );

    expect(screen.getByRole("button", { name: "Add 0 accepted items" })).toBeDisabled();
  });

  it("drops a preselected item that was disabled in its package", async () => {
    const user = userEvent.setup();
    const item = compatibleItem("Enabled");
    const pkg = createDeploymentPackage({ name: "Source package", items: [item] });
    const workspace = createWorkspace({ packages: [pkg] });
    const { rerender } = renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("checkbox", { name: /^Enabled/ }));
    expect(screen.getByRole("button", { name: "Add 1 accepted item" })).toBeEnabled();

    // The same item, only switched off: the existence filter cannot be what rejects it.
    item.enabled = false;
    rerender({ ...workspace, packages: [pkg] });

    expect(screen.getByText(/disabled in the package/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Add 0 accepted items" })).toBeDisabled();
  });

  it("reports a source that differs and adopts it on request", async () => {
    const user = userEvent.setup();
    const item = compatibleItem("Enabled");
    const template = completeTemplate({ name: "Northgate App", policies: [policyDraft({}, item)] });
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source package", items: [item] })],
      administrativeTemplates: [template],
    });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("region", { name: "Administrative Templates" });
    expect(within(dialog).getByText("Source matches the snapshot")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Use current source" })).toBeNull();
  });

  it("offers to adopt a changed source and keeps the policy valid afterwards", async () => {
    const user = userEvent.setup();
    const item = compatibleItem("Enabled");
    item.registry.value = { type: "DWord", data: 7 };
    const snapshotSource = compatibleItem("Enabled");
    const template = completeTemplate({
      name: "Northgate App",
      policies: [policyDraft({ registryItemId: item.id }, snapshotSource)],
    });
    const workspace = createWorkspace({
      packages: [createDeploymentPackage({ name: "Source package", items: [item] })],
      administrativeTemplates: [template],
    });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("region", { name: "Administrative Templates" });
    expect(within(dialog).getByText("Source differs from the snapshot")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Use current source" }));

    // Only the value data changed, so the authored choices survive the adoption.
    expect(within(dialog).getByText("Source matches the snapshot")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Continue to review" })).toBeEnabled();
  });

  it("couples the policy class to the hive and keeps the chosen Registry type", async () => {
    const user = userEvent.setup();
    renderWorkspace(createWorkspace());
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("button", { name: "Start with my own Registry target" }));
    const region = screen.getByRole("region", { name: "Administrative Templates" });

    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Registry hive for/ }),
      "HKEY_CURRENT_USER",
    );
    expect(within(region).getByText("User")).toBeVisible();

    const typeSelect = within(region).getByRole("combobox", { name: /Registry value type for/ });
    await user.selectOptions(typeSelect, "ExpandString");
    expect(typeSelect).toHaveValue("ExpandString");

    // A text target must be editable, not only displayable.
    const valueInput = within(region).getByRole("textbox", { name: /Registry value for/ });
    await user.type(valueInput, "%ProgramFiles%\\Northgate");
    expect(valueInput).toHaveValue("%ProgramFiles%\\Northgate");
  });

  it("blocks review while an authored DWORD value is cleared", async () => {
    const user = userEvent.setup();
    renderWorkspace(createWorkspace());
    await user.click(screen.getByRole("button", { name: "New template" }));
    await user.click(screen.getByRole("button", { name: "Start with my own Registry target" }));
    const region = screen.getByRole("region", { name: "Administrative Templates" });

    await user.type(
      within(region).getByRole("textbox", { name: /Registry path for/ }),
      "Software\\Policies\\Northgate\\Widget",
    );
    await user.type(
      within(region).getByRole("textbox", { name: /Value name for/ }),
      "EnableWidget",
    );
    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Registry value type for/ }),
      "DWord",
    );
    const valueInput = within(region).getByRole("spinbutton", { name: /Registry value for/ });
    await user.clear(valueInput);
    await user.type(valueInput, "1");
    await user.type(
      within(region).getByRole("textbox", { name: "Template name" }),
      "Northgate App",
    );
    await user.type(within(region).getByRole("textbox", { name: "Version" }), "1.0.0");
    await user.type(
      within(region).getByRole("textbox", { name: "Vendor identifier" }),
      "Northgate",
    );
    await user.type(within(region).getByRole("textbox", { name: "Product identifier" }), "App");
    await user.type(
      within(region).getByRole("textbox", { name: "Policy identifier" }),
      "EnableFeature",
    );
    await user.type(within(region).getByRole("textbox", { name: "Category" }), "Northgate App");
    await user.type(
      within(region).getByRole("textbox", { name: "Display name" }),
      "Enable feature",
    );
    await user.type(within(region).getByRole("textbox", { name: "Explanation" }), "Writes it.");
    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Value mode for/ }),
      "Fixed",
    );
    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Enabled behavior for/ }),
      "WritePresentValue",
    );
    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Disabled behavior for/ }),
      "DeleteValue",
    );
    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Not Configured behavior for/ }),
      "DeleteValue",
    );
    // The template is otherwise complete, so the only thing that can block review from here is the value.
    expect(within(region).getByRole("button", { name: "Continue to review" })).toBeEnabled();

    await user.clear(valueInput);

    expect(within(region).getByText(/Enter an integer from 0 to 4294967295/)).toBeVisible();
    expect(within(region).getByRole("button", { name: "Continue to review" })).toBeDisabled();

    await user.type(valueInput, "5");
    expect(within(region).getByRole("button", { name: "Continue to review" })).toBeEnabled();
  });

  it("does not carry an invalid draft from one template into the next", async () => {
    const user = userEvent.setup();
    const { rerenderWithRequest } = renderWithRequest(createWorkspace(), {
      token: 1,
      selected: [],
      newTemplate: true,
    });
    const region = screen.getByRole("region", { name: "Administrative Templates" });
    await user.selectOptions(
      within(region).getByRole("combobox", { name: /Registry value type for/ }),
      "DWord",
    );
    const valueInput = within(region).getByRole("spinbutton", { name: /Registry value for/ });
    await user.clear(valueInput);
    // The invalid draft belongs to this template only, and it blocks saving here.
    expect(within(region).getByRole("button", { name: "Save draft to Workspace" })).toBeDisabled();

    // The creation request replaces the draft without a cancel, so the previous validity must not survive.
    rerenderWithRequest({ token: 2, selected: [], newTemplate: true });

    const fresh = screen.getByRole("region", { name: "Administrative Templates" });
    // The request is answered by the app's confirmation, so the replacement lands one tick later.
    await waitFor(() =>
      expect(within(fresh).getByRole("button", { name: "Save draft to Workspace" })).toBeEnabled(),
    );
    await fillAuthoredPolicy(user, fresh);
    expect(within(fresh).getByRole("button", { name: "Continue to review" })).toBeEnabled();
  });
});
