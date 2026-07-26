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

/** Must match `.object-list > .object-row` in globals.css. */
const ROW_HEIGHT = 48;

/** Rows rendered beyond each edge, so a fast scroll does not show a gap. */
const OVERSCAN = 6;

export function ObjectList({
  records,
  selectedElementId,
  onSelect,
}: {
  records: ElementBoundsRecord[];
  selectedElementId: number | null;
  onSelect: (elementId: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 480 });

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (element) setViewport({ top: element.scrollTop, height: element.clientHeight || 480 });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  // Picking in the viewport should bring the row into view; the list used to
  // stay wherever it was, which made selection feel like it had not happened.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selectedElementId == null) return;
    const index = records.findIndex((record) => record.elementId === selectedElementId);
    if (index < 0) return;
    const rowTop = index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < element.scrollTop) element.scrollTop = rowTop;
    else if (rowBottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = rowBottom - element.clientHeight;
    }
  }, [records, selectedElementId]);

  const first = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    records.length,
    Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN,
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
      <div style={{ height: first * ROW_HEIGHT }} />
      {visible.map((record) => {
        const dimensions = boundsDimensions(record.boundsFeet);
        return (
          <button
            key={record.elementId}
            className={`object-row${selectedElementId === record.elementId ? " selected" : ""}`}
            onClick={() => onSelect(record.elementId)}
            role="option"
            aria-selected={selectedElementId === record.elementId}
          >
            <span><i />{record.categoryName ?? "Uncategorised"} <em>{record.elementId}</em></span>
            <small>{dimensions.x.toFixed(1)} × {dimensions.y.toFixed(1)} × {dimensions.z.toFixed(1)} ft</small>
          </button>
        );
      })}
      <div style={{ height: Math.max(0, (records.length - last) * ROW_HEIGHT) }} />
    </div>
  );
}
