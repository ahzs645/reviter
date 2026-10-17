import test from "node:test";
import assert from "node:assert/strict";
import {
  Rational,
  rational,
} from "../lib/reviter/native-rational-overlay.ts";
import {
  replayPortableCapSideTopology,
  sameOriginalComponent,
  isExactOriginalSupportingSideAtFoot,
  type PortableCapSideTopology,
} from "../lib/reviter/native-stepped-stair-v2-footing-boundary.ts";
function cube(): PortableCapSideTopology {
  const faces = [
    { token: 10, vertices: [4, 5, 6, 7] },
    { token: 11, vertices: [0, 1, 5, 4] },
    { token: 12, vertices: [1, 2, 6, 5] },
    { token: 13, vertices: [2, 3, 7, 6] },
    { token: 14, vertices: [3, 0, 4, 7] },
    { token: 15, vertices: [0, 3, 2, 1] },
  ];
  const edges = new Map<string, PortableCapSideTopology["edges"][number]>(),
    uses: PortableCapSideTopology["faces"] = [];
  for (const face of faces) {
    const directed =
      [] as PortableCapSideTopology["faces"][number]["loopUses"][number]["directedEdges"];
    for (let i = 0; i < 4; i++) {
      const a = face.vertices[i]!,
        b = face.vertices[(i + 1) % 4]!,
        key = [Math.min(a, b), Math.max(a, b)].join(","),
        direction = a < b ? 1 : -1;
      let edge = edges.get(key);
      if (!edge) {
        edge = {
          edgeToken: 200 + edges.size,
          faceReferences: [face.token, 0],
          nextReferences: [0, 0],
          previousReferences: [0, 0],
          flags: direction === -1 ? 1 : 0,
          firstAndLastEdgePoints: [],
          interiorEdgePoints: [],
        };
        edges.set(key, edge);
      }
      const side = edge.faceReferences[0] === face.token ? 0 : 1;
      if (side === 1)
        edge.faceReferences = [edge.faceReferences[0], face.token];
      directed.push({ edgeToken: edge.edgeToken, side, direction });
    }
    uses.push({
      faceToken: face.token,
      face: { firstLoop: { token: 100 + face.token } },
      loopUses: [
        {
          loopToken: 100 + face.token,
          loop: {
            faceReference: face.token,
            nextEdgeReference: directed[0]!.edgeToken,
            previousEdgeReference: directed.at(-1)!.edgeToken,
            nextLoop: { token: 0 },
            open: false,
          },
          directedEdges: directed,
        },
      ],
    });
  }
  for (const face of uses)
    for (const loop of face.loopUses)
      for (const [i, use] of loop.directedEdges.entries()) {
        const edge = [...edges.values()].find(
          (e) => e.edgeToken === use.edgeToken,
        )!;
        const next: [number, number] = [...edge.nextReferences],
          previous: [number, number] = [...edge.previousReferences];
        next[use.side] = loop.directedEdges[i + 1]?.edgeToken ?? loop.loopToken;
        previous[use.side] =
          loop.directedEdges[i - 1]?.edgeToken ?? loop.loopToken;
        edge.nextReferences = next;
        edge.previousReferences = previous;
      }
  const adjacent = [...edges.values()]
    .filter((e) => e.faceReferences.includes(10))
    .map((edge) => {
      const capSide: 0 | 1 = edge.faceReferences[0] === 10 ? 0 : 1,
        side = (1 - capSide) as 0 | 1,
        sideFace = edge.faceReferences[side],
        cap = uses[0]!.loopUses[0]!,
        other = uses.find((f) => f.faceToken === sideFace)!.loopUses[0]!;
      return {
        sideFaceToken: sideFace,
        sharedEdges: [
          {
            edgeToken: edge.edgeToken,
            capLoopToken: cap.loopToken,
            sideLoopToken: other.loopToken,
            capUse: {
              side: capSide,
              direction: cap.directedEdges.find(
                (u) => u.edgeToken === edge.edgeToken,
              )!.direction,
            },
            sideUse: {
              side,
              direction: other.directedEdges.find(
                (u) => u.edgeToken === edge.edgeToken,
              )!.direction,
            },
          },
        ],
      };
    });
  return {
    nativeOwnerElementId: 20,
    capFaceToken: 10,
    componentFaceTokens: faces.map((f) => f.token),
    componentEdgeTokens: [...edges.values()].map((e) => e.edgeToken),
    componentId: "synthetic-cube",
    sourceModelSha256: "a".repeat(64),
    sourceSchemaSha256: "b".repeat(64),
    faces: uses,
    edges: [...edges.values()],
    adjacentSides: adjacent,
  };
}
test("complete original reciprocal component identifies only the cap's actual boundary sides", () => {
  const topology = cube(),
    before = structuredClone(topology),
    result = replayPortableCapSideTopology(topology);
  assert.deepEqual([...result.adjacentSideFaceTokens].sort(), [11, 12, 13, 14]);
  assert(!result.adjacentSideFaceTokens.has(15));
  assert.deepEqual(topology, before);
  assert(
    sameOriginalComponent(
      [15, 14, 13, 12, 11, 10],
      topology.componentFaceTokens,
    ),
  );
  assert(
    !sameOriginalComponent(
      [10, 11, 12, 13, 14, 99],
      topology.componentFaceTokens,
    ),
  );
});
test("nonreciprocal edges, borrowed cap/component, missing loop uses and false adjacency refuse", () => {
  const mutate = [
    (t: PortableCapSideTopology) => {
      t.edges[0]!.nextReferences = [999, 999];
    },
    (t: PortableCapSideTopology) => {
      t.capFaceToken = 999;
    },
    (t: PortableCapSideTopology) => {
      t.componentFaceTokens.push(999);
    },
    (t: PortableCapSideTopology) => {
      t.faces[0]!.loopUses[0]!.directedEdges.pop();
    },
    (t: PortableCapSideTopology) => {
      t.adjacentSides[0]!.sideFaceToken = 15;
    },
    (t: PortableCapSideTopology) => {
      t.adjacentSides[0]!.sharedEdges[0]!.sideLoopToken = 110;
    },
    (t: PortableCapSideTopology) => {
      t.edges[0]!.flags ^= 1;
    },
  ];
  for (const change of mutate) {
    const topology = cube();
    change(topology);
    assert.throws(() => replayPortableCapSideTopology(topology));
  }
});
test("only exact reciprocal side contact at current named footplane qualifies; positive height and borrowed facts refuse", () => {
  const topology = cube(),
    frame = "d".repeat(64),
    adjacency = {
      ...replayPortableCapSideTopology(topology),
      sourceOccurrenceFrameSha256: frame,
    },
    cell = {
      id: `native:20:${frame}:cell:6`,
      nativeOwnerId: 20,
      originalFaceTokens: [13],
      originalCellRole: "original-boundary-domain",
      sourceComponentFaceTokens: [...topology.componentFaceTokens],
      maximumElevationFeet: rational(1),
    },
    support = {
      nativeOwnerId: 20,
      physicalFaceToken: 10,
      sourceComponentFaceTokens: [...topology.componentFaceTokens],
      sourceOccurrenceFrameSha256: frame,
      elevationFeet: rational(1),
    };
  assert(
    isExactOriginalSupportingSideAtFoot(cell, support, rational(1), adjacency),
  );
  assert(
    !isExactOriginalSupportingSideAtFoot(
      {
        ...cell,
        maximumElevationFeet: new Rational((1n << 128n) + 1n, 1n << 128n),
      },
      support,
      rational(1),
      adjacency,
    ),
  );
  for (const changed of [
    { ...cell, nativeOwnerId: 21 },
    { ...cell, originalFaceTokens: [15] },
    { ...cell, sourceComponentFaceTokens: [10, 11, 12, 13, 14, 99] },
    { ...cell, id: `native:20:${"e".repeat(64)}:cell:6` },
    { ...cell, originalCellRole: "cap-bounded-core" },
  ])
    assert(
      !isExactOriginalSupportingSideAtFoot(
        changed,
        support,
        rational(1),
        adjacency,
      ),
    );
  assert(
    !isExactOriginalSupportingSideAtFoot(
      cell,
      { ...support, physicalFaceToken: 11 },
      rational(1),
      adjacency,
    ),
  );
  assert(
    !isExactOriginalSupportingSideAtFoot(
      cell,
      { ...support, nativeOwnerId: 21 },
      rational(1),
      adjacency,
    ),
  );
});
