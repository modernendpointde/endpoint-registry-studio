import { describe, expect, it } from "vitest";

import { createZip, type ZipFile } from "./zip";

function read16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function read32(data: Uint8Array, offset: number): number {
  return (
    (data[offset]! |
      (data[offset + 1]! << 8) |
      (data[offset + 2]! << 16) |
      (data[offset + 3]! << 24)) >>>
    0
  );
}

function extractStoredZip(data: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (read32(data, offset) === 0x04034b50) {
    const compressedSize = read32(data, offset + 18);
    const nameLength = read16(data, offset + 26);
    const extraLength = read16(data, offset + 28);
    const nameOffset = offset + 30;
    const contentOffset = nameOffset + nameLength + extraLength;
    const name = decoder.decode(data.subarray(nameOffset, nameOffset + nameLength));
    files.set(name, data.slice(contentOffset, contentOffset + compressedSize));
    offset = contentOffset + compressedSize;
  }
  return files;
}

describe("store-only ZIP generation", () => {
  it("round trips large files and UTF-8 paths without variadic writes", () => {
    const large = new Uint8Array(300_000);
    for (let index = 0; index < large.length; index += 1) large[index] = index % 251;
    const files: ZipFile[] = [
      { name: "groß/東京.bin", data: large },
      { name: "README.md", data: new TextEncoder().encode("ready\n") },
    ];

    const extracted = extractStoredZip(createZip(files));

    const extractedLarge = extracted.get("groß/東京.bin");
    expect(extractedLarge).toBeDefined();
    expect(extractedLarge?.length).toBe(large.length);
    expect(extractedLarge?.every((byte, index) => byte === large[index])).toBe(true);
    expect(new TextDecoder().decode(extracted.get("README.md"))).toBe("ready\n");
  });

  it("rejects classic ZIP entry and path limits clearly", () => {
    const empty = new Uint8Array();
    expect(() =>
      createZip(Array.from({ length: 65_536 }, (_, index) => ({ name: `${index}`, data: empty }))),
    ).toThrow("ZIP file count exceeds the supported classic ZIP limit");
    expect(() => createZip([{ name: "x".repeat(65_536), data: empty }])).toThrow(
      "exceeds the supported classic ZIP limit",
    );
  });
});
