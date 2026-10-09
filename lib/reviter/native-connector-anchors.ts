import { validNativeSourceStairBinding } from "./native-source-stair.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
/** Original enabled vertical-connector endpoints may identify an otherwise
 * unclaimed physical landing face. Ordinary labels never become this proof. */
export function nativeConnectorAnchors(data: IndoorDataset) {
  const nodes = new Map(data.nodes.map((n) => [n.id, n])),
    records = new Map(data.records.map((r) => [r.key, r]));
  return data.edges
    .filter(
      (e) =>
        e.enabled &&
        ["stairs", "local-steps", "ramp", "elevator", "escalator"].includes(
          e.kind,
        ) &&
        Number.isSafeInteger(e.nativeElementId) &&
        e.nativeElementId! > 0 &&
        e.pointsFeet.length >= 2,
    )
    .flatMap((edge) =>
      [edge.from, edge.to].flatMap((id, i) => {
        const node = nodes.get(id),
          room = node && records.get(node.roomKey),
          point = i === 0 ? edge.pointsFeet[0] : edge.pointsFeet.at(-1),
          sourceOnly =
            !!edge.nativeSourceStair &&
            validNativeSourceStairBinding(data, edge);
        if (
          !node ||
          (!sourceOnly &&
            (!room ||
              !room.walkable ||
              room.access === "staff" ||
              !edge.roomKeys.includes(room.key))) ||
          !point ||
          point.some((v, k) => Math.abs(v - node.pointFeet[k]!) > 1e-7) ||
          (!sourceOnly &&
            !(
              room!.stair ||
              room!.circulation ||
              room!.properties.generatedLanding === true
            ))
        )
          return [];
        return [
          {
            edgeId: edge.id,
            kind: edge.kind,
            nodeId: node.id,
            roomKey: sourceOnly ? "" : room!.key,
            nativeElementId: edge.nativeElementId!,
            pointFeet: node.pointFeet,
            levelId: node.levelId,
          },
        ];
      }),
    )
    .sort(
      (a, b) =>
        a.edgeId.localeCompare(b.edgeId) || a.nodeId.localeCompare(b.nodeId),
    );
}
