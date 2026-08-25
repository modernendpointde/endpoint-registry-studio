export async function copyText(value: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) {
    throw new Error("Clipboard access is not available in this browser context.");
  }
  try {
    await clipboard.writeText(value);
  } catch {
    throw new Error("Clipboard access was denied or failed.");
  }
}

export async function readClipboardText(): Promise<string> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.readText) {
    throw new Error("Clipboard access is not available in this browser context.");
  }
  try {
    return await clipboard.readText();
  } catch {
    throw new Error("Clipboard access was denied or failed.");
  }
}
