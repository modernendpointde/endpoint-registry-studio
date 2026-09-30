import { describe, expect, it } from "vitest";

import {
  createDeploymentPackage,
  createRegistryItem,
  defaultDeployment,
} from "../../domain/workspace/workspace";
import type { RegistryItem } from "../../domain/workspace/workspace";
import type { ItemField } from "../../domain/validation/workspaceValidation";
import {
  commitPathText,
  describedByFeedbackId,
  feedbackElementId,
  isDraftDirty,
  readFieldFeedback,
  readItemEditorState,
} from "./itemEditorState";

function draft(
  overrides: Partial<RegistryItem["registry"]> = {},
  item: Partial<RegistryItem> = {},
) {
  return createRegistryItem({
    registry: {
      desiredState: "Present",
      hive: "HKEY_CURRENT_USER",
      keyPath: "Software\\Vendor\\App",
      valueName: "Enabled",
      value: { type: "DWord", data: 1 },
      view: "Auto",
      deletionMode: "Value",
      rollbackMode: "None",
      rollbackValue: { type: "DWord", data: 0 },
      ...overrides,
    },
    ...item,
  });
}

const pkg = createDeploymentPackage({ id: "package-1", name: "Package" });

/** Only a Win32 package has revert behavior, and only a 32-bit package resolves the Auto view. */
const win32Pkg = createDeploymentPackage({
  id: "package-1",
  name: "Package",
  deployment: { ...defaultDeployment(), method: "Win32App" },
});
const pkg32 = createDeploymentPackage({
  id: "package-1",
  name: "Package",
  deployment: { ...defaultDeployment(), runIn64BitPowerShell: false },
});

function state(overrides: Partial<Parameters<typeof readItemEditorState>[0]> = {}) {
  return readItemEditorState({
    draft: draft(),
    pathText: "Software\\Vendor\\App",
    pathEdited: false,
    valueBinaryText: "",
    rollbackBinaryText: "",
    deploymentPackage: pkg,
    ...overrides,
  });
}

describe("path text", () => {
  it("moves a recognised hive prefix into the hive and out of the path", () => {
    const committed = commitPathText(draft(), "HKLM\\Software\\Vendor");
    expect(committed.committed).toBe(true);
    expect(committed.hiveNote).toBe("HKEY_LOCAL_MACHINE");
    expect(committed.draft.registry.hive).toBe("HKEY_LOCAL_MACHINE");
    expect(committed.draft.registry.keyPath).toBe("Software\\Vendor");
    expect(committed.pathText).toBe("Software\\Vendor");
  });

  it("keeps an unsupported hive as an error instead of storing it", () => {
    const before = draft();
    const committed = commitPathText(before, "HKCR\\Software");
    expect(committed.committed).toBe(false);
    expect(committed.draft).toBe(before);
    expect(committed.pathText).toBe("HKCR\\Software");
  });

  it("keeps a relative path as typed", () => {
    const committed = commitPathText(draft(), "Software\\Vendor\\Other");
    expect(committed.committed).toBe(true);
    expect(committed.hiveNote).toBeUndefined();
    expect(committed.draft.registry.hive).toBe("HKEY_CURRENT_USER");
    expect(committed.draft.registry.keyPath).toBe("Software\\Vendor\\Other");
  });

  it("does not re-read a path that the reader did not edit", () => {
    const stored = draft({ hive: "HKEY_CURRENT_USER", keyPath: "HKLM\\Software\\Vendor" });
    const editor = state({
      draft: stored,
      pathText: "HKLM\\Software\\Vendor",
      pathEdited: false,
    });
    expect(editor.resolvedDraft.registry.keyPath).toBe("HKLM\\Software\\Vendor");
    expect(editor.unsupportedHive).toBeUndefined();
    expect(editor.issues).not.toContainEqual(
      expect.objectContaining({ code: "unsupported-hive-prefix" }),
    );
  });

  it("reports an unsupported prefix while the edit is pending", () => {
    const editor = state({ pathText: "HKU\\Software", pathEdited: true });
    expect(editor.unsupportedHive).toBe("HKU");
    expect(editor.resolvedDraft.registry.keyPath).toBe("HKU\\Software");
    expect(editor.valid).toBe(false);
  });
});

