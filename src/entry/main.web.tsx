import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WebWorkbench } from "../application/WebWorkbench";
import { loadRuntimeConfig } from "../application/runtimeConfig";
import "../styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}

void loadRuntimeConfig().then((runtimeConfig) => {
  createRoot(rootElement).render(
    <StrictMode>
      <WebWorkbench runtimeConfig={runtimeConfig} />
    </StrictMode>,
  );
});
