"use client";
import type { CSSProperties } from "react";
export function DockResize({ side, value, onChange }: { side: "left" | "right"; value: number; onChange: (width: number) => void }) {
  const constrain = (width: number) => onChange(Math.max(210, Math.min(420, width)));
  return <div className={`dock-resize dock-resize-${side}`} role="separator" tabIndex={0}
    aria-label={`Resize ${side === "left" ? "browser" : "properties"} panel`} aria-orientation="vertical"
    aria-valuemin={210} aria-valuemax={420} aria-valuenow={value}
    style={{ "--dock-width": `${value}px` } as CSSProperties}
    onDoubleClick={() => onChange(side === "left" ? 280 : 296)}
    onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); constrain(value + (event.key === "ArrowRight" ? 10 : -10) * (side === "right" ? -1 : 1)); }
      if (event.key === "Home") { event.preventDefault(); constrain(210); }
      if (event.key === "End") { event.preventDefault(); constrain(420); }
    }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const node = event.currentTarget;
      const panel = side === "left" ? node.previousElementSibling : node.nextElementSibling;
      const start = event.clientX, width = panel?.getBoundingClientRect().width ?? value;
      const move = (next: PointerEvent) => constrain(width + (next.clientX - start) * (side === "right" ? -1 : 1));
      const end = () => { node.removeEventListener("pointermove", move); node.removeEventListener("pointerup", end); node.removeEventListener("pointercancel", end); };
      node.addEventListener("pointermove", move); node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
    }} />;
}
