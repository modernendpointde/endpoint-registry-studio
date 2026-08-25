# Workspace and package schemas

## Schema 7

Endpoint Registry Studio accepts schema 7 only. Other versions, unknown kinds, and malformed roots are rejected before Workspace state changes.

A Workspace file uses `kind: "registry-workspace"` and contains:

- generator version, stable Workspace ID, and Workspace name
- an ordered `packages` array

Each Deployment Package contains a stable ID, name, deployment method, run context, PowerShell host/signature options, and ordered Registry Items. Package status and fingerprint are derived rather than stored in Workspace JSON.

Each Registry Item contains a stable ID, enabled state, description, one Registry definition, and conditional SYSTEM + HKCU settings. The Registry definition records desired state, deletion mode, hive, key path, value name, typed value, Registry view, and Revert fields.

Package downloads include `registry-package.json` with `kind: "registry-package"`, the complete package, generator version, deterministic fingerprint, and optional source-Workspace identity.

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
