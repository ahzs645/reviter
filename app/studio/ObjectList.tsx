"use client";

/**
 * The object list, windowed.
 *
 * It used to render `records.slice(0, 180)` and tell you to search if you
 * wanted the rest — the one place the interface admitted it could not show you
 * the model. Rows are a fixed height, so only the ones inside the scroll
 * viewport (plus a little overscan) need to exist; the rest are two spacer
 * divs. 33,000 objects then cost the same as 20.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { boundsDimensions, type ElementBoundsRecord } from "../../lib/reviter";

/** Must match `.object-row` in globals.css. */
export const ROW_HEIGHT = 46;

/** And `.mobile .object-row`, where the row is sized as a touch target. */
export const MOBILE_ROW_HEIGHT = 58;

/** Rows rendered beyond each edge, so a fast scroll does not show a gap. */
const OVERSCAN = 6;

export function ObjectList({
  records,
  selectedElementId,
  onSelect,
  rowHeight = ROW_HEIGHT,
}: {
  records: ElementBoundsRecord[];
  selectedElementId: number | null;
  onSelect: (elementId: number) => void;
  rowHeight?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 480 });

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (element) {
      const next = { top: element.scrollTop, height: element.clientHeight || 480 };
      setViewport((current) => current.top === next.top && current.height === next.height ? current : next);
    }
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [measure]);

  // Picking in the viewport should bring the row into view; the list used to
  // stay wherever it was, which made selection feel like it had not happened.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selectedElementId == null) return;
    const index = records.findIndex((record) => record.elementId === selectedElementId);
    if (index < 0) return;
    const rowTop = index * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < element.scrollTop) element.scrollTop = rowTop;
    else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = rowBottom - element.clientHeight;
    }
  }, [records, rowHeight, selectedElementId]);

  const first = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN);
  const last = Math.min(
    records.length,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN,
  );
  const visible = records.slice(first, last);

  return (
    <div
      className="object-list"
      role="listbox"
      aria-label="Recovered Revit objects"
      ref={scrollRef}
      onScroll={measure}
    >
      <div style={{ height: first * rowHeight }} />
      {visible.map((record) => {
        const dimensions = boundsDimensions(record.boundsFeet);
        const selected = selectedElementId === record.elementId;
        return (
          <button
            key={record.elementId}
            type="button"
            className={`object-row${selected ? " selected" : ""}`}
            onClick={() => onSelect(record.elementId)}
            role="option"
            aria-selected={selected}
          >
            <span>
              <i />
              <b>{record.categoryName ?? "Uncategorised"}</b>
              <em>{record.elementId}</em>
            </span>
            <small>{dimensions.x.toFixed(1)} × {dimensions.y.toFixed(1)} × {dimensions.z.toFixed(1)} ft</small>
          </button>
        );
      })}
      <div style={{ height: Math.max(0, (records.length - last) * rowHeight) }} />
    </div>
  );
}
