import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DockerWorkbench } from "../application/DockerWorkbench";
import { loadRuntimeConfig } from "../application/runtimeConfig";
import "../styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}

void loadRuntimeConfig().then((runtimeConfig) => {
  createRoot(rootElement).render(
    <StrictMode>
      <DockerWorkbench runtimeConfig={runtimeConfig} />
    </StrictMode>,
  );
});
