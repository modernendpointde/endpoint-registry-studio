# Architecture

## System boundary

Endpoint Registry Studio is a static React and TypeScript single-page application. Parsing, validation, state management, PowerShell generation, and archive creation run in the browser. There is no application server, account service, database, telemetry, or runtime API.

Imported files are read locally. Downloads are created with Blob URLs after user action.

## Build variants

Two composition roots share the same Workbench and domain logic:

| Build              | Entry point                 | Workspace lifecycle                                             |
| ------------------ | --------------------------- | --------------------------------------------------------------- |
| Storage-free web   | `src/entry/main.web.tsx`    | Starts empty, keeps state in memory, exports through a download |
| Self-hosted/Docker | `src/entry/main.docker.tsx` | Restores, autosaves, and clears origin-private browser storage  |

The persistent lifecycle uses OPFS with IndexedDB fallback and can use a user-selected Workspace file where the browser supports it. Persistent modules are excluded from `dist-web/`; import-graph, bundle, manifest, and browser checks enforce that boundary.

## Module boundaries

| Area                           | Responsibility                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `domain`                       | Registry models, path normalisation, effective behavior, validation, IDs, cloning, and fingerprints           |
| `serialization`                | Current Workspace/package JSON and `.reg` parsing                                                             |
| `generators`                   | PowerShell, package files, CSV, documentation, manifests, and ZIP output                                      |
| `application`                  | Workspace/package/template use cases, selectors, build gates, runtime configuration, and lifecycle interfaces |
| `platform`                     | Bounded file access, Clipboard, downloads, and browser persistence adapters                                   |
| `features`, `shared`, `styles` | React surfaces, reusable UI, copy, and presentation                                                           |

Domain, serialization, and generator modules do not depend on React. React coordinates committed state and dialogs but does not define authoritative parsing, validation, schema, or generation rules.

The item editor keeps its rules in `src/features/registry-items/itemEditorState.ts`, a plain module that owns path resolution, the candidate, the issue list, the delayed field feedback, the collapsed summary, the Enter rule, and the dirty check. Both authoring surfaces consume it and only wire state to their markup: `RegistryItemComposer.tsx`, the permanent form in the package detail, and `RegistryItemDialog.tsx`, which edits an item, duplicates it, or edits the draft of the form as `Details…`. Their shared field controls live in `itemFieldControls.tsx` and the shared feedback wiring in `itemFieldFeedback.tsx`. Committing an item runs through one routine in `WorkbenchCore` that takes the package and the mode explicitly, so a surface without an editor overlay commits the same way.

The Registry Item draft is session state of `WorkbenchCore`, one per package, described by `itemDraftState.ts`: the item plus the raw text buffers of the path, the value, and the revert value. It is never part of the Workspace document, the export, the fingerprint, or the persistent autosave; it only feeds the guards for document replacement, package deletion, and unloading, and a draft that still equals its series state is not unsaved work.

## Data model and flow

Schema 8 uses `RegistryWorkspace.packages[] → DeploymentPackage.items[]` plus `RegistryWorkspace.administrativeTemplates[]`.

1. Selected files are size-checked and decoded before parsing. Registry input accepts validated UTF-8 or BOM-marked UTF-16LE; Workspace/package JSON requires UTF-8.
2. `.reg` parsing produces reviewable candidates and diagnostics. Candidates become Registry Items only after selection.
3. Workspace and package files pass strict schema validation before state changes. The current version and the previous published version are accepted; an older accepted document is lifted to the current version in memory, and its newly introduced fields are filled with documented defaults. Every other version is rejected.
4. Editor drafts remain separate from committed state. Saving validates and commits atomically.
5. Package validation derives readiness from package settings and enabled items. Incomplete or invalid packages cannot be downloaded.
6. Each package is generated independently. Selected/all downloads place packages in separate folders and include only the selected Workspace scope.
7. Browser adapters perform Clipboard and download operations. No Registry or Workspace content is uploaded.
8. Administrative-template selection assesses Registry Items in package context. Accepted policies keep frozen Registry snapshots; rejected items remain visible with exact reasons. Drafts persist only in `administrativeTemplates[]`; compiler output is generated for preview/download and is not stored.

