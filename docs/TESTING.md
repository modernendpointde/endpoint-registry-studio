# Testing

## Coverage

The test suite covers:

- Registry models, exact type/value semantics, effective views, deletion, Revert, fingerprints, and SYSTEM + HKCU targeting.
- Current schema-8 Workspace/package parsing, administrative-template persistence, round trips, ID collisions, and unsupported-version rejection.
- `.reg` parsing, supported encodings and types, partial imports, diagnostics, and file-size limits, including the fixture-backed hive-prefix cases: every supported spelling, a subkey literally named `HKLM`, unsupported hives, and relative headers.
- Package validation and deterministic PowerShell, CSV, documentation, manifest, and ZIP generation.
- Read-only Detect/DryRun roles, idempotent mutation roles, exact CLR values, Unicode, profile targeting, and script inventories.
- Workspace operations, imports, downloads, runtime configuration, dialogs, focus, keyboard behavior, accessibility, and responsive layouts.
- The application's own confirmation: the question, the consequence and both explicit answers, the danger tone on an irreversible one, the focus on the declining answer, Escape and the backdrop as cancel, the decision the reader chose, the queued order of two questions asked at once, and that the dialog a question is asked out of is suspended while it is shown and restored with its content afterwards. A component guard asserts that a destructive flow opens that dialog and never calls the native prompt, and a browser test proves the same on the running build with a listener that fails on any native dialog.
- Storage-free web and persistent Docker lifecycle boundaries.
- Administrative-template eligibility, snapshot isolation, schema-safe draft CRUD, explicit metadata authoring, unload protection, compiler-gated preview/download, and rejected-item diagnostics including all-rejected inputs.
- Administrative-template duplicate Registry targets, including case-insensitive matches and the negative cases that must stay compilable, plus the locally detected overlap between template policies and enabled Deployment Package items, including recursive deletion scopes.
- Administrative-template navigation as a main-content view: the active navigator state, each of the three empty states and the action they offer, and unsaved authoring surviving a switch to the package list and back.
- Administrative-template source relationships: the package entry point preselecting only enabled items, the templates listed for a package, the source status for a policy, and adopting a changed source while keeping choices that still apply.
- The in-application guide: every topic is listed and reachable, the way back to work and to About, and that its examples use the product's own fictional vendor rather than a Microsoft placeholder.
- The permanent Registry Item form in the package detail: the four primary fields for every Registry type, the summary line that names the desired state and every setting that is not at its default, red validation that is delayed until interaction or a commit, `Details…` editing the same draft without committing it, the series continuation after a commit, and the form at 390 px together with an axe check.
- The package-scoped Registry Item draft: raw text that survives a surface change, a package switch, and the details dialog; the guards that run when the document is replaced or reset, when a package is replaced under the same identifier, when a package is deleted, and when the page unloads; an untouched series draft that is not unsaved work; `Discard draft` with its confirmation; and that the draft never reaches the package, the fingerprint, or the export.
- The commit rules of the form: the item rules and the conflicts the candidate would cause beside the items already in the package, an unsupported path prefix that stays an error instead of falling back to the stored path, and one Enter that commits exactly once.
- The authoring budget guard: the seven sequence variants — A, D, B, and C, with a keyboard variant for A, B, and C that has to reach the same end state — and the two creation budgets, each asserting an exact activation count, plus the composing, repeated, toggle, and multi-line Enter exceptions.
- The package surface layout against a viewport matrix: 1024 x 768, 1152 x 720, 1280 x 720, 1366 x 768, 1440 x 900, 1600 x 900, 1920 x 1080, 2560 x 1440, 3440 x 1440, the height edge at 1280 x 699 and 1280 x 700, the flat windows 1024 x 600, 1093 x 614, 910 x 512 and 1920 x 512, a tall 1024 x 1440, both sides of the 720, 960 and 1180 px breakpoints, and the stacked 380 x 844. Each case asserts no horizontal document overflow, a usable form, a wrapping tool row, the list behaviour of its width, and the field labels of the stacked list.
- The layout contract itself: a form of at most 260 px, a header of at most 155 px, the first item row at most at y = 620 and completely inside the visible area from 1280 x 700 upward, one shared inner edge across header, form, tool row and list on every display, a surface that fills its view from 1024 to 3840 px with the list stacked below the form, a search and filter group that stays on one line at 1280, 1366 and 1920 px, and the same contract with a configured footer.
- The Registry Items title/count, inline composer, toolbar, and item list inhabit one card; the unnumbered sections of the Registry Item dialog share one field edge with its Advanced controls.
- The measurement rules of that suite: geometry must exist (a missing box fails the test instead of passing a bound), every scroll container is reset before measuring and confirmed to be at zero, the visible area accounts for the scrolling pane and a fixed footer, and every measured value has to hold across two render frames.
- The interactions every matrix viewport has to allow: opening and closing the details dialog with the focus returned to the form, searching, filtering, sorting, reaching the last column and the item actions through the list container, and the import entry remaining enabled. The flow of the import itself stays covered by the budget guard.
- The pressure states at 380 x 844, 721 x 900, 1024 x 600, 1280 x 700 and 3440 x 1440: an empty package with its hint and one import above the form, long unbroken names, paths and values inside their cells, a template-eligible item with its conditional action, a warning item, and a multi-line value.
- Keyboard navigation at 380 x 844, 910 x 512, 1024 x 600 and 1280 x 700: every focused control stays inside the visible area, and one Tab from a focused item row reaches the item actions inside the list viewport.
- A screenshot of the package surface at 380 x 844, 1024 x 600, 1280 x 700, 1440 x 900 and 3440 x 1440 for both artifacts, with an assertion that a real image was written.

