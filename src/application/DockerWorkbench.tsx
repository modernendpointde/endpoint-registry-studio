import { useDockerWorkspaceLifecycle } from "./DockerWorkspaceLifecycle";
import { WorkbenchCore } from "./WorkbenchCore";
import type { RuntimeConfig } from "./runtimeConfig";

export function DockerWorkbench({ runtimeConfig }: { runtimeConfig?: RuntimeConfig }) {
  return (
    <WorkbenchCore
      {...(runtimeConfig ? { runtimeConfig } : {})}
      useWorkspaceLifecycle={useDockerWorkspaceLifecycle}
    />
  );
}
