# Administrative Template output

An administrative template produces one custom ADMX file and one `en-US` ADML file. Policies come
from compatible Registry Items or from Registry targets entered in the template editor.

## Workbench flow

Administrative Templates is a main-content view beside the Deployment Packages, selected from the
same navigator, so the package list stays visible while a template is authored. It is not a dialog
and not a Deployment Package method.

1. The picker assesses every Registry Item in its package context.
2. Compatible and rejected items remain visible; rejected items show exact reason messages and cannot be selected.
3. Selection creates a frozen Registry snapshot. Later source-package edits do not silently change the policy.
4. Template and policy metadata are authored explicitly. Structurally valid incomplete drafts may be saved in schema 8 Workspace JSON; values that could not be reopened are blocked before commit.
5. Preview and download remain blocked until the authoritative domain validator and compiler succeed.
6. Review shows the authored policy behaviour first, then the generated ADMX, ADML, and import instructions as text. Download creates a local ZIP; nothing is uploaded.
7. Switching between the package list and the template view keeps unsaved authoring, which is also protected against page unload.

The template view starts empty in one of three states, each naming the next step: no Registry Items exist, so every policy would be written directly in the template; items exist but none is eligible, so the compatibility reasons are offered for review; or eligible items exist and a template can reuse them.

A Deployment Package that contains eligible items offers the reverse entry: its detail view starts template authoring with the package's eligible items preselected. Only enabled items are preselected, because eligibility and inclusion are different questions and a disabled script item must not slip into a policy. A package whose items already feed a template lists those templates and links back to them.

A template does not require a Deployment Package. A policy may carry its own Registry target, written in the template editor with hive, path, value name, type, and value. The authoring rules are the same either way and fail closed: the target must be expressible as ADMX, so a path outside `Software\Policies\<Vendor>\<Product>`, an unsupported type, or a missing path blocks compilation exactly as it does for a derived policy.

Each policy shows where it came from and whether the two still agree. For a policy written in the template the status is `authored` and there is nothing to compare. For a derived policy the status is `matches`, `differs`, or `unavailable`, and it never implies that equality is required: a policy holds a frozen snapshot by design, and a later edit to the source is not an error. When a source differs, the author can adopt the current definition explicitly. Adopting clears the authored value mode and state behaviours when the hive, key path, value name, or type changed, so a range or fixed value that no longer describes the setting cannot be inherited silently; the author then re-decides, and the normal compiler gates apply again.

## Registry target conflicts

Two policies in one template must not claim the same Registry value. A policy's target identity is its hive, key path, value name, and Registry view, compared without case sensitivity because Windows treats paths and value names that way. The comparison folds characters the way Windows does rather than with a language-aware lowercase mapping, and it deliberately prefers reporting an overlap: a false overlap blocks compilation visibly, while a missed one would ship policies that overwrite each other.

A template that contains two policies with the same identity does not compile, and review and download stay blocked. Policies that differ in hive or value name are distinct targets and stay compilable. Explicit Registry views are not eligible for administrative templates, so every supported policy uses the Auto view.

The Workbench also compares each template policy against the enabled Registry Items of the Workspace packages. It reports two situations: a package item that affects the same Registry value, and a recursive key deletion whose key tree contains the policy path. These reports are local observations. The product cannot know which profiles are assigned, which one wins in the tenant, or what a client ends up with, so the wording never describes a verified Intune conflict.

## Files

A successful template download contains:

- `<product>.admx`
- `en-US/<product>.adml`
- `IMPORT.md`

The generated file contents are deterministic, and the generator applies strict XML escaping. DTDs, entities, scripts, external resources, illegal XML characters, unsafe namespaces, unsupported Registry semantics, and files above the recorded Intune size limit fail closed. Archive timestamps record the time of the download, as they do in package archives.

## Persistence

The Workspace persists authoring drafts in `administrativeTemplates[]`. Generated XML, picker selection, preview state, and diagnostics are transient.

The storage-free web build keeps the Workspace in memory until explicit export. The self-hosted build persists the same Workspace document through its existing browser-local lifecycle. No additional storage or network API is used.

## Limitations

- No Microsoft Graph, tenant connection, or automatic upload.
- One `en-US` ADML only.
- Only compatible Present String, ExpandString, and DWORD policies under supported non-Microsoft policy paths.
- No explicit Registry views, deletion desired state, SYSTEM profile processing, Default User processing, Win32 Revert semantics, unnamed values, sensitive-looking value names, QWORD, Binary, or MultiString.
- Not Configured cannot be set to leave an existing value.
- ExpandString policies cannot use a fixed value, for the policy or for the Disabled state.
- Custom ADMX import in Microsoft Intune is a public preview.
