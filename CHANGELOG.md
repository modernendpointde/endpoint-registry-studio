# Changelog

All notable changes to Endpoint Registry Studio are documented here.

The project follows [Semantic Versioning](https://semver.org/).

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
