import { describe, expect, it } from "vitest";

import { parseReg } from "./registryFileDecoder";

const header = "Windows Registry Editor Version 5.00\n\n";

describe(".reg parser", () => {
  it("parses aliases, default/named strings, escaping, Unicode, DWORD, and deletion", () => {
    const result = parseReg(
      `${header}[HKLM\\SOFTWARE\\Acme]\n@=""\n"Greeting"="Grüße \\"Admin\\""\n"Count"=dword:0000002a\n"Old"=-`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates[1]).toMatchObject({
      registry: {
        hive: "HKEY_LOCAL_MACHINE",
        valueName: "Greeting",
        value: { type: "String", data: 'Grüße "Admin"' },
      },
    });
    expect(result.candidates[2]?.registry.value).toEqual({ type: "DWord", data: 42 });
    expect(result.candidates[3]?.registry.desiredState).toBe("Absent");
  });

  it("parses binary, multiline ExpandString, MultiString, and exact QWORD", () => {
    const result = parseReg(
      `${header}[HKEY_CURRENT_USER\\Software\\Acme]\n"Bin"=hex:00,ff,10\n` +
        `"Expand"=hex(2):25,00,54,00,45,00,4d,00,50,00,25,00,\\\n  00,00\n` +
        `"Multi"=hex(7):41,00,00,00,42,00,00,00,00,00\n` +
        `"Big"=hex(b):ff,ff,ff,ff,ff,ff,ff,ff`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.registry.value)).toEqual([
      { type: "Binary", data: [0, 255, 16] },
      { type: "ExpandString", data: "%TEMP%" },
      { type: "MultiString", data: ["A", "B"] },
      { type: "QWord", data: "18446744073709551615" },
    ]);
  });

  it("parses exact unsigned DWORD and QWORD boundaries", () => {
    const result = parseReg(
      `${header}[HKLM\\SOFTWARE\\Acme]\n` +
        `"DWordZero"=dword:00000000\n` +
        `"DWordMax"=dword:ffffffff\n` +
        `"QWordZero"=hex(b):00,00,00,00,00,00,00,00\n` +
        `"QWordMax"=hex(b):ff,ff,ff,ff,ff,ff,ff,ff`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.registry.value)).toEqual([
      { type: "DWord", data: 0 },
      { type: "DWord", data: 4_294_967_295 },
      { type: "QWord", data: "0" },
      { type: "QWord", data: "18446744073709551615" },
    ]);
  });

  it("rejects malformed or overflowing numeric Registry syntax", () => {
    const result = parseReg(
      `${header}[HKLM\\SOFTWARE\\Acme]\n` +
        `"DWordOverflow"=dword:100000000\n` +
        `"DWordFraction"=dword:000000.1\n` +
        `"QWordOverflow"=hex(b):00,00,00,00,00,00,00,00,01\n` +
        `"BinaryByteOverflow"=hex:100`,
    );

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        "Unsupported Registry value syntax.",
        "QWORD hex(b) data must contain exactly eight bytes.",
        "Hexadecimal data must be comma-separated two-digit bytes.",
      ]),
    );
  });

  it("converts deleted keys into explicit recursive deletion", () => {
    const result = parseReg(`${header}[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Acme]`);
    expect(result.candidates[0]).toMatchObject({
      registry: {
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
        keyPath: "SOFTWARE\\Acme",
      },
    });
  });

  it("reports line, source, reason, and known correction for malformed input", () => {
    const result = parseReg(`${header}"Loose"="value"\n[HKEY_CLASSES_ROOT\\Bad]\n"X"=hex(9):00`);
    expect(result.candidates).toEqual([]);
    const loose = result.diagnostics.find((item) => item.line === 3);
    const hive = result.diagnostics.find((item) => item.line === 4);
    expect(loose?.source).toBe('"Loose"="value"');
    expect(typeof loose?.correction).toBe("string");
    expect(hive?.reason).toContain("Unsupported hive");
  });

  it("keeps supported keys after an unsupported header and skips unsupported hives", () => {
    const result = parseReg(
      `REGEDIT4\n\n[HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso]\n"Policy"=dword:00000001\n[HKEY_CLASSES_ROOT\\Bad]\n"X"="no"`,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      registry: {
        hive: "HKEY_LOCAL_MACHINE",
        keyPath: "SOFTWARE\\Contoso",
        valueName: "Policy",
        value: { type: "DWord", data: 1 },
      },
    });
    expect(result.diagnostics.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        "Missing or unsupported Registry Editor header.",
        expect.stringContaining("Unsupported hive"),
        "Value belongs to an unsupported key and was not imported.",
      ]),
    );
  });

  it("still parses a key when the Registry Editor header is missing", () => {
    const result = parseReg('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso]\n"Policy"=dword:00000001');
    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostics[0]?.reason).toBe("Missing or unsupported Registry Editor header.");
    expect(result.candidates[0]?.registry.valueName).toBe("Policy");
  });

  it("does not silently discard unsupported types or empty keys", () => {
    const result = parseReg(
      `${header}[HKLM\\Software\\Empty]\n\n[HKLM\\Software\\Other]\n"X"=hex(9):00`,
    );
    expect(result.diagnostics.map((item) => item.reason)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Empty key"),
        expect.stringContaining("Unsupported hex Registry type"),
      ]),
    );
  });
});
