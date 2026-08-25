import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { contextualHelp, type ContextualHelpKey } from "./contextualHelp";
import { englishUi } from "../localization/locale";

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  eyebrow,
  size = "medium",
  variant = "standard",
  initialFocus,
  children,
  footer,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  size?: "small" | "medium" | "large" | "review" | "notice";
  variant?: "standard" | "quiet";
  initialFocus?: string | undefined;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const applicationRoot = document.querySelector<HTMLElement>(".wb-app");
    const previousAriaHidden = applicationRoot?.getAttribute("aria-hidden");
    const previousInert = applicationRoot?.inert ?? false;
    if (applicationRoot) {
      applicationRoot.inert = true;
      applicationRoot.setAttribute("aria-hidden", "true");
    }
    const preferred = initialFocus
      ? panelRef.current?.querySelector<HTMLElement>(initialFocus)
      : undefined;
    const first = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
    window.setTimeout(() => (preferred ?? first)?.focus(), 0);
    return () => {
      if (applicationRoot) {
        applicationRoot.inert = previousInert;
        if (previousAriaHidden == null) applicationRoot.removeAttribute("aria-hidden");
        else applicationRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      window.setTimeout(() => returnFocusRef.current?.focus(), 0);
    };
  }, [initialFocus]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
    ];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={"wb-dialog-layer" + (variant === "quiet" ? " wb-dialog-layer--quiet" : "")}
      role="presentation"
      onMouseDown={(event) => {
        if (variant === "standard" && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`wb-dialog wb-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <header className="wb-dialog__header">
          <div>
            {eyebrow && <span className="wb-eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          {variant === "standard" && (
            <button className="wb-icon-button" aria-label={"Close " + title} onClick={onClose}>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </header>
        <div className="wb-dialog__body">{children}</div>
        {footer && <footer className="wb-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

function clampedPosition(anchor: DOMRect, width: number, height: number) {
  const gap = 10;
  const viewportGap = 12;
  const left = Math.min(
    window.innerWidth - width - viewportGap,
    Math.max(viewportGap, anchor.right - width),
  );
  const roomBelow = window.innerHeight - anchor.bottom;
  const top =
    roomBelow >= height + gap
      ? anchor.bottom + gap
      : Math.max(viewportGap, anchor.top - height - gap);
  return { left, top };
}

function helpPopoverSize() {
  return {
    width: Math.min(336, Math.max(0, window.innerWidth - 24)),
    height: Math.min(360, Math.max(0, window.innerHeight - 24)),
  };
}

export function HelpTip({ helpKey }: { helpKey: ContextualHelpKey }) {
  const content = contextualHelp[helpKey];
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const titleId = useId();

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const size = helpPopoverSize();
    setPosition(clampedPosition(anchor, size.width, size.height));
    window.setTimeout(
      () => panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus(),
      0,
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!buttonRef.current) return;
      const size = helpPopoverSize();
      setPosition(
        clampedPosition(buttonRef.current.getBoundingClientRect(), size.width, size.height),
      );
    };
    const close = (event: globalThis.KeyboardEvent | MouseEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        (panelRef.current?.contains(event.target as Node) ||
          buttonRef.current?.contains(event.target as Node))
      ) {
        return;
      }
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="wb-help-button"
        aria-label={`${englishUi.help.prefix} ${content.title}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="wb-help-popover"
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            style={position}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            <div className="wb-help-popover__topline">
              <strong id={titleId}>{content.title}</strong>
              <button
                type="button"
                aria-label={`${englishUi.help.closePrefix} ${content.title} ${englishUi.help.closeSuffix}`}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                ×
              </button>
            </div>
            <p>{content.summary}</p>
            <dl>
              {content.details.map((detail) => (
                <div key={detail.term}>
                  <dt>{detail.term}</dt>
                  <dd>{detail.description}</dd>
                </div>
              ))}
            </dl>
            {content.example && <code>{content.example}</code>}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface MenuAction {
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
}

export function ActionMenu({
  label,
  open,
  actions,
  onOpenChange,
}: {
  label: string;
  open: boolean;
  actions: readonly MenuAction[];
  onOpenChange: (open: boolean) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<"first" | "last">("first");
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const updatePosition = () =>
      setPosition(
        clampedPosition(buttonRef.current!.getBoundingClientRect(), 210, actions.length * 40 + 16),
      );
    updatePosition();
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ].filter((item) => !item.disabled);
    (initialFocusRef.current === "last" ? items.at(-1) : items[0])?.focus();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [actions.length, open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.KeyboardEvent | MouseEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        (menuRef.current?.contains(event.target as Node) ||
          buttonRef.current?.contains(event.target as Node))
      ) {
        return;
      }
      onOpenChange(false);
      if (event instanceof globalThis.KeyboardEvent) buttonRef.current?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("mousedown", close);
    };
  }, [onOpenChange, open]);

  return (
    <>
      <button
        ref={buttonRef}
        className="wb-icon-button wb-icon-button--menu"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          event.stopPropagation();
          initialFocusRef.current = "first";
          onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
          onOpenChange(true);
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="wb-action-menu"
            role="menu"
            aria-label={label}
            style={position}
            onKeyDown={(event) => {
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
              ].filter((item) => !item.disabled);
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              let next: number | undefined;
              if (event.key === "ArrowDown") next = (current + 1) % items.length;
              else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = items.length - 1;
              else if (event.key === "Tab") onOpenChange(false);
              if (next === undefined || items.length === 0) return;
              event.preventDefault();
              items[next]?.focus();
            }}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                role="menuitem"
                disabled={action.disabled}
                data-tone={action.tone}
                onClick={() => {
                  onOpenChange(false);
                  buttonRef.current?.focus();
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
