/** Pure portable reciprocal topology replay. The source importer must rebuild
 * these component operands from the actual original model; copied geometry is
 * not source authority. No complete owner or component is exempted. */
import type { Rational } from "./native-rational-overlay.ts";
export type CapSideEdgeUse = {
  edgeToken: number;
  side: 0 | 1;
  direction: 1 | -1;
};
export type PortableCapSideTopology = {
  nativeOwnerElementId: number;
  capFaceToken: number;
  componentFaceTokens: number[];
  componentEdgeTokens: number[];
  componentId: string;
  sourceModelSha256: string;
  sourceSchemaSha256: string;
  sourceGeometryOwnerElementId?: number;
  sourceOccurrenceFrameSha256?: string;
  sourceGeometryFrameSha256?: string;
  faces: {
    faceToken: number;
    face: { firstLoop: { token: number } };
    loopUses: {
      loopToken: number;
      loop: {
        faceReference: number;
        nextEdgeReference: number;
        previousEdgeReference: number;
        nextLoop: { token: number };
        open: boolean;
      };
      directedEdges: CapSideEdgeUse[];
    }[];
  }[];
  edges: {
    edgeToken: number;
    faceReferences: readonly [number, number];
    nextReferences: readonly [number, number];
    previousReferences: readonly [number, number];
    flags: number;
    firstAndLastEdgePoints: unknown;
    interiorEdgePoints: unknown;
  }[];
  adjacentSides: {
    sideFaceToken: number;
    sharedEdges: {
      edgeToken: number;
      capLoopToken: number;
      sideLoopToken: number;
      capUse: { side: 0 | 1; direction: 1 | -1 };
      sideUse: { side: 0 | 1; direction: 1 | -1 };
    }[];
  }[];
};
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const canonical = (tokens: readonly number[]) =>
  [...tokens].sort((a, b) => a - b).join(",");
export const sameOriginalComponent = (
  a: readonly number[] | undefined,
  b: readonly number[],
) => !!a && a.length === b.length && canonical(a) === canonical(b);
export function replayPortableCapSideTopology(
  topology: PortableCapSideTopology,
) {
  const fail = (why: string): never => {
    throw new Error(`Invalid original cap-side reciprocal topology: ${why}`);
  };
  if (
    !positive(topology.nativeOwnerElementId) ||
    !positive(topology.capFaceToken) ||
    !topology.componentId ||
    !Array.isArray(topology.componentFaceTokens) ||
    topology.componentFaceTokens.length === 0 ||
    !topology.componentFaceTokens.every(positive) ||
    new Set(topology.componentFaceTokens).size !==
      topology.componentFaceTokens.length ||
    !topology.componentFaceTokens.includes(topology.capFaceToken) ||
    !Array.isArray(topology.componentEdgeTokens) ||
    topology.componentEdgeTokens.length === 0 ||
    !topology.componentEdgeTokens.every(positive) ||
    new Set(topology.componentEdgeTokens).size !==
      topology.componentEdgeTokens.length
  )
    fail("owner/cap/component identity");
  const faces = new Map(topology.faces.map((face) => [face.faceToken, face])),
    edges = new Map(topology.edges.map((edge) => [edge.edgeToken, edge]));
  if (
    faces.size !== topology.faces.length ||
    edges.size !== topology.edges.length ||
    !sameOriginalComponent([...faces.keys()], topology.componentFaceTokens) ||
    !sameOriginalComponent([...edges.keys()], topology.componentEdgeTokens)
  )
    fail("incomplete component census");
  const uses = new Map<
      string,
      { faceToken: number; loopToken: number; use: CapSideEdgeUse }
    >(),
    loops = new Set<number>();
  for (const face of topology.faces) {
    if (
      face.loopUses.length === 0 ||
      face.face.firstLoop.token !== face.loopUses[0]!.loopToken
    )
      fail("missing original face loop");
    for (const [loopIndex, loop] of face.loopUses.entries()) {
      if (
        !positive(loop.loopToken) ||
        loops.has(loop.loopToken) ||
        loop.directedEdges.length < 2 ||
        loop.loop.open !== false ||
        loop.loop.faceReference !== face.faceToken ||
        loop.loop.nextLoop.token !==
          (face.loopUses[loopIndex + 1]?.loopToken ?? 0) ||
        loop.loop.nextEdgeReference !== loop.directedEdges[0]!.edgeToken ||
        loop.loop.previousEdgeReference !== loop.directedEdges.at(-1)!.edgeToken
      )
        fail("duplicate/missing original loop");
      loops.add(loop.loopToken);
      for (const [i, use] of loop.directedEdges.entries()) {
        const edge = edges.get(use.edgeToken),
          key = `${use.edgeToken}:${use.side}`,
          nextToken = loop.directedEdges[i + 1]?.edgeToken ?? loop.loopToken,
          previousToken =
            loop.directedEdges[i - 1]?.edgeToken ?? loop.loopToken;
        if (
          !edge ||
          ![0, 1].includes(use.side) ||
          ![-1, 1].includes(use.direction) ||
          uses.has(key) ||
          edge.faceReferences[use.side] !== face.faceToken ||
          edge.nextReferences[use.side] !== nextToken ||
          edge.previousReferences[use.side] !== previousToken ||
          !Number.isSafeInteger(edge.flags) ||
          edge.flags < 0 ||
          use.direction !==
            (((edge.flags & 1) !== 0) === (use.side === 1) ? 1 : -1)
        )
          fail("nonreciprocal directed source edge");
        uses.set(key, {
          faceToken: face.faceToken,
          loopToken: loop.loopToken,
          use,
        });
      }
    }
  }
  const connected = new Set<number>([topology.capFaceToken]);
  for (const edge of topology.edges) {
    if (
      edge.faceReferences.length !== 2 ||
      edge.nextReferences.length !== 2 ||
      edge.previousReferences.length !== 2 ||
      !edge.faceReferences.every((token) => faces.has(token)) ||
      !uses.has(`${edge.edgeToken}:0`) ||
      !uses.has(`${edge.edgeToken}:1`)
    )
      fail("edge leaves the complete source component");
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of topology.edges) {
      const [a, b] = edge.faceReferences;
      if (connected.has(a) && !connected.has(b)) {
        connected.add(b);
        changed = true;
      }
      if (connected.has(b) && !connected.has(a)) {
        connected.add(a);
        changed = true;
      }
    }
  }
  if (connected.size !== faces.size)
    fail("another source component was borrowed");
  const actual = new Map<number, number[]>();
  for (const edge of topology.edges) {
    const [a, b] = edge.faceReferences;
    if (a === b || (a !== topology.capFaceToken && b !== topology.capFaceToken))
      continue;
    const other = a === topology.capFaceToken ? b : a;
    actual.set(other, [...(actual.get(other) ?? []), edge.edgeToken]);
  }
  if (
    new Set(topology.adjacentSides.map((side) => side.sideFaceToken)).size !==
      topology.adjacentSides.length ||
    actual.size !== topology.adjacentSides.length
  )
    fail("incomplete cap adjacency");
  for (const side of topology.adjacentSides) {
    const expected = actual.get(side.sideFaceToken);
    if (
      !expected ||
      !sameOriginalComponent(
        side.sharedEdges.map((edge) => edge.edgeToken),
        expected,
      )
    )
      fail("borrowed or missing shared side edge");
    for (const shared of side.sharedEdges) {
      const cap = uses.get(`${shared.edgeToken}:${shared.capUse.side}`),
        other = uses.get(`${shared.edgeToken}:${shared.sideUse.side}`);
      if (
        shared.capUse.side === shared.sideUse.side ||
        !cap ||
        !other ||
        cap.faceToken !== topology.capFaceToken ||
        other.faceToken !== side.sideFaceToken ||
        cap.loopToken !== shared.capLoopToken ||
        other.loopToken !== shared.sideLoopToken ||
        cap.use.direction !== shared.capUse.direction ||
        other.use.direction !== shared.sideUse.direction ||
        shared.capUse.direction !== -shared.sideUse.direction
      )
        fail(
          "shared edge does not belong to both complete original face loops",
        );
    }
  }
  return {
    nativeOwnerElementId: topology.nativeOwnerElementId,
    capFaceToken: topology.capFaceToken,
    componentFaceTokens: [...topology.componentFaceTokens],
    adjacentSideFaceTokens: new Set(actual.keys()),
  };
}

