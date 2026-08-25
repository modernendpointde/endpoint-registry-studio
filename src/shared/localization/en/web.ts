export const webWorkspaceCopy = {
  startNewMemory: "Start a new Workspace? Unexported changes will be discarded.",
  startupNotice: {
    title: "Not saved in this tab",
    body: [
      "This hosted copy keeps your Workspace in memory.",
      "Reloading or closing the tab discards changes you have not exported. Use Export to keep a Workspace file on your device.",
    ],
    acknowledgeLabel: "Continue",
    privacyLabel: "Privacy details",
    selfHostLabel: "Self-host this app",
  },
  privacy:
    "Registry and Workspace content is processed in this browser. This web version does not save your Workspace into browser storage and does not restore it after reload. Reloading or closing the tab discards unexported changes; files are created on your device only when you request them. Workspace and Registry content is not uploaded by the application.",
} as const;
