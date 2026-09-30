# Manual test plan

The automated suites cover the domain rules, the generators, the schema, the interface behaviour, and the
layout matrix. A few things cannot be checked there, above all whether the generated PowerShell does the
right thing on Windows. This plan lists the manual pass that runs before a release and after a change to
the authoring surface or the layout. Budget roughly 30 to 45 minutes.

## Getting the build

Use the artifact you intend to ship:

- A preview container image: `docker pull ghcr.io/modernendpointde/endpoint-registry-studio:<tag>` and
  `docker run --rm -p 8080:8080 <image>`. Public packages can be pulled anonymously; if the package is
  private, the pull needs a token with `read:packages`.
- The release archives: the storage-free web build or the self-hosted build from the release page.
- A local development build: `npm run dev` for quick checks, or `npm run build` plus
  `PORT=4173 DIST_DIR=dist-web node scripts/serve-production.mjs` for the produced artifact.

Note the build tag, the operating system, the browser, the window size, and the browser zoom for every
check below. A finding without that context cannot be reproduced.

## Already covered by the suites

Do not repeat these by hand: the six Registry types in parsing, validation, and generation; the schema
round trip and the previous schema version; deterministic PowerShell, CSV, ZIP, and archive content; the
import diagnostics; the keyboard and focus behaviour of the dialogs; the click budgets (3 / 7 / 3 with the
pointer and the keyboard); the viewport matrix with its pressure states; and the layout limits.

## A. Registry Items

1. Add one item of **each type** — String, ExpandString, MultiString, DWord, QWord, Binary — in one package
   and confirm the value shown in the list matches what you typed. For Binary, type an incomplete byte
   first, open `Details…`, apply, switch packages, and come back: the raw text has to survive, and the
   commit has to stay blocked until it parses.
2. Add a **series of five values under one path**: the form has to keep hive, path, type, and view, and
   clear value name and value each time.
3. Add an **Absent** item for each delete scope — value, value then empty key, recursive key — and confirm
   the destructive confirmation appears for the recursive case and states what it removes.
4. In a **SYSTEM package, add an HKEY_CURRENT_USER item**: the summary line has to state the missing profile
   target, and a commit attempt has to open `Details…` on that field. Try both resolutions: "target all
   existing profiles" for this item, and "run this package as logged-on user" for the whole package.
5. In a **Win32 App package, set a defined revert value** and confirm the revert action and its value type
   appear in the summary line without opening `Details…`.
6. **Draft behaviour**: type half an item, switch to another package and back, open the guide, and import a
   Registry file — the draft has to stay. Then `Discard draft` and confirm it resets to the series state.
   Reload the page: the draft is gone and the page asks nothing.
7. **Import a real `.reg` file** through the file picker and through the clipboard, once ANSI and once
   UTF-16LE, deliberately including one line that must be skipped, and read the diagnostics.

## B. Generated output on Windows

The browser cannot run the generated scripts, so this section needs a non-production Windows device.

1. Download the package ZIP of a package that uses all six types and both Registry views, and run
   `Detect.ps1` and `DryRun.ps1`: they must report without changing anything.
2. Run `Remediate.ps1` twice: the second run must report the same state, not change it again.
3. Confirm the exit codes for compliant, non-compliant, and error results against the Intune expectations
   in the generated README.
4. Check an Absent recursive item and a value deletion against a throwaway key, then run `Uninstall.ps1`
   of a Win32 package and confirm the revert value is written.
5. For an HKEY_CURRENT_USER item in a SYSTEM package, confirm the profile scope: signed-in users, existing
   profiles, and the Default User template for future profiles.
6. Open one generated script and confirm the Deployment Package, Registry Item, and generator metadata are
   present and that the escaping of a value containing quotes or a percent sign looks right.

## C. Surface and accessibility

1. Look at the opened package detail at 1280 x 800, 1920 x 1080, and on an ultrawide display: the surface
   uses the full width, keeps the form above the item list with one inner edge, and the first item row is visible without scrolling from about 700 px
   window height upward. Text must be comfortably readable at 100 % on a 27 or 34 inch WQHD display. On Windows, repeat at 125 % and 150 % display scaling.
2. Narrow the window below 720 px (and check a phone-width view): the item list stacks and shows every
   field with its label, without a sideways scrollbar.
3. Walk the whole authoring flow with the keyboard only: form, `Details…`, `Apply details`, `Add item`,
   the item row actions, and the search field. The focus has to stay visible everywhere.
4. Read one package detail with a screen reader (Narrator or NVDA): labels, error messages, and the column
   association of the stacked list have to be announced sensibly.
5. Open `Details…` and confirm the dialog starts at its first section — it used to jump to the advanced
   region — while the advanced region is already expanded.
