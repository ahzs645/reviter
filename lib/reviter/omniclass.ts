/** One row of Revit's tab-delimited OmniClass taxonomy file. */
import type { PartAtomMetadata } from "./part-atom.ts";

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

export type BundledOmniClassEdition = "vanilla" | "food-service" | "merged";

const EDITION_FILE: Record<Exclude<BundledOmniClassEdition, "merged">, string> = {
  vanilla: "OmniClassTaxonomy_Vanilla.txt",
  "food-service": "OmniClassTaxonomy_FoodService.txt",
};

async function fetchEdition(
  edition: Exclude<BundledOmniClassEdition, "merged">,
  baseUrl: string | URL | undefined,
  fetcher: typeof fetch,
): Promise<OmniClassItem[]> {
  const base = baseUrl ?? (typeof document !== "undefined" ? document.baseURI : undefined);
  if (!base) throw new Error("A base URL is required outside a browser.");
  const response = await fetcher(new URL(`omniclass/${EDITION_FILE[edition]}`, base));
  if (!response.ok) throw new Error(`Could not load the ${edition} OmniClass edition.`);
  return parseOmniClassTaxonomy(await response.text());
}

export async function loadBundledOmniClassTaxonomy(
  edition: BundledOmniClassEdition = "merged",
  options: { baseUrl?: string | URL; fetcher?: typeof fetch } = {},
): Promise<OmniClassItem[]> {
  const fetcher = options.fetcher ?? fetch;
  if (edition !== "merged") return fetchEdition(edition, options.baseUrl, fetcher);
  const [vanilla, foodService] = await Promise.all([
    fetchEdition("vanilla", options.baseUrl, fetcher),
    fetchEdition("food-service", options.baseUrl, fetcher),
  ]);
  return mergeOmniClassTaxonomies(vanilla, foodService);
}

export function searchOmniClassTaxonomy(
  items: readonly OmniClassItem[],
  query: string,
  limit = 60,
): OmniClassItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized || limit <= 0) return [];
  return items.filter((item) =>
    item.number.toLowerCase().includes(normalized) ||
    item.title.toLowerCase().includes(normalized) ||
    String(item.categoryId ?? "").includes(normalized)
  ).slice(0, limit);
}

/** Resolve only explicit OmniClass Number parameters; never guess from a title. */
export function omniClassForPartAtom(
  metadata: PartAtomMetadata | undefined,
  taxonomy: readonly OmniClassItem[],
): OmniClassItem | undefined {
  const number = metadata?.types.flatMap((type) => type.parameters).find((parameter) =>
    (parameter.displayName ?? parameter.name).replace(/[^a-z0-9]/gi, "").toLowerCase() ===
    "omniclassnumber")?.value.trim();
  return number ? taxonomy.find((item) => item.number === number) : undefined;
}
