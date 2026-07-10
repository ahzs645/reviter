import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ReviterStudio from "../app/ReviterStudio";
import "../app/globals.css";

globalThis.__REVITER_STATIC_WORKERS__ = {
  rvt: new URL("./assets/worker-runtime.js", document.baseURI).href,
  ifc: new URL("./assets/ifc-worker-runtime.js", document.baseURI).href,
};

const root = document.getElementById("root");
if (!root) throw new Error("Reviter root element was not found.");
const referencePreview = new URLSearchParams(window.location.search).get("reference") === "autodesk";

createRoot(root).render(
  <StrictMode>
    <ReviterStudio referencePreview={referencePreview} />
  </StrictMode>,
);