describe("editor state", () => {
  it("accepts a complete item", () => {
    // HKCU in a SYSTEM package needs a user hive target, so the complete case targets the machine hive.
    const editor = state({ draft: draft({ hive: "HKEY_LOCAL_MACHINE" }) });
    expect(editor.valid).toBe(true);
    expect(editor.isPresent).toBe(true);
    expect(editor.issues).toEqual([]);
    expect(editor.advancedSummaryText).toBe("Present");
  });

  it("reports partial hexadecimal input as a blocking value error", () => {
    const editor = state({
      draft: draft({ value: { type: "Binary", data: [] } }),
      valueBinaryText: "f",
    });
    expect(editor.valid).toBe(false);
    expect(editor.issues).toContainEqual(
      expect.objectContaining({ code: "invalid-binary", field: "value", severity: "Error" }),
    );
  });

  it("reports partial hexadecimal input in the revert value as a blocking error", () => {
    const rollback = {
      rollbackMode: "SetDefinedRollbackValue" as const,
      rollbackValue: { type: "Binary" as const, data: [] },
    };
    const editor = state({
      draft: draft(rollback),
      rollbackBinaryText: "f",
      deploymentPackage: win32Pkg,
    });
    expect(editor.valid).toBe(false);
    expect(editor.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-rollback-binary",
        field: "rollbackValue",
        severity: "Error",
      }),
    );

    const parsed = state({
      draft: draft(rollback),
      rollbackBinaryText: "ff",
      deploymentPackage: win32Pkg,
    });
    expect(parsed.issues).not.toContainEqual(
      expect.objectContaining({ code: "invalid-rollback-binary" }),
    );
    expect(parsed.parsedRollbackBinary).toEqual([255]);
  });

  it("reports an unsupported hive prefix as a blocking path error", () => {
    const editor = state({ pathText: "HKCR\\Software", pathEdited: true });
    expect(editor.valid).toBe(false);
    expect(editor.issues).toContainEqual(
      expect.objectContaining({
        code: "unsupported-hive-prefix",
        field: "keyPath",
        severity: "Error",
      }),
    );
  });

  it("describes a recursive delete in its summary", () => {
    const editor = state({
      draft: draft({
        desiredState: "Absent",
        deletionMode: "KeyRecursive",
        hive: "HKEY_LOCAL_MACHINE",
      }),
    });
    expect(editor.isPresent).toBe(false);
    expect(editor.recursiveDelete).toBe(true);
    expect(editor.advancedSummaryText).toBe(
      "Desired state Absent · deletes the key and everything below it",
    );
  });
});

describe("feedback", () => {
  const issue = {
    code: "invalid-key-path",
    severity: "Error" as const,
    message: "Enter a non-empty relative Registry path without empty segments.",
    packageId: "package-1",
    itemId: "item-1",
    scope: "item" as const,
    field: "keyPath" as const,
  };

  it("delays a red field until interaction or Save", () => {
    const feedback = readFieldFeedback([issue], "keyPath", {
      attempted: false,
      touched: new Set(),
    });
    expect(feedback.error).toBeDefined();
    expect(feedback.showError).toBe(false);
    expect(describedByFeedbackId("keyPath", feedback)).toBeUndefined();
  });

  it("shows a red field after a commit attempt", () => {
    const feedback = readFieldFeedback([issue], "keyPath", {
      attempted: true,
      touched: new Set(),
    });
    expect(feedback.showError).toBe(true);
    expect(describedByFeedbackId("keyPath", feedback)).toBe(feedbackElementId("keyPath"));
  });

  it("shows a red field the reader touched, and only that field", () => {
    const touched = new Set<ItemField>(["keyPath"]);
    expect(readFieldFeedback([issue], "keyPath", { attempted: false, touched }).showError).toBe(
      true,
    );
    expect(readFieldFeedback([issue], "valueName", { attempted: false, touched }).showError).toBe(
      false,
    );
  });

  it("shows the field a validation navigation named", () => {
    const feedback = readFieldFeedback([issue], "keyPath", {
      attempted: false,
      touched: new Set(),
      focusField: "keyPath",
    });
    expect(feedback.showError).toBe(true);
    expect(describedByFeedbackId("keyPath", feedback)).toBe(feedbackElementId("keyPath"));
  });

  it("carries a warning even before interaction but not the generic Auto note", () => {
    const warning = {
      code: "auto-view",
      severity: "Warning" as const,
      message: "Auto uses the PowerShell host architecture.",
      packageId: "package-1",
      itemId: "item-1",
      scope: "item" as const,
      field: "view" as const,
    };
    const generic = readFieldFeedback([warning], "view", { attempted: false, touched: new Set() });
    expect(generic.warning).toBeDefined();
    expect(describedByFeedbackId("view", generic)).toBeUndefined();

    const real = readFieldFeedback([{ ...warning, code: "auto-view-wow-risk" }], "view", {
      attempted: false,
      touched: new Set(),
    });
    expect(describedByFeedbackId("view", real)).toBe(feedbackElementId("view"));
  });
});

