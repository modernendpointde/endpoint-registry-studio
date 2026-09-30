import { useLayoutEffect, useRef } from "react";

import { englishUi } from "../localization/locale";
import type { ConfirmRequest } from "./confirm";
import { InfoGlyph } from "./icons";
import { Dialog } from "./Overlays";

/**
 * The single designed confirmation of the app: the same dialog mechanics as every other overlay, one
 * question, two explicit answers and a danger tone for an irreversible one.
 */
export function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest;
  onResolve: (accepted: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);

  /**
   * A confirmation is answered from inside the dialog the reader is already in: a discard while an
   * editor is open, a download out of the review. Only one dialog may be active, so the confirmation
   * suspends every other open layer for as long as it is shown and restores it when it closes.
   */
  useLayoutEffect(() => {
    const own = layerRef.current;
    const suspended = [...document.querySelectorAll<HTMLElement>(".wb-dialog-layer")]
      .filter((layer) => layer !== own)
      .map((layer) => ({
        layer,
        hidden: layer.hidden,
        inert: layer.hasAttribute("inert"),
        ariaHidden: layer.getAttribute("aria-hidden"),
      }));
    for (const entry of suspended) {
      entry.layer.hidden = true;
      entry.layer.setAttribute("inert", "");
      entry.layer.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const entry of suspended) {
        entry.layer.hidden = entry.hidden;
        if (entry.inert) entry.layer.setAttribute("inert", "");
        else entry.layer.removeAttribute("inert");
        if (entry.ariaHidden === null) entry.layer.removeAttribute("aria-hidden");
        else entry.layer.setAttribute("aria-hidden", entry.ariaHidden);
      }
    };
  }, []);

  const danger = request.tone === "danger";
  return (
    <Dialog
      role="alertdialog"
      size="small"
      layerRef={layerRef}
      title={request.title}
      eyebrow={englishUi.common.confirm.eyebrow}
      eyebrowGlyph={<InfoGlyph />}
      eyebrowTone={danger ? "danger" : "neutral"}
      /** The cancelling answer takes the focus, so an accidental Enter never destroys anything. */
      initialFocus=".wb-confirm__cancel"
      onClose={() => onResolve(false)}
      footer={
        <>
          <button
            type="button"
            className="wb-button wb-button--ghost wb-confirm__cancel"
            data-answer="cancel"
            onClick={() => onResolve(false)}
          >
            {request.cancelLabel ?? englishUi.common.confirm.cancel}
          </button>
          <button
            type="button"
            className={`wb-button wb-confirm__accept wb-button--${danger ? "danger" : "primary"}`}
            data-answer="accept"
            onClick={() => onResolve(true)}
          >
            {request.confirmLabel}
          </button>
        </>
      }
    >
      <p className="wb-confirm__message" data-tone={danger ? "danger" : "neutral"}>
        {request.message}
      </p>
    </Dialog>
  );
}
