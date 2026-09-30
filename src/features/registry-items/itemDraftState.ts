import { createRegistryItem, type RegistryItem } from "../../domain/workspace/workspace";
import { binaryText, blankRegistryValue } from "./itemDraft";

/**
 * What a committed item carries into the next draft of the same package. Session state only: it is not
 * part of the Workspace document, is not serialized, and does not survive a reload.
 */
export interface ItemContinuation {
  hive: RegistryItem["registry"]["hive"];
  keyPath: string;
  valueType: RegistryItem["registry"]["value"]["type"];
  view: RegistryItem["registry"]["view"];
}

export const continuationOf = (item: RegistryItem): ItemContinuation => ({
  hive: item.registry.hive,
  keyPath: item.registry.keyPath,
  valueType: item.registry.value.type,
  view: item.registry.view,
});

/**
 * A fresh draft that carries only the continuation fields; every other field keeps its default. The
 * identity can be carried over, because a draft that is compared against its own series state has to
 * keep the identity it already has instead of being handed a new one on every comparison.
 */
export function seriesDraft(continuation: ItemContinuation | undefined, id?: string): RegistryItem {
  const blank = createRegistryItem(id === undefined ? {} : { id });
  if (!continuation) return blank;
  return {
    ...blank,
    registry: {
      ...blank.registry,
      hive: continuation.hive,
      keyPath: continuation.keyPath,
      view: continuation.view,
      value: blankRegistryValue(continuation.valueType),
    },
  };
}

/**
 * Everything an authoring surface needs to render one draft, including the raw text buffers, so that an
 * invalid Binary entry survives a surface change, a package switch, and the details dialog.
 */
export interface ItemDraftState {
  draft: RegistryItem;
  pathText: string;
  pathEdited: boolean;
  valueBinaryText: string;
  rollbackBinaryText: string;
}

export function createItemDraftState(item: RegistryItem): ItemDraftState {
  return {
    draft: item,
    pathText: item.registry.keyPath,
    pathEdited: false,
    valueBinaryText: binaryText(item.registry.value),
    rollbackBinaryText: binaryText(item.registry.rollbackValue),
  };
}

/** The state a draft is reset to: the item the last commit left behind, or a blank first item. */
export function seriesDraftState(
  continuation: ItemContinuation | undefined,
  id?: string,
): ItemDraftState {
  return createItemDraftState(seriesDraft(continuation, id));
}

export function draftStatesEqual(left: ItemDraftState, right: ItemDraftState): boolean {
  return (
    left.pathText === right.pathText &&
    left.pathEdited === right.pathEdited &&
    left.valueBinaryText === right.valueBinaryText &&
    left.rollbackBinaryText === right.rollbackBinaryText &&
    JSON.stringify(left.draft) === JSON.stringify(right.draft)
  );
}

/**
 * A draft is unsaved work only once it differs from the series state it was prepared from. An untouched
 * series draft is therefore not unsaved work, and it never triggers a guard.
 */
export function isDraftDirtyAgainstSeries(
  current: ItemDraftState,
  continuation: ItemContinuation | undefined,
): boolean {
  return !draftStatesEqual(seriesDraftState(continuation, current.draft.id), current);
}
