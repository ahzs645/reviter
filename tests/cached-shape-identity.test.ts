import assert from "node:assert/strict";
import test from "node:test";
import { removeCachedShapeRecords } from "../lib/reviter/convert-synthesised-records.ts";
import type { ElementBoundsRecord } from "../lib/reviter/types.ts";
import type { InstancePlacement } from "../lib/reviter/instanced-geometry.ts";

test("a drawing helper cannot classify a proven model instance as cached symbol geometry", () => {
  const placement = (elementId: number, geometryId: number): InstancePlacement => ({ elementId, geometryId, basis: [1,0,0,0,1,0,0,0,1], origin: [0,0,0] });
  const records = [10,20,30].map(elementId => ({ elementId }) as ElementBoundsRecord);
  const result = removeCachedShapeRecords({ elementBounds: records, categoryTokens: [], elementIndex: undefined, modelInstanceIds: new Set([10]), instancePlacements: new Map([[10,placement(10,20)], [30,placement(30,10)]]) });
  assert.deepEqual(records.map(r => r.elementId), [10,30]);
  assert.deepEqual([...result.sharedGeometryIds], [20]);
  assert.equal(result.cachedShapeRecords,1);
});
