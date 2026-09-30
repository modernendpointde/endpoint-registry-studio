import { useCallback, useRef, useState } from "react";

/**
 * The one question the app asks before an action that cannot be taken back or that replaces work.
 * Every visible word belongs to the caller: the request carries the title, the explanation and the
 * label of the confirming action, so a confirmation never invents copy of its own.
 */
export interface ConfirmRequest {
  /** The question itself; it becomes the accessible name of the alert dialog. */
  title: string;
  /** The consequence, including the warning an import or a draft delete has to state. Line breaks stay. */
  message: string;
  /** The label of the confirming action, for example `Delete package`. */
  confirmLabel: string;
  /** The label of the cancelling action; `Cancel` unless the flow has a clearer word. */
  cancelLabel?: string;
  /** `danger` marks an irreversible consequence and recolours the confirming action. */
  tone?: "neutral" | "danger";
}

/** Resolves with the reader's decision: `true` only when the confirming action was chosen. */
export type RequestConfirm = (this: void, request: ConfirmRequest) => Promise<boolean>;

interface PendingConfirm {
  request: ConfirmRequest;
  resolve: (accepted: boolean) => void;
}

/**
 * Owns the single confirmation surface of the app. Requests are answered one after the other, so a
 * second question can never replace an unanswered one and no two dialogs are active at the same time.
 */
export function useAppConfirm(): {
  requestConfirm: RequestConfirm;
  pending: ConfirmRequest | undefined;
  settle: (accepted: boolean) => void;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const queue = useRef<PendingConfirm[]>([]);
  const visible = useRef<PendingConfirm | null>(null);
  visible.current = pending;

  const requestConfirm = useCallback<RequestConfirm>(
    (request) =>
      new Promise<boolean>((resolve) => {
        const entry: PendingConfirm = { request, resolve };
        queue.current.push(entry);
        setPending((current) => current ?? entry);
      }),
    [],
  );

  const settle = useCallback((accepted: boolean) => {
    const entry = visible.current;
    if (entry === null) return;
    queue.current = queue.current.filter((candidate) => candidate !== entry);
    setPending(queue.current[0] ?? null);
    entry.resolve(accepted);
  }, []);

  return { requestConfirm, pending: pending?.request, settle };
}
