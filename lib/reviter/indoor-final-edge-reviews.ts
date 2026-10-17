import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";

type EdgeReview = {
  enabled?: boolean;
  accessible?: "yes" | "no" | "unknown";
  notes?: string;
  geometryKey?: string;
};

/** The portable review key used by the connection inspector. Node identities
 * are part of the key; coincident coordinates never substitute for an ID. */
export function finalNativeEdgeReviewKey(
  data: IndoorDataset,
  edge: IndoorEdge,
) {
  return JSON.stringify([
    data.source.modelSha256,
    edge.from,
    edge.to,
    edge.roomKeys,
    edge.pointsFeet,
  ]);
}

/** Native cell regeneration runs after the general saved-review pass and
 * replaces the walking edges. Replay only existing source-bound reviews on
 * those final branches. This function creates no branch or accessibility
 * approval and cannot enable an edge refused by a physical/source check.
 *
 * Legacy review keys describe ordinary bidirectional walking geometry. A
 * direction change, missing endpoint, changed coordinates/owners or stepped
 * transition cannot inherit a positive confirmation through a reused edge ID.
 * A saved closure remains conservative even if its old geometry changed.
 */
export function replayFinalNativeEdgeReviews(
  data: IndoorDataset,
  savedReviews: unknown,
) {
  const reviews = (
    savedReviews as { edges?: Record<string, EdgeReview> } | null
  )?.edges;
  const result: {
    applied: string[];
    disabled: string[];
    refused: { edgeId: string; reason: string }[];
  } = { applied: [], disabled: [], refused: [] };
  if (!reviews || typeof reviews !== "object") return result;
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const records = new Map(data.records.map((record) => [record.key, record]));
  const geometry = data.circulationGeometry;
  const cells = new Set(
    geometry?.sourceModelSha256 === data.source.modelSha256
      ? geometry.cells.map((cell) => cell.id)
      : [],
  );
  for (const edge of data.edges) {
    if (!edge.nativeCellId || edge.kind !== "walk") continue;
    const review = reviews[edge.id];
    if (!review || typeof review !== "object") continue;
    if (review.enabled === false) {
      edge.enabled = false;
      result.disabled.push(edge.id);
    }
    if (typeof review.notes === "string") edge.notes = review.notes;
    if (!review.accessible) continue;
    const refuse = (reason: string) =>
      result.refused.push({ edgeId: edge.id, reason });
    if (!["yes", "no", "unknown"].includes(review.accessible)) {
      refuse("Malformed accessibility review.");
      continue;
    }
    if (review.geometryKey !== finalNativeEdgeReviewKey(data, edge)) {
      refuse("Reviewed model, endpoint identities, owners or path changed.");
      continue;
    }
    const from = nodes.get(edge.from),
      to = nodes.get(edge.to);
    if (
      !cells.has(edge.nativeCellId) ||
      !from ||
      !to ||
      edge.pointsFeet.length < 2 ||
      edge.pointsFeet.some(
        (point) =>
          point.length !== 3 ||
          point.some((coordinate) => !Number.isFinite(coordinate)) ||
          point[2] !== from.pointFeet[2],
      ) ||
      JSON.stringify(from.pointFeet) !== JSON.stringify(edge.pointsFeet[0]) ||
      JSON.stringify(to.pointFeet) !== JSON.stringify(edge.pointsFeet.at(-1)) ||
      from.pointFeet[2] !== to.pointFeet[2] ||
      (edge.direction !== undefined && edge.direction !== "both") ||
      !edge.roomKeys.length ||
      !edge.roomKeys.includes(from.roomKey) ||
      !edge.roomKeys.includes(to.roomKey) ||
      edge.roomKeys.some((key) => {
        const record = records.get(key);
        return !record || !record.walkable || record.access === "staff";
      })
    ) {
      refuse(
        "Final native branch, endpoints, direction or access no longer match an ordinary walking review.",
      );
      continue;
    }
    // Deliberately leave enabled unchanged unless closing. The caller's final
    // physical checks and native cell constructor own admission of the branch.
    edge.accessible = review.accessible;
    result.applied.push(edge.id);
  }
  return result;
}
