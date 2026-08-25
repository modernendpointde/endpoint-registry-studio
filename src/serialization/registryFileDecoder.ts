import {
  createId,
  createRegistryDefinition,
  normalizeQWord,
  type RegistryDefinition,
  type RegistryHive,
  type RegistryValue,
} from "../domain/registry/model";

export const MAX_REG_BYTES = 5 * 1024 * 1024;

export interface ParserDiagnostic {
  severity: "Error" | "Warning";
  line: number;
  source: string;
  reason: string;
  correction?: string;
}

export interface RegParseResult {
  candidates: ParsedRegistryCandidate[];
  diagnostics: ParserDiagnostic[];
}

export interface ParsedRegistryCandidate {
  id: string;
  enabled: boolean;
  registry: RegistryDefinition;
  description: string;
}

interface LogicalLine {
  line: number;
  source: string;
  text: string;
}

function diagnostic(
  severity: ParserDiagnostic["severity"],
  line: LogicalLine,
  reason: string,
  correction?: string,
): ParserDiagnostic {
  return correction === undefined
    ? { severity, line: line.line, source: line.source, reason }
    : { severity, line: line.line, source: line.source, reason, correction };
}

function assembleLines(text: string): LogicalLine[] {
  const physical = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const result: LogicalLine[] = [];
  for (let index = 0; index < physical.length; index += 1) {
    const start = index;
    const sources = [physical[index] ?? ""];
    let value = physical[index] ?? "";
    while (/\\\s*$/.test(value) && index + 1 < physical.length) {
      value = value.replace(/\\\s*$/, "");
      index += 1;
      const next = physical[index] ?? "";
      sources.push(next);
      value += next.trim();
    }
    result.push({ line: start + 1, source: sources.join("\n"), text: value.trim() });
  }
  return result;
}

function parseHivePath(raw: string): { hive: RegistryHive; keyPath: string } | undefined {
  const separator = raw.indexOf("\\");
  const hiveRaw = (separator === -1 ? raw : raw.slice(0, separator)).toUpperCase();
  const keyPath = separator === -1 ? "" : raw.slice(separator + 1);
  const aliases: Record<string, RegistryHive> = {
    HKEY_LOCAL_MACHINE: "HKEY_LOCAL_MACHINE",
    HKLM: "HKEY_LOCAL_MACHINE",
    HKEY_CURRENT_USER: "HKEY_CURRENT_USER",
    HKCU: "HKEY_CURRENT_USER",
  };
  const hive = aliases[hiveRaw];
  return hive ? { hive, keyPath } : undefined;
}

function unescapeQuoted(raw: string): string | undefined {
  let result = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      result += char;
      continue;
    }
    const next = raw[index + 1];
    if (next !== "\\" && next !== '"') return undefined;
    result += next;
    index += 1;
  }
  return result;
}

function parseHexBytes(raw: string): number[] | undefined {
  if (raw.trim() === "") return [];
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => !/^[0-9a-fA-F]{2}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

function decodeUtf16(bytes: number[]): string {
  const usable =
    bytes.length >= 2 && bytes.at(-1) === 0 && bytes.at(-2) === 0 ? bytes.slice(0, -2) : bytes;
  return new TextDecoder("utf-16le", { fatal: true }).decode(new Uint8Array(usable));
}

function parseData(raw: string): { value?: RegistryValue; deletion?: true; error?: string } {
  if (raw === "-") return { deletion: true };
  const stringMatch = /^"((?:[^"\\]|\\.)*)"$/.exec(raw);
  if (stringMatch) {
    const data = unescapeQuoted(stringMatch[1] ?? "");
    return data === undefined
      ? { error: "String contains an unsupported escape sequence." }
      : { value: { type: "String", data } };
  }
  const dword = /^dword:([0-9a-fA-F]{8})$/i.exec(raw);
  if (dword) return { value: { type: "DWord", data: Number.parseInt(dword[1] ?? "", 16) } };
  const hex = /^hex(?:\(([0-9a-fA-F]+)\))?:(.*)$/i.exec(raw);
  if (!hex) return { error: "Unsupported Registry value syntax." };
  const kind = (hex[1] ?? "binary").toLowerCase();
  const bytes = parseHexBytes(hex[2] ?? "");
  if (!bytes) return { error: "Hexadecimal data must be comma-separated two-digit bytes." };
  try {
    if (kind === "binary") return { value: { type: "Binary", data: bytes } };
    if (kind === "2") return { value: { type: "ExpandString", data: decodeUtf16(bytes) } };
    if (kind === "7") {
      const decoded = decodeUtf16(bytes);
      return {
        value: {
          type: "MultiString",
          data: decoded === "" ? [] : decoded.replace(/\0$/, "").split("\0"),
        },
      };
    }
    if (kind === "b") {
      if (bytes.length !== 8)
        return { error: "QWORD hex(b) data must contain exactly eight bytes." };
      let number = 0n;
      bytes.forEach((byte, index) => {
        number |= BigInt(byte) << BigInt(index * 8);
      });
      const data = normalizeQWord(number.toString());
      return data
        ? { value: { type: "QWord", data } }
        : { error: "QWORD is outside its valid range." };
    }
    return { error: `Unsupported hex Registry type hex(${kind}).` };
  } catch {
    return { error: "Hex string data is not valid UTF-16LE." };
  }
}

