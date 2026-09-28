/**
 * Geometry a GRep stores but the saved view does not draw.
 *
 * Every replayed GNode carries a GInfo, and bit 0x80 of its `flags` word
 * marks the node, and so everything beneath it, as not drawn. A family stores
 * the geometry of every state it can take, and the saved file says with this
 * bit which of it is shown; Revit resolves it when it saves, so reading it
 * needs no family parameter or GFilter condition evaluated here.
 *
 * Measured on the four corpus models (2025 RAC and technical school samples,
 * the 2027 campus model and the fourth, a 2024 sample):
 *
 *  - The RAC sample's track-light types store twelve lamp heads each, for
 *    every track length. The heads a type's own length leaves out sit in
 *    groups flagged 0x880e4, the heads it draws in groups flagged 0x88004.
 *    Without the flagged heads the seven placed fixtures match the Autodesk
 *    Viewer's boxes to 0.001 ft, where the full store spans 12 ft of a
 *    4.4 ft fixture. The family's GFilters carry no conditions over the heads; their
 *    GConditionDir children only pick symbolic lines by view direction.
 *  - Every wall stores its location line and core faces as four planes, in
 *    groups flagged 0xa0880a4, 0x20880a0 or 0xa0882a4. They run the wall's
 *    full length through its joins and across its doors and windows. Without
 *    them 92 technical school walls go from 0.23 to 0.50 ft off their
 *    Autodesk boxes to within 0.001 ft, and 1,189 campus walls from
 *    reconstructed boxes to native.
 *  - A GRep root persists two extents: the local one over everything stored
 *    and the world one over what is drawn. Over every owner whose faces all
 *    mesh, carry the bit somewhere and hold no instance (35, 121, 919 and
 *    5,636 owners in the four models), leaving the flagged faces out is what
 *    brings the meshed box onto the world extents, or both boxes already sit
 *    on it (52, 237, 769 and 3,928 more). No owner needs a flagged face for
 *    its world extents but two flat 0.3 ft symbols in the campus model,
 *    whose unflagged lines can account for them (`work/cmp/probe-world.ts`,
 *    to 0.01 ft).
 *
 * Bit 0x20 is not the same bit. Every node seen with 0x80 or 0x40 has it,
 * but so do faces that are drawn: taking 0x20 for the rule, 11 RAC owners
 * and 29 technical school owners lose faces their world extents need.
 */
import type { Revit2027GInfo } from "./revit-2027-grep-prefixes.ts";
import type { Revit2027GRepReplaySpan } from "./revit-2027-grep-replay.ts";

/** The GInfo flag bit of a node the saved view does not draw. */
export const REVIT_2027_GINFO_UNDRAWN_FLAG = 0x80;

type GInfoCarrier = {
  gInfo?: Revit2027GInfo;
  /** A GFilter and a GGTag keep their GInfo on their group header. */
  group?: { gInfo?: Revit2027GInfo };
};

/** The node's own GInfo, wherever its reader keeps it. */
function spanGInfo(span: Revit2027GRepReplaySpan): Revit2027GInfo | undefined {
  const value = span.value as GInfoCarrier | undefined;
  return value?.gInfo ?? value?.group?.gInfo;
}

function carriesUndrawnFlag(span: Revit2027GRepReplaySpan): boolean {
  const gInfo = spanGInfo(span);
  return gInfo != null && (gInfo.flags & REVIT_2027_GINFO_UNDRAWN_FLAG) !== 0;
}

/**
 * The replay indices of every node the saved view does not draw: a node whose
 * own GInfo carries the bit, and every node beneath one. A replay whose parent
 * links do not resolve to its own spans fails closed and returns null, since
 * which of its nodes are drawn is then unknown.
 */
export function revit2027UndrawnReplayIndices(
  spans: readonly Revit2027GRepReplaySpan[],
): ReadonlySet<number> | null {
  const undrawn = new Array<boolean | undefined>(spans.length);
  for (let start = 0; start < spans.length; start += 1) {
    if (spans[start]?.replayIndex !== start) return null;
    const chain: number[] = [];
    let flagged = false;
    let index: number | null = start;
    while (index != null) {
      const known = undrawn[index];
      if (known !== undefined) {
        flagged = known;
        break;
      }
      const span: Revit2027GRepReplaySpan | undefined = spans[index];
      if (!span || chain.length >= spans.length) return null;
      chain.push(index);
      if (carriesUndrawnFlag(span)) {
        flagged = true;
        break;
      }
      index = span.parentReplayIndex;
    }
    for (const entry of chain) undrawn[entry] = flagged;
  }
  const result = new Set<number>();
  for (let index = 0; index < undrawn.length; index += 1) {
    if (undrawn[index]) result.add(index);
  }
  return result;
}
