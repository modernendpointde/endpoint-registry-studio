export type BrowserFileErrorCode = "too-large" | "read-failed" | "unsupported-encoding";

export class BrowserFileError extends Error {
  constructor(
    readonly code: BrowserFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BrowserFileError";
  }
}

async function readBoundedBytes(file: File, maxBytes: number): Promise<Uint8Array> {
  if (file.size > maxBytes) {
    throw new BrowserFileError(
      "too-large",
      `File exceeds the ${maxBytes.toLocaleString("en-US")}-byte import limit.`,
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new BrowserFileError(
        "too-large",
        `File exceeds the ${maxBytes.toLocaleString("en-US")}-byte import limit.`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof BrowserFileError) throw error;
    throw new BrowserFileError("read-failed", "The selected file could not be read.");
  }
}

function decode(bytes: Uint8Array, encoding: "utf-8" | "utf-16le"): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new BrowserFileError(
      "unsupported-encoding",
      encoding === "utf-8"
        ? "File is not valid UTF-8."
        : "Registry file encoding is not supported. Use UTF-8 or UTF-16LE.",
    );
  }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

export async function readUtf8TextFile(file: File, maxBytes: number): Promise<string> {
  const bytes = await readBoundedBytes(file, maxBytes);
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    throw new BrowserFileError("unsupported-encoding", "JSON files must use UTF-8 encoding.");
  }
  const content = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
  return decode(content, "utf-8");
}

export async function readRegistryTextFile(file: File, maxBytes: number): Promise<string> {
  const bytes = await readBoundedBytes(file, maxBytes);
  if (
    startsWith(bytes, [0xfe, 0xff]) ||
    startsWith(bytes, [0xff, 0xfe, 0x00, 0x00]) ||
    startsWith(bytes, [0x00, 0x00, 0xfe, 0xff])
  ) {
    throw new BrowserFileError(
      "unsupported-encoding",
      "Registry file encoding is not supported. Use UTF-8 or UTF-16LE.",
    );
  }
  if (startsWith(bytes, [0xff, 0xfe])) return decode(bytes.subarray(2), "utf-16le");
  const content = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
  const text = decode(content, "utf-8");
  if (text.includes("\0")) {
    throw new BrowserFileError(
      "unsupported-encoding",
      "Registry file encoding is not supported. Use UTF-8 or UTF-16LE.",
    );
  }
  return text;
}
