/** Plan-view SVG of the recovered footprint. */
import type { ConvertResult, Segment } from "./types";

function segmentBounds(segments: Segment[]) {
  const xs = segments.flatMap((segment) => [segment.x0, segment.x1]);
  const ys = segments.flatMap((segment) => [segment.y0, segment.y1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function makePlanSvg(result: ConvertResult): string {
  const { minX, maxX, minY, maxY } = segmentBounds(result.segments);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const strokeWidth = Math.max(width, height) / 1_200;
  const paths = result.segments
    .map(
      (segment) =>
        `<path d="M ${segment.x0 - minX} ${maxY - segment.y0} L ${segment.x1 - minX} ${maxY - segment.y1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recovered RVT plan centerlines">
  <rect width="100%" height="100%" fill="#f4f1e9"/>
  <g fill="none" stroke="#143e46" stroke-width="${strokeWidth}" stroke-linecap="round" vector-effect="non-scaling-stroke">${paths}</g>
</svg>`;
}