Not carried by this suite: native browser zoom and real Windows display scaling. Browser zoom cannot be set through Playwright, and no Windows test environment is available; both are covered by the manual test plan and are never reported as passed. The matrix proves CSS reflow in Chromium only.

- Immediate package creation from both entry points, including the one activation it costs, the suggested name, and that every further suggestion stays distinguishable.
- The editable package name in the header: it takes effect while it is typed, an emptied field keeps its buffer and the package reports the missing name until it is filled in again, and Enter there never commits a Registry Item.

## Local checks

Install dependencies with Node.js 22 or newer:

```bash
npm ci
```

Run the required validation checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run docs:check
```

Run one Vitest file with:

```bash
npm run test -- path/to/file.test.ts
```

The unit run also guards the interface tokens: a test reads `src/styles/*.css` and fails when a corner radius is neither one of the six `--wb-radius-*` steps nor `50%` or `0`, and when a defined step is unused.

## Browser suites

Install Chromium once:

```bash
npx playwright install chromium
```

Each browser command builds its matching artifact before running:

```bash
npm run test:browser:web
npm run test:browser:docker
```

The web suite verifies the production bundle, root and nested hosting, core import/review/download flows, Registry Item table overflow, accessibility, console errors, and zero calls to persistent storage APIs. It also proves that the notice appears below the measured shell header and below the active view heading in package detail, Administrative Templates and Guide at wide and narrow widths. A second test measures the small text roles - table header, package id, state badge, explanation of the form card, counter, item status, Registry hive pill, hint of an empty package, and the navigator's label, section names, active entry detail and footer note on the navigator band; it waits until every running transition has finished, because a colour caught mid-transition is reported in an interpolation space the parser cannot read - in the light and the dark theme and fails whenever a role drops below 4.5:1. Further tests measure template candidate, editor, conflict and preview text (and require a template with authoring issues to show its header state in the warning tone). The small text test also measures the light success notice, the red eyebrow of a destructive confirmation, and the label, state chip, fingerprint, file detail and preview mode switch of the review's file navigation and Guide text in both themes against that target. A layout test holds the surface roles together: the form has to sit on the solid card surface, the item list header must add no second band above the table, and the tool row has to keep the band. Another layout test measures the selects and search fields of the tool row and the overview filter, and the single-line fields of the form, against the button beside them: font size and height have to match, so a control can no longer inherit the larger body text. A type test walks the visible text of the package detail, the item dialog, the review and the overview and fails on any text below 12 px. Layout tests also require every column label of the Registry Item list to fit its column at 1280 and 1920 px and the Workspace name to keep its full width at 380 px, and a runtime test requires Cancel to appear in the ghost colour immediately after a template step changes. The small text test measures the invalid form summary as well. A spacing test requires at least 6 px between the underline of the package name and the settings pills at 1280, 1920 and 380 px. A focus test requires the package name to move its 3 px ring from the borderless field to the heading around it, with rounded corners. The package header itself is checked for the muted suggested name, the pill row with the longest delivery method, the two column arrangement from 1280 px upward and its height budget. A shell test requires the navigator to run flush from the top bar to the bottom edge at 1280 x 700 and 1920 x 1080 with its foot note inside it, and to span the full width below the top bar at 960 px; a form test requires the four Registry Item fields to share one row with their controls on one line at 1920 px. The Docker suite verifies restore, autosave, reload, and stored-copy deletion.

### Viewport matrix

| Viewport   | Primary check                                                                       |
| ---------- | ----------------------------------------------------------------------------------- |
| 1280 × 800 | Desktop application shell, content-pane scrolling, and Registry Item table overflow |
| 960 × 668  | Laptop layout and natural document scrolling                                        |
| 720 × 800  | Compact footer and responsive content                                               |
| 390 × 844  | Narrow dialogs, help, focus, and overlays                                           |

## Container checks

```bash
docker build -t endpoint-registry-studio .
docker compose config
sh docker/smoke-test.sh endpoint-registry-studio
```

The smoke test verifies container health, security/cache headers for HTML, `config.json`, license/notice files, and hashed assets, plus the expected project and React license text.

## Manual validation

The pass that no suite can replace — Registry Items, the generated PowerShell on Windows, the surface on real screens, and the data safety guards — is written down in [Manual test plan](MANUAL_TEST_PLAN.md).

## Manual Windows validation

Generated PowerShell cannot run in the browser test environment. Before release or production rollout, test representative packages on a non-production Windows device in the intended context and architecture. Confirm read-only detection, idempotent mutation, exact Registry types and views, deletion scope, HKCU profile targeting, Default User handling, and supported Win32 Revert behavior.