export function parseReg(text: string): RegParseResult {
  const candidates: ParsedRegistryCandidate[] = [];
  const diagnostics: ParserDiagnostic[] = [];
  if (new TextEncoder().encode(text).byteLength > MAX_REG_BYTES) {
    return {
      candidates,
      diagnostics: [
        {
          severity: "Error",
          line: 1,
          source: "",
          reason: `Registry input exceeds the ${MAX_REG_BYTES}-byte limit.`,
        },
      ],
    };
  }

  const lines = assembleLines(text);
  const firstContent = lines.find((line) => line.text !== "" && !/^[;#]/.test(line.text));
  const hasSupportedHeader = firstContent?.text === "Windows Registry Editor Version 5.00";
  if (!hasSupportedHeader) {
    diagnostics.push(
      diagnostic(
        "Error",
        firstContent ?? { line: 1, source: "", text: "" },
        "Missing or unsupported Registry Editor header.",
        "Start the file with Windows Registry Editor Version 5.00.",
      ),
    );
  }

  let current:
    { hive: RegistryHive; keyPath: string; header: LogicalLine; values: number } | undefined;
  let skippedKey: LogicalLine | undefined;
  const finishKey = () => {
    if (current && current.values === 0) {
      diagnostics.push(
        diagnostic(
          "Warning",
          current.header,
          "Empty key declarations cannot be represented as a Registry value entry and were not imported.",
        ),
      );
    }
  };

  const skipAsHeader = (line: LogicalLine): boolean => {
    if (line !== firstContent) return false;
    if (hasSupportedHeader) return true;
    return !/^\[/.test(line.text);
  };

  for (const line of lines) {
    if (skipAsHeader(line) || line.text === "" || /^[;#]/.test(line.text)) continue;
    const keyMatch = /^\[(-?)([^\]]+)\]$/.exec(line.text);
    if (keyMatch) {
      finishKey();
      const parsed = parseHivePath(keyMatch[2] ?? "");
      if (!parsed || parsed.keyPath === "") {
        diagnostics.push(
          diagnostic(
            "Error",
            line,
            "Unsupported hive or empty key path.",
            "Use HKLM or HKCU followed by a key path.",
          ),
        );
        current = undefined;
        skippedKey = line;
        continue;
      }
      skippedKey = undefined;
      if (keyMatch[1] === "-") {
        candidates.push({
          id: createId(),
          enabled: true,
          registry: createRegistryDefinition({
            ...parsed,
            desiredState: "Absent",
            deletionMode: "KeyRecursive",
            valueName: "",
          }),
          description: "",
        });
        current = undefined;
      } else {
        current = { ...parsed, header: line, values: 0 };
      }
      continue;
    }

    if (!current) {
      diagnostics.push(
        skippedKey
          ? diagnostic("Error", line, "Value belongs to an unsupported key and was not imported.")
          : diagnostic(
              "Error",
              line,
              "Value appears outside a supported key declaration.",
              "Add a [HKEY_...] declaration before the value.",
            ),
      );
      continue;
    }
    const valueMatch = /^(?:@|"((?:[^"\\]|\\.)*)")=(.*)$/.exec(line.text);
    if (!valueMatch) {
      diagnostics.push(
        diagnostic(
          "Error",
          line,
          "Malformed or unsupported value declaration.",
          'Use @=... or "ValueName"=... syntax.',
        ),
      );
      continue;
    }
    const valueName = valueMatch[1] === undefined ? "" : unescapeQuoted(valueMatch[1]);
    if (valueName === undefined) {
      diagnostics.push(
        diagnostic("Error", line, "Value name contains an unsupported escape sequence."),
      );
      continue;
    }
    const parsedData = parseData(valueMatch[2] ?? "");
    if (parsedData.error) {
      diagnostics.push(diagnostic("Error", line, parsedData.error));
      continue;
    }
    candidates.push({
      id: createId(),
      enabled: true,
      registry: createRegistryDefinition({
        hive: current.hive,
        keyPath: current.keyPath,
        valueName,
        desiredState: parsedData.deletion ? "Absent" : "Present",
        deletionMode: "Value",
        value: parsedData.value ?? { type: "String", data: "" },
      }),
      description: "",
    });
    current.values += 1;
  }
  finishKey();
  return { candidates, diagnostics };
}
