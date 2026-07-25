/**
 * Native Revit category recovery.
 *
 * Revit stores each element's `BuiltInCategory` as a negative 64-bit id inside
 * the `Partitions/*` element-definition region. The id is framed by a stable
 * 18-byte token:
 *
 * ```text
 * 04 00                 // field tag
 * <u32>                 // category-element discriminator (not decoded)
 * <i64 categoryId>      // negative BuiltInCategory id, e.g. -2000011 = Walls
 * ff ff ff ff           // terminator
 * ```
 *
 * The token carries no element id of its own. The owning element is the nearest
 * preceding 64-bit value that the rest of the pass proves to be a real native
 * element id, so resolution happens after the partition scan completes.
 *
 * Everything here is evidence-driven: the caller receives the raw support and
 * purity numbers, and callers that cannot reach the confidence floor keep the
 * previous, weaker classification instead of inventing one.
 */

import type { ElementBoundsRecord, NativeCategorySummary } from "./types";

/** Revit BuiltInCategory ids are dense in this window; anything else is noise. */
const CATEGORY_ID_MIN = -2_100_000;
const CATEGORY_ID_MAX = -1_999_000;

/** Bytes scanned backwards from a category token looking for its element id. */
const OWNER_SCAN_BYTES = 3_000;

/** Element-id candidates retained per token; p99 of the observed corpus is 90. */
const OWNER_CANDIDATE_LIMIT = 96;

/** Native element ids in the observed corpus sit well inside this window. */
const MIN_ELEMENT_ID = 200;
const MAX_ELEMENT_ID = 0x00ff_ffff;

/** Minimum records behind a record-code consensus before it may be applied. */
const CODE_CONSENSUS_MIN_SUPPORT = 8;

/** Minimum share of a code cluster that must agree on one category. */
const CODE_CONSENSUS_MIN_PURITY = 0.7;

/**
 * Category ids corroborated against the paired IFC export of the supplied
 * Revit 2027 project. Ids outside this table stay numeric rather than being
 * guessed at from Revit's much larger BuiltInCategory enumeration.
 */
const CATEGORY_NAMES: Record<number, string> = {
  [-2000011]: "Walls",
  [-2000014]: "Windows",
  [-2000023]: "Doors",
  [-2000032]: "Floors",
  [-2000035]: "Roofs",
  [-2000038]: "Ceilings",
  [-2000100]: "Columns",
  [-2000120]: "Stairs",
  [-2000126]: "Railings",
  [-2000170]: "Curtain Panels",
  [-2000171]: "Curtain Wall Mullions",
  [-2000180]: "Ramps",
  [-2001330]: "Structural Columns",
};

/**
 * Stair and railing sub-component categories. Each one resolves to stair or
 * railing products in the paired IFC export, but the individual Revit
 * sub-category names are not corroborated, so they share one display label.
 */
const STAIR_RAILING_COMPONENT_IDS = new Set([
  -2000045, -2000067, -2000123, -2000127, -2000919, -2000920, -2000938,
  -2000945, -2000946, -2000954,
]);

export function categoryDisplayName(categoryId: number): string {
  const known = CATEGORY_NAMES[categoryId];
  if (known) return known;
  if (STAIR_RAILING_COMPONENT_IDS.has(categoryId)) {
    return `Stair and railing components (${categoryId})`;
  }
  return `Revit category ${categoryId}`;
}

/** True when the category is corroborated by name rather than left numeric. */
export function isNamedCategory(categoryId: number): boolean {
  return CATEGORY_NAMES[categoryId] != null;
}

export type CategoryToken = {
  categoryId: number;
  /** Nearest-first native element-id candidates preceding the token. */
  ownerCandidates: number[];
};

function plausibleElementId(value: number): boolean {
  return value >= MIN_ELEMENT_ID && value <= MAX_ELEMENT_ID;
}

/**
 * Collect every category token in one inflated partition page together with the
 * element-id candidates that precede it. Candidates stay unresolved here: the
 * set of real element ids is only complete once the whole stream is scanned.
 */
export function collectCategoryTokens(data: Uint8Array): CategoryToken[] {
  const tokens: CategoryToken[] = [];
  if (data.byteLength < 18) return tokens;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (
    let offset = data.indexOf(0x04);
    offset >= 0 && offset + 18 <= data.byteLength;
    offset = data.indexOf(0x04, offset + 1)
  ) {
    if (data[offset + 1] !== 0x00) continue;
    if (view.getUint32(offset + 10, true) !== 0xffff_ffff) continue;
    if (view.getUint32(offset + 14, true) !== 0xffff_ffff) continue;

    const categoryId = view.getUint32(offset + 6, true) - 0x1_0000_0000;
    if (categoryId <= CATEGORY_ID_MIN || categoryId >= CATEGORY_ID_MAX) continue;

    const ownerCandidates: number[] = [];
    const stop = Math.max(0, offset - OWNER_SCAN_BYTES);
    for (
      let cursor = offset - 8;
      cursor >= stop && ownerCandidates.length < OWNER_CANDIDATE_LIMIT;
      cursor -= 1
    ) {
      if (view.getUint32(cursor + 4, true) !== 0) continue;
      const candidate = view.getUint32(cursor, true);
      if (plausibleElementId(candidate)) ownerCandidates.push(candidate);
    }

    tokens.push({ categoryId, ownerCandidates });
    offset += 17;
  }
  return tokens;
}

