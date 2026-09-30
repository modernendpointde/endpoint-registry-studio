import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";
import { useAppConfirm, type ConfirmRequest } from "./confirm";

const deleteItem: ConfirmRequest = {
  title: "Delete Registry Item “Enabled”?",
  message: "The Registry Item is removed from this package. This cannot be undone.",
  confirmLabel: "Delete item",
  tone: "danger",
};

/** The smallest app that owns the confirmation: one surface, and one dialog already open behind it. */
function Harness({ requests }: { requests: readonly ConfirmRequest[] }) {
  const { requestConfirm, pending, settle } = useAppConfirm();
  const [decisions, setDecisions] = useState<readonly boolean[]>([]);
  return (
    <div className="wb-app">
      <button
        onClick={() => {
          for (const request of requests)
            void requestConfirm(request).then((accepted) =>
              setDecisions((current) => [...current, accepted]),
            );
        }}
      >
        Ask
      </button>
      <div className="wb-dialog-layer" data-testid="open-dialog">
        <p>Another dialog</p>
      </div>
      {pending && <ConfirmDialog request={pending} onResolve={settle} />}
      <output data-testid="decisions">{decisions.map(String).join(",")}</output>
    </div>
  );
}

async function askFor(user: ReturnType<typeof userEvent.setup>, question: string) {
  await user.click(screen.getByRole("button", { name: "Ask" }));
  return screen.findByRole("alertdialog", { name: question });
}

/** The question is closed and the record holds exactly the answers given so far. */
async function expectAnswered(answers: string) {
  await waitFor(() => {
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("decisions")).toHaveTextContent(answers);
  });
}

describe("the app confirmation", () => {
  it("states the question, the consequence and both explicit answers", async () => {
    const user = userEvent.setup();
    render(<Harness requests={[deleteItem]} />);

    const dialog = await askFor(user, "Delete Registry Item “Enabled”?");

    expect(dialog).toHaveTextContent("The Registry Item is removed from this package.");
    expect(dialog).toHaveTextContent("This cannot be undone.");
    const accept = within(dialog).getByRole("button", { name: "Delete item" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    // Only the irreversible answer carries the danger tone; the safe one stays quiet.
    expect(accept).toHaveClass("wb-button--danger");
    expect(cancel).not.toHaveClass("wb-button--danger");
    // The safe answer owns the focus, so Enter never destroys anything by accident.
    await waitFor(() => expect(cancel).toHaveFocus());
  });

  it("decides with the answer the reader chose", async () => {
    const user = userEvent.setup();
    render(<Harness requests={[deleteItem]} />);

    const dialog = await askFor(user, "Delete Registry Item “Enabled”?");
    await user.click(within(dialog).getByRole("button", { name: "Delete item" }));

    await expectAnswered("true");
  });

  it("answers Escape and the backdrop as the cancelling answer", async () => {
    const user = userEvent.setup();
    render(<Harness requests={[deleteItem]} />);

    await askFor(user, "Delete Registry Item “Enabled”?");
    await user.keyboard("{Escape}");
    await expectAnswered("false");

    const dialog = await askFor(user, "Delete Registry Item “Enabled”?");
    const layer = dialog.closest(".wb-dialog-layer");
    if (layer === null) throw new Error("the confirmation is not rendered in its own layer");
    fireEvent.mouseDown(layer);
    await expectAnswered("false,false");
  });

  it("suspends the dialog it is asked out of, and restores it on cancel", async () => {
    const user = userEvent.setup();
    render(<Harness requests={[deleteItem]} />);
    const openDialog = screen.getByTestId("open-dialog");
    expect(openDialog).not.toHaveAttribute("hidden");

    await askFor(user, "Delete Registry Item “Enabled”?");
    expect(openDialog).toHaveAttribute("hidden");
    expect(openDialog).toHaveAttribute("inert");
    expect(openDialog).toHaveAttribute("aria-hidden", "true");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(openDialog).not.toHaveAttribute("hidden");
    expect(openDialog).not.toHaveAttribute("inert");
    expect(openDialog).not.toHaveAttribute("aria-hidden");
  });

  it("answers one question at a time and keeps the order", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        requests={[
          { ...deleteItem, title: "First question?" },
          { ...deleteItem, title: "Second question?", tone: "neutral" },
        ]}
      />,
    );

    const first = await askFor(user, "First question?");
    // The second request waits instead of replacing the unanswered one.
    expect(screen.queryByRole("alertdialog", { name: "Second question?" })).toBeNull();

    await user.click(within(first).getByRole("button", { name: "Delete item" }));
    const second = await screen.findByRole("alertdialog", { name: "Second question?" });
    // A neutral question confirms with the primary action, not with the danger tone.
    expect(within(second).getByRole("button", { name: "Delete item" })).toHaveClass(
      "wb-button--primary",
    );
    await user.click(within(second).getByRole("button", { name: "Delete item" }));

    await expectAnswered("true,true");
  });
});
