# Workspace and package schemas

## Accepted versions

Endpoint Registry Studio writes schema 8 and also accepts schema 7, the previous published version. Everything else is rejected before Workspace state changes: a version below 7 was never published, and a version newer than 8 is not understood.

An accepted schema 7 document is lifted to schema 8 in memory. Schema 8 added the `administrativeTemplates` array to the Workspace, so a lifted schema 7 Workspace carries an empty array. A schema 7 Workspace that already contains `administrativeTemplates` is rejected, because that field does not belong to schema 7 and dropping it silently would discard data. The package file format is identical in both versions.

Opening an older file and saving it again writes schema 8. Older application versions cannot read that file. The rule follows from a product commitment: a file written by a released version stays readable.

## Schema 8

Unknown kinds and malformed roots are rejected before Workspace state changes.

A Workspace file uses `kind: "registry-workspace"` and contains:

- generator version, stable Workspace ID, and Workspace name
- an ordered `packages` array
- an ordered `administrativeTemplates` array

Each administrative template stores stable identity, vendor/product identifiers, version, and ordered policies. A policy persists a Registry snapshot and authored ADMX metadata. The snapshot either comes from a Deployment Package item, in which case the policy also stores that item's ID, or it is written directly in the template and carries no source ID. Incomplete templates may round-trip; unknown fields are rejected. Package fingerprints do not include templates.

Each Deployment Package contains a stable ID, name, deployment method, run context, PowerShell host/signature options, and ordered Registry Items. Package status and fingerprint are derived rather than stored in Workspace JSON.

Each Registry Item contains a stable ID, enabled state, description, one Registry definition, and conditional SYSTEM + HKCU settings. The Registry definition records desired state, deletion mode, hive, key path, value name, typed value, Registry view, and Revert fields.

Package downloads include `registry-package.json` with `kind: "registry-package"`, the complete package, generator version, deterministic fingerprint, and optional source-Workspace identity.

Package deployment archives include Workspace JSON for the included packages only. That Workspace JSON does not include administrative templates.

## Import behavior

Workspace and package files are decoded as UTF-8 and strictly validated. Import rejects duplicate or cross-package item IDs, invalid enums and values, malformed fingerprints, unsupported methods, and files larger than 5 MiB. Limits are 10,000 packages and 10,000 Registry Items.

Replacing a package requires the same package ID. Import as copy assigns new package and item IDs. A collision on item ID alone cannot replace unrelated package data.

`.reg` parsing produces temporary review candidates, not schema objects. Selected candidates are converted into Registry Items.

## Registry values

| Type         | JSON `data`                       |
| ------------ | --------------------------------- |
| String       | string                            |
| ExpandString | raw string                        |
| MultiString  | string array                      |
| Binary       | byte array                        |
| DWord        | unsigned 32-bit number            |
| QWord        | canonical unsigned decimal string |

QWORD is not stored as a JSON number, avoiding JavaScript precision loss. Present means exact Registry type and raw typed value equality.

## Revert and profile settings

Win32 Revert behavior is explicit. Supported actions delete a managed value or set a defined value; recursive key deletion cannot reconstruct a subtree. Remediation and Platform scripts ignore inactive Revert fields.

SYSTEM + HKCU settings are effective only for HKCU items in SYSTEM packages. The supported scopes are currently signed-in users and all existing profiles, with optional Default User for the latter. Inactive profile fields do not affect validation, fingerprints, or output.

## Persistence

The storage-free web build keeps the Workspace in memory until explicit export. The self-hosted/Docker build autosaves the current Workspace in origin-private browser storage using OPFS with IndexedDB fallback. Export always occurs on user action; Workspace and Registry data is not uploaded.
