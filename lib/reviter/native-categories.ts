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

import { builtInCategoryName, humaniseCategoryName } from "./built-in-categories.ts";
import {
  REVIT_2027_BASE_RAILING_SYMBOL_MARKER,
  REVIT_2027_TOP_RAIL_TYPE_MARKER,
} from "./revit-2027-baluster-instances.ts";

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

/**
 * How much agreement a record-code cluster needs before its category may be
 * inherited by siblings.
 *
 * A single flat floor of 8 supporting elements was tuned against the clusters
 * that dominate a model by count — mullions and curtain panels arrive in the
 * thousands — and it silently excludes the tail. A building holds a dozen ramps
 * and a couple of dozen ceilings, so their clusters can never reach 8 directly
 * resolved members, and every one of those elements stays uncategorised no
 * matter how unanimous the evidence is.
 *
 * Support and purity trade against each other instead: a large cluster may be
 * merely dominant, a small one has to be near-unanimous. Three elements that
 * agree completely are evidence; three that split two-to-one are not.
 */
const CODE_CONSENSUS_FLOORS: readonly { minSupport: number; minPurity: number }[] = [
  { minSupport: 8, minPurity: 0.7 },
  { minSupport: 4, minPurity: 0.85 },
  { minSupport: 3, minPurity: 1 },
];

/** Smallest cluster any floor will accept. */
const CODE_CONSENSUS_MIN_SUPPORT = Math.min(
  ...CODE_CONSENSUS_FLOORS.map((floor) => floor.minSupport),
);

/** True when a cluster clears any of the support/purity pairs above. */
function clearsConsensusFloor(support: number, purity: number): boolean {
  return CODE_CONSENSUS_FLOORS.some(
    (floor) => support >= floor.minSupport && purity >= floor.minPurity,
  );
}

export function categoryDisplayName(categoryId: number): string {
  const name = builtInCategoryName(categoryId);
  return name ? humaniseCategoryName(name) : `Revit category ${categoryId}`;
}

/** True when the category id resolves to a published Revit category name. */
export function isNamedCategory(categoryId: number): boolean {
  return builtInCategoryName(categoryId) != null;
}

/** `RampSym` tag 3463 is persisted as marker 3462 in Revit 2027. */
const REVIT_2027_RAMP_SYMBOL_MARKER = 3462;

/** Footprint-roof parameter which is independent of the duplicated-bounds code. */
const MAXIMUM_RIDGE_HEIGHT_PARAMETER_ID = -1_001_705;

/**
 * Category identities proved by a native class or a class-specific parameter.
 *
 * These are deliberately narrower than general marker consensus. The marker
 * names the exact Revit 2027 class in `Formats/Latest`, while the roof rule
 * requires both the one-field slab/roof record shape and the footprint-roof
 * `Maximum Ridge Height` parameter. No category is inferred from dimensions or
 * from an IFC class.
 */
