import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RegistryImportDialog } from "./RegistryImportDialog";

const registryText =
  'Windows Registry Editor Version 5.00\n\n[HKEY_LOCAL_MACHINE\\Software\\Late]\n"Late"=dword:00000001';

/**
 * A file whose read stays pending until the test releases it. The dialog is rendered directly here,
 * so closing it does not unmount it and a missing invalidation stays observable.
 */
function pendingFile(name: string) {
  let release: () => void = () => undefined;
  const promise = new Promise<ArrayBuffer>((resolve) => {
    release = () => resolve(new TextEncoder().encode(registryText).buffer);
  });
  const file = { name, size: 0, arrayBuffer: vi.fn(() => promise) } as unknown as File;
  return { file, release: () => release() };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RegistryImportDialog close", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("discards a pending read when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onImport = vi.fn();
    render(<RegistryImportDialog onClose={onClose} onImport={onImport} />);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    const pending = pendingFile("late.reg");
    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [pending.file] },
    });

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    pending.release();
    await flush();

    expect(within(dialog).queryByText("late.reg")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Add a Registry source")).toBeVisible();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("discards a pending read when the dialog is closed with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<RegistryImportDialog onClose={onClose} onImport={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Import Registry data" });

    const pending = pendingFile("late.reg");
    fireEvent.change(within(dialog).getByLabelText("Choose Registry file"), {
      target: { files: [pending.file] },
    });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    pending.release();
    await flush();

    expect(within(dialog).queryByText("late.reg")).not.toBeInTheDocument();
  });
});
