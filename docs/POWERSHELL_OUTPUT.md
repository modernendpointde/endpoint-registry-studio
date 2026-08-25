# PowerShell output

## Package contents

Each Deployment Package is generated independently from its enabled Registry Items.

| Method             | Scripts                                               |
| ------------------ | ----------------------------------------------------- |
| Intune Remediation | `DryRun.ps1`, `Detect.ps1`, `Remediate.ps1`           |
| Platform script    | `DryRun.ps1`, `Apply.ps1`                             |
| Win32 app source   | `Install.ps1`, `Detect.ps1`, optional `Uninstall.ps1` |

Packages also include `README.md`, `VERSION`, `registry-summary.csv`, and `registry-package.json`. Selected/all downloads contain one folder per package, a scope-matching Workspace file, and `manifest.json`; unselected package data is excluded.

The eight-character fingerprint covers generator version, package execution settings, and ordered effective behavior of enabled items. It is a deterministic trace identifier, not a cryptographic signature.

## Script behavior

Detect and DryRun contain read/comparison logic only. Remediate, Apply, Install, and Uninstall contain direct Registry actions and are idempotent. Uninstall is generated only for supported explicit Win32 Revert actions.

Every script is standalone and targets Windows PowerShell 5.1. It includes no external module, download, network request, `Invoke-Expression`, or dynamic execution.

Exit behavior:

- Remediation Detect: 0 when compliant, otherwise 1.
- Win32 Detect: 0 when installed/compliant, 1 when not installed/non-compliant, 2 on detection error.
- Mutation roles return non-success when Registry or required profile work fails.

The first output line starts with `ERS;` and includes the package fingerprint, role, and counters. SYSTEM mutation roles also append one line to `%ProgramData%\Endpoint Registry Studio\ers.log`. Detect, DryRun, and logged-on-user packages do not write that file.

## Exact Registry semantics

Scripts use `Microsoft.Win32.RegistryKey`.

- Registry32 and Registry64 select the matching `RegistryView`; Both emits both views; Auto uses `RegistryView.Default`.
- Paths are not rewritten with `WOW6432Node`.
- Present requires matching existence, `RegistryValueKind`, and raw typed value.
- ExpandString is read without environment expansion.
- MultiString order and Binary bytes are compared exactly.
- Absent supports value deletion, value plus empty-key deletion, or recursive key deletion.

Generated CLR values are `String`, `String[]`, `Byte[]`, `Int32`, or `Int64` as appropriate. High-bit DWORD and QWORD values retain their Registry bit patterns. QWORD conversion starts from the exact decimal string, not a JavaScript number.

Non-ASCII and control-containing strings use a generated UTF-8 Base64 decoder only when required, keeping scripts safe for Windows PowerShell 5.1.

## Revert and command files

Win32 Revert never captures or guesses a previous value. It performs only the configured delete or defined-value action. Recursive key deletion has no Revert action.

A 64-bit Win32 package uses `%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe`; a 32-bit package uses `powershell.exe`. Signature enforcement selects `AllSigned`; otherwise command files use `Bypass`. Generated scripts are unsigned and must be signed by the operator when enforcement is enabled.

## SYSTEM and HKCU

Logged-on-user packages use ordinary HKCU. SYSTEM packages expand HKCU items to currently signed-in users or all existing profiles; Default User is optional for the all-existing scope.

Loaded profile hives are reused. Required offline hives are mounted from `NTUSER.DAT` under temporary unique names. The script unloads only hives it mounted and reports enumeration, mount, access, and unload failures. System and service profiles are excluded. Default User uses `%SystemDrive%\Users\Default\NTUSER.DAT`, not `HKEY_USERS\.DEFAULT`.

Test generated scripts on representative non-production Windows devices before Intune rollout.
