/** Worker for native-landing-approaches.ts (bounded checkpoint worker protocol).
 * It deserializes the bound immutable model/dataset snapshots, recomputes the
 * same deterministic pair plan and evaluates one pure pair per task. It never
 * applies union-find decisions or diagnostics; the parent replays in order. */
import { deserialize } from "node:v8";
import { initializeNativeExactGeosOverlay } from "../../lib/reviter/native-exact-geos-overlay.ts";
import { planNativeApproaches, createNativeApproachEvaluator } from "../../lib/reviter/native-circulation-links.ts";
import type { IndoorDataset } from "../../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import { strictJson, type CheckpointWorkerContext, type JsonValue } from "./bounded-worker-checkpoints.ts";
import { nativeApproachPairKey, candidateCarrier } from "./native-landing-approaches.ts";

export async function initialize(context: CheckpointWorkerContext) {
  const model = deserialize(await context.readVerifiedInput("native-model")) as ConvertResult;
  const data = deserialize(await context.readVerifiedInput("landing-dataset")) as IndoorDataset;
  await initializeNativeExactGeosOverlay();
  const plan = planNativeApproaches(model, data);
  return { data, plan, evaluate: createNativeApproachEvaluator(model, data) };
}
export function runTask(input: JsonValue, state: Awaited<ReturnType<typeof initialize>>): JsonValue {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2) throw Error("Invalid landing approach task");
  const { index, pairKey } = input as { index: number; pairKey: string };
  const pair = state.plan.pairs[index];
  if (!Number.isSafeInteger(index) || !pair || nativeApproachPairKey(state.data, pair) !== pairKey)
    throw Error("Landing approach task does not match the bound pair plan");
  const result = candidateCarrier(state.evaluate(pair)) as unknown as JsonValue;
  strictJson(result);
  return result;
}
