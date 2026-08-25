import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeneratedArtifact } from "../../generators/types";
import { copyText, readClipboardText } from "./clipboard";
import { downloadArtifact } from "./download";

const artifact: GeneratedArtifact = {
  name: "test.txt",
  purpose: "Test",
  mediaType: "text/plain",
  content: "content",
};

describe("browser actions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects missing and denied Clipboard access", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(copyText("value")).rejects.toThrow("not available");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(copyText("value")).rejects.toThrow("denied or failed");
  });

  it("rejects missing and denied Clipboard reads", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await expect(readClipboardText()).rejects.toThrow("not available");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(readClipboardText()).rejects.toThrow("denied or failed");
  });

  it("reports download initiation failure and releases the temporary URL", async () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });

    await expect(downloadArtifact(artifact)).rejects.toThrow("could not start");
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
