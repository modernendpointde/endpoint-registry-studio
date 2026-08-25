export type ContextualHelpKey =
  | "desiredState"
  | "registryView"
  | "valueType"
  | "rollback"
  | "userHiveTarget"
  | "defaultUser"
  | "deleteBehavior";

export interface ContextualHelpContent {
  title: string;
  summary: string;
  details: readonly { term: string; description: string }[];
  example?: string;
}

export const contextualHelp: Record<ContextualHelpKey, ContextualHelpContent> = {
  desiredState: {
    title: "Desired state",
    summary: "Controls whether the target should exist or be removed.",
    details: [
      {
        term: "Present",
        description: "Requires the selected view, value type, and value to match exactly.",
      },
      {
        term: "Absent",
        description: "Removes the value or key using the selected delete behavior.",
      },
    ],
  },
  registryView: {
    title: "Registry view",
    summary: "Controls whether the 32-bit or 64-bit Registry view is used.",
    details: [
      { term: "Auto", description: "Uses the PowerShell host architecture." },
      { term: "Registry64", description: "Explicitly targets the 64-bit Registry view." },
      { term: "Registry32", description: "Explicitly targets the 32-bit Registry view." },
      { term: "Both", description: "Requires and applies the configured state in both views." },
    ],
    example: "HKLM\\SOFTWARE\\Contoso",
  },
  valueType: {
    title: "Registry value type",
    summary: 'The type is part of compliance; text "1" and DWORD 1 are different values.',
    details: [
      { term: "DWORD", description: "An unsigned 32-bit integer." },
      {
        term: "QWORD",
        description: "A 64-bit integer stored as precision-safe text in this tool.",
      },
      {
        term: "ExpandString",
        description: "Compares the stored raw text without expanding environment variables.",
      },
      {
        term: "MultiString",
        description: "Compares every string in the configured order.",
      },
    ],
  },
  rollback: {
    title: "Revert behavior",
    summary: "Defines how a Win32 App uninstall reverts this item.",
    details: [
      { term: "No revert action", description: "No automatic reversal is generated." },
      { term: "Delete managed value", description: "Removes the managed Registry value." },
      { term: "Set a defined value", description: "Writes the configured revert type and value." },
    ],
  },
  userHiveTarget: {
    title: "User hive target",
    summary: "Used only when an HKCU item runs as SYSTEM. Choose one of three targets.",
    details: [
      {
        term: "Currently signed-in users",
        description: "Targets every detected interactive user through HKEY_USERS.",
      },
      {
        term: "All existing user profiles",
        description: "Processes every applicable local profile, loading offline hives as needed.",
      },
      {
        term: "All existing profiles and Default User",
        description:
          "Same as all existing profiles, plus the Default User NTUSER.DAT used for future profiles.",
      },
    ],
    example: "HKEY_USERS\\S-1-5-21-...\\Software\\Contoso",
  },
  defaultUser: {
    title: "New user profiles",
    summary: "Updates the Default User template used to create future local profiles.",
    details: [
      {
        term: "Scope",
        description: "Loads C:\\Users\\Default\\NTUSER.DAT separately from existing profiles.",
      },
      {
        term: "Consequence",
        description: "Every profile created after deployment can inherit the change.",
      },
    ],
  },
  deleteBehavior: {
    title: "Delete behavior",
    summary: "Controls how much Registry content an Absent item removes.",
    details: [
      { term: "Delete value", description: "Removes only the configured value." },
      {
        term: "Delete value, then empty key",
        description: "Removes the parent key only when no values or subkeys remain.",
      },
      {
        term: "Delete key recursively",
        description: "Removes the complete key tree and all content below it.",
      },
    ],
  },
};
