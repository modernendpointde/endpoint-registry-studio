import type { ReactNode } from "react";

import { HIVES, type RegistryHive, type RegistryValue } from "../../domain/registry/model";
import type { ItemFieldFeedbackApi } from "./itemFieldFeedback";

const PATH_HINT =
  "Enter a Registry path. A leading HKLM or HKCU moves the hive into the selector beside this field and is removed from the path, so both HKLM\\Software\\Vendor and Software\\Vendor are accepted.";

/**
 * The Registry target of an item: the hive selector attached to the path field, the raw path text, and
 * the note a committed hive prefix leaves behind. The inline form and the dialog render the same control.
 */
export function RegistryPathField({
  hive,
  onHive,
  pathText,
  onPathText,
  onPathBlur,
  hiveNote,
  api,
  className = "wb-field wb-field--wide",
  hint = PATH_HINT,
  hintPlacement = "below",
  keyPathId,
}: {
  hive: RegistryHive;
  onHive: (hive: RegistryHive) => void;
  pathText: string;
  onPathText: (text: string) => void;
  onPathBlur: () => void;
  hiveNote?: RegistryHive | undefined;
  api: ItemFieldFeedbackApi;
  className?: string;
  hint?: ReactNode;
  /**
   * Where the hint sits. The dialog explains the field under it; the permanent form keeps the field rows
   * one line high and puts the short reminder beside the label.
   */
  hintPlacement?: "below" | "title";
  /** When set, the field label points at the control instead of relying on its accessible name alone. */
  keyPathId?: string;
}): ReactNode {
  return (
    <div className={className}>
      {hintPlacement === "title" ? (
        <span className="wb-field-title">
          {keyPathId === undefined ? (
            <span>Registry path</span>
          ) : (
            <label htmlFor={keyPathId}>Registry path</label>
          )}
          <small>{hint}</small>
        </span>
      ) : (
        <span>Registry path</span>
      )}
      <div className="wb-field-combo">
        <select
          data-field="hive"
          aria-label="Registry hive"
          aria-invalid={api.invalid("hive")}
          aria-describedby={api.describedBy("hive")}
          value={hive}
          {...api.interaction("hive")}
          onChange={(event) => onHive(event.target.value as RegistryHive)}
        >
          {HIVES.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <input
          {...(keyPathId === undefined ? {} : { id: keyPathId })}
          data-field="keyPath"
          aria-label="Registry path"
          aria-invalid={api.invalid("keyPath")}
          aria-describedby={api.describedBy("keyPath")}
          placeholder={"Software\\Vendor\\Product"}
          value={pathText}
          {...api.interaction("keyPath")}
          onChange={(event) => onPathText(event.target.value)}
          onBlur={() => {
            api.interaction("keyPath").onBlur();
            onPathBlur();
          }}
        />
      </div>
      {api.feedback("hive")}
      {hintPlacement === "below" ? <small>{hint}</small> : null}
      {hiveNote ? (
        <small className="wb-field__note">
          Recognised {hiveNote} and removed it from the path.
        </small>
      ) : null}
      {api.feedback("keyPath")}
    </div>
  );
}

/**
 * The value editor of one Registry type. A multi-line value keeps its line breaks, a Binary value edits
 * its raw hexadecimal text so that partial input survives, and a QWORD stays decimal text.
 */
export function RegistryValueInput({
  value,
  field,
  rawText,
  onChange,
  onRawTextChange,
  ariaLabel,
  controlId,
  api,
}: {
  value: RegistryValue;
  field: "value" | "rollbackValue";
  rawText: string;
  onChange: (next: RegistryValue) => void;
  onRawTextChange: (text: string) => void;
  ariaLabel: string;
  /** When set, the field label points at the control instead of relying on its accessible name alone. */
  controlId?: string;
  api: ItemFieldFeedbackApi;
}): ReactNode {
  const common = {
    ...(controlId === undefined ? {} : { id: controlId }),
    "data-field": field,
    "aria-label": ariaLabel,
    "aria-invalid": api.invalid(field),
    "aria-describedby": api.describedBy(field),
    ...api.interaction(field),
  };
  if (value.type === "MultiString") {
    return (
      <textarea
        {...common}
        rows={3}
        value={value.data.join("\n")}
        onChange={(event) =>
          onChange({ type: "MultiString", data: event.target.value.split("\n") })
        }
      />
    );
  }
  if (value.type === "Binary") {
    return (
      <textarea
        {...common}
        rows={3}
        placeholder="00 ff 10"
        value={rawText}
        onChange={(event) => onRawTextChange(event.target.value)}
      />
    );
  }
  if (value.type === "DWord") {
    return (
      <input
        {...common}
        type="number"
        min="0"
        max="4294967295"
        value={Number.isNaN(value.data) ? "" : value.data}
        onChange={(event) =>
          onChange({
            type: "DWord",
            data: event.target.value === "" ? Number.NaN : Number(event.target.value),
          })
        }
      />
    );
  }
  return (
    <input
      {...common}
      inputMode={value.type === "QWord" ? "numeric" : undefined}
      value={value.data}
      onChange={(event) => {
        if (value.type === "QWord") onChange({ type: "QWord", data: event.target.value });
        else if (value.type === "ExpandString")
          onChange({ type: "ExpandString", data: event.target.value });
        else onChange({ type: "String", data: event.target.value });
      }}
    />
  );
}