The current JSON contract is documented in [Workspace schema](WORKSPACE_SCHEMA.md).

Release and generator metadata intentionally share the package version as one source of truth. Release 1.2.0 therefore uses generator contract 1.2.0 across the UI, serialized files, fingerprints, and generated artifacts; schema versioning remains independent.

## PowerShell boundary

Scripts are generated by role:

- Remediation: `DryRun.ps1`, `Detect.ps1`, and `Remediate.ps1`
- Platform script: `DryRun.ps1` and `Apply.ps1`
- Win32 app source: `Install.ps1`, `Detect.ps1`, and optional `Uninstall.ps1`

Detect and DryRun contain read/comparison logic only. Mutating roles perform direct idempotent set or delete operations. Feature-specific helpers are included only when required.

The package fingerprint is an eight-character deterministic trace identifier over generator version, package execution settings, and ordered enabled-item behavior. It is not a cryptographic signature. See [PowerShell output](POWERSHELL_OUTPUT.md).

## SYSTEM and HKCU

Run context belongs to the package. Each HKCU item in a SYSTEM package selects currently signed-in users or all existing profiles; Default User is optional for the all-existing scope. Generated scripts use loaded hives when available and mount required `NTUSER.DAT` files temporarily. Only hives mounted by the script are unloaded.

Logged-on-user packages use ordinary HKCU. HKLM items do not use profile expansion.

## UI and delivery

The shell is flat: the navigator is a band flush with the left edge that runs from the top bar to the bottom, view headings lie on the page without a card and close with a line, and each view has one work surface with a 1 px border, an 8 px radius and no shadow; the existing SVG product mark stays unchanged. `PackageDetail` places a title/count, optional empty hint, `RegistryItemComposer`, tool row, and item list in one `.wb-registry-workspace` surface, keeping the 155/260/620-px package contract. The Guide puts its existing navigation and bounded reading article in one bordered surface. The Registry Item dialog renders its conditional sections without numeric markers or a reserved left label column; the Advanced field grid uses the same left edge. These changes are presentation only, using the existing tokens and shared dialog controls.

