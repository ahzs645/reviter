"use client";

import { useSyncExternalStore } from "react";

import type { PlanTheme } from "../../lib/reviter/architectural-plan.ts";

/**
 * The active theme, read from `<html data-theme>`.
 *
 * The theme deliberately lives on the document rather than in React state (see
 * `toggleTheme` in ReviterStudio), because nothing in the tree needs to
 * re-render when it flips — the tokens are swapped by CSS. Drawings are the
 * exception: the plan SVG carries its own stylesheet and page CSS cannot reach
 * inside it, so the renderer has to be told which ink to use. This subscribes
 * to the attribute so those surfaces, and only those, re-render on a flip.
 */
export function useTheme(): PlanTheme {
  return useSyncExternalStore(subscribe, read, () => "dark" as const);
}

function read(): PlanTheme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
