/**
 * A census of the safety limits that actually bound a conversion.
 *
 * The decoders carry a set of scalar limits — the longest stair they will
 * reconstruct, the widest planar quad they will accept, the most curves they
 * will assemble into rings, the thickest wall they will pair planes across.
 * Every one of them was measured against a single ordinary-sized building, and
 * every one of them is applied with a bare `continue` or `break`.
 *
 * That combination is the problem this module exists for. A limit fitted to one
 * building is a hypothesis about all buildings, and a hypothesis that fails
 * silently is one nobody can act on: a model with a 120-tread monumental stair
 * or a mile-wide site plane loses that geometry, the run reports success, and
 * the only evidence is an absence. The numbers themselves cannot responsibly be
 * re-tuned without a second building to tune them against — but they can be
 * made to say when they were the reason something is missing.
 *
 * So nothing here changes what is decoded. It records which limits were reached
 * and how often, so the run can report "this model met a limit fitted to a
 * different one" instead of quietly returning less.
 *
 * The counters are module-level because the limits are applied deep inside
 * per-page scanning routines that are called from many places, and threading a
 * census through their signatures would cost more clarity than it buys.
 * `convertRvtBytes` resets them as it starts and snapshots them as it finishes;
 * conversion is synchronous and runs one model at a time, in the worker and in
 * the Node command alike, so there is no interleaving to confuse the counts.
 */

/** The limits worth reporting on, named for the constant that imposes them. */
export type ConversionLimit =
  | "max-treads"
  | "max-curves-per-element"
  | "max-quad-span-feet"
  | "max-half-thickness-feet"
  | "max-coordinate"
  | "monumental-solid-treads";

/** How each limit reads in a warning, and what it costs when it binds. */
const LIMIT_DESCRIPTIONS: Record<ConversionLimit, string> = {
  "max-treads": "stair runs longer than the reconstructor's tread limit",
  "max-curves-per-element": "elements with more sketch curves than ring assembly accepts",
  "max-quad-span-feet": "planar faces wider than the accepted quad span",
  "max-half-thickness-feet": "plane pairs further apart than the accepted wall thickness",
  "max-coordinate": "curve coordinates outside the accepted model extent",
  "monumental-solid-treads":
    "stair runs drawn as solid terraces by the fitted monumental depth/rise rule",
};

const counts = new Map<ConversionLimit, number>();

/** Record that `limit` rejected something. Cheap enough for inner loops. */
export function noteLimit(limit: ConversionLimit): void {
  counts.set(limit, (counts.get(limit) ?? 0) + 1);
}

/** Clear the census. Called once as a conversion begins. */
export function resetLimitCensus(): void {
  counts.clear();
}

export type LimitCensusEntry = {
  limit: ConversionLimit;
  /** How many times this limit rejected something during the conversion. */
  rejections: number;
  description: string;
};

/** Every limit that bound at least once, most-hit first. */
export function limitCensus(): LimitCensusEntry[] {
  return [...counts]
    .filter(([, rejections]) => rejections > 0)
    .map(([limit, rejections]) => ({
      limit,
      rejections,
      description: LIMIT_DESCRIPTIONS[limit],
    }))
    .sort((a, b) => b.rejections - a.rejections);
}

/**
 * One warning naming the limits that bound, or nothing when none did.
 *
 * Worth saying plainly in the run's own output rather than only in a JSON
 * field: on a model that never reaches them these limits are invisible and
 * harmless, and the moment one binds is exactly the moment the reader needs to
 * know a threshold from another building is in play.
 */
export function limitCensusWarning(): string | null {
  const census = limitCensus();
  if (!census.length) return null;
  const parts = census.map(
    (entry) => `${entry.rejections.toLocaleString()} ${entry.description} (${entry.limit})`,
  );
  return (
    `Decoder limits fitted to a single reference building rejected geometry in this model: ${parts.join("; ")}. ` +
    "These are thresholds, not decode failures — the affected geometry may be recoverable with limits measured on a second building."
  );
}