Every view, the overview included, uses the same content inset: 20 px, 16 px below 720 px, and no fixed maximum width: every view uses the width of its canvas, and the Registry Items card always stacks the form above the tool row and the item table. When the form is at least 1400 px wide, its four fields share one row with their controls on one line; below that they use two columns. The template editor and preview keep a form width of 1280 px, and Guide text keeps its line length. Search and the two filters of the tool row form one group that wraps as a whole. The item list keeps its eight columns above 720 px, with fixed widths for the short values, a value column that stops at 360 px once the list is 2150 px wide, and the largest share for the Registry target, and only its own container scrolls sideways; at 720 px and below the same rows stack and show the label of every cell. A browser layout suite measures the surface against a viewport matrix, so the limits are checked on the running build rather than trusted. The Workbench uses a local reducer and mutually exclusive dialogs. A Deployment Package is created by one activation from the navigator or the overview, it exists immediately with a suggested name, and the header of the detail view that opens edits that name in place; Registry Items are authored in the permanent form of that view, and the dialogs it keeps are for editing an item, duplicating it, or changing the depth of the draft. Administrative Templates are a second main-content view selected from the navigator, with their own selector, editor, and review flow; they do not become Deployment Package methods, and the package list stays reachable while a template is authored. Unsaved authoring survives switching between the two views and participates in unload protection. A guide is the third view, opened from the header, with its topics and text bundled into the application so it needs no network access and works from a subdirectory. Draft isolation, focus management, keyboard navigation, responsive layouts, and visible validation are covered by component and browser tests. One corner-radius scale lives as custom properties in `src/styles/tokens.css` - dialogs 20 px, popovers 12 px, controls 10 px, work surfaces and small inner surfaces 8 px, pills 999 px, while circles keep 50% and square edges keep 0 - and a unit test fails on any other value or on a step nothing uses. The shell measures its own chrome into `--wb-notice-top` - the header, which wraps into three rows on narrow windows, and the active view head, including package detail, Administrative Templates, and Guide - so the notice starts below the actions and view heading. From 1280 px upward the package header is a two column grid: the identity keeps the left column, the state card sits above the actions in the right one, and the height is the taller column instead of the sum of four stacked bands. The name is a borderless line with a permanent underline that draws the suggested name muted until the package is renamed, and the two settings are pills. Icons are inline SVG glyphs from `src/shared/ui/icons.tsx`: every one is decorative, inherits `currentColor` and never changes the line box. Three surfaces are told apart by role: the card (`--wb-surface`, `--wb-surface-solid`), the band that carries secondary content such as toolbars, table headers, hints and status cards (`--wb-band`), and the surface the reader edits (`--wb-control-bg` with `--wb-control-border`). The quietest text uses `--wb-quiet`, so a 9 px table label and a faint mark no longer share one grey; status badges carry their own background and text pair per theme. Text follows one scale: `--wb-font-xs` 12 px is the floor for meta text and labels, `--wb-font-sm` 13 px carries secondary text and column labels, `--wb-font-md` 14 px is body text and controls, `--wb-font-lg` 16 px emphasised lines, and only the weights 400, 600 and 700 are used. The font stack names installed system fonts only, starting with Segoe UI Variable for Windows 11 and naming Arial and Liberation Sans before system-ui so Linux does not fall back to the wider DejaVu Sans, and loads no font file. The package header sets the measurements for every other surface: `--wb-control-height` (38 px) is the one height of buttons, selects, search fields, single-line fields and option rows, `--wb-control-font-size` is the size of their labels and values, and `--wb-eyebrow-*`, `--wb-title-*` and `--wb-meta-size` carry the type roles that name a view, state its subject and describe it, so a select or search field never inherits the body font size. One eyebrow rule serves the header, the overview, the guide, the ADMX preview, the navigator and the dialogs, and it takes its colour from `--wb-accent-label`, which each theme defines because a small bold label needs a different tone on a light surface than on a dark one. `Dialog` takes an optional `eyebrowGlyph` and an `eyebrowTone`; the confirmation passes `danger` for an irreversible question, which paints the eyebrow in `--wb-error-text`. No surface paints navy any more: the navigator, the review's file navigation and the notice use the card and band roles, and only the script preview keeps a dark code surface.

Overlays share one mechanism and one look. Every modal renders through `Dialog` in `src/shared/ui/Overlays.tsx`, which owns the portal, the focus trap, the initial focus, Escape, the return of the focus and the inert application root behind it; dialogs differ only in size, eyebrow, title and footer, and the header sits on the plain card surface while the footer sits on the band. A confirmation is a second role of the same mechanism: `ConfirmDialog` in `src/shared/ui/ConfirmDialog.tsx` renders the `alertdialog` a destructive or replacing action asks for, and `useAppConfirm` in `src/shared/ui/confirm.ts` owns the one question at a time, resolves it as `true` only for the confirming answer, and keeps further requests queued so no question ever replaces an unanswered one. Each answer names which side it is in `data-answer`, which the suites use to choose one. The request carries every visible word, the tone and the label of the declining answer, so no confirmation invents copy of its own. Because a confirmation is often asked out of a dialog the reader is already in - a discard while an editor is open, a download out of the review, clearing the stored Workspace from the privacy details - the confirmation suspends every other open dialog layer for as long as it is shown and restores it afterwards; a suspended layer keeps its state, so a cancelled question leaves the editor exactly as it was. The Workspace lifecycle in `src/application/workspaceLifecycle.ts` carries the same decision: `confirmNewWorkspace` resolves asynchronously, both storage adapters and `applyImportedContent` are asynchronous, and a declined question changes neither the Workspace nor the draft. The browser's `beforeunload` prompt is the one platform boundary that stays outside this mechanism.

Vite emits relative asset paths for root or subdirectory hosting. `config.json` is loaded from the application directory and may provide validated branding and footer links. The nginx image serves the persistent build on port 8080.

See [Docker and static hosting](DOCKER_AND_HOSTING.md), [Security](SECURITY.md), and [Testing](TESTING.md).
