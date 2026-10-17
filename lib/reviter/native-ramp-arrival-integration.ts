import type { IndoorDataset, IndoorEdge } from "./indoor-contract.ts";
import { proposeNativeRampTerminalArrival } from "./native-ramp-terminal-arrival.ts";

/** Unwired compiler integration proposal. Call only after ramp qualification
 * and final physical walking replay; the callback must check current original
 * ramp, own-door and walking support. This changes one derived arrival pointer,
 * never the original label/seed, any node/edge, owner, review or accessibility.
 * The ordinary final approached-arrival gate and runtime policy still apply. */
export function applyNativeRampTerminalArrival(data: IndoorDataset, metadata: unknown,
    roomKey: string, physicallyChecked: (edge: IndoorEdge) => boolean) {
  const proposal = proposeNativeRampTerminalArrival(data, metadata, roomKey, physicallyChecked);
  if (!proposal) return;
  const record = data.records.find(room => room.key === proposal.roomKey)!;
  record.arrivalNodeId = proposal.proposedArrivalNodeId;
  return proposal;
}