describe("collapsed summary", () => {
  it("names every non-default in the collapsed line", () => {
    const editor = state({
      draft: draft(
        { view: "Both", hive: "HKEY_LOCAL_MACHINE" },
        { enabled: false, description: "Operator note" },
      ),
    });
    expect(editor.advancedSummaryText).toBe(
      "Present · View Both · Excluded from generated scripts · Description: Operator note",
    );
  });

  it("names the effective 32-bit resolution of an Auto view", () => {
    const editor = state({ deploymentPackage: pkg32 });
    expect(editor.advancedSummaryText).toContain(
      "View Auto · resolves to Registry32 in this package",
    );
    expect(state().advancedSummaryText).not.toContain("resolves to Registry32");
  });

  it("states a whitespace-only description", () => {
    const editor = state({ draft: draft({}, { description: "   " }) });
    expect(editor.advancedSummaryText).toContain("Description: whitespace only");
  });

  it("truncates a long description to the summary limit", () => {
    const editor = state({ draft: draft({}, { description: "a".repeat(60) }) });
    const entry = `Description: ${"a".repeat(47)}…`;
    expect(editor.advancedSummaryText).toContain(entry);
    expect(entry.slice("Description: ".length)).toHaveLength(48);
  });

  it("states the delete scope in words", () => {
    expect(
      state({
        draft: draft({
          desiredState: "Absent",
          deletionMode: "KeyIfEmpty",
          hive: "HKEY_LOCAL_MACHINE",
        }),
      }).advancedSummaryText,
    ).toBe("Desired state Absent · deletes the value, then the empty key");
    expect(
      state({
        draft: draft({
          desiredState: "Absent",
          deletionMode: "Value",
          hive: "HKEY_LOCAL_MACHINE",
        }),
      }).advancedSummaryText,
    ).toBe("Desired state Absent · deletes the value");
  });

  it("states a revert action, because it changes what the uninstall does", () => {
    const editor = state({
      draft: draft(
        { rollbackMode: "SetDefinedRollbackValue", rollbackValue: { type: "String", data: "old" } },
        {},
      ),
      deploymentPackage: win32Pkg,
    });
    expect(editor.advancedSummaryText).toContain("Revert: set a defined value (String)");

    const deleting = state({
      draft: draft({ rollbackMode: "DeleteManagedValue" }),
      deploymentPackage: win32Pkg,
    });
    expect(deleting.advancedSummaryText).toContain("Revert: delete the managed value");

    // A package without revert behavior says nothing about it.
    expect(state().advancedSummaryText).not.toContain("Revert:");
  });

  it("states the profile target of a SYSTEM item that targets HKEY_CURRENT_USER", () => {
    expect(state().advancedSummaryText).toContain("User hive target required");

    const chosen = state({
      draft: draft(
        {},
        { userHive: { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true } },
      ),
    });
    expect(chosen.advancedSummaryText).toContain(
      "Profile target: all existing profiles and Default User",
    );

    const signedIn = state({
      draft: draft(
        {},
        { userHive: { userHiveTarget: "AllSignedInUsers", includeDefaultUser: false } },
      ),
    });
    expect(signedIn.advancedSummaryText).toContain("Profile target: currently signed-in users");

    // The machine hive never asks for a profile target.
    expect(
      state({ draft: draft({ hive: "HKEY_LOCAL_MACHINE" }) }).advancedSummaryText,
    ).not.toContain("Profile target");
  });
});

describe("dirty state", () => {
  it("counts an unchanged draft as clean", () => {
    const item = draft({ value: { type: "Binary", data: [0] } });
    expect(
      isDraftDirty({
        candidate: item,
        original: JSON.stringify(item),
        draft: item,
        valueBinaryText: "00",
        originalValueBinaryText: "00",
        rollbackBinaryText: "",
        originalRollbackBinaryText: "",
      }),
    ).toBe(false);
  });

  it("counts an unparsed binary edit as dirty", () => {
    const item = draft({ value: { type: "Binary", data: [0] } });
    expect(
      isDraftDirty({
        candidate: item,
        original: JSON.stringify(item),
        draft: item,
        valueBinaryText: "0",
        originalValueBinaryText: "00",
        rollbackBinaryText: "",
        originalRollbackBinaryText: "",
      }),
    ).toBe(true);
  });

  it("counts a revert binary edit as dirty", () => {
    const item = draft({ rollbackValue: { type: "Binary", data: [0] } });
    const shared = {
      candidate: item,
      original: JSON.stringify(item),
      draft: item,
      valueBinaryText: "",
      originalValueBinaryText: "",
    };
    expect(
      isDraftDirty({ ...shared, rollbackBinaryText: "00", originalRollbackBinaryText: "00" }),
    ).toBe(false);
    expect(
      isDraftDirty({ ...shared, rollbackBinaryText: "0", originalRollbackBinaryText: "00" }),
    ).toBe(true);
  });
});