/**
 * Resolve each token to the nearest preceding value that the completed scan
 * proved to be a real element id, then keep the majority category per element.
 */
export function resolveElementCategories(
  tokens: CategoryToken[],
  knownElementIds: Set<number>,
): Map<number, number> {
  const votes = new Map<number, Map<number, number>>();
  for (const token of tokens) {
    const owner = token.ownerCandidates.find((candidate) => knownElementIds.has(candidate));
    if (owner == null) continue;
    const perElement = votes.get(owner) ?? new Map<number, number>();
    perElement.set(token.categoryId, (perElement.get(token.categoryId) ?? 0) + 1);
    votes.set(owner, perElement);
  }

  const resolved = new Map<number, number>();
  for (const [elementId, perElement] of votes) {
    let bestCategory = 0;
    let bestCount = 0;
    for (const [categoryId, count] of perElement) {
      if (count > bestCount) {
        bestCount = count;
        bestCategory = categoryId;
      }
    }
    if (bestCategory) resolved.set(elementId, bestCategory);
  }
  return resolved;
}

export type RecordCodeConsensus = {
  categoryId: number;
  /** Elements of this record code that carry a directly resolved category. */
  support: number;
  /** Share of that support agreeing on `categoryId`, in `[0, 1]`. */
  purity: number;
};

export function recordCodeKey(recordCode?: number, recordCount?: number): string {
  return `${recordCode ?? -1}:${recordCount ?? -1}`;
}

/**
 * Derive a record-code to category mapping from the elements that resolved
 * directly, so sibling records of the same shape inherit the same category.
 * Only clusters that clear both the support and purity floors are returned.
 */
export function deriveRecordCodeCategories(
  records: { elementId: number; recordCode?: number; recordCount?: number }[],
  resolved: Map<number, number>,
): Map<string, RecordCodeConsensus> {
  const clusters = new Map<string, Map<number, number>>();
  for (const record of records) {
    const categoryId = resolved.get(record.elementId);
    if (categoryId == null) continue;
    const key = recordCodeKey(record.recordCode, record.recordCount);
    const cluster = clusters.get(key) ?? new Map<number, number>();
    cluster.set(categoryId, (cluster.get(categoryId) ?? 0) + 1);
    clusters.set(key, cluster);
  }

  const consensus = new Map<string, RecordCodeConsensus>();
  for (const [key, cluster] of clusters) {
    let bestCategory = 0;
    let bestCount = 0;
    let support = 0;
    for (const [categoryId, count] of cluster) {
      support += count;
      if (count > bestCount) {
        bestCount = count;
        bestCategory = categoryId;
      }
    }
    const purity = support ? bestCount / support : 0;
    if (support < CODE_CONSENSUS_MIN_SUPPORT || purity < CODE_CONSENSUS_MIN_PURITY) continue;
    consensus.set(key, { categoryId: bestCategory, support, purity });
  }
  return consensus;
}

/**
 * Resolve category tokens against the element ids the scan actually proved,
 * then fill the remainder from per-record-code consensus. Mutates `records`
 * and returns the evidence behind every assignment.
 */
export function applyNativeCategories(
  records: ElementBoundsRecord[],
  tokens: CategoryToken[],
  elemTableIds?: Uint32Array,
): NativeCategorySummary {
  const knownElementIds = new Set<number>(records.map((record) => record.elementId));
  if (elemTableIds) for (const elementId of elemTableIds) knownElementIds.add(elementId);

  const resolved = resolveElementCategories(tokens, knownElementIds);
  const consensus = deriveRecordCodeCategories(records, resolved);

  let directElements = 0;
  let inheritedElements = 0;
  const counts = new Map<number, number>();
  for (const record of records) {
    const direct = resolved.get(record.elementId);
    const inherited = direct == null
      ? consensus.get(recordCodeKey(record.recordCode, record.recordCount))
      : undefined;
    const categoryId = direct ?? inherited?.categoryId;
    if (categoryId == null) continue;
    record.categoryId = categoryId;
    record.categoryName = categoryDisplayName(categoryId);
    record.categorySource = direct == null ? "record-code-consensus" : "native-token";
    if (direct == null) inheritedElements += 1;
    else directElements += 1;
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }

  const codeConsensus = [...consensus.entries()]
    .map(([recordCode, entry]) => ({
      recordCode,
      categoryId: entry.categoryId,
      categoryName: categoryDisplayName(entry.categoryId),
      support: entry.support,
      purity: entry.purity,
    }))
    .sort((a, b) => b.support - a.support);

  return {
    tokensFound: tokens.length,
    directElements,
    inheritedElements,
    categories: [...counts.entries()]
      .map(([categoryId, elements]) => ({
        categoryId,
        name: categoryDisplayName(categoryId),
        elements,
      }))
      .sort((a, b) => b.elements - a.elements),
    codeConsensus,
  };
}
