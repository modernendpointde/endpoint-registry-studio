import { useEffect, useRef, useState, type DragEvent } from "react";

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
import type { RegistryImportSource } from "./registryImport";

interface PreviewState {
  result: RegParseResult;
  sourceLabel: string;
}

type SourceState =
  | { kind: "file"; fileName: string; bytes: number; text: string }
  | { kind: "clipboard"; lines: number; text: string };

const copy = englishUi.registryImport;
const itemLabel = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
const diagnosticLabel = (count: number, word: "warning" | "error") =>
  `${count} ${count === 1 ? word : `${word}s`}`;
const lineLabel = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`;
}

function clipboardLineCount(text: string): number {
  return text.replace(/\n$/, "").split(/\r\n|\r|\n/).length;
}

function toImportSource(source: SourceState): RegistryImportSource {
  return source.kind === "file"
    ? { kind: "file", fileName: source.fileName }
    : { kind: "clipboard" };
}

export function RegistryImportDialog({
  onImport,
  onClose,
}: {
  onImport: (candidates: ParsedRegistryCandidate[], source: RegistryImportSource) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<SourceState>();
  const [sourceError, setSourceError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<PreviewState>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const readRequest = useRef(0);

  const acceptText = (text: string, next: SourceState) => {
    if (new TextEncoder().encode(text).length > MAX_REG_BYTES) {
      setSource(undefined);
      setSourceError(`Registry text exceeds the ${MAX_REG_BYTES / 1024 / 1024} MB limit.`);
      return;
    }
    setSourceError("");
    setSource(next);
  };

  const acceptClipboard = (text: string) => {
    if (!text.trim()) {
      setSource(undefined);
      setSourceError(copy.emptyClipboard);
      return;
    }
    acceptText(text, { kind: "clipboard", lines: clipboardLineCount(text), text });
  };

  const readFile = async (file: File) => {
    const request = ++readRequest.current;
    if (!file.name.toLowerCase().endsWith(".reg")) {
      setSource(undefined);
      setSourceError("Choose a .reg file.");
      return;
    }
    setSourceError("");
    try {
      const content = await readRegistryTextFile(file, MAX_REG_BYTES);
      if (request !== readRequest.current) return;
      acceptText(content, { kind: "file", fileName: file.name, bytes: file.size, text: content });
    } catch (error) {
      if (request !== readRequest.current) return;
      setSource(undefined);
      setSourceError(
        error instanceof Error ? error.message : "The selected file could not be read.",
      );
    }
  };

  useEffect(() => {
    if (preview) return;
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text") ?? "";
      if (!text) return;
      event.preventDefault();
      if (!text.trim()) {
        setSource(undefined);
        setSourceError(copy.emptyClipboard);
        return;
      }
      if (new TextEncoder().encode(text).length > MAX_REG_BYTES) {
        setSource(undefined);
        setSourceError(`Registry text exceeds the ${MAX_REG_BYTES / 1024 / 1024} MB limit.`);
        return;
      }
      setSourceError("");
      setSource({ kind: "clipboard", lines: clipboardLineCount(text), text });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [preview]);

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };
  const parse = () => {
    if (!source) return;
    const result = parseReg(source.text);
    setPreview({
      result,
      sourceLabel: source.kind === "file" ? source.fileName : copy.clipboardSource,
    });
    setSelected(new Set(result.candidates.map((candidate) => candidate.id)));
  };
  const selectedCandidates =
    preview?.result.candidates.filter((candidate) => selected.has(candidate.id)) ?? [];
  const hasErrors =
    preview?.result.diagnostics.some((diagnostic) => diagnostic.severity === "Error") ?? false;

  return (
    <Dialog
      title={copy.title}
      eyebrow={preview ? copy.reviewEyebrow : copy.sourceEyebrow}
      size={preview ? "large" : "medium"}
      initialFocus={preview ? undefined : '[data-source-primary="true"]'}
      onClose={onClose}
      footer={
        preview ? (
          <>
            <button className="wb-button wb-button--ghost" onClick={() => setPreview(undefined)}>
              Back
            </button>
            <button
              className="wb-button wb-button--primary"
              disabled={selectedCandidates.length === 0}
              onClick={() => source && onImport(selectedCandidates, toImportSource(source))}
            >
              Import {itemLabel(selectedCandidates.length)}
            </button>
          </>
        ) : (
          <>
            <button className="wb-button wb-button--ghost" onClick={onClose}>
              {copy.cancel}
            </button>
            <button className="wb-button wb-button--primary" disabled={!source} onClick={parse}>
              {copy.reviewItems}
            </button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="wb-import-source">
          <div className="wb-local-notice">
            <span aria-hidden="true">●</span> Processed locally in this browser. Registry data is
            never uploaded.
          </div>
          <div
            className="wb-source-well"
            data-active={dragActive}
            data-kind={source ? "ready" : "empty"}
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
            {source ? (
              <>
                <div className="wb-source-glyph" aria-hidden="true">
                  REG
                </div>
                <div className="wb-source-well__meta">
                  <strong>{source.kind === "file" ? source.fileName : copy.clipboardSource}</strong>
                  <span>
                    {source.kind === "file"
                      ? `${copy.fileKind} · ${formatBytes(source.bytes)} · ${copy.readyToParse}`
                      : `${lineLabel(source.lines)} · ${copy.readyToParse}`}
                  </span>
                </div>
                <button
                  className="wb-button wb-button--quiet"
                  type="button"
                  onClick={() => {
                    setSource(undefined);
                    setSourceError("");
                  }}
                >
                  {copy.replace}
                </button>
              </>
            ) : (
              <>
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
                  <button
                    className="wb-button wb-button--ghost"
                    type="button"
                    onClick={() => {
                      void readClipboardText()
                        .then(acceptClipboard)
                        .catch((error: unknown) => {
                          setSource(undefined);
                          setSourceError(
                            error instanceof Error
                              ? error.message
                              : "Clipboard access was denied or failed.",
                          );
                        });
                    }}
                  >
                    {copy.pasteClipboard}
                  </button>
                </div>
                <span className="wb-source-well__hint">{pasteHint()}</span>
              </>
            )}
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
              <strong>{preview.sourceLabel}</strong>
            </div>
            <div>
              <strong>{itemLabel(preview.result.candidates.length)}</strong>
              <span>parsed</span>
            </div>
            <div>
              <strong>
                {diagnosticLabel(
                  preview.result.diagnostics.filter((item) => item.severity === "Warning").length,
                  "warning",
                )}
              </strong>
            </div>
            <div>
              <strong>
                {diagnosticLabel(
                  preview.result.diagnostics.filter((item) => item.severity === "Error").length,
                  "error",
                )}
              </strong>
            </div>
          </div>
          {preview.result.diagnostics.length > 0 && (
            <div className="wb-diagnostics" aria-label="Import diagnostics">
              {preview.result.diagnostics.map((diagnostic, index) => (
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
          {preview.result.candidates.length > 0 && hasErrors ? (
            <p className="wb-import-review__note">{copy.partialHelp}</p>
          ) : preview.result.candidates.length === 0 ? (
            <p className="wb-import-review__note">{copy.noParsedItems}</p>
          ) : null}
          <div className="wb-import-cards" aria-label="Parsed Registry Items">
            {preview.result.candidates.map((candidate) => {
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
