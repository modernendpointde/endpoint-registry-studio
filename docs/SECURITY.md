# Security and privacy architecture

## Trust boundary

Imported `.reg` files, Workspace/package JSON, and `config.json` are untrusted data. They are parsed as text or data, never executed, and never rendered as HTML. The application does not use unsafe HTML, script evaluation, or dynamic PowerShell execution.

## Data handling

Registry, Workspace, and package content is processed in the browser.

| Variant            | Storage behavior                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Storage-free web   | Memory only until explicit export; reload discards unexported work                                              |
| Self-hosted/Docker | Origin-private browser storage with OPFS and IndexedDB fallback; autosave, restore, and user-initiated clearing |

A supported browser may also write a user-selected Workspace file. Downloads use local Blob URLs and Registry data is not placed in URLs.

The application has no backend, authentication, cloud storage, analytics, telemetry, advertising, or external runtime API. Static hosts receive ordinary connection requests for application files but do not receive Workspace or Registry content. Configured GitHub, LinkedIn, legal, or other footer links are normal anchors and contact their destination only after a click.

## Input and output controls

- File size limits are applied before decoding. JSON requires validated UTF-8; Registry input also supports BOM-marked UTF-16LE.
- Schema 8 Workspace and package files are accepted, plus schema 7, the previous published version, which is lifted to schema 8 in memory with documented defaults for fields introduced since then. Every other version, unsupported kind, duplicate ID, invalid value, unknown field, and malformed fingerprint is rejected before state changes.
- Runtime configuration accepts a limited set of text, color, theme, local-logo, import, and footer-link values. It cannot inject HTML, JavaScript, or CSS.
- Registry Item drafts remain outside committed Workspace state. The package detail keeps one draft per package in memory only: it is never serialized, never part of the fingerprint, the export, or the persistent autosave, and it keeps the raw text of the value and of the revert value, so incomplete input cannot be coerced into a stored value or silently dropped. A changed draft counts as unsaved work for the guards that replace or reset the Workspace, that replace a package under the same identifier, that delete a package, and that unload the page; an untouched series draft does not. A commit runs the item rules and the conflicts the candidate would cause beside the items already in the package, so a conflicting Registry target cannot be added. Incomplete administrative-template records may persist in schema 8 Workspace JSON; unknown template fields are rejected.
- Errors block generated previews and downloads. Warnings require confirmation. The confirmation is the application's own dialog rather than a native prompt: it states the consequence, offers explicit consent and decline, takes neither answer as a default, and changes nothing when it is closed, cancelled with Escape, or dismissed on the backdrop. A confirmation asked out of an open dialog suspends that dialog instead of stacking on it, so exactly one modal is interactive. Persistent unload protection remains the browser's own dialog, which the application cannot style or suppress; it only decides whether the browser offers it at all.
- Selected-package archives contain only selected package data and do not include administrative templates.
- Administrative-template selection stores frozen Registry snapshots only after explicit user selection. Rejected items cannot enter a template draft. Schema structural validation blocks drafts that could not be reopened, unsaved editor changes participate in unload protection, and preview/download re-run authoritative domain validation and compilation. Generated XML is displayed as text and is never rendered as HTML.
- A template cannot compile when two of its policies claim the same Registry value, compared case-insensitively because Windows treats Registry paths and value names that way. Overlaps between a template policy and an enabled Deployment Package item are reported as locally detected observations, never as verified Intune assignment conflicts.
- CSV cells are quoted and formula-leading untrusted values are forced to text.
- Clipboard and download failures are reported without claiming success.
- Package fingerprints are trace identifiers, not signatures or secret hashes.

## Generated PowerShell

Generated scripts use `Microsoft.Win32.RegistryKey`, centralized literal escaping, and no downloads, network requests, external modules, `Invoke-Expression`, or dynamic code execution.

Detect and DryRun are read-only. Mutating roles are deterministic and idempotent. Revert behavior is explicit and never guesses a previous value. SYSTEM mutation may append a local line to `%ProgramData%\Endpoint Registry Studio\ers.log`; read-only roles do not write that file.

SYSTEM + HKCU scripts target explicit profile scopes, exclude system/service profiles, and unload only hives they mounted. Missing targets, inaccessible hives, and unload failures produce non-success results.

## Hosting

Operators should use TLS, restrict access to deployment files and `config.json`, and preserve the container security headers. A compromised hosting origin can replace the application JavaScript, so generated scripts should be reviewed and tested on non-production Windows devices before rollout.

The nginx image runs unprivileged with a read-only filesystem, dropped capabilities, no privilege escalation, a small `/tmp` tmpfs, and route-specific security/cache headers.

## Reporting vulnerabilities

Use the process in the root [security policy](../SECURITY.md).
