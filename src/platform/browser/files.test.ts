import { describe, expect, it, vi } from "vitest";

import { readRegistryTextFile, readUtf8TextFile } from "./files";

function browserFile(bytes: Uint8Array, name: string): File {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: vi.fn(() => Promise.resolve(bytes.slice().buffer)),
  } as unknown as File;
}

function utf16LeFile(text: string, name = "settings.reg"): File {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set([0xff, 0xfe]);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[2 + index * 2] = code & 0xff;
    bytes[3 + index * 2] = code >> 8;
  }
  return browserFile(bytes, name);
}

describe("browser file boundaries", () => {
  it("decodes UTF-8 and UTF-16LE Registry files without changing their text", async () => {
    const registryText =
      'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_LOCAL_MACHINE\\Software\\Contoso]\r\n"Greeting"="Grüße"\r\n';

    await expect(
      readRegistryTextFile(browserFile(new TextEncoder().encode(registryText), "utf8.reg"), 1024),
    ).resolves.toBe(registryText);
    const utf8 = new TextEncoder().encode(registryText);
    const utf8Bom = new Uint8Array(utf8.length + 3);
    utf8Bom.set([0xef, 0xbb, 0xbf]);
    utf8Bom.set(utf8, 3);
    await expect(readRegistryTextFile(browserFile(utf8Bom, "utf8-bom.reg"), 1024)).resolves.toBe(
      registryText,
    );
    await expect(readRegistryTextFile(utf16LeFile(registryText), 1024)).resolves.toBe(registryText);
  });

  it("rejects unsupported UTF-16BE Registry files explicitly", async () => {
    const file = browserFile(new Uint8Array([0xfe, 0xff, 0x00, 0x41]), "be.reg");

    await expect(readRegistryTextFile(file, 1024)).rejects.toThrow("Use UTF-8 or UTF-16LE");
  });

  it("rejects oversized files before reading their contents", async () => {
    const file = browserFile(new TextEncoder().encode("small"), "workspace.json");
    Object.defineProperty(file, "size", { configurable: true, value: 2048 });
    const read = vi.spyOn(file, "arrayBuffer");

    await expect(readUtf8TextFile(file, 1024)).rejects.toThrow("1,024-byte import limit");
    expect(read).not.toHaveBeenCalled();
  });

  it("turns file read failures into a stable browser-boundary error", async () => {
    const file = browserFile(new TextEncoder().encode("{}"), "workspace.json");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("device disappeared"));

    await expect(readUtf8TextFile(file, 1024)).rejects.toThrow(
      "The selected file could not be read",
    );
  });
});
