/**
 * Browser-safe family metadata from the optional `PartAtom` XML stream.
 *
 * The bundled Rust/WASM reader parses the XML and returns a plain JS summary.
 * This adapter validates that untyped boundary and deliberately drops
 * `raw_xml`, so worker messages and JSON reports carry useful metadata rather
 * than an unbounded duplicate of the source stream.
 */

export type PartAtomTerm = {
  term: string;
  label?: string;
  scheme?: string;
};

export type PartAtomParameter = {
  name: string;
  displayName?: string;
  sourceType?: string;
  id?: string;
  parameterType?: string;
  units?: string;
  value: string;
};

export type PartAtomFamilyType = {
  title: string;
  sourceType?: string;
  parameters: PartAtomParameter[];
};

export type PartAtomDesignFile = {
  title?: string;
  product?: string;
  productVersion?: number;
  updated?: string;
};

export type PartAtomLink = {
  rel?: string;
  type?: string;
  href?: string;
  files: PartAtomDesignFile[];
};

export type PartAtomMetadata = {
  /** First family type title, falling back to the Atom entry title. */
  title?: string;
  id?: string;
  entryTitle?: string;
  updated?: string;
  categories: PartAtomTerm[];
  taxonomies: PartAtomTerm[];
  links: PartAtomLink[];
  familyType?: string;
  variationCount?: number;
  types: PartAtomFamilyType[];
};

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function terms(value: unknown): PartAtomTerm[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const term = text(row.term);
    if (!term) return [];
    const label = text(row.label);
    const scheme = text(row.scheme);
    return [{ term, ...(label ? { label } : {}), ...(scheme ? { scheme } : {}) }];
  });
}

export function partAtomMetadataFromSummary(summary: unknown): PartAtomMetadata | undefined {
  if (!summary || typeof summary !== "object") return undefined;
  const partAtom = (summary as Record<string, unknown>).partatom;
  if (!partAtom || typeof partAtom !== "object") return undefined;
  const row = partAtom as Record<string, unknown>;
  const title = text(row.title);
  const updated = text(row.updated);
  const categories = terms(row.categories);
  const taxonomies = terms(row.taxonomies);
  if (!title && !updated && !categories.length && !taxonomies.length) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(updated ? { updated } : {}),
    categories,
    taxonomies,
    links: [],
    types: [],
  };
}

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, body: string) => {
      const key = body.toLowerCase();
      if (key === "amp") return "&";
      if (key === "lt") return "<";
      if (key === "gt") return ">";
      if (key === "quot") return "\"";
      if (key === "apos") return "'";
      const codePoint = key.startsWith("#x")
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    },
  );
}

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    result[match[1]!] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return result;
}

function tagValue(source: string, localName: string): string | undefined {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
      "i",
    ),
  );
  if (!match) return undefined;
  return text(decodeXml(match[1]!.replace(/<[^>]+>/g, "").trim()));
}

function blocks(source: string, localName: string): Array<{ attributes: string; body: string }> {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${escaped}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
    "gi",
  );
  const result: Array<{ attributes: string; body: string }> = [];
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    result.push({ attributes: match[1] ?? "", body: match[2] ?? "" });
  }
  return result;
}

/**
 * Parse Autodesk's Atom/PartAtom family metadata without DOM APIs.
 *
 * Keeping this as a text parser makes it usable in a Web Worker, Node, and the
 * browser main thread alike. It reads only the documented Atom-shaped fields
 * and treats parameter type/unit identifiers as data rather than importing
 * Autodesk's runtime enums.
 */
export function parsePartAtomXml(xml: string): PartAtomMetadata | undefined {
  if (!/<(?:[\w.-]+:)?entry\b/i.test(xml)) return undefined;
  const entryTitle = tagValue(xml, "title");
  const id = tagValue(xml, "id");
  const updated = tagValue(xml, "updated");

  const categories = blocks(xml, "category").flatMap((block): PartAtomTerm[] => {
    const attrs = attributes(block.attributes);
    const term = text(attrs.term) ?? tagValue(block.body, "term");
    if (!term) return [];
    const scheme = text(attrs.scheme) ?? tagValue(block.body, "scheme");
    return [{ term, ...(scheme ? { scheme } : {}) }];
  });
  const taxonomies = blocks(xml, "taxonomy").flatMap((block): PartAtomTerm[] => {
    const term = tagValue(block.body, "term");
    if (!term) return [];
    const label = tagValue(block.body, "label");
    return [{ term, ...(label ? { label } : {}) }];
  });
  const links = blocks(xml, "link").map((block): PartAtomLink => {
    const attrs = attributes(block.attributes);
    const files = blocks(block.body, "design-file").map((file): PartAtomDesignFile => {
      const productVersionText = tagValue(file.body, "product-version");
      const productVersion = productVersionText == null
        ? undefined
        : Number.parseInt(productVersionText, 10);
      const title = tagValue(file.body, "title");
      const product = tagValue(file.body, "product");
      const fileUpdated = tagValue(file.body, "updated");
      return {
        ...(title ? { title } : {}),
        ...(product ? { product } : {}),
        ...(Number.isInteger(productVersion) ? { productVersion } : {}),
        ...(fileUpdated ? { updated: fileUpdated } : {}),
      };
    });
    return {
      ...(text(attrs.rel) ? { rel: text(attrs.rel) } : {}),
      ...(text(attrs.type) ? { type: text(attrs.type) } : {}),
      ...(text(attrs.href) ? { href: text(attrs.href) } : {}),
      files,
    };
  });

  const family = blocks(xml, "family")[0];
  const familyAttrs = family ? attributes(family.attributes) : {};
  const variationRaw = family ? tagValue(family.body, "variationCount") : undefined;
  const variationCount = variationRaw == null ? undefined : Number(variationRaw);
  const types = family
    ? blocks(family.body, "part").flatMap((part): PartAtomFamilyType[] => {
        const title = tagValue(part.body, "title");
        if (!title) return [];
        const partAttrs = attributes(part.attributes);
        const parameters: PartAtomParameter[] = [];
        const simple = /<([\w:.-]+)\b([^>]*)>([^<]*)<\/\1>/g;
        for (let match = simple.exec(part.body); match; match = simple.exec(part.body)) {
          const name = match[1]!.replace(/^.*:/, "");
          if (name.toLowerCase() === "title") continue;
          const attrs = attributes(match[2] ?? "");
          parameters.push({
            name,
            ...(text(attrs.displayName) ? { displayName: text(attrs.displayName) } : {}),
            ...(text(attrs.type) ? { sourceType: text(attrs.type) } : {}),
            ...(text(attrs.id) ? { id: text(attrs.id) } : {}),
            ...(text(attrs.typeOfParameter)
              ? { parameterType: text(attrs.typeOfParameter) }
              : {}),
            ...(text(attrs.units) ? { units: text(attrs.units) } : {}),
            value: decodeXml((match[3] ?? "").trim()),
          });
        }
        return [{
          title,
          ...(text(partAttrs.type) ? { sourceType: text(partAttrs.type) } : {}),
          parameters,
        }];
      })
    : [];

  const title = types[0]?.title ?? entryTitle;
  if (!title && !updated && !categories.length && !taxonomies.length) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(id ? { id } : {}),
    ...(entryTitle ? { entryTitle } : {}),
    ...(updated ? { updated } : {}),
    categories,
    taxonomies,
    links,
    ...(text(familyAttrs.type) ? { familyType: text(familyAttrs.type) } : {}),
    ...(Number.isInteger(variationCount) ? { variationCount } : {}),
    types,
  };
}
