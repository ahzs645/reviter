import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ReviterStudio from "../app/ReviterStudio";
import "./fonts.css";
import "../app/globals.css";

globalThis.__REVITER_BUILD_VERSION__ = __REVITER_PAGES_BUILD_VERSION__;

globalThis.__REVITER_STATIC_WORKERS__ = {
  rvt: new URL("./assets/worker-runtime.js", document.baseURI).href,
  ifc: new URL("./assets/ifc-worker-runtime.js", document.baseURI).href,
  dwg: new URL("./assets/dwg-worker-runtime.js", document.baseURI).href,
  plan: new URL("./assets/floor-plan-worker-runtime.js", document.baseURI).href,
  regions: new URL("./assets/floor-regions-worker-runtime.js", document.baseURI).href,
};

const root = document.getElementById("root");
if (!root) throw new Error("Reviter root element was not found.");
// `?reference=autodesk` used to open the studio straight into a bundled
// derivative of one building. There is no bundled reference any more — a
// reference is paired from disk, per model — so there is nothing to preview.
createRoot(root).render(
  <StrictMode>
    <ReviterStudio />
  </StrictMode>,
);
