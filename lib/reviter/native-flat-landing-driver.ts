/** Unwired source-owning driver hook. Recipes remain metadata until the actual
 * original RVT context and the current complete physical predicate agree. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ConvertResult } from "./types.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
import type { IndoorRampRecipes } from "./indoor-ramps.ts";
import { fitGeoreference, modelPointToGeographic } from "./georeference.ts";
import {
  preserveSourceReviewedFlatLanding,
  type proveReviewedFlatLanding,
} from "./indoor-reviewed-flat-landing.ts";
import {
  createOriginalPlacedPlanarObstacleContext,
  proveOriginalPlacedPlanarObstacleEnvelope,
  proveOriginalDirectWallTrimObstacleEnvelope,
  originalPlanarObstacleFacts,
  type OriginalPlanarObstacleCertificate,
} from "./native-source-placed-planar-obstacles.ts";

type RecipeInput = Parameters<typeof proveReviewedFlatLanding>[2];
type Review = RecipeInput["review"];
type Candidate = { edgeId: string; input: RecipeInput };
type Refusal = { edgeId: string; reason: string; nativeElementIds?: number[] };
type P3 = [number, number, number];
const finitePath = (v: unknown): v is P3[] =>
  Array.isArray(v) &&
  v.length >= 2 &&
  v.length <= 1000 &&
  v.every(
    (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
  );

/** Locate only explicit original review/recipe identities. No nearest-node,
 * nearby stair, room-name or coordinate guess is used. This grants no proof. */
