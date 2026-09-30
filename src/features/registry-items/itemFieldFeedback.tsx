import { useRef, useState, type ReactNode } from "react";

import type { ItemField, ItemValidationIssue } from "../../domain/validation/workspaceValidation";
import {
  describedByFeedbackId,
  enterCommitAction,
  feedbackElementId,
  readFieldFeedback,
  type EditorSurface,
  type EnterCommitAction,
} from "./itemEditorState";

function fieldErrorMessage(issue: ItemValidationIssue): string {
  if (issue.code === "invalid-key-path") {
    return "Enter a non-empty relative Registry path without empty segments.";
  }
  return issue.message;
}

export interface ItemFieldInteraction {
  onPointerDown: () => void;
  onKeyDown: () => void;
  onBlur: () => void;
}

export interface ItemFieldFeedbackApi {
  /** True once a commit was attempted, which reveals every blocking field at once. */
  attempted: boolean;
  attempt: () => void;
  /** How many fields the reader interacted with, so a message can distinguish idle from attempted. */
  touchedCount: number;
  touch: (field: ItemField) => void;
  feedback: (field: ItemField) => ReactNode;
  invalid: (field: ItemField) => boolean;
  describedBy: (field: ItemField) => string | undefined;
  interaction: (field: ItemField) => ItemFieldInteraction;
}

/**
 * Red validation is delayed until the reader interacted with the field or attempted a commit. The inline
 * form and the dialog share this, so a field behaves the same in both surfaces.
 */
export function useItemFieldFeedback(
  issues: readonly ItemValidationIssue[],
  {
    focusField,
    surface = "dialog",
  }: { focusField?: ItemField | undefined; surface?: EditorSurface } = {},
): ItemFieldFeedbackApi {
  const [touched, setTouched] = useState<ReadonlySet<ItemField>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const engaged = useRef<Set<ItemField>>(new Set());

  const fieldState = (field: ItemField) =>
    readFieldFeedback(issues, field, {
      attempted,
      touched,
      ...(focusField ? { focusField } : {}),
    });
  const touch = (field: ItemField) => setTouched((current) => new Set(current).add(field));
  return {
    attempted,
    attempt: () => setAttempted(true),
    touchedCount: touched.size,
    touch,
    feedback: (field) => {
      const state = fieldState(field);
      if (state.error && state.showError) {
        return (
          <small id={feedbackElementId(field, surface)} className="wb-field__error">
            {fieldErrorMessage(state.error)}
          </small>
        );
      }
      // A field without a warning renders nothing: only a real warning gets its own line.
      if (state.warning && state.warning.code !== "auto-view") {
        return (
          <small id={feedbackElementId(field, surface)} className="wb-field__warning">
            {state.warning.message}
          </small>
        );
      }
      return null;
    },
    invalid: (field) => Boolean(fieldState(field).showError && fieldState(field).error),
    describedBy: (field) => describedByFeedbackId(field, fieldState(field), surface),
    interaction: (field) => ({
      onPointerDown: () => engaged.current.add(field),
      onKeyDown: () => engaged.current.add(field),
      onBlur: () => {
        if (!engaged.current.has(field)) return;
        touch(field);
      },
    }),
  };
}

/**
 * The Enter rule of a form, read from a React event. The decision itself lives in the pure module, so the
 * two authoring surfaces cannot drift apart.
 */
export function enterActionFor(event: {
  key: string;
  nativeEvent: { isComposing: boolean };
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}): EnterCommitAction {
  const target = event.target;
  return enterCommitAction(
    {
      key: event.key,
      isComposing: event.nativeEvent.isComposing,
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    },
    target instanceof HTMLElement
      ? {
          tagName: target.tagName,
          ...(target instanceof HTMLInputElement ? { type: target.type } : {}),
        }
      : null,
  );
}
