import assert from "node:assert/strict";
import test from "node:test";

import {
  certifyRevit2027DrawableFaceCoverage,
} from "../lib/reviter/revit-2027-native-mesh-bridge.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-face-static.ts";

function face(
  token: number,
  surfaceToken: number,
  firstLoopToken: number,
  regionTokens: readonly number[] = [],
) {
  return {
    propertyToken: token,
    propertySourceClassSlot: REVIT_2027_FACE_SOURCE_CLASS_SLOT,
    value: {
      surface: { token: surfaceToken },
      firstLoop: { token: firstLoopToken },
      faceRegions: {
        entries: regionTokens.map((regionToken) => ({
          token: regionToken,
        })),
      },
    },
  };
}

test("nested completeness ignores zero-loop reference-face issues", () => {
  const spans = [
    face(1, 101, 201),
    face(2, 102, 0),
  ];
  assert.deepEqual(
    certifyRevit2027DrawableFaceCoverage(
      spans,
      [{ faceToken: 1 }],
      [{
        issue: {
          code: "loop-unresolved",
          faceToken: 2,
        },
      }],
    ),
    {
      complete: true,
      drawableFaces: 1,
      meshedDrawableFaces: 1,
      missingFaceTokens: [],
      code: "complete",
    },
  );
});

test("negative-one queued sentinels are non-null drawable properties", () => {
  const spans = [
    face(1, -1, 201),
    face(2, 102, -1),
    face(3, 103, 0, [-1]),
  ];
  assert.deepEqual(
    certifyRevit2027DrawableFaceCoverage(
      spans,
      [
        { faceToken: 1 },
        { faceToken: 2 },
        { faceToken: 3 },
      ],
    ),
    {
      complete: true,
      drawableFaces: 3,
      meshedDrawableFaces: 3,
      missingFaceTokens: [],
      code: "complete",
    },
  );
});

test("unproven negative CondInt16 tokens are not drawable properties", () => {
  const spans = [
    face(1, -2, 201),
    face(2, 102, -2),
    face(3, 103, 0, [-2]),
  ];
  assert.deepEqual(
    certifyRevit2027DrawableFaceCoverage(spans, []),
    {
      complete: false,
      drawableFaces: 0,
      meshedDrawableFaces: 0,
      missingFaceTokens: [],
      code: "no-drawable-faces",
    },
  );
});

test("nested completeness remains fail-closed for every positive drawable face", () => {
  const spans = [
    face(1, 101, 201),
    // A FaceRegion is independently positive topology even when firstLoop is
    // zero, so this face cannot be treated as a reference face.
    face(2, 102, 0, [301]),
  ];
  assert.deepEqual(
    certifyRevit2027DrawableFaceCoverage(
      spans,
      [{ faceToken: 1 }],
      [{
        issue: {
          code: "unsupported-surface",
          faceToken: 2,
        },
      }],
    ),
    {
      complete: false,
      drawableFaces: 2,
      meshedDrawableFaces: 1,
      missingFaceTokens: [2],
      code: "incomplete-drawable-faces",
    },
  );
});
