/** Detect and crop independently drafted plan panels in decoded DWG SVGs. */

export type FloorReferenceCatalogBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloorReferenceCatalogSection = {
  id: string;
  label: string;
  bounds: FloorReferenceCatalogBounds;
};

export type FloorReferenceCatalog = {
  viewBox: FloorReferenceCatalogBounds;
  sections: FloorReferenceCatalogSection[];
};

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu;

function attribute(attributes: string, name: string) {
  return attributes.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, "iu"))?.[1] ?? null;
}

function numbers(value: string) {
  return Array.from(value.matchAll(NUMBER), (match) => Number(match[0])).filter(Number.isFinite);
}

function boundsFromPath(path: string): FloorReferenceCatalogBounds | null {
  if (!/[zZ]\s*$/u.test(path.trim())) return null;
  const values = numbers(path);
  if (values.length < 8 || values.length % 2 !== 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < values.length; index += 2) {
    xs.push(values[index]!);
    ys.push(values[index + 1]!);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;
  const tolerance = Math.max(width, height) * 1e-7;
  const onRectangle = xs.every((x, index) => (
    Math.abs(x - minX) <= tolerance || Math.abs(x - maxX) <= tolerance ||
    Math.abs(ys[index]! - minY) <= tolerance || Math.abs(ys[index]! - maxY) <= tolerance
  ));
  return onRectangle ? { x: minX, y: minY, width, height } : null;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function sameBounds(left: FloorReferenceCatalogBounds, right: FloorReferenceCatalogBounds) {
  const scale = Math.max(left.width, left.height, right.width, right.height, 1);
  const close = (a: number, b: number) => Math.abs(a - b) <= scale * 1e-7;
  return close(left.x, right.x) && close(left.y, right.y) &&
    close(left.width, right.width) && close(left.height, right.height);
}

/**
 * Decoded DWG catalogues commonly use green, closed rectangular frames around
 * independently positioned plans. This reader indexes only those explicit
 * frames; it does not infer panels from arbitrary linework.
 */
export function parseFloorReferenceCatalogSvg(svg: string): FloorReferenceCatalog | null {
  const svgOpen = svg.match(/<svg\b([^>]*)>/iu);
  const viewBoxValues = numbers(svgOpen ? attribute(svgOpen[1]!, "viewBox") ?? "" : "");
  if (viewBoxValues.length !== 4 || !(viewBoxValues[2]! > 0) || !(viewBoxValues[3]! > 0)) return null;
  const viewBox = {
    x: viewBoxValues[0]!,
    y: viewBoxValues[1]!,
    width: viewBoxValues[2]!,
    height: viewBoxValues[3]!,
  };

  const frames: Array<{ sourceId: string; bounds: FloorReferenceCatalogBounds }> = [];
  const group = /<g\b([^>]*)>\s*<path\b([^>]*)\/?>(?:<\/path>)?\s*<\/g>/giu;
  for (const match of svg.matchAll(group)) {
    const groupAttributes = match[1]!;
    const stroke = (attribute(groupAttributes, "stroke") ?? "").replace(/\s+/gu, "").toLowerCase();
    if (stroke !== "rgb(0,127,31)" && stroke !== "#007f1f") continue;
    const path = attribute(match[2]!, "d");
    const bounds = path ? boundsFromPath(path) : null;
    if (!bounds || frames.some((frame) => sameBounds(frame.bounds, bounds))) continue;
    frames.push({ sourceId: attribute(groupAttributes, "id") ?? `frame-${frames.length + 1}`, bounds });
  }
  if (!frames.length) return null;

  const labels: Array<{ x: number; y: number; text: string }> = [];
  const text = /<text\b([^>]*)>([^<]*)<\/text>/giu;
  for (const match of svg.matchAll(text)) {
    const x = Number(attribute(match[1]!, "x"));
    const y = Number(attribute(match[1]!, "y"));
    const fontSize = Number(attribute(match[1]!, "font-size"));
    const value = decodeXmlText(match[2]!);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(fontSize) && fontSize >= 350 && value) {
      labels.push({ x, y, text: value });
    }
  }

  const sections = frames
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x)
    .map((frame, index) => {
      const { x, y, width, height } = frame.bounds;
      const contained = labels
        .filter((label) => label.x >= x && label.x <= x + width && label.y >= y && label.y <= y + height)
        .sort((left, right) => left.y - right.y || left.x - right.x)
        .map((label) => label.text);
      return {
        id: frame.sourceId,
        label: contained.length ? Array.from(new Set(contained)).join(" · ") : `Plan section ${index + 1}`,
        bounds: frame.bounds,
      };
    });
  return { viewBox, sections };
}

/**
 * Give an SVG an absolute intrinsic size, taken from its viewBox.
 *
 * An SVG referenced by an `<image>` element is loaded as an image, and Chromium
 * draws nothing at all for an image with no intrinsic size — a bare `viewBox`,
 * or `width="100%"`, both count as none. That silently blanked every SVG
 * reference: the architectural plan this application exports carries only a
 * viewBox, and LibreDWG's own SVG writes percentages. Sizes already stated in
 * absolute units are left alone, and an SVG with no viewBox to measure is
 * returned untouched rather than guessed at.
 */
export function withFloorReferenceIntrinsicSize(svg: string) {
  const tag = svg.match(/<svg\b[^>]*>/iu)?.[0];
  if (!tag) return svg;
  const declared = (name: string) => {
    const value = attribute(tag, name);
    return value != null && /^\s*[-+]?(?:\d+\.?\d*|\.\d+)\s*(?:px)?\s*$/iu.test(value);
  };
  if (declared("width") && declared("height")) return svg;

  const viewBox = attribute(tag, "viewBox");
  if (!viewBox) return svg;
  const values = numbers(viewBox);
  if (values.length < 4) return svg;
  const [, , width, height] = values as [number, number, number, number];
  if (!(width > 0) || !(height > 0)) return svg;

  const stripped = tag
    .replace(/(?:^|\s)width=["'][^"']*["']/iu, "")
    .replace(/(?:^|\s)height=["'][^"']*["']/iu, "");
  return svg.replace(tag, `${stripped.slice(0, 4)} width="${width}" height="${height}"${stripped.slice(4)}`);
}

/** Return the original decoded SVG with its viewport cropped to one panel. */
export function cropFloorReferenceCatalogSvg(
  svg: string,
  bounds: FloorReferenceCatalogBounds,
  paddingRatio = 0.025,
) {
  const padding = Math.max(bounds.width, bounds.height) * Math.max(0, paddingRatio);
  const viewBox = [
    bounds.x - padding,
    bounds.y - padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2,
  ].join(" ");
  if (!/<svg\b[^>]*\bviewBox=["'][^"']+["']/iu.test(svg)) {
    throw new Error("The decoded SVG does not have a viewBox to crop.");
  }
  const cropped = svg.replace(/(<svg\b[^>]*\bviewBox=)["'][^"']+["']/iu, `$1"${viewBox}"`);
  // A crop is a new viewport, so any size inherited from the whole drawing now
  // describes the wrong shape and would show the section stretched. Dropping it
  // lets the size be remeasured from the viewBox that was just written.
  const tag = cropped.match(/<svg\b[^>]*>/iu)![0];
  const unsized = tag
    .replace(/(?:^|\s)width=["'][^"']*["']/iu, "")
    .replace(/(?:^|\s)height=["'][^"']*["']/iu, "");
  return withFloorReferenceIntrinsicSize(cropped.replace(tag, unsized));
}
