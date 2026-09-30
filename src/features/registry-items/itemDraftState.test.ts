import { describe, expect, it } from "vitest";

import { createRegistryItem } from "../../domain/workspace/workspace";
import {
  continuationOf,
  createItemDraftState,
  draftStatesEqual,
  isDraftDirtyAgainstSeries,
  seriesDraft,
  seriesDraftState,
} from "./itemDraftState";

const item = createRegistryItem({
  registry: {
    desiredState: "Present",
    hive: "HKEY_LOCAL_MACHINE",
    keyPath: "Software\\Vendor\\App",
    valueName: "Enabled",
    value: { type: "DWord", data: 1 },
    view: "Registry64",
    deletionMode: "Value",
    rollbackMode: "None",
    rollbackValue: { type: "DWord", data: 0 },
  },
  description: "Operator note",
});

describe("series continuation", () => {
  it("carries only the hive, the path, the type, and the view", () => {
    const next = seriesDraft(continuationOf(item));
    expect(next.registry.hive).toBe("HKEY_LOCAL_MACHINE");
    expect(next.registry.keyPath).toBe("Software\\Vendor\\App");
    expect(next.registry.view).toBe("Registry64");
    expect(next.registry.value).toEqual({ type: "DWord", data: 0 });
    // Every other field returns to its default, and the identity is new.
    expect(next.registry.valueName).toBe("");
    expect(next.enabled).toBe(true);
    expect(next.description).toBe("");
    expect(next.id).not.toBe(item.id);
  });

  it("starts blank without a continuation", () => {
    const blank = seriesDraft(undefined);
    expect(blank.registry.keyPath).toBe("");
    expect(blank.registry.value.type).toBe("String");
  });

  it("keeps an identity it is handed, so a series state can be compared with its own draft", () => {
    expect(seriesDraft(continuationOf(item), "kept").id).toBe("kept");
    expect(seriesDraftState(continuationOf(item), "kept").draft.id).toBe("kept");
  });
});

describe("dirty draft", () => {
  it("does not count an untouched series draft as unsaved work", () => {
    const continuation = continuationOf(item);
    expect(isDraftDirtyAgainstSeries(seriesDraftState(continuation), continuation)).toBe(false);
  });

  it("counts an item edit and every raw text buffer", () => {
    const continuation = continuationOf(item);
    const state = seriesDraftState(continuation);
    const cases = [
      { ...state, pathText: "Software\\Vendor\\Other" },
      { ...state, pathEdited: true },
      { ...state, valueBinaryText: "0" },
      { ...state, rollbackBinaryText: "0" },
      { ...state, draft: { ...state.draft, description: "note" } },
      { ...state, draft: { ...state.draft, enabled: false } },
    ];
    for (const changed of cases) {
      expect(isDraftDirtyAgainstSeries(changed, continuation)).toBe(true);
    }
  });

  it("compares two states by value", () => {
    const state = createItemDraftState(item);
    expect(draftStatesEqual(state, { ...state })).toBe(true);
    expect(draftStatesEqual(state, { ...state, pathEdited: true })).toBe(false);
    expect(draftStatesEqual(state, { ...state, draft: { ...state.draft, id: "other" } })).toBe(
      false,
    );
  });
});
