import { createRegistryDefinition } from "../domain/registry/model";
import {
  createDeploymentPackage,
  createRegistryItem,
  createWorkspace,
  type RegistryWorkspace,
} from "../domain/workspace/workspace";

export interface SampleWorkspaceFile {
  fileName: string;
  title: string;
  summary: string;
  workspace: RegistryWorkspace;
}

function sample(
  fileName: string,
  title: string,
  summary: string,
  workspace: RegistryWorkspace,
): SampleWorkspaceFile {
  return { fileName, title, summary, workspace };
}

export const SAMPLE_WORKSPACES: readonly SampleWorkspaceFile[] = [
  sample(
    "01-hklm-dword.registry-workspace.json",
    "HKLM DWORD",
    "One DWORD under HKLM.",
    createWorkspace({
      id: "11111111-1111-4111-8111-111111111101",
      name: "Sample · HKLM DWORD",
      packages: [
        createDeploymentPackage({
          id: "22222222-2222-4222-8222-222222222201",
          name: "HKLM DWORD",
          items: [
            createRegistryItem({
              id: "33333333-3333-4333-8333-333333333301",
              registry: createRegistryDefinition({
                hive: "HKEY_LOCAL_MACHINE",
                keyPath: "Software\\EndpointRegistryStudio\\Samples\\DWord",
                valueName: "Enabled",
                value: { type: "DWord", data: 1 },
              }),
            }),
          ],
        }),
      ],
    }),
  ),
  sample(
    "02-unicode-string.registry-workspace.json",
    "Unicode string",
    "One Unicode string under HKLM.",
    createWorkspace({
      id: "11111111-1111-4111-8111-111111111102",
      name: "Sample · Unicode string",
      packages: [
        createDeploymentPackage({
          id: "22222222-2222-4222-8222-222222222202",
          name: "Unicode string",
          items: [
            createRegistryItem({
              id: "33333333-3333-4333-8333-333333333302",
              registry: createRegistryDefinition({
                hive: "HKEY_LOCAL_MACHINE",
                keyPath: "Software\\EndpointRegistryStudio\\Samples\\Unicode",
                valueName: "Greeting",
                value: { type: "String", data: "Grüße" },
              }),
            }),
          ],
        }),
      ],
    }),
  ),
  sample(
    "03-hkcu-signed-in-users.registry-workspace.json",
    "HKCU signed-in users",
    "HKCU for currently signed-in users, SYSTEM context.",
    createWorkspace({
      id: "11111111-1111-4111-8111-111111111103",
      name: "Sample · HKCU signed-in users",
      packages: [
        createDeploymentPackage({
          id: "22222222-2222-4222-8222-222222222203",
          name: "HKCU signed-in users",
          items: [
            createRegistryItem({
              id: "33333333-3333-4333-8333-333333333303",
              registry: createRegistryDefinition({
                hive: "HKEY_CURRENT_USER",
                keyPath: "Software\\EndpointRegistryStudio\\Samples\\SignedIn",
                valueName: "ShowStatus",
                value: { type: "DWord", data: 1 },
              }),
              userHive: { userHiveTarget: "AllSignedInUsers", includeDefaultUser: false },
            }),
          ],
        }),
      ],
    }),
  ),
  sample(
    "04-hkcu-all-profiles-default-user.registry-workspace.json",
    "HKCU all profiles and Default User",
    "HKCU for all existing profiles plus Default User, SYSTEM context.",
    createWorkspace({
      id: "11111111-1111-4111-8111-111111111104",
      name: "Sample · HKCU all profiles and Default User",
      packages: [
        createDeploymentPackage({
          id: "22222222-2222-4222-8222-222222222204",
          name: "HKCU all profiles and Default User",
          items: [
            createRegistryItem({
              id: "33333333-3333-4333-8333-333333333304",
              registry: createRegistryDefinition({
                hive: "HKEY_CURRENT_USER",
                keyPath: "Software\\EndpointRegistryStudio\\Samples\\AllProfiles",
                valueName: "ShowStatus",
                value: { type: "DWord", data: 1 },
              }),
              userHive: { userHiveTarget: "AllExistingProfiles", includeDefaultUser: true },
            }),
          ],
        }),
      ],
    }),
  ),
  sample(
    "05-value-deletion.registry-workspace.json",
    "Value deletion",
    "Absent DWORD value under HKLM.",
    createWorkspace({
      id: "11111111-1111-4111-8111-111111111105",
      name: "Sample · Value deletion",
      packages: [
        createDeploymentPackage({
          id: "22222222-2222-4222-8222-222222222205",
          name: "Value deletion",
          items: [
            createRegistryItem({
              id: "33333333-3333-4333-8333-333333333305",
              registry: createRegistryDefinition({
                hive: "HKEY_LOCAL_MACHINE",
                keyPath: "Software\\EndpointRegistryStudio\\Samples\\Delete",
                valueName: "LegacyFlag",
                desiredState: "Absent",
                deletionMode: "Value",
                value: { type: "DWord", data: 0 },
              }),
            }),
          ],
        }),
      ],
    }),
  ),
  sample(
    "06-win32-revert.registry-workspace.json",
    "Win32 with revert",
    "Win32 App DWORD with delete-on-uninstall.",
    createWorkspace({
      id: "11111111-1111-4111-8111-111111111106",
      name: "Sample · Win32 with revert",
      packages: [
        createDeploymentPackage({
          id: "22222222-2222-4222-8222-222222222206",
          name: "Win32 with revert",
          deployment: {
            method: "Win32App",
            runContext: "System",
            runIn64BitPowerShell: true,
            enforceSignatureCheck: false,
          },
          items: [
            createRegistryItem({
              id: "33333333-3333-4333-8333-333333333306",
              registry: createRegistryDefinition({
                hive: "HKEY_LOCAL_MACHINE",
                keyPath: "Software\\EndpointRegistryStudio\\Samples\\Win32",
                valueName: "Installed",
                value: { type: "DWord", data: 1 },
                rollbackMode: "DeleteManagedValue",
              }),
            }),
          ],
        }),
      ],
    }),
  ),
];
