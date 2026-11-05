/** Plane-scoped inputs for landing-approach reuse (CLI only, opt-in prototype).
 *
 * A landing pair is evaluated on one walking plane (both endpoints within
 * 0.05 ft). Its walking region, door, ramp cap and identity checks filter the
 * large dataset collections by level or elevation before reading geometry. A
 * plane scope therefore keeps, for each scoped collection, the elements of
 * that plane whole and only the declared selector fields (level, elevation,
 * identity) of every other element. Everything else (the whole native model and
 * every unscoped dataset field) stays in the scope whole.
 *
 * Soundness does not rest on this list being right. The pair is evaluated on
 * a guarded view of the same inputs: every out-of-scope element is a proxy that
 * answers only its selector fields and throws LandingScopeViolation on any
 * other read. A candidate computed without a violation provably read nothing
 * outside its scope, so the scope digest covers every input it used. A
 * violation means the evaluation needs more; the caller then evaluates on the
 * complete inputs and keys the result on the complete inputs.
 */
import type { IndoorDataset, IndoorNode } from "../../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import { canonicalValueSha256 } from "./canonical-value-digest.ts";

export const LANDING_SCOPE_VERSION = "landing-plane-scope-v1";
/** Same tolerance the walking region uses for its level and record filters. */
const PLANE_TOLERANCE_FEET = 0.05;

export class LandingScopeViolation extends Error {
  readonly collection: string;
  readonly field: string;
  constructor(collection: string, field: string) {
    super(`Landing approach read ${collection}.${field} outside its plane scope`);
    this.collection = collection;
    this.field = field;
  }
}

type Item = Record<string, unknown>;
export type ScopedCollection = {
  /** Selector fields: readable (and digested) on every element. */
  selectors: readonly string[];
  /** Elevation of an element from its selector fields; undefined keeps it in scope. */
  elevation: (item: Item, levels: Map<number, number>) => number | undefined;
};
const levelElevation = (item: Item, levels: Map<number, number>) => levels.get(item.levelId as number);
/** Dataset collections scoped by plane. Each selector list was derived from the
 * guarded fixture runs (a missing selector shows up as a violation, never as
 * a stale reuse). */
export type LandingScopedCollections = Readonly<Record<string, ScopedCollection>>;
export const LANDING_SCOPED_COLLECTIONS: LandingScopedCollections = {
  walls: { selectors: ["id", "levelId", "nativeElementId", "reviewPatchId"], elevation: levelElevation },
  doors: { selectors: ["id", "levelId", "nativeElementId"], elevation: levelElevation },
  records: { selectors: ["key", "levelId", "elevationFeet"], elevation: (r) => r.elevationFeet as number },
  nodes: { selectors: ["id", "roomKey", "levelId", "kind"], elevation: (n) => (n.pointFeet as number[] | undefined)?.[2] },
};

const inPlane = (z: number | undefined, plane: number) => z === undefined || !Number.isFinite(z) || Math.abs(z - plane) < PLANE_TOLERANCE_FEET;

function pick(item: Item, fields: readonly string[]): Item {
  const out: Item = {};
  for (const key of Object.keys(item)) if (fields.includes(key)) out[key] = item[key];
  return out;
}
function guard(item: Item, collection: string, selectors: readonly string[], violations: LandingScopeViolation[]): Item {
  // Recorded before throwing: evaluation code that catches errors (for example
  // a refused exact overlay treated as unsupported) cannot hide the read.
  const refuse = (field: PropertyKey): never => {
    const violation = new LandingScopeViolation(collection, String(field));
    violations.push(violation);
    throw violation;
  };
  return new Proxy(item, {
    get: (target, key, receiver) => (typeof key === "symbol" || selectors.includes(key) ? Reflect.get(target, key, receiver) : refuse(key)),
    has: (target, key) => (typeof key === "symbol" || selectors.includes(key) ? Reflect.has(target, key) : refuse(key)),
    ownKeys: () => refuse("<keys>"),
    getOwnPropertyDescriptor: (target, key) => (typeof key !== "symbol" && selectors.includes(key) ? Reflect.getOwnPropertyDescriptor(target, key) : refuse(key)),
    set: () => refuse("<write>"),
    defineProperty: () => refuse("<write>"),
    deleteProperty: () => refuse("<write>"),
  });
}

export type LandingPlaneScope = {
  elevationFeet: number;
  /** Digest of every input a violation-free evaluation on this plane can read. */
  sha256: string;
  /** The same model and dataset, with out-of-scope elements guarded. */
  model: ConvertResult;
  dataset: IndoorDataset;
  /** Elements kept whole / reduced to selectors, per scoped collection. */
  counts: Record<string, { whole: number; selectorsOnly: number }>;
  /** Every refused read on the guarded view, including ones code caught. */
  violations: LandingScopeViolation[];
};

/** One scope per walking plane; modelSha256 is the canonical digest of the model. */
export function createLandingPlaneScope(model: ConvertResult, dataset: IndoorDataset, elevationFeet: number, modelSha256: string, collections: LandingScopedCollections = LANDING_SCOPED_COLLECTIONS): LandingPlaneScope {
  const levels = new Map(dataset.nativeLevels.map((l) => [l.id, l.elevationFeet]));
  const guarded: Item = { ...(dataset as unknown as Item) },
    reduced: Item = { ...(dataset as unknown as Item) },
    counts: LandingPlaneScope["counts"] = {},
    violations: LandingScopeViolation[] = [];
  for (const [name, spec] of Object.entries(collections)) {
    const items = (dataset as unknown as Item)[name];
    if (!Array.isArray(items)) continue;
    let whole = 0;
    const keep = items.map((item: Item) => {
      const keepWhole = !item || typeof item !== "object" || inPlane(spec.elevation(item, levels), elevationFeet);
      if (keepWhole) whole++;
      return keepWhole;
    });
    guarded[name] = items.map((item: Item, i) => (keep[i] ? item : guard(item, name, spec.selectors, violations)));
    // Tagged, so a whole element can never digest like another's selector subset.
    reduced[name] = items.map((item: Item, i) => (keep[i] ? ["whole", item] : ["selectors", pick(item, spec.selectors)]));
    counts[name] = { whole, selectorsOnly: items.length - whole };
  }
  const sha256 = canonicalValueSha256({
    format: LANDING_SCOPE_VERSION,
    elevationFeet,
    modelSha256,
    selectors: Object.entries(collections).map(([name, spec]) => [name, spec.selectors]),
    dataset: reduced,
  });
  return { elevationFeet, sha256, model, dataset: guarded as unknown as IndoorDataset, counts, violations };
}

/** Walking plane the pair's region is queried on: its portal's, else its start's. */
export const landingPairPlane = (a: IndoorNode, portal: IndoorNode | undefined) => (portal ?? a).pointFeet[2];
