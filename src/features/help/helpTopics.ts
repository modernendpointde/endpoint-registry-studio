export interface HelpExample {
  title: string;
  lines: string[];
  note?: string;
}

export type HelpBlock =
  | { kind: "text"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "example"; example: HelpExample }
  | { kind: "note"; text: string }
  | { kind: "ref"; text: string; topicId: string };

export type HelpGroup = "Orientation" | "Operation" | "Reference" | "Troubleshooting" | "Examples";

export const HELP_GROUP_ORDER: readonly HelpGroup[] = [
  "Orientation",
  "Operation",
  "Reference",
  "Troubleshooting",
  "Examples",
];

export interface HelpTopic {
  id: string;
  title: string;
  group: HelpGroup;
  summary?: string;
  blocks: HelpBlock[];
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "start",
    title: "Start here",
    group: "Orientation",
    blocks: [
      {
        kind: "text",
        text: "This application runs in the browser. It uploads nothing and does not connect to Intune; Workspaces, Registry values, and generated files stay on your machine.",
      },
      {
        kind: "text",
        text: "A Workspace is the document you edit and holds Deployment Packages and administrative templates. A Deployment Package holds Registry Items plus the settings for how Intune runs the result, and produces a ZIP of PowerShell scripts. An administrative template holds policies and produces one ADMX file and one en-US ADML file.",
      },
      {
        kind: "text",
        text: "The two outputs differ in how a value changes later. A script package writes the value it contains each time it runs, so a change means regenerating and redeploying. An administrative template is imported into Intune once and applied through a configuration profile, so administrator input can change without new files.",
      },
      {
        kind: "text",
        text: "Typical sequence: create a package or template, add its Registry settings, review the output, test on a non-production device, deploy through Intune, and keep the exported Workspace.",
      },
      {
        kind: "ref",
        text: "A complete first run is described in",
        topicId: "first-package",
      },
    ],
  },
  {
    id: "first-package",
    title: "Create, review, and download a script package",
    group: "Operation",
    blocks: [
      {
        kind: "text",
        text: "The package writes one machine-scoped DWORD for the vendor Northgate.",
      },
      {
        kind: "heading",
        text: "Create the package",
      },
      {
        kind: "steps",
        items: [
          "Choose New package. The navigator and the overview both offer it, beside New administrative template; the package exists immediately with the suggested name Untitled Deployment Package and its detail view opens.",
          "Rename it in the header if you like: the name under the eyebrow is a line with a permanent underline, and it takes effect while you type. While it is still the suggested name it is drawn in a muted tone, and after the first rename it reads like any other name. An emptied field keeps what you typed instead of resetting itself, and the package reports the missing name until you fill it in.",
          "The two pills under the name state what the package produces and where it runs: the delivery method reads Intune Remediation and the run context reads SYSTEM. Beside them the state of the package is a card, amber while something is still missing and neutral when the package is ready, with the package ID next to the state and the reason on its own line. A choice takes effect at once and needs no editor, and every entry of the delivery method names the scripts that method produces: Detect.ps1, Remediate.ps1, and DryRun.ps1 for Intune Remediation, Apply.ps1 and DryRun.ps1 for a platform script, and Install.ps1, Detect.ps1, and Uninstall.ps1 where defined for a Win32 app source. Choose Edit package for the 64-bit host and the signature requirement; the 64-bit host matters because view Auto follows it.",
          "Leave Require signed scripts cleared unless every generated script will be signed. It affects the Win32 command files and the generated README only.",
        ],
      },
      {
        kind: "heading",
        text: "Add the Registry Item",
      },
      {
        kind: "steps",
        items: [
          "The package detail carries a permanent Registry Item form; nothing opens.",
          "Leave the hive selector at HKEY_LOCAL_MACHINE.",
          "Set Registry path to Software\\Northgate\\Demo. The hive selector sits at the left of that field. A leading HKLM or HKCU in the path moves the hive into the selector and is removed from the path; the stored path is relative to the hive.",
          "Set Value name to Enabled. Leave it blank only to target the default value.",
          "Set Registry value type to DWord and Registry value to 1.",
          "Read the line under the form: it states the desired state and every setting that is not at its default, such as the Registry32 view that Auto resolves to in a 32-bit package.",
          "Choose Add item. The item appears in the item list as DWORD 1, and the form stays with a fresh draft.",
        ],
      },
      {
        kind: "text",
        text: "Adding several values under one path is one series. After Add item the form stays and already carries the hive, the path, the value type, and the view; every other field returns to its default, so a value that has to be absent again, excluded, or described needs that answer per item. Only the value name and the value are left to type for a value under the same conditions, and a SYSTEM package that targets HKEY_CURRENT_USER also asks for its user hive target again. Enter adds the item from a path, name, or value field, and Ctrl or Cmd plus Enter does the same; a multi-line value keeps its line breaks. Everything that is not part of the common case sits behind Details…, which edits the same draft: Desired state, the delete scope, Registry view, inclusion, the description, the user hive target, and the revert behavior of a Win32 package. Apply details keeps those changes in the form, and the draft belongs to its package: it survives switching packages inside the session, is never part of the Workspace file, and is not included in the output.",
      },
      {
        kind: "note",
        text: "A path under Software\\Policies is flagged because an administrative template or another policy source can write the same location. The warning does not block the package.",
      },
      {
        kind: "heading",
        text: "Review before downloading",
      },
      {
        kind: "steps",
        items: [
          "Choose Review output. The review opens on the package configuration and lists the generated files.",
          "Read the three generated scripts. Detect.ps1 decides what Intune reports, Remediate.ps1 applies the state when detection reports a difference, and DryRun.ps1 reports the planned action without writing.",
          "Resolve every error and read every warning. Errors block the download; downloading requires accepting the warnings.",
        ],
      },
      {
        kind: "heading",
        text: "Download and keep the source",
      },
      {
        kind: "steps",
        items: [
          "Choose Download package. The ZIP contains the scripts plus the support files listed under Output files.",
          "Extract the ZIP and upload the scripts to an Intune Remediation. DryRun.ps1 stays for local checks.",
          "Export the Workspace before you close the tab. The downloaded ZIP is deployment material, not the editable source.",
        ],
      },
      {
        kind: "heading",
        text: "Test the package on a device",
      },
      {
        kind: "steps",
        items: [
          "Copy the extracted scripts to a non-production device.",
          "Run DryRun.ps1 in the configured context and architecture.",
          "Run Remediate.ps1, then inspect HKLM\\Software\\Northgate\\Demo and confirm that Enabled is a DWORD with the value 1.",
          "Run Detect.ps1 and confirm that it reports compliance.",
        ],
      },
      {
        kind: "example",
        example: {
          title: "What the generated scripts do with this item",
          lines: [
            "Detect.ps1     reads HKLM\\Software\\Northgate\\Demo\\Enabled",
            "               exits 0 when it is DWORD 1, 1 when it differs",
            "Remediate.ps1  writes DWORD 1",
            "DryRun.ps1     reports the same comparison without writing",
          ],
        },
      },
      {
        kind: "ref",
        text: "Problems with a package are described in",
        topicId: "failures",
      },
    ],
  },
  {
    id: "import",
    title: "Import Registry data and manage items",
    group: "Operation",
    blocks: [
      {
        kind: "text",
        text: "Import reads a .reg file or pasted Registry text and turns selected lines into Registry Items. Nothing is added until you confirm.",
      },
      {
        kind: "steps",
        items: [
          "Choose Import Registry data.",
          "Choose a .reg file, or paste Registry text from the clipboard. UTF-16LE files with a byte order mark are read as well as UTF-8.",
          "The dialog parses the source as soon as you choose it and lists every value it recognised.",
          "Check the diagnostics. Each entry is marked as importable or skipped, with a reason.",
          "Select the entries you want. The confirm button counts your selection.",
          "Choose Import, then check the item list. Imported items appear after the existing ones.",
        ],
      },
      {
        kind: "heading",
        text: "What the diagnostics mean",
      },
      {
        kind: "text",
        text: "A skipped line is reported with its reason: a key without values, a value type the editor does not support, or text that is not valid Registry syntax. Unnamed values are importable and appear as the default value.",
      },
      {
        kind: "text",
        text: "Importing the valid entries does not fix the skipped ones; skipped lines stay in the source file only.",
      },
      {
        kind: "heading",
        text: "Working with existing items",
      },
      {
        kind: "steps",
        items: [
          "The switch on a row takes the item out of the generated output. It stays in the package and can be switched back on.",
          "More actions offers Edit, Duplicate, Copy path, Move or copy to another package, and Delete.",
          "Moving removes the item from this package. Copying leaves the original here and creates an independent copy.",
          "Deleting removes the item from the Workspace. It does not remove anything from a device where an earlier package already wrote it.",
        ],
      },
      {
        kind: "note",
        text: "Import adds items; running it twice on the same file creates a second set.",
      },
    ],
  },
  {
    id: "templates",
    title: "Create, review, and download an administrative template",
    group: "Operation",
    blocks: [
      {
        kind: "heading",
        text: "Decide whether a template fits",
      },
      {
        kind: "text",
        text: "A template can express a named value of type String, ExpandString, or DWORD that is set to Present, at a path under Software\\Policies\\<Vendor>\\<Product>, with Registry view Auto. Everything else stays in a script package.",
      },
      {
        kind: "example",
        example: {
          title: "Settings that need a script package instead",
          lines: [
            "Deleting a value or a key",
            "Binary, MultiString, or QWORD data",
            "An explicit Registry32, Registry64, or Both view",
            "Processing user profiles from a SYSTEM package",
            "A Win32 uninstall that restores an earlier value",
          ],
        },
      },
      {
        kind: "heading",
        text: "Create the template",
      },
      {
        kind: "steps",
        items: [
          "Choose New administrative template; the editor opens with one policy.",
          "Enter the policy's Registry target.",
          "Set Registry hive to HKEY_LOCAL_MACHINE.",
          "Set Registry path to Software\\Policies\\Northgate\\Demo.",
          "Set Value name to Enabled, Registry value type to DWord, and Registry value to 1.",
          "Set Template name to Northgate demo policy and Version to 1.0.0.",
          "Set Vendor identifier to Northgate and Product identifier to Demo; together they determine the namespace Northgate.Demo.",
          "Set Policy identifier to EnableFeature. Changing it later creates a new policy rather than an update.",
          "Set Category to Northgate Demo, Display name to Enable the demo feature, and Explanation to Writes the configured value.",
          "Set Value mode to Administrator input, Minimum DWORD to 0, and Maximum DWORD to 10.",
          "Choose Write configured value for Enabled, and Delete value for Disabled and Not Configured.",
        ],
      },
      {
        kind: "text",
        text: "The status line counts the remaining authoring issues and reads Ready to preview and download once the template compiles.",
      },
      {
        kind: "heading",
        text: "Review and download",
      },
      {
        kind: "steps",
        items: [
          "Choose Continue to review. The summary lists each policy with its target and type.",
          "Check the generated ADMX and ADML text below the summary.",
          "Choose Download template. The ZIP contains the ADMX file, the en-US ADML file, and IMPORT.md.",
          "Choose Back to edit, then Save draft to Workspace, and export the Workspace to keep the editable source.",
        ],
      },
      {
        kind: "heading",
        text: "Deploy the template",
      },
      {
        kind: "steps",
        items: [
          "In Intune, import the ADMX file and its en-US ADML file in the same step. IMPORT.md in the ZIP describes the import steps.",
          "Create a configuration profile from the imported template and set the value there. Administrator input is what makes this possible.",
          "Assign the profile to a test device or test user, then synchronise the target and inspect the Registry.",
        ],
      },
      {
        kind: "example",
        example: {
          title: "What each state does with this policy",
          lines: [
            "Enabled           writes the number entered in the profile",
            "Disabled          deletes HKLM\\Software\\Policies\\Northgate\\Demo\\Enabled",
            "Not Configured    deletes the same value",
          ],
          note: "The profile state is what Intune applies. It is not the same as the Detect comparison a script package performs.",
        },
      },
      {
        kind: "note",
        text: "Verify Enabled, then Disabled, then restore Enabled before testing Not Configured, because a value that Disabled already deleted proves nothing about the third state.",
      },
      {
        kind: "heading",
        text: "Change the template later",
      },
      {
        kind: "text",
        text: "A fixed value, an added policy, a changed policy identifier, or a reorganized category needs a new template version. Uploading an ADMX file whose settings are already imported fails with a namespace error, and Microsoft documents two options: delete the profiles that use the settings and the original import, then import the new pair; or publish the new version under a different namespace, such as a version number in the product identifier, and import it alongside the first.",
      },
      {
        kind: "ref",
        text: "Refused items and blocked templates are described in",
        topicId: "failures",
      },
    ],
  },
  {
    id: "saving",
    title: "Save, reopen, and back up your work",
    group: "Operation",
    blocks: [
      {
        kind: "text",
        text: "The header reports the storage state next to the Workspace name. In the storage-free build that state is a button that opens the privacy details. Where changes are stored in this browser, a reload restores them; while saving or after a save error, the latest changes are not guaranteed to survive a reload. Where nothing is stored, the Workspace is held in memory and reloading or closing the tab discards unexported changes. Template edits are saved only after Save draft to Workspace.",
      },
      {
        kind: "heading",
        text: "Which file to use",
      },
      {
        kind: "example",
        example: {
          title: "Three ways to get data out",
          lines: [
            "Export, in the header      the whole Workspace, reopened with Open",
            "Export, on a package       that package as JSON, reopened as a package",
            "Download package           the deployment ZIP, not meant to be reopened",
          ],
          note: "Package archives contain no administrative templates. Templates travel in the Workspace file.",
        },
      },
      {
        kind: "heading",
        text: "Reopen and back up",
      },
      {
        kind: "steps",
        items: [
          "Open reads a Workspace or package file. Replacing a modified Workspace asks first.",
          "When a package ID already exists, the conflict dialog offers Replace, Import as copy, or Cancel. Import as copy assigns new package and item IDs and leaves the existing package untouched.",
          "Keep a separate backup that autosave will not overwrite. The saved copy is the current state, not a history.",
        ],
      },
      {
        kind: "heading",
        text: "Older files",
      },
      {
        kind: "steps",
        items: [
          "Open the file and check that the packages and items are complete.",
          "Export it under a new name rather than overwriting the original, then open the export again to confirm it reads back.",
        ],
      },
      {
        kind: "note",
        text: "Files written as schema 7 or schema 8 open here. Saving writes schema 8, which older releases cannot read. Other schema versions are rejected.",
      },
    ],
  },
  {
    id: "reference",
    title: "Types, views, context, and state behaviour",
    group: "Reference",
    blocks: [
      {
        kind: "heading",
        text: "Registry types",
      },
      {
        kind: "example",
        example: {
          title: "The type is part of the value",
          lines: [
            'String, data "1"        REG_SZ       the character 1',
            "DWord, data 1           REG_DWORD    the number 1",
            'ExpandString, "%TEMP%"  REG_EXPAND_SZ  expanded by consumers, compared unexpanded',
          ],
          note: "Detection compares the type as well as the data, and compares ExpandString values without expanding environment variables. A rule written for REG_DWORD does not match REG_SZ.",
        },
      },
      {
        kind: "text",
        text: "QWORD values are entered as decimal digits and support the full unsigned 64-bit range. Binary values are byte sequences; MultiString values are lists of strings.",
      },
      {
        kind: "heading",
        text: "Registry views",
      },
      {
        kind: "text",
        text: "On 64-bit Windows a key under HKLM\\Software can exist in the 64-bit view, the 32-bit view, or be redirected depending on the process that opens it. Auto follows the architecture of the PowerShell host, which Use 64-bit PowerShell controls. Registry32 and Registry64 name a view directly, regardless of the host.",
      },
      {
        kind: "text",
        text: "Both applies the item to the 32-bit view and the 64-bit view in turn.",
      },
      {
        kind: "text",
        text: "Redirected keys are the reason a value can be written and still look absent. Software\\WOW6432Node is not written literally; choose the view instead.",
      },
      {
        kind: "heading",
        text: "Run context and user targets",
      },
      {
        kind: "example",
        example: {
          title: "Where HKCU lands",
          lines: [
            "SYSTEM + HKCU + Currently signed-in users   the profiles of users signed in now",
            "SYSTEM + HKCU + All existing user profiles              every applicable local profile",
            "SYSTEM + HKCU + All existing profiles and Default User  the same profiles plus the Default User template",
            "Logged-on user + HKCU                                   the signed-in user only",
          ],
          note: "A SYSTEM package cannot infer which user is meant, so it requires a target. Applicable profiles are the local profiles in the profile list, excluding the well-known system accounts S-1-5-18, S-1-5-19, and S-1-5-20 and the system and service profile paths. Default User applies the value to profiles created later.",
        },
      },
      {
        kind: "heading",
        text: "Removal",
      },
      {
        kind: "steps",
        items: [
          "Delete value removes one named value and leaves the key.",
          "Delete key if empty removes the named value, then removes the key only when nothing else remains under it.",
          "Delete key recursively removes the key and everything below it. This is destructive and warned about, because it removes values the package never wrote.",
        ],
      },
      {
        kind: "heading",
        text: "Revert",
      },
      {
        kind: "text",
        text: "Win32 app packages can define what happens on uninstall. Revert can delete a value the package manages, or restore a value you specify. A recursive delete has no revert option, because one stored value cannot reconstruct a removed subtree.",
      },
    ],
  },
  {
    id: "output",
    title: "Output files, handoff, and verification",
    group: "Reference",
    blocks: [
      {
        kind: "heading",
        text: "Files per delivery method",
      },
      {
        kind: "example",
        example: {
          title: "What each method produces",
          lines: [
            "Intune Remediation    Detect.ps1, Remediate.ps1, DryRun.ps1",
            "Platform Script       Apply.ps1, DryRun.ps1",
            "Win32 app source      Install.ps1, Detect.ps1, Uninstall.ps1 where defined",
          ],
          note: "Every package also carries README.md, registry-summary.csv, registry-package.json, and VERSION.",
        },
      },
      {
        kind: "heading",
        text: "Handoff to Intune",
      },
      {
        kind: "steps",
        items: [
          "Remediation: upload Detect.ps1 as the detection script and Remediate.ps1 as the remediation script.",
          "Platform Script: upload Apply.ps1 and run it in the configured context.",
          "Win32: wrap the source into an .intunewin file with the Microsoft Win32 Content Prep Tool and upload that.",
          "Assignment, targeting, and reporting stay in Intune.",
        ],
      },
      {
        kind: "heading",
        text: "Reading the ERS line",
      },
      {
        kind: "example",
        example: {
          title: "One line per run",
          lines: [
            "ERS; fingerprint=1A2B3C4D; role=Detect; Compliant=1; NonCompliant=0; Errors=0",
            "ERS; fingerprint=1A2B3C4D; role=Remediate; processed=1; errors=0",
            "ERS; fingerprint=1A2B3C4D; role=DryRun; total=1; compliant=0; non-compliant=1; errors=0",
          ],
          note: "The fingerprint identifies the package and also appears in the review dialog and the generated README. The role names the script.",
        },
      },
      {
        kind: "text",
        text: "The counters count evaluations, not changes: each item is evaluated once per view, and profile-targeted items are evaluated for every selected profile and view, so an item with view Both and two selected profiles is evaluated four times. A processed count of one shows that a target was handled, not that its data changed.",
      },
      {
        kind: "heading",
        text: "Verifying on a device",
      },
      {
        kind: "steps",
        items: [
          "Run DryRun.ps1 where the method provides it, then the applicable Remediate, Apply, or Install script in the configured context and architecture.",
          "Inspect the Registry location the item names, including the value type, and run Detect.ps1 where the method provides one to compare its result.",
        ],
      },
      {
        kind: "note",
        text: "Generated scripts are unsigned source material. Signature enforcement requires every script to be signed with a certificate the target devices trust. Require signed scripts sets -ExecutionPolicy AllSigned in the Win32 install and uninstall commands.",
      },
    ],
  },
  {
    id: "failures",
    title: "Rejected items and blocked template downloads",
    group: "Troubleshooting",
    blocks: [
      {
        kind: "text",
        text: "Rejected items cannot be selected. Template authoring issues block review and download.",
      },
      {
        kind: "heading",
        text: "Correct the input",
      },
      {
        kind: "text",
        text: "Correct the field named in the validation message. Common causes are an empty or malformed Registry path, a missing or NUL-containing value name, data that does not match its declared type, an empty template name, display name, explanation, or category, or a version that is not in the form 1.2.3.",
      },
      {
        kind: "text",
        text: "Identifiers must be 1 to 64 characters long, start with a letter, and contain only ASCII letters, digits, and underscores. Policy identifiers must be unique, and the vendor and product namespace must not start with a Microsoft or Windows prefix.",
      },
      {
        kind: "heading",
        text: "This item needs script behaviour",
      },
      {
        kind: "text",
        text: "The item is set to Absent, so it removes state rather than writing it. The value has no name. The type is Binary, MultiString, or QWORD. The view is not Auto. A SYSTEM package that targets user profiles, or includes Default User, is refused, as is a Win32 app item with a configured revert action.",
      },
      {
        kind: "text",
        text: "A template carries a policy definition, so it cannot carry an execution context, an explicit view, or an uninstall action, and an Absent item cannot become a policy. A policy can still delete its managed value for Disabled or Not Configured; that is policy-state behaviour, not an Absent item. Keep the setting in a script package.",
      },
      {
        kind: "heading",
        text: "This target is outside the supported paths",
      },
      {
        kind: "text",
        text: "The path contains WOW6432Node, starts with Software outside Software\\Policies\\<Vendor>\\<Product> and is therefore view-dependent, lies outside Software entirely, or is reserved: System, Software\\Microsoft, or Software\\Policies\\Microsoft, including subpaths. The value name ends in key, password, secret, token, or credential.",
      },
      {
        kind: "text",
        text: "Moving a setting under Software\\Policies does not make an application read it there. Confirm the documented location; if it is outside the supported paths, use a script package.",
      },
      {
        kind: "text",
        text: "The name check is a precaution, not a finding. It matches the end of the name without a word boundary, so Monkey is refused even if it holds nothing sensitive. Renaming it to pass the check leaves the setting in the wrong place.",
      },
      {
        kind: "heading",
        text: "Finish the policy behaviour",
      },
      {
        kind: "text",
        text: "One of the three state behaviours, or the value mode, is still unchosen. Not Configured is set to leave an existing value, which this generator does not support. An ExpandString uses a fixed value instead of administrator input, for the policy or for its Disabled state. A Disabled fixed value does not match the stored type or is not valid for it. A DWORD range is missing, not an integer, outside 0 to 4294967295, or has a minimum above its maximum.",
      },
      {
        kind: "text",
        text: "The message names the policy and the choice.",
      },
      {
        kind: "heading",
        text: "Repair a conflicting or inconsistent policy",
      },
      {
        kind: "text",
        text: "Two policies in the same template resolve to the same hive, path, value name, and view. A policy stores the Registry definition it was created from, called its snapshot; that stored definition no longer satisfies the eligibility rules. A machine policy must target HKEY_LOCAL_MACHINE, and a user policy must target HKEY_CURRENT_USER.",
      },
      {
        kind: "text",
        text: "The first case stops the template from compiling, because the two policies would write the same value. These issues concern the policy's stored definition; correct its target, or recreate the policy with the appropriate hive.",
      },
      {
        kind: "note",
        text: "A source that differs from its policy snapshot is not an error; the package item changed after the policy was created. Choosing Use current source clears the value mode and the state behaviours when the hive, path, value name, or type changed, so the choices have to be made again.",
      },
      {
        kind: "ref",
        text: "The settings a template can carry are described in",
        topicId: "templates",
      },
    ],
  },
  {
    id: "examples",
    title: "Worked examples",
    group: "Examples",
    blocks: [
      {
        kind: "heading",
        text: "Apply a value to existing user profiles from a SYSTEM package",
      },
      {
        kind: "steps",
        items: [
          "Create a script deployment package. The two menus in the header already read Intune Remediation and SYSTEM; if the run context shows Logged-on user, choose SYSTEM there.",
          "Add an item with hive HKEY_CURRENT_USER, path Software\\Northgate\\Demo, value name Theme, type String, and value dark.",
          "Choose All existing user profiles. The item cannot be saved without a target.",
          "To include profiles created later, choose All existing profiles and Default User instead.",
          "Review the generated scripts. Detection reads the applicable profiles, loading offline hives when necessary and unloading only the hives it loaded.",
          "On a test device with two applicable profiles, run Remediate.ps1 as SYSTEM, inspect both profiles, then run Detect.ps1.",
        ],
      },
      {
        kind: "heading",
        text: "Introduce and correct drift",
      },
      {
        kind: "steps",
        items: [
          "Change the value inside one profile and run Detect.ps1 again. It reports a difference for that profile and leaves the others compliant.",
          "Run Remediate.ps1 and confirm that the changed profile is corrected.",
        ],
      },
      {
        kind: "example",
        example: {
          title: "Where the value ends up",
          lines: [
            "HKEY_USERS\\<SID of profile A>\\Software\\Northgate\\Demo\\Theme",
            "HKEY_USERS\\<SID of profile B>\\Software\\Northgate\\Demo\\Theme",
          ],
          note: "Each selected profile receives the value in its own hive. A profile that is not selected is untouched.",
        },
      },
      {
        kind: "note",
        text: "This item cannot become an administrative template policy. A template rejects SYSTEM processing of user profiles, and the Registry path would have to be under Software\\Policies\\<Vendor>\\<Product>.",
      },
      {
        kind: "heading",
        text: "Deploy a Registry setting and define its uninstall value",
      },
      {
        kind: "steps",
        items: [
          "Create a script deployment package and choose Win32 app source.",
          "Add a Present item targeting HKLM\\Software\\Northgate\\Demo, named Enabled, with type DWord and value 1.",
          "In Revert behavior, choose Set a defined value, and set Revert value type to DWord and Revert value to 0. A Win32 app package shows this region without a second step.",
          "Review the output. Install.ps1 writes the value, Detect.ps1 checks it, and Uninstall.ps1 writes the defined value.",
          "Wrap the source into an .intunewin file, upload it, and assign it to a test device.",
        ],
      },
      {
        kind: "heading",
        text: "Verify uninstall behaviour",
      },
      {
        kind: "steps",
        items: [
          "Install the Registry package on the test device and confirm the value it writes.",
          "Uninstall it and confirm that the value you defined under Revert is present again.",
        ],
      },
      {
        kind: "example",
        example: {
          title: "Revert options",
          lines: [
            "No revert action                 uninstall leaves the value in place",
            "Delete managed value             uninstall removes the value the package wrote",
            "Set a defined value              uninstall writes the value you specify",
          ],
          note: "Revert can restore a value you know. It cannot restore data the package never recorded.",
        },
      },
      {
        kind: "note",
        text: "A value the application itself rewrites is a poor candidate for restore. Choose a value the package owns and nothing else writes.",
      },
      {
        kind: "ref",
        text: "The first end-to-end run is described in",
        topicId: "first-package",
      },
    ],
  },
];
