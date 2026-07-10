import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ReviterStudio from "../app/ReviterStudio";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Reviter root element was not found.");

createRoot(root).render(
  <StrictMode>
    <ReviterStudio />
  </StrictMode>,
);
