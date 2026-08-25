import { useTransientWorkspaceLifecycle } from "../platform/browser/transientWorkspaceTransfer";
import { WorkbenchCore } from "./WorkbenchCore";
import type { RuntimeConfig } from "./runtimeConfig";

export function WebWorkbench({ runtimeConfig }: { runtimeConfig?: RuntimeConfig }) {
  return (
    <WorkbenchCore
      {...(runtimeConfig ? { runtimeConfig } : {})}
      useWorkspaceLifecycle={useTransientWorkspaceLifecycle}
    />
  );
}
