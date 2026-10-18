"use client";
import type { CameraPreset } from "../../lib/reviter/viewer.ts";
export function OrientationWidget({ onView }: { onView: (preset: CameraPreset) => void }) {
  return <nav className="orientation-widget" aria-label="Model orientation">
    <button type="button" onClick={() => onView("top")} aria-label="Orient model top">Top</button>
    <div><button type="button" onClick={() => onView("front")} aria-label="Orient model front">Front</button><button type="button" onClick={() => onView("right")} aria-label="Orient model right">Right</button></div>
    <button type="button" onClick={() => onView("seIso")} aria-label="Orient model home">Home ↗</button>
  </nav>;
}