/** Only a named cap's actual reciprocal SIDE at the exact current footplane.
 * Positive material, unknown height, unrelated faces/components/occurrences
 * and every foreign owner retain the ordinary closed-contact predicate. */
export function isExactOriginalSupportingSideAtFoot(
  cell: {
    id: string;
    nativeOwnerId: number;
    originalFaceTokens: number[];
    originalCellRole?: string;
    sourceComponentFaceTokens?: number[];
    maximumElevationFeet: Rational;
  },
  support: {
    nativeOwnerId: number;
    physicalFaceToken: number;
    sourceComponentFaceTokens?: number[];
    sourceOccurrenceFrameSha256?: string;
    elevationFeet: Rational;
  },
  foot: Rational,
  adjacency: ReturnType<typeof replayPortableCapSideTopology> & {
    sourceOccurrenceFrameSha256: string;
  },
) {
  const same = (a: Rational, b: Rational) => a.n * b.d === b.n * a.d;
  return (
    same(cell.maximumElevationFeet, foot) &&
    same(support.elevationFeet, foot) &&
    cell.nativeOwnerId === support.nativeOwnerId &&
    adjacency.nativeOwnerElementId === support.nativeOwnerId &&
    adjacency.capFaceToken === support.physicalFaceToken &&
    cell.originalCellRole === "original-boundary-domain" &&
    cell.originalFaceTokens.length === 1 &&
    adjacency.adjacentSideFaceTokens.has(cell.originalFaceTokens[0]!) &&
    sameOriginalComponent(
      support.sourceComponentFaceTokens,
      adjacency.componentFaceTokens,
    ) &&
    sameOriginalComponent(
      cell.sourceComponentFaceTokens,
      adjacency.componentFaceTokens,
    ) &&
    support.sourceOccurrenceFrameSha256 ===
      adjacency.sourceOccurrenceFrameSha256 &&
    cell.id.startsWith(
      `native:${cell.nativeOwnerId}:${adjacency.sourceOccurrenceFrameSha256}:`,
    )
  );
}
