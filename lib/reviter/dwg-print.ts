export const DWG_PAPER_SIZES = {
  Letter: [215.9, 279.4], Tabloid: [279.4, 431.8], A4: [210, 297], A3: [297, 420],
} as const;
export type DwgPaperSize = keyof typeof DWG_PAPER_SIZES;
export type DwgSheetOptions = {
  title: string;
  source: string;
  date: string;
  /** Null uses fit-to-page; a physical scale requires declared drawing units. */
  scale: number | null;
  feetPerUnit: number | null;
  layers?: readonly string[];
  annotations?: string;
};

const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]!));

export function dwgSheetGeometry(bounds: readonly number[], paper: DwgPaperSize, landscape: boolean, scale: number | null, feetPerUnit: number | null) {
  const dimensions = DWG_PAPER_SIZES[paper], pageWidth = dimensions[landscape ? 1 : 0], pageHeight = dimensions[landscape ? 0 : 1];
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2]! <= 0 || bounds[3]! <= 0) throw new Error("The drawing has invalid printable bounds.");
  if (scale !== null && (!(Number.isFinite(scale) && scale > 0) || !(feetPerUnit && Number.isFinite(feetPerUnit) && feetPerUnit > 0))) throw new Error("Choose drawing units before printing at a physical scale.");
  const availableWidth = pageWidth - 24, availableHeight = pageHeight - 58;
  const mmPerUnit = scale === null ? Math.min(availableWidth / bounds[2]!, availableHeight / bounds[3]!) : feetPerUnit! * 304.8 / scale;
  const width = bounds[2]! * mmPerUnit, height = bounds[3]! * mmPerUnit;
  if (width > availableWidth + 1e-6 || height > availableHeight + 1e-6) throw new Error("This scale does not fit the sheet. Choose a larger scale denominator or paper size.");
  return { pageWidth, pageHeight, x: 12 + (availableWidth - width) / 2, y: 12 + (availableHeight - height) / 2, width, height, mmPerUnit };
}

/** A fit-to-page preview of recovered linework, without inspection highlights or UI. */
export function dwgPrintSvg(svg: string, paper: DwgPaperSize, landscape: boolean, options?: DwgSheetOptions): string {
  const dimensions = DWG_PAPER_SIZES[paper];
  const width = dimensions[landscape ? 1 : 0], height = dimensions[landscape ? 0 : 1];
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error("The drawing has no printable bounds.");
  const content = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  if (options) {
    const geometry = dwgSheetGeometry(viewBox.trim().split(/\s+/).map(Number), paper, landscape, options.scale, options.feetPerUnit);
    const { x, y, width: drawingWidth, height: drawingHeight, mmPerUnit } = geometry;
    const titleY = height - 42;
    const mmPerFoot = options.feetPerUnit ? mmPerUnit / options.feetPerUnit : null;
    const maxFeet = mmPerFoot ? Math.min(45, (width - 24) / 4) / mmPerFoot : null;
    const magnitude = maxFeet ? 10 ** Math.floor(Math.log10(maxFeet)) : null;
    const barFeet = magnitude && maxFeet ? [5, 2, 1].map(n => n * magnitude).find(n => n <= maxFeet) ?? magnitude : null;
    const barWidth = barFeet && mmPerFoot ? barFeet * mmPerFoot : null;
    const scaleBar = barWidth && barFeet ? `<g data-scale-bar-feet="${barFeet}" stroke="#111827" fill="none"><path d="M12 ${titleY - 6}h${barWidth}m-${barWidth} -2v4m${barWidth} -4v4" stroke-width="0.3"/><text x="12" y="${titleY - 10}" stroke="none" fill="#111827" font-size="2.5">${barFeet} ft</text></g>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Review sheet">
      <rect width="${width}" height="${height}" fill="white"/>
      <rect x="12" y="12" width="${width - 24}" height="${height - 24}" fill="none" stroke="#111827" stroke-width="0.3"/>
      <svg data-sheet-mm-per-unit="${mmPerUnit}" x="${x}" y="${y}" width="${drawingWidth}" height="${drawingHeight}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${content}${options.annotations ?? ""}<style>svg > rect{fill:white}.dwg{stroke:#111827}.dwg-text{fill:#111827}</style></svg>
      ${scaleBar}<path d="M12 ${titleY}H${width - 12}" stroke="#111827" stroke-width="0.3"/>
      <g fill="#111827" font-family="system-ui,sans-serif"><text x="16" y="${titleY + 7}" font-size="4">${xml(options.title.slice(0, 90))}</text>
      <text x="16" y="${titleY + 13}" font-size="2.6">Source: ${xml(options.source.slice(0, 110))}</text>
      <text x="16" y="${titleY + 19}" font-size="2.6">${xml(options.date)} · ${options.scale === null ? "Fit to page" : `Scale 1:${options.scale}`} · Review annotations</text>
      <text x="16" y="${titleY + 25}" font-size="2.2">Layers: ${xml((options.layers ?? []).slice(0, 6).join(", ").slice(0, 100))}${(options.layers?.length ?? 0) > 6 ? " …" : ""}</text></g>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="Print preview">
    <rect width="${width}" height="${height}" fill="white"/>
    <svg x="12" y="12" width="${width - 24}" height="${height - 24}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${content}
      <style>svg > rect{fill:white}.dwg{stroke:#111827}.dwg-text{fill:#111827}</style>
    </svg></svg>`;
}
