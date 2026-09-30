# Changelog

All notable changes to Endpoint Registry Studio are documented here.

The project follows [Semantic Versioning](https://semver.org/).

## 1.2.0 - 2026-09-30

Faster package authoring and a readable, calmer interface on every display.

### Authoring

- `New package` creates a Deployment Package immediately with the suggested name `Untitled Deployment Package` and opens it. The name is edited in place in the package header; a repeated suggestion is numbered.
- Registry Items are written in a permanent form in the package detail: hive, Registry path, value name, type, and value. `Add item` keeps the hive, path, type, and view for the next item.
- Enter adds the item from a single-line field or a select, and Ctrl or Cmd plus Enter adds it from any field. A multi-line value keeps its line breaks.
- `Details…` opens desired state, delete scope, Registry view, inclusion, description, user hive target, and Revert behavior for the same draft. A summary line under the form states every setting that is not at its default.
- Each package keeps one unsaved draft in memory only. It is never written to the Workspace file, the export, the fingerprint, or the persistent autosave. Replacing the Workspace, deleting the package, or leaving the page asks before a changed draft is lost.
- A path typed or pasted with a leading hive such as `HKLM\` or `HKEY_CURRENT_USER\` sets the hive. An unsupported hive such as `HKCR` is reported as a field error instead of being stored in the path.
- The delivery method and the run context are chosen directly in the package header; each delivery method names the scripts it produces.
- A SYSTEM package that targets HKEY_CURRENT_USER resolves its user hive target in one click.
- Importing a `.reg` file or clipboard content opens the review directly.
- `New package` and `New administrative template` are direct actions. Creating a package no longer asks for the output type.
- A package with one DWORD value needs three activations instead of five.

### Interface

- The navigator runs along the left edge, view headings sit on the page, and each view has one work surface. Every view uses the full width of the display, with the Registry Item form above the item list.
- Text is 14 px for body and controls, 13 px for secondary text, and never smaller than 12 px. The font stack uses installed system fonts, starting with Segoe UI Variable on Windows 11; no font file is downloaded.
- Small text meets a contrast of 4.5:1 in the light and the dark theme.
- Views, dialogs, and notices share one visual language, and buttons, selects, and fields share one 38 px height.
- Destructive or replacing actions ask through the application's own confirmation instead of browser prompts. The safe answer has the focus, and Escape cancels. Only one dialog is shown at a time.
- The storage-free web build opens without a startup dialog; a permanent `Memory only` notice in the header opens the privacy details.
- At narrow widths the Registry Item list stacks and labels every field.

### Compatibility

- The Workspace schema stays at version 8. Files saved with 1.1.0 open unchanged.
- Generated PowerShell, ADMX, and ADML output is unchanged apart from the version metadata 1.2.0, so package fingerprints change.

## 1.1.0 - 2026-09-20

Administrative templates become a second output beside script packages.

- Author one custom ADMX file and one `en-US` ADML file, either from the compatible Registry Items of a Deployment Package or from a Registry target entered in the template.
- Assess every Registry Item for template compatibility and read the exact reason for each rejected item.
- Set the Enabled, Disabled, and Not Configured behaviour per policy, and choose between administrator input with an explicit DWORD range and a fixed value.
- Block a template in which two policies would write the same Registry value.
- Keep each policy bound to the Registry definition it was created from, see whether the source still matches, and adopt the current definition explicitly.
- Download the ADMX file, the `en-US` ADML file, and `IMPORT.md` as a ZIP.
- Ask for the output type when a package is created.
- Read the guide in the application from the header.
- Open Workspaces written as schema 7 and save them as schema 8.

## 1.0.2 - 2026-09-12

- Keep long Registry Item names, descriptions, paths, value names, and values inside their package-table columns.

## 1.0.1 - 2026-08-26

- Write a valid DOS modification timestamp in generated package ZIP archives so extracted files no longer appear as 1979-11-30.

## 1.0.0 - 2026-08-25

Initial release.

- Author Workspaces, Deployment Packages, and Registry Items entirely in the browser.
- Import supported `.reg` files and clipboard content with reviewable diagnostics.
- Generate deterministic Windows PowerShell 5.1 for Intune Remediation, Platform scripts, and Win32 app source.
- Preserve exact Registry types, values, views, deletion modes, Revert behavior, Unicode, and high-bit DWORD/QWORD data.
- Target HKLM and HKCU in logged-on-user or SYSTEM context, including signed-in users, existing profiles, and optional Default User handling.
- Review and download package ZIPs, CSV summaries, documentation, Workspace JSON, and selection-scoped archives.
- Use the storage-free static web artifact or the persistent self-hosted/Docker artifact.
- Host at a domain root or subdirectory, with an unprivileged nginx image available from GitHub Container Registry.
- Configure validated branding and footer links without rebuilding the application.
- Open included schema-7 sample Workspaces for common Registry scenarios.
- Report release and generator contract metadata consistently as 1.0.0 across About, Workspace/package files, scripts, and artifacts.
- Validate container builds on pull requests and `main` without publishing them; publish only exact semantic-version images and stable `latest` after container validation.
- Ship the project license and complete React MIT notice in both release archives and the digest-pinned stable nginx container image.

### Known limitations

- Supported Registry hives are HKLM and HKCU.
- Empty keys in `.reg` files cannot be represented.
- Win32 output is source material and does not include an `.intunewin` package.
- Generated PowerShell requires validation on representative non-production Windows devices.
