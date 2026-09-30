import { describe, expect, it } from "vitest";

import { readHivePathInput } from "./path";

describe("readHivePathInput", () => {
  it.each([
    ["HKLM\\Software\\Vendor", "HKEY_LOCAL_MACHINE", "Software\\Vendor"],
    ["HKEY_LOCAL_MACHINE\\Software\\Vendor", "HKEY_LOCAL_MACHINE", "Software\\Vendor"],
    ["hklm\\Software\\Vendor", "HKEY_LOCAL_MACHINE", "Software\\Vendor"],
    ["HKCU\\Software\\Vendor", "HKEY_CURRENT_USER", "Software\\Vendor"],
    ["HKEY_CURRENT_USER\\Software\\Vendor", "HKEY_CURRENT_USER", "Software\\Vendor"],
    ["hkcu\\Software\\Vendor", "HKEY_CURRENT_USER", "Software\\Vendor"],
    ["HKLM:\\Software\\Vendor", "HKEY_LOCAL_MACHINE", "Software\\Vendor"],
    ["  HKLM  \\Software", "HKEY_LOCAL_MACHINE", "Software"],
  ])("recognises %s as a supported hive", (raw, hive, keyPath) => {
    expect(readHivePathInput(raw)).toEqual({ kind: "hive", hive, keyPath });
  });

  it("returns an empty key path when only the hive is given", () => {
    expect(readHivePathInput("HKLM")).toEqual({
      kind: "hive",
      hive: "HKEY_LOCAL_MACHINE",
      keyPath: "",
    });
    expect(readHivePathInput("HKCU:")).toEqual({
      kind: "hive",
      hive: "HKEY_CURRENT_USER",
      keyPath: "",
    });
  });

  it.each([
    "HKCR\\Software",
    "HKEY_CLASSES_ROOT\\Software",
    "HKU\\S-1-5-21",
    "HKEY_USERS\\S-1-5-21",
    "HKCC\\Software",
    "HKEY_CURRENT_CONFIG\\Software",
    "HKEY_PERFORMANCE_DATA",
    "hkcr\\Software",
  ])("reports %s as an unsupported hive", (raw) => {
    const parsed = readHivePathInput(raw);
    expect(parsed.kind).toBe("unsupported-hive");
  });

  it("keeps a relative path unchanged, including names that look like an alias", () => {
    for (const raw of [
      "Software\\Vendor\\Product",
      "HKAPP\\Settings",
      "HKEY_FOO\\Settings",
      "HKLMX\\Settings",
      "HKEY_DYN_DATA\\Settings",
      "Software\\HKLM\\Vendor",
      "",
    ]) {
      expect(readHivePathInput(raw)).toEqual({ kind: "relative", keyPath: raw });
    }
  });

  it("does not treat a hive name in a later segment as a prefix", () => {
    expect(readHivePathInput("Software\\HKLM")).toEqual({
      kind: "relative",
      keyPath: "Software\\HKLM",
    });
  });
});
