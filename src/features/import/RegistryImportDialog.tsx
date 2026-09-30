import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { displayValue } from "../../domain/registry/model";
import { effectiveDesiredMutationForRegistry } from "../../domain/effectiveBehavior";
import {
  MAX_REG_BYTES,
  parseReg,
  type ParsedRegistryCandidate,
  type RegParseResult,
} from "../../serialization/registryFileDecoder";
import { readClipboardText } from "../../platform/browser/clipboard";
import { readRegistryTextFile } from "../../platform/browser/files";
import { englishUi } from "../../shared/localization/locale";
import { Dialog } from "../../shared/ui/Overlays";
import { ImportGlyph } from "../../shared/ui/icons";
import type { RegistryImportSource } from "./registryImport";

/** Only the provenance survives acceptance; the text itself is parsed and then discarded. */
type SourceState = { kind: "file"; fileName: string } | { kind: "clipboard" };

interface AcceptedSource {
  source: SourceState;
  result: RegParseResult;
}

type AcceptanceOutcome =
  | { kind: "accepted"; accepted: AcceptedSource; selected: string[] }
  | { kind: "error"; message: string };

const copy = englishUi.registryImport;
const itemLabel = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
const diagnosticLabel = (count: number, word: "warning" | "error") =>
  `${count} ${count === 1 ? word : `${word}s`}`;
const pasteHint = () =>
  /Mac|iPhone|iPad/.test(navigator.userAgent) ? copy.pasteHintMac : copy.pasteHint;

const importAction = (candidate: ParsedRegistryCandidate) => {
  switch (effectiveDesiredMutationForRegistry(candidate.registry).kind) {
    case "SetValue":
      return "Set exact value";
    case "DeleteValue":
      return "Delete value";
    case "DeleteValueAndEmptyKey":
      return "Delete value and empty key";
    case "DeleteKeyRecursive":
      return "Delete key tree";
  }
};

function toImportSource(source: SourceState): RegistryImportSource {
  return source.kind === "file"
    ? { kind: "file", fileName: source.fileName }
    : { kind: "clipboard" };
}

function sourceLabelOf(source: SourceState): string {
  return source.kind === "file" ? source.fileName : copy.clipboardSource;
}

/**
 * Classifies one accepted source. Parsing is synchronous and never commits; the review stage remains
 * the only commit point.
 */
function acceptSourceText(text: string, source: SourceState): AcceptanceOutcome {
  if (!text.trim()) {
    return {
      kind: "error",
      message: source.kind === "file" ? copy.emptyFile : copy.emptyClipboard,
    };
  }
  if (new TextEncoder().encode(text).length > MAX_REG_BYTES) {
    return {
      kind: "error",
      message: `Registry text exceeds the ${MAX_REG_BYTES / 1024 / 1024} MB limit.`,
    };
  }
  const result = parseReg(text);
  return {
    kind: "accepted",
    accepted: { source, result },
    selected: result.candidates.map((candidate) => candidate.id),
  };
}

