import { screen } from "@testing-library/react";
// Only the setup helper's return type is needed, so the import stays a type import.
import type userEvent from "@testing-library/user-event";

/**
 * Answers the app's own confirmation. The app opens no native prompt: a destructive or replacing
 * action asks through a designed alert dialog, so a test names the question it expects and chooses
 * one of the two answers the way a reader would. It returns the dialog, so the test can also read it.
 */
export async function answerConfirm(
  user: ReturnType<typeof userEvent.setup>,
  answer: "accept" | "cancel",
  question?: string | RegExp,
): Promise<HTMLElement> {
  const dialog = await screen.findByRole(
    "alertdialog",
    question === undefined ? {} : { name: question },
  );
  const button = dialog.querySelector<HTMLButtonElement>(`[data-answer="${answer}"]`);
  if (button === null) throw new Error(`the confirmation offers no ${answer} answer`);
  await user.click(button);
  return dialog;
}
