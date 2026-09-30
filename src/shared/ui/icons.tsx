/**
 * The interface draws its icons inline. The product ships no icon dependency, every glyph inherits the
 * current colour, and all of them are decorative: the control around them carries the accessible name.
 */
const glyph = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
} as const;

interface GlyphProps {
  className?: string;
}

function glyphClassName(className: string | undefined): string {
  return className === undefined ? "wb-glyph" : "wb-glyph " + className;
}

/** A deployment package: the closed box the package definition ships in. */
export function PackageGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

/** What the package produces and how it is enforced: the delivery method. */
export function MethodGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Where the generated scripts run: the run context. */
export function ContextGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <path d="M6 7h.01M6 17h.01" />
    </svg>
  );
}

/** The Registry Items the package carries. */
export function ItemListGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** Renaming the package in place. */
export function PencilGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

/** The affordance of a menu that shows its current value. */
export function ChevronGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A hint that explains the empty surface without looking like an error. */
export function InfoGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/**
 * Bringing an existing Registry file in. The arrow points into the surface on purpose: this product
 * keeps its data in the browser, so an upward arrow would read like data leaving it.
 */
export function ImportGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M12 4v12m-5-5 5 5 5-5M5 20h14" />
    </svg>
  );
}

/** Creating the next thing: a package, a template, or the first item. */
export function PlusGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** The list of everything, ahead of the packages in the navigator. */
export function GridGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** Finding a package or a Registry target. */
export function SearchGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Dismissing an overlay or a notice. */
export function CloseGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** The administrative-template path, next to the package path in the navigator. */
export function TemplateGlyph({ className }: GlyphProps) {
  return (
    <svg {...glyph} className={glyphClassName(className)}>
      <path d="M5 8h14M5 16h14" />
      <circle cx="10" cy="8" r="2.2" />
      <circle cx="15" cy="16" r="2.2" />
    </svg>
  );
}
