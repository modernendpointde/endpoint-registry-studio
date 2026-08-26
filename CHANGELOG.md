# Changelog

All notable changes to Endpoint Registry Studio are documented here.

The project follows [Semantic Versioning](https://semver.org/).

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
