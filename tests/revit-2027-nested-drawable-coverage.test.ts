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
