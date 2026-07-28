/** One row of Revit's tab-delimited OmniClass taxonomy file. */
export type OmniClassItem = {
  number: string;
  title: string;
  level: number;
  /** Optional Revit BuiltInCategory id carried by Autodesk's taxonomy file. */
  categoryId?: number;
};

export function parseOmniClassTaxonomy(source: string): OmniClassItem[] {
  return source.replace(/^\uFEFF/, "").split(/\r?\n/).flatMap((line): OmniClassItem[] => {
    if (!line.trim() || line.trimStart().startsWith("#")) return [];
    const [number, title, rawLevel, rawCategory] = line.split("\t");
    const level = Number.parseInt(rawLevel ?? "", 10);
    if (!number?.trim() || !title?.trim() || !Number.isInteger(level)) return [];
    const categoryId = Number.parseInt(rawCategory ?? "", 10);
    return [{
      number: number.trim(),
      title: title.trim(),
      level,
      ...(Number.isInteger(categoryId) ? { categoryId } : {}),
    }];
  });
}

export function writeOmniClassTaxonomy(items: readonly OmniClassItem[]): string {
  if (!items.length) return "";
  return `${items.map((item) => [
    item.number,
    item.title,
    String(item.level),
    item.categoryId == null ? "" : String(item.categoryId),
  ].join("\t")).join("\n")}\n`;
}

/** Merge multiple taxonomy editions while retaining distinct Revit mappings. */
export function mergeOmniClassTaxonomies(
  ...taxonomies: ReadonlyArray<readonly OmniClassItem[]>
): OmniClassItem[] {
  const unique = new Map<string, OmniClassItem>();
  for (const taxonomy of taxonomies) {
    for (const item of taxonomy) {
      const key = `${item.number}\u0000${item.title}\u0000${item.level}\u0000${item.categoryId ?? ""}`;
      if (!unique.has(key)) unique.set(key, item);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.number.localeCompare(right.number, "en", { numeric: true }));
}
