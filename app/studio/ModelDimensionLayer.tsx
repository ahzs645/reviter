"use client";
import { useEffect, useRef } from "react";
import { dimensionLabel, type ReviewDimension } from "./review-session.ts";
import type { CommentProjection } from "./ModelCommentLayer.tsx";
export function ModelDimensionLayer({ dimensions, project }: { dimensions: readonly ReviewDimension[]; project: (dimension: ReviewDimension) => CommentProjection | null }) {
  const nodes = useRef(new Map<string, HTMLSpanElement>());
  useEffect(() => {
    if (!dimensions.length) return;
    let frame = 0, last = -Infinity;
    const place = (time: number) => {
      if (time - last > 60) {
        last = time;
        for (const dimension of dimensions) {
          const node = nodes.current.get(dimension.id); if (!node) continue;
          const point = project(dimension);
          node.style.visibility = point?.visible ? "visible" : "hidden";
          if (point?.visible) node.style.transform = `translate(${point.x}px, ${point.y}px)`;
        }
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place); return () => cancelAnimationFrame(frame);
  }, [dimensions, project]);
  return <div className="model-dimension-layer" aria-label="Model dimension labels">{dimensions.map(d => <span key={d.id} ref={node => { if (node) nodes.current.set(d.id, node); else nodes.current.delete(d.id); }}>{dimensionLabel(d)}</span>)}</div>;
}