export function discoverSourceReviewedFlatLandings(
  rooms: RoomDirectoryData,
  expectedSourceModelSha256: string,
) {
  const candidates: Candidate[] = [],
    refused: Refusal[] = [];
  const ramps = rooms.indoorRamps as IndoorRampRecipes | undefined;
  const reviews = (
    rooms.indoorReviews as { edges?: Record<string, Review> } | undefined
  )?.edges;
  if (!reviews) return { candidates, refused };
  if (
    ramps?.version !== 1 ||
    ramps.sourceModelSha256 !== expectedSourceModelSha256 ||
    !Array.isArray(ramps.ramps)
  ) {
    refused.push({
      edgeId: "source",
      reason: "Original ramp recipe version/model binding is absent or stale.",
    });
    return { candidates, refused };
  }
  for (const [edgeId, review] of Object.entries(reviews)) {
    if (!edgeId.startsWith("walk:") || review?.accessible !== "yes") continue;
    try {
      const key: unknown = JSON.parse(review.geometryKey ?? "");
      if (
        !Array.isArray(key) ||
        key.length !== 5 ||
        key[0] !== expectedSourceModelSha256 ||
        typeof key[1] !== "string" ||
        typeof key[2] !== "string" ||
        !Array.isArray(key[3]) ||
        !finitePath(key[4])
      )
        throw Error("Malformed or stale original approach review.");
      const rampMatches = ramps.ramps.filter((r) =>
        ["upper", "lower"].some(
          (side) =>
            key[1] === `${r.id}:${side}` && edgeId === `walk:${r.id}:${side}`,
        ),
      );
      const transitionMatches = (rooms.buildingTransitions ?? []).filter(
        (t) =>
          t.kind === "local-steps" &&
          t.evidence === "user-reported" &&
          [0, 1].some(
            (side) =>
              key[2] === `local:${t.id}:${side}` &&
              key[3].length === 1 &&
              key[3][0] === `landing:${t.id}:${side}` &&
              !t.endpoints[side]!.roomKey,
          ),
      );
      if (rampMatches.length !== 1 || transitionMatches.length !== 1)
        throw Error(
          "Approach lacks one explicitly owned original unnamed flat local-stair landing and ramp recipe.",
        );
      const r = rampMatches[0]!;
      candidates.push({
        edgeId,
        input: structuredClone({
          transition: transitionMatches[0]!,
          ramp: {
            id: r.id,
            nativeRampId: r.nativeRampId,
            floorElementIds: r.floorElementIds,
            pointsFeet: r.pointsFeet,
          },
          review,
        }),
      });
    } catch (e) {
      refused.push({
        edgeId,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { candidates, refused };
}

type Request = { nativeElementId: number; nativeDefinitionId?: number };
function candidateOriginalObstacleRequests(
  model: ConvertResult,
  candidates: Candidate[],
) {
  const selected = new Map<number, Request>(),
    refused: Refusal[] = [];
  for (const candidate of candidates) {
    const path = JSON.parse(candidate.input.review.geometryKey!)[4] as P3[],
      z = path[0]![2];
    if (path.some((p) => p[2] !== z)) {
      refused.push({
        edgeId: candidate.edgeId,
        reason: "Original approach is not planar.",
      });
      continue;
    }
    const minX = Math.min(...path.map((p) => p[0])) - 1,
      maxX = Math.max(...path.map((p) => p[0])) + 1,
      minY = Math.min(...path.map((p) => p[1])) - 1,
      maxY = Math.max(...path.map((p) => p[1])) + 1;
    for (const record of model.elementBounds) {
      if (record.categoryId !== -2000011 && record.categoryId !== -2000023)
        continue;
      const b = record.boundsFeet;
      const valid = ["x", "y", "z"].every((axis) => {
        const k = axis as "x" | "y" | "z";
        return (
          Number.isFinite(b.min[k]) &&
          Number.isFinite(b.max[k]) &&
          b.min[k] <= b.max[k]
        );
      });
      if (
        valid &&
        (b.max.z <= z ||
          b.min.z > z + 6 ||
          b.max.x < minX ||
          b.min.x > maxX ||
          b.max.y < minY ||
          b.min.y > maxY)
      )
        continue;
      // Cache metadata is a locator only. The source wrapper independently
      // verifies actual headers, native placement, definition and branch census.
      if (record.categoryId === -2000011)
        selected.set(record.elementId, { nativeElementId: record.elementId });
      else if (
        Number.isSafeInteger(record.familySymbolId) &&
        record.familySymbolId! > 0
      )
        selected.set(record.elementId, {
          nativeElementId: record.elementId,
          nativeDefinitionId: record.familySymbolId,
        });
      else
        refused.push({
          edgeId: candidate.edgeId,
          reason:
            "A nearby native door has no definition locator; its physical veto is retained.",
          nativeElementIds: [record.elementId],
        });
    }
  }
  return { requests: [...selected.values()], refused };
}

/** Create once per process from actual original bytes; never serialize opaque
 * authority into an authoring JSON. Call the returned hook after local-flight
 * qualification/access zones, immediately before native circulation derivation.
 * Its supplied current model and dataset are physically rechecked each time. */
export function createSourceReviewedFlatLandingDriver(options: {
  originalModelBytes: Uint8Array;
  expectedSourceModelSha256: string;
  nativeModel: ConvertResult;
  rooms: RoomDirectoryData;
}) {
  const sha = options.expectedSourceModelSha256;
  if (
    !/^[a-f0-9]{64}$/.test(sha) ||
    bytesToHex(sha256(options.originalModelBytes)) !== sha
  )
    throw Error(
      "Original flatlanding RVT bytes do not match the expected model identity.",
    );
  if (!options.rooms.georeference)
    throw Error(
      "Original flatlanding driver requires the source georeference.",
    );
  const fit = fitGeoreference(options.rooms.georeference);
  const discovered = discoverSourceReviewedFlatLandings(options.rooms, sha),
    located = candidateOriginalObstacleRequests(
      options.nativeModel,
      discovered.candidates,
    ),
    certificates: OriginalPlanarObstacleCertificate[] = [],
    refused: Refusal[] = [...discovered.refused, ...located.refused];
  const sourceReceipts: { nativeElementId: number; sourceFacts: unknown }[] =
    [];
  let sourceContextReceipt:
    | {
        sourceModelSha256: string;
        sourceSchemaSha256: string;
        completeSourcePages: number;
      }
    | undefined;
  if (discovered.candidates.length) {
    try {
      const context = createOriginalPlacedPlanarObstacleContext(
        options.originalModelBytes,
        sha,
        located.requests,
      );
      sourceContextReceipt = {
        sourceModelSha256: context.sourceModelSha256,
        sourceSchemaSha256: context.sourceSchemaSha256,
        completeSourcePages: context.completeSourcePages,
      };
      for (const request of located.requests) {
        try {
          const proof =
            request.nativeDefinitionId === undefined
              ? proveOriginalDirectWallTrimObstacleEnvelope(
                  context,
                  request.nativeElementId,
                )
              : proveOriginalPlacedPlanarObstacleEnvelope(
                  context,
                  request.nativeElementId,
                );
          if (!proof.ok) {
            refused.push({
              edgeId: "source-body",
              reason: proof.blockers.join("; "),
              nativeElementIds: [request.nativeElementId],
            });
            continue;
          }
          certificates.push(proof.certificate);
          sourceReceipts.push({
            nativeElementId: request.nativeElementId,
            sourceFacts: originalPlanarObstacleFacts(proof.certificate)
              .sourceFacts,
          });
        } catch (e) {
          refused.push({
            edgeId: "source-body",
            reason: e instanceof Error ? e.message : String(e),
            nativeElementIds: [request.nativeElementId],
          });
        }
      }
    } catch (e) {
      refused.push({
        edgeId: "source-context",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const attempts: unknown[] = [];
  return {
    initializationReceipt: structuredClone({
      sourceModelSha256: sha,
      sourceContextReceipt,
      explicitRecipeCount: discovered.candidates.length,
      sourceReceipts,
      refused,
    }),
    beforeNativeCirculation(model: ConvertResult, dataset: IndoorDataset) {
      if (dataset.source.modelSha256 !== sha) {
        const result = [
          {
            applied: false,
            reason: "Current dataset belongs to a different original model.",
          },
        ];
        attempts.push(...result);
        return structuredClone(result);
      }
      if (discovered.candidates.length && !sourceContextReceipt) {
        const result = discovered.candidates.map((candidate) => ({
          edgeId: candidate.edgeId,
          applied: false,
          reason:
            "Complete actual original-RVT/schema context is unavailable; no flat landing is restored.",
        }));
        attempts.push(...result);
        return structuredClone(result);
      }
      const results = discovered.candidates.map((candidate) => {
        try {
          const result = preserveSourceReviewedFlatLanding(
            model,
            dataset,
            candidate.input,
            certificates,
            (p) => {
              const q = modelPointToGeographic(p, fit);
              return [q.longitude, q.latitude];
            },
          );
          if (!result.applied)
            return {
              edgeId: candidate.edgeId,
              applied: false,
              reason: result.reason,
              blockers: result.proof.ok ? [] : result.proof.blockers,
            };
          return {
            edgeId: candidate.edgeId,
            applied: true,
            sourceModelSha256: sha,
            originalGeometryKey: result.proof.originalGeometryKey,
            originalSourceObstacleElementIds:
              result.proof.originalSourceObstacleElementIds,
            checkedSourceElementIds: result.proof.checkedSourceElementIds,
            added: {
              record: structuredClone(result.record),
              node: structuredClone(result.node),
              approach: structuredClone(result.edge),
            },
            originalVerticalEdgesChanged: false,
            originalOwnersChanged: false,
            restoredAccessibilityReview: false,
            limitations:
              "One source-owned flat terminal and physically rechecked approach only; native cells and actual navigation must regenerate after this hook.",
          };
        } catch (e) {
          return {
            edgeId: candidate.edgeId,
            applied: false,
            reason: e instanceof Error ? e.message : String(e),
          };
        }
      });
      attempts.push(...results);
      return structuredClone(results);
    },
    receipts: () => structuredClone(attempts),
  };
}
