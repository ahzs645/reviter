import { REVIT_2027_GGROUP_SOURCE_CLASS_SLOT } from "./revit-2027-grep-prefixes.ts";
import { REVIT_2027_GFILTER_SOURCE_CLASS_SLOT } from "./revit-2027-gfilter.ts";
import { REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT, type Revit2027GeometryStatic } from "./revit-2027-geometry.ts";
import type { Revit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";

/** The measured wall representation has seven single-face view drawings,
 * followed by the multi-face model body. Combining those views with the body
 * adds planes through openings and extends wall ends. Accept only this exact
 * root/geometry structure; unknown representations keep their usual gate. */
export function wallModelFaceTokens(root: Revit2027FramedGRepRoot, replay: Revit2027GRepReplay): Set<number> | null {
  const G = REVIT_2027_GGROUP_SOURCE_CLASS_SLOT, F = REVIT_2027_GFILTER_SOURCE_CLASS_SLOT, B = REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT;
  const pattern = [G,G,F,G,F,F,G,B];
  if (root.flags !== 0 || root.objectType !== 3 || root.children.length !== pattern.length ||
      root.children.some((c,i) => c.sourceClassSlot !== pattern[i]) || replay.endOffset !== root.dynamicPayloadEndOffset) return null;
  const bodies = replay.spans.filter(s => s.propertySourceClassSlot === B);
  const model = bodies.find(s => s.path.length === 1 && s.path[0] === 7);
  if (!model || bodies.length !== 8) return null;
  const body = model.value as Revit2027GeometryStatic;
  if (body.faces.count < 4 || body.edges.count < 6) return null;
  const expectedPaths = new Set(['0,0','1,0','2,0,0','3,0','4,0,0','5,0,0','6,0']);
  for (const span of bodies) {
    if (span === model) continue;
    if (!expectedPaths.delete(span.path.join(',')) || (span.value as Revit2027GeometryStatic).faces.count !== 1) return null;
  }
  if (expectedPaths.size || body.faces.entries.some(e => e.token <= 0)) return null;
  return new Set(body.faces.entries.map(e => e.token));
}