export function categoryFromNativeObjectEvidence(
  record: Pick<
    ElementBoundsRecord,
    | "recordCode"
    | "recordCount"
    | "parameters"
    | "orientedBox"
    | "solid"
    | "solids"
    | "arcs"
  >,
  markers: ReadonlySet<number> | undefined,
): number | undefined {
  if (markers?.has(REVIT_2027_RAMP_SYMBOL_MARKER)) return -2_000_180; // Ramps
  if (markers?.has(REVIT_2027_TOP_RAIL_TYPE_MARKER)) return -2_000_946; // Railing Top Rail
  if (
    markers?.has(REVIT_2027_BASE_RAILING_SYMBOL_MARKER) &&
    (record.orientedBox || record.solid || record.solids?.length || record.arcs?.length)
  ) {
    return -2_000_127; // Stairs Railing Baluster
  }
  if (
    record.recordCode === 58 &&
    record.parameters?.some(
      (parameter) => parameter.parameterId === MAXIMUM_RIDGE_HEIGHT_PARAMETER_ID,
    )
  ) {
    return -2_000_035; // Roofs
  }
  return undefined;
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

export type ResolvedCategoriesWithEvidence = {
  /** Majority category per element, exactly as `resolveElementCategories`. */
  resolved: Map<number, number>;
  /**
   * Elements whose winning category is backed only by donated tokens: every
   * supporting token has a *nearer* preceding value that the persisted element
   * table proves is a real element — just not one this conversion draws — so
   * the nearest-preceding rule fell through past the token's actual owner.
   */
  donatedOnly: Set<number>;
};

/**
 * Resolve tokens like `resolveElementCategories`, but also report which
 * assignments rest entirely on donated tokens.
 *
 * The persisted `Global/ElemTable` lists every element in the document, not
 * merely the ones with a decodable bounds record. A token whose nearest real
 * element id belongs to an undrawn element was written for that element; when
 * the nearest *drawable* id then claims it, the claim is a fall-through, not
 * evidence. The measured case is element `447970`: a 72,315 sq ft floor plate
 * that took a mullion's token because the mullion itself owns no bounds record.
 *
 * The vote still lands — dropping donated tokens outright would also strip the
 * drawing-aid labels (`Stairs Paths`, `Sketch Lines`, balusters) that the scene
 * admission rules rely on, and those labels are uncontradicted. The flag lets
 * the caller override a donated-only label only where stronger evidence — the
 * element's own record-code cluster — actively disagrees.
 */
export function resolveElementCategoriesWithEvidence(
  tokens: CategoryToken[],
  knownElementIds: Set<number>,
  realElementIds: Set<number>,
): ResolvedCategoriesWithEvidence {
  const votes = new Map<number, Map<number, number>>();
  const cleanVotes = new Map<number, Map<number, number>>();
  for (const token of tokens) {
    const owner = token.ownerCandidates.find((candidate) => knownElementIds.has(candidate));
    if (owner == null) continue;
    const realOwner = token.ownerCandidates.find((candidate) => realElementIds.has(candidate));
    const perElement = votes.get(owner) ?? new Map<number, number>();
    perElement.set(token.categoryId, (perElement.get(token.categoryId) ?? 0) + 1);
    votes.set(owner, perElement);
    // `realElementIds` is a superset of `knownElementIds`, so the nearest real
    // candidate sits at or before the nearest known one; the vote is clean
    // exactly when the two are the same value.
    if (realOwner === owner) {
      const perClean = cleanVotes.get(owner) ?? new Map<number, number>();
      perClean.set(token.categoryId, (perClean.get(token.categoryId) ?? 0) + 1);
      cleanVotes.set(owner, perClean);
    }
  }

  const resolved = new Map<number, number>();
  const donatedOnly = new Set<number>();
  for (const [elementId, perElement] of votes) {
    let bestCategory = 0;
    let bestCount = 0;
    for (const [categoryId, count] of perElement) {
      if (count > bestCount) {
        bestCount = count;
        bestCategory = categoryId;
      }
    }
    if (!bestCategory) continue;
    resolved.set(elementId, bestCategory);
    if (!(cleanVotes.get(elementId)?.get(bestCategory))) donatedOnly.add(elementId);
  }
  return { resolved, donatedOnly };
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
    if (support < CODE_CONSENSUS_MIN_SUPPORT || !clearsConsensusFloor(support, purity)) continue;
    consensus.set(key, { categoryId: bestCategory, support, purity });
  }
  return consensus;
}

/**
 * Resolve category tokens against the element ids the scan actually proved,
 * then fill the remainder from per-record-code consensus. Mutates `records`
 * and returns the evidence behind every assignment.
 *
 * With `ownershipElementIds` — the persisted `Global/ElemTable` id set — a
 * direct label that rests only on donated tokens (see
 * `resolveElementCategoriesWithEvidence`) yields to the element's own
 * record-code cluster when that cluster clears the ordinary consensus floors
 * and disagrees. No new threshold is introduced: a consensus trusted to hand
 * out categories to unlabelled siblings is trusted to outvote a token that
 * provably fell through from an undrawn element.
 */
export function applyNativeCategories(
  records: ElementBoundsRecord[],
  tokens: CategoryToken[],
  elemTableIds?: Uint32Array,
  ownershipElementIds?: Set<number>,
): NativeCategorySummary {
  const knownElementIds = new Set<number>(records.map((record) => record.elementId));
  if (elemTableIds) for (const elementId of elemTableIds) knownElementIds.add(elementId);

  let resolved: Map<number, number>;
  let donatedOnly: Set<number>;
  if (ownershipElementIds?.size) {
    const realElementIds = new Set(knownElementIds);
    for (const elementId of ownershipElementIds) realElementIds.add(elementId);
    ({ resolved, donatedOnly } = resolveElementCategoriesWithEvidence(
      tokens,
      knownElementIds,
      realElementIds,
    ));
  } else {
    resolved = resolveElementCategories(tokens, knownElementIds);
    donatedOnly = new Set();
  }
  const consensus = deriveRecordCodeCategories(records, resolved);

  let directElements = 0;
  let inheritedElements = 0;
  let donatedTokenElements = 0;
  let donatedTokensOverridden = 0;
  const counts = new Map<number, number>();
  for (const record of records) {
    let direct = resolved.get(record.elementId);
    const clusterEntry = consensus.get(recordCodeKey(record.recordCode, record.recordCount));
    if (direct != null && donatedOnly.has(record.elementId)) {
      donatedTokenElements += 1;
      if (clusterEntry && clusterEntry.categoryId !== direct) {
        donatedTokensOverridden += 1;
        direct = undefined;
      }
    }
    const inherited = direct == null ? clusterEntry : undefined;
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
    donatedTokenElements,
    donatedTokensOverridden,
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
