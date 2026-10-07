export const DWG_PAPER_SIZES = {
  Letter: [215.9, 279.4], Tabloid: [279.4, 431.8], A4: [210, 297], A3: [297, 420],
} as const;
export type DwgPaperSize = keyof typeof DWG_PAPER_SIZES;

/** A fit-to-page preview of recovered linework, without inspection highlights or UI. */
export function dwgPrintSvg(svg: string, paper: DwgPaperSize, landscape: boolean): string {
  const dimensions = DWG_PAPER_SIZES[paper];
  const width = dimensions[landscape ? 1 : 0], height = dimensions[landscape ? 0 : 1];
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error("The drawing has no printable bounds.");
  const content = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Print preview">
    <rect width="${width}" height="${height}" fill="white"/>
    <svg x="12" y="12" width="${width - 24}" height="${height - 24}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${content}
      <style>svg > rect{fill:white}.dwg{stroke:#111827}.dwg-text{fill:#111827}</style>
    </svg></svg>`;
}