export function RegistryImportDialog({
  onImport,
  onClose,
}: {
  onImport: (candidates: ParsedRegistryCandidate[], source: RegistryImportSource) => void;
  onClose: () => void;
}) {
  const [accepted, setAccepted] = useState<AcceptedSource>();
  const [sourceError, setSourceError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  /** Discards any result that is still in flight, for example when the dialog closes. */
  const invalidate = useCallback(() => {
    requestRef.current += 1;
  }, []);

  /**
   * Starts one source attempt. The request id is taken before any await, and the previous review is
   * cleared immediately, so a slow read cannot leave an older result committable.
   */
  const beginRequest = useCallback(() => {
    invalidate();
    const request = requestRef.current;
    setAccepted(undefined);
    setSelected(new Set());
    setSourceError("");
    return request;
  }, [invalidate]);

  /** Applies an outcome only when it belongs to the newest request. */
  const applyOutcome = useCallback((request: number, outcome: AcceptanceOutcome) => {
    if (request !== requestRef.current) return;
    if (outcome.kind === "error") {
      setAccepted(undefined);
      setSelected(new Set());
      setSourceError(outcome.message);
      return;
    }
    setSourceError("");
    setAccepted(outcome.accepted);
    setSelected(new Set(outcome.selected));
  }, []);

  const readFile = async (file: File) => {
    const request = beginRequest();
    if (!file.name.toLowerCase().endsWith(".reg")) {
      applyOutcome(request, { kind: "error", message: "Choose a .reg file." });
      return;
    }
    try {
      const content = await readRegistryTextFile(file, MAX_REG_BYTES);
      applyOutcome(request, acceptSourceText(content, { kind: "file", fileName: file.name }));
    } catch (error) {
      applyOutcome(request, {
        kind: "error",
        message: error instanceof Error ? error.message : "The selected file could not be read.",
      });
    }
  };

  const readClipboard = () => {
    const request = beginRequest();
    void readClipboardText()
      .then((text) => applyOutcome(request, acceptSourceText(text, { kind: "clipboard" })))
      .catch((error: unknown) =>
        applyOutcome(request, {
          kind: "error",
          message:
            error instanceof Error ? error.message : "Clipboard access was denied or failed.",
        }),
      );
  };

  useEffect(() => {
    if (accepted) return;
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text") ?? "";
      if (!text) return;
      event.preventDefault();
      const request = beginRequest();
      applyOutcome(request, acceptSourceText(text, { kind: "clipboard" }));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [accepted, applyOutcome, beginRequest]);

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };
  const close = () => {
    invalidate();
    onClose();
  };
  const selectedCandidates =
    accepted?.result.candidates.filter((candidate) => selected.has(candidate.id)) ?? [];
  const hasErrors =
    accepted?.result.diagnostics.some((diagnostic) => diagnostic.severity === "Error") ?? false;

  return (
    <Dialog
      title={copy.title}
      eyebrow={accepted ? copy.reviewEyebrow : copy.sourceEyebrow}
      eyebrowGlyph={<ImportGlyph />}
      size={accepted ? "large" : "medium"}
      initialFocus={accepted ? undefined : '[data-source-primary="true"]'}
      onClose={close}
      footer={
        accepted ? (
          <>
            <button className="wb-button wb-button--ghost" onClick={() => beginRequest()}>
              {copy.replace}
            </button>
            <button
              className="wb-button wb-button--primary"
              disabled={selectedCandidates.length === 0}
              onClick={() => onImport(selectedCandidates, toImportSource(accepted.source))}
            >
              Import {itemLabel(selectedCandidates.length)}
            </button>
          </>
        ) : (
          <button className="wb-button wb-button--ghost" onClick={close}>
            {copy.cancel}
          </button>
        )
      }
    >
      {!accepted ? (
        <div className="wb-import-source">
          <div className="wb-local-notice">
            <span aria-hidden="true">●</span> Processed locally in this browser. Registry data is
            never uploaded.
          </div>
          <div
            className="wb-source-well"
            data-active={dragActive}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setDragActive(false);
            }}
            onDrop={drop}
          >
            <h3>{copy.addSource}</h3>
            <p>{copy.sourceHelp}</p>
            <div className="wb-source-well__actions">
              <button
                className="wb-button wb-button--ghost"
                type="button"
                data-source-primary="true"
                onClick={() => fileRef.current?.click()}
              >
                {copy.chooseFile}
              </button>
              <button className="wb-button wb-button--ghost" type="button" onClick={readClipboard}>
                {copy.pasteClipboard}
              </button>
            </div>
            <span className="wb-source-well__hint">{pasteHint()}</span>
            <input
              ref={fileRef}
              className="wb-visually-hidden"
              type="file"
              accept=".reg"
              aria-label={copy.chooseFileLabel}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = "";
              }}
            />
          </div>
          {sourceError && (
            <p className="wb-field__error" role="alert">
              {sourceError}
            </p>
          )}
        </div>
      ) : (
        <div className="wb-import-review">
          <div className="wb-review-summary">
            <div>
              <span>Source</span>
              <strong>{sourceLabelOf(accepted.source)}</strong>
            </div>
            <div>
              <strong>{itemLabel(accepted.result.candidates.length)}</strong>
              <span>parsed</span>
            </div>
            <div>
              <strong>
                {diagnosticLabel(
                  accepted.result.diagnostics.filter((item) => item.severity === "Warning").length,
                  "warning",
                )}
              </strong>
            </div>
            <div>
              <strong>
                {diagnosticLabel(
                  accepted.result.diagnostics.filter((item) => item.severity === "Error").length,
                  "error",
                )}
              </strong>
            </div>
          </div>
          {accepted.result.diagnostics.length > 0 && (
            <div className="wb-diagnostics" aria-label="Import diagnostics">
              {accepted.result.diagnostics.map((diagnostic, index) => (
                <article
                  key={`${diagnostic.line}-${index}`}
                  data-tone={diagnostic.severity.toLowerCase()}
                >
                  <strong>
                    {diagnostic.severity} · Line {diagnostic.line}
                  </strong>
                  <p>
                    {diagnostic.reason}
                    {diagnostic.correction ? ` ${diagnostic.correction}` : ""}
                  </p>
                  <code>{diagnostic.source}</code>
                </article>
              ))}
            </div>
          )}
          {accepted.result.candidates.length > 0 && hasErrors ? (
            <p className="wb-import-review__note">{copy.partialHelp}</p>
          ) : accepted.result.candidates.length === 0 ? (
            <p className="wb-import-review__note">{copy.noParsedItems}</p>
          ) : null}
          <div className="wb-import-cards" aria-label="Parsed Registry Items">
            {accepted.result.candidates.map((candidate) => {
              const registry = candidate.registry;
              const pathName = registry.keyPath.split("\\").at(-1) || registry.keyPath;
              const name =
                registry.desiredState === "Absent" && registry.deletionMode === "KeyRecursive"
                  ? pathName
                  : registry.valueName || "Default value";
              return (
                <label
                  key={candidate.id}
                  className="wb-import-card"
                  data-selected={selected.has(candidate.id)}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${name}`}
                    checked={selected.has(candidate.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        return next;
                      })
                    }
                  />
                  <div className="wb-import-card__title">
                    <strong>{name}</strong>
                    <span>{importAction(candidate)}</span>
                  </div>
                  <div className="wb-import-card__target">
                    <span>{registry.hive}</span>
                    <code>{registry.keyPath}</code>
                  </div>
                  <dl>
                    <div>
                      <dt>Action</dt>
                      <dd>{importAction(candidate)}</dd>
                    </div>
                    <div>
                      <dt>View</dt>
                      <dd>{registry.view}</dd>
                    </div>
                    {registry.desiredState === "Present" && (
                      <>
                        <div>
                          <dt>Type</dt>
                          <dd>{registry.value.type}</dd>
                        </div>
                        <div>
                          <dt>Value</dt>
                          <dd>{displayValue(registry.value) || "Empty value"}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