6. In the package header, open the delivery method menu: it has to state the current value, every entry has
   to name the scripts that method produces, and the choice has to take effect immediately without opening
   a dialog. Open the run context menu as well: it states the current value and offers SYSTEM and
   Logged-on user. Confirm the header keeps its height while both values change.
7. Check the header itself: the suggested name is drawn muted and turns into a normal name after renaming,
   the underline is visible without hovering, the two settings read as pills, and the state card is amber
   for an incomplete package and green-tinted for a ready one. Look at it in both themes, and confirm the header
   is one column below 1280 px and two columns above it.
8. Check the Registry Items card: its eyebrow sits above the permanent form without a count of its own (the
   header states the count), and the form's name and explanation share one quiet line on desktop. Item
   states are round pills, the Status column shows a coloured dot before Ready, Warning or Error, and the
   hive reads as a neutral pill like the run-context setting. Focusing the package name draws a rounded ring
   around its line. Import, search, filters and the existing item list stay
   inside that same card. The import action carries an icon that points into the surface, and the empty
   package hint carries an info icon. The first Registry
   Item row still has to be visible without scrolling at 1280 x 700, the lower edge of the contract.
9. Walk the periphery: the navigator shows a filled accent square with a plus for a new package and a
   chevron on every entry, both search fields carry a search glyph, the empty states carry a plus, and every
   eyebrow (package header, overview, guide, ADMX preview, dialogs) reads in the same style and colour, the
   overview, template and guide titles match the package name, and the overview and template states are chips
   with a dot (a template with issues in the warning tone) in
   both themes, the navigator included. The navigator is a band flush with the left edge from the top bar to the
   bottom, closed by a line, and its active entry shows a tint and a 4 px accent edge. View heads have no card or
   shadow, each view shows one flat bordered work surface, and at 1920 px and wider the four fields of the
   Registry Item form sit on one row. The Workspace name in the header bar is an underlined line whose
   keyboard focus draws a ring around it.
10. Look at the surfaces: fields have to read as their own, clearly bordered surface in both themes (white in
    light, a deeper tone with a visible border in dark) and not as grey boxes on a tinted band; the quiet
    labels (table header, package id, counter) have to stay readable; status badges have to be legible in
    both themes; and the active entry of the navigator shows one tint and one accent edge rather than a
    gradient, a border and an edge at once.
11. Check a question: delete a Deployment Package from its row menu. A designed dialog has to state the
    question, the consequence and two named answers, with the declining answer focused, and no native
    browser prompt may appear anywhere in the flow. Cancel with Escape and again on the backdrop: the
    package has to stay. Then open `Edit package`, change the name, click `Cancel`: the question has to
    appear over an otherwise empty backdrop, the editor has to be invisible behind it, and `Keep editing`
    has to bring it back with the typed name. Check the same look in both themes and at 380 px width. The
    delete question names itself with a red CONFIRMATION eyebrow; every other dialog eyebrow carries a glyph
    and stays in the accent tone. In the Registry Item dialog, `Ready to apply` is a green chip and the
    Advanced section opens with a chevron; the review's file list sits on the light band, its state is a
    chip with a dot, and success notices are light cards.
12. Open Administrative Templates with no draft, then the candidate picker, an editor with a policy,
    a conflict and the XML preview. At wide and narrow widths in Light, Dark and System themes, the
    heading, actions and content should share the package view's inner edge; candidate, status,
    provenance and conflict text should remain legible, and no footer action should be clipped.
    Trigger a success notice and confirm it starts below the template heading.
13. Open the Guide in Light, Dark and System themes. Check the selected topic, the note and the
    references at desktop and phone widths; the navigation and reading text share a bordered card, and
    its topic/content columns should become one column
    without horizontal overflow. Trigger a success notice and confirm it clears the Guide heading.
14. Open Registry Item `Details…` in both themes and at phone width: sections have text headings without
    numeric badges, the field columns use the available modal width, and Advanced fields start at the same
    horizontal edge. Confirm focus, Escape, scroll restoration and the unchanged footer actions.

## D. Data safety

1. In the storage-free build, confirm the memory indicator is visible, that nothing is restored after a
   reload, and that the browser storage stays untouched.
2. Replace the Workspace while an item draft differs: the page has to ask first. Do the same for deleting
   the package that holds the draft.

## Recording

Write down the build tag, the platform, the browser and window size, what you did, what you expected, and
what happened instead. A failed step is worth more than a general impression, so keep the exact text of any
message that surprised you.

## Known gaps

- Native browser zoom and real Windows display scaling are not automated. The layout suite proves CSS
  reflow in Chromium only; this plan is where scaling gets its coverage.
- The container is built and validated by the release pipeline; the published image is the container
  evidence.
- The layout matrix runs against both artifacts in the pipeline, but a real device pass is still the only
  way to judge how the surface feels at an unusual window size.
