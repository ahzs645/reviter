/**
 * The overlay must not call an element aligned merely because its outer box
 * agrees. A missing expected stair surface is an interior topology difference
 * and remains visible as red comparison geometry.
 */
export function ifcGeometryDiffStatus(
  boundsAligned: boolean,
  materialSlopeDifferent: boolean,
  stairTopologyIncomplete: boolean,
): "aligned" | "different" {
  return boundsAligned && !materialSlopeDifferent && !stairTopologyIncomplete
    ? "aligned"
    : "different";
}
