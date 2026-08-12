/**
 * Clipping a rebuilt solid to the element's own envelope.
 *
 * The two are independent readings of one element — a trim range off the native
 * centre plane, and the duplicated-bounds record — so where they disagree the
 * shorter one is not a guess. See the block comment at the call site in
 * `convert.ts` for the measurements and the controls.
 */
import type { Bounds3 } from "./types.ts";
import type { WallSolid } from "./native-geometry.ts";

/** Below this a clipped run is degenerate, and the solid is left alone. */
const MIN_CLIPPED_LENGTH_FEET = 0.05;

/**
 * How far a solid's centreline may sit outside its own envelope before the two
 * readings are taken to be about different elements.
 *
 * This is numeric slack and nothing else: two solids in the supplied project
 * miss their envelope by 1e-4 ft, which is a rounded corner rather than a
 * disagreement, while the thinnest wall in the model is 60 mm — 0.197 ft — so a
 * twentieth of a foot is far below any real dimension here. **The value is not
 * on a cliff.** Over the records the scene draws, every threshold from 0.0002 ft
 * to 0.2252 ft selects the same eleven solids; they miss by 0.23, 0.23, 0.49,
 * 3.61, 5.47, 7.88, 11.35, 14.62, 16.02, 36.03 and 243.19 ft.
 *
 * Half of the solid's *own* thickness — how far the drawn box reaches from the
 * centreline — was measured as the alternative with no fitted number in it, and
 * it spares one of the eleven: 1193382, whose duplicated-bounds record is
 * 0.1 x 0.0 ft and reproduces its export box exactly, carrying a solid 12.31 ft
 * long. A rule that keeps that one is the worse rule.
 */
const STRAY_SLACK_FEET = 0.05;

/**
 * Does a solid's centreline meet the element's own envelope in plan?
 *
 * **A solid that shares no point with its own envelope is not the element's
 * solid.** The two are independent readings — a trim range off a native centre
 * plane, and the duplicated-bounds record — and the record is the reading that
 * has been checked: for the 106 `IfcWall` and 6,045 `IfcWallStandardCase`
 * records that carry a real one, the envelope reproduces the export's box corner
 * for corner within 0.001 ft for 100.0% and 99.4% of them. So where the two
 * disagree completely, rather than merely by the join trimming `clipSolidToEnvelope`
 * absorbs, the solid is a surface attribution that went to the wrong element.
 *
 * 147 of the 6,756 solids that sit on a record with a real bounds block fail
 * this test, and **11 of them are on records the scene draws** — 6 walls, 4
 * curtain panels and 1 mullion. Four of the eleven are carried by a *second*
 * element as well, which settles it outright: a plane triple is one body, so two
 * owners is a misattribution however the boxes are read. For three of those the
 * co-owner's envelope reproduces the solid's own length and thickness to 0.01 ft
 * — 1501065's box is 0.39 x 29.89 ft against a solid 29.37 ft long and 0.394
 * thick, and the solid was being drawn on 1501060 and 1501062 as well.
 *
 * Dropping them improves 6 of the 11 and worsens 0, taking the elements drawn
 * over 10 ft past their own export box from 35 to 29 and the worst single case
 * from **260.3 ft to 19.8**; the other 5 are drawn from a placed oriented box,
 * which already outranks the solid, so nothing on screen changes for them.
 *
 * **The per-class agreement percentages cannot judge this rule and were not
 * used to fit it.** Falling back to the envelope always scores better on a box
 * metric, because the envelope *is* the export's box for 99.4% of walls: the same
 * containment test against the envelope of the element one id below rejects 3,342
 * of 5,354 solids and against a shuffled envelope 5,356, and both come out
 * *higher* on `IfcWallStandardCase` size — 95.7% and 97.0% against 92.4% — while
 * throwing away the orientation of thousands of correctly rebuilt walls. What
 * separates the rule from those controls is its specificity: keyed on the
 * element's own envelope it fires on **11 of 5,354**, 0.2%, against 62% and 100%.
 */
export function solidBelongsToEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const minX = envelope.min.x - STRAY_SLACK_FEET;
  const minY = envelope.min.y - STRAY_SLACK_FEET;
  const maxX = envelope.max.x + STRAY_SLACK_FEET;
  const maxY = envelope.max.y + STRAY_SLACK_FEET;
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(solid.start.x, solid.start.y) || inside(solid.end.x, solid.end.y)) return true;

  // Liang–Barsky again: a run can cross the envelope with neither end inside it,
  // and a wall whose record is a fragment of its own length does exactly that.
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  let enter = 0;
  let exit = 1;
  const limits: [number, number][] = [
    [-dx, solid.start.x - minX],
    [dx, maxX - solid.start.x],
    [-dy, solid.start.y - minY],
    [dy, maxY - solid.start.y],
  ];
  for (const [direction, distance] of limits) {
    if (Math.abs(direction) < 1e-12) {
      if (distance < 0) return false;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  return exit > enter;
}

/**
 * Clip a solid's centreline to the envelope's plan extent, in place.
 *
 * Returns true when the run was shortened. A solid that lies wholly outside its
 * own envelope, or that would clip to nothing, is left as it is: that is a
 * disagreement to report rather than a length to invent.
 */
export function clipSolidToEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_CLIPPED_LENGTH_FEET) return false;

  // Liang–Barsky against the plan rectangle, in the run's own parameter.
  let enter = 0;
  let exit = 1;
  const limits: [number, number, number][] = [
    [-dx, solid.start.x - envelope.min.x, 0],
    [dx, envelope.max.x - solid.start.x, 0],
    [-dy, solid.start.y - envelope.min.y, 0],
    [dy, envelope.max.y - solid.start.y, 0],
  ];
  for (const [direction, distance] of limits) {
    if (Math.abs(direction) < 1e-12) {
      // Parallel to this edge: outside it means there is nothing to clip to.
      if (distance < 0) return false;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  if (exit <= enter) return false;
  if (enter <= 1e-9 && exit >= 1 - 1e-9) return false;
  if ((exit - enter) * length < MIN_CLIPPED_LENGTH_FEET) return false;

  const at = (t: number) => ({ x: solid.start.x + dx * t, y: solid.start.y + dy * t });
  const clippedStart = at(enter);
  const clippedEnd = at(exit);
  solid.start = { ...solid.start, x: clippedStart.x, y: clippedStart.y };
  solid.end = { ...solid.end, x: clippedEnd.x, y: clippedEnd.y };
  return true;
}

/** An end travelling less than this is numerical noise, not a join. */
const MIN_EXTENSION_FEET = 1e-9;

/**
 * Intersect a solid's elevation band with the element's own envelope, in place.
 * Returns true when the band was narrowed.
 *
 * The plan rules above are the same argument as this one — two independent
 * readings of one element, so the smaller is not a guess — applied to the axis
 * nothing was checking. A solid's band is `origin.z + vMin` to `origin.z + vMax`
 * off the centre plane's trim range; the record's is the element's own extent.
 *
 * **This is the sharpest rule in the file and the reason is that it almost never
 * applies.** Of the 5,312 solid-drawn records that carry a real bounds block,
 * the solid's band reaches outside that record for **3**: 1192647, whose record
 * and whose export box both read 0.66 ft tall against a solid drawn 9.84, and
 * 865903 and 2227845 at 6.89 and 6.56 ft. All three go to **0.000 ft** and
 * nothing else in the model moves — `IfcWall` size agreement 88.8% → 89.6%, and
 * three walls leave the over-five-foot tail.
 *
 * **Nulls.** Given a shuffled real record's band the same intersection fires on
 * 579 records and is better for 3 while worse for 572, worst 0.000 → 42.65 ft.
 * Given the band of the element one id below it fires on 79 and is better for
 * **0** and worse for 79. Specificity 3 of 5,312 — 0.06% — against 11% and 1.5%.
 *
 * Narrowing cannot add extent, so no element can be pushed outside the building;
 * a band that would collapse is left alone, on the same principle as the plan
 * rules — a disagreement to report rather than a height to invent.
 */
export function clipSolidBandToEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const base = Math.max(solid.baseElevation, envelope.min.z);
  const top = Math.min(solid.topElevation, envelope.max.z);
  if (top - base < MIN_CLIPPED_LENGTH_FEET) return false;
  if (base - solid.baseElevation < 1e-9 && solid.topElevation - top < 1e-9) return false;
  solid.baseElevation = base;
  solid.topElevation = top;
  return true;
}

/**
 * Signed travel for one end of the run: how far it may move along `direction`
 * before either corner of the drawn box at that end leaves the envelope's plan
 * rectangle. Negative when a corner is already outside.
 *
 * The corners rather than the centreline, because the two differ for a wall at
 * an angle and 1,888 of this model's 5,316 eligible runs are at 32°, 35.5° or
 * 45° to the model axes. A corner sits half a thickness off the centreline along
 * the run's normal, which contributes nothing along the run but everything to
 * the axis-aligned envelope the corner has to stay inside: for a 45° wall the
 * extreme-x corner and the extreme-y corner are at opposite ends, and taking the
 * minimum over both corners and both axes is what makes the answer zero there
 * instead of half a thickness of invented length.
 */
function endReach(
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  normalX: number,
  normalY: number,
  envelope: Bounds3,
): number {
  let reach = Infinity;
  for (const sign of [1, -1]) {
    const cornerX = x + normalX * sign;
    const cornerY = y + normalY * sign;
    const limits: [number, number, number, number][] = [
      [cornerX, dirX, envelope.min.x, envelope.max.x],
      [cornerY, dirY, envelope.min.y, envelope.max.y],
    ];
    for (const [corner, direction, min, max] of limits) {
      if (Math.abs(direction) < 1e-12) continue;
      reach = Math.min(reach, direction > 0 ? (max - corner) / direction : (min - corner) / direction);
    }
  }
  return Number.isFinite(reach) ? reach : 0;
}

/**
 * Extend a solid's run to the element's own envelope, in place. Returns true
 * when either end moved.
 *
 * **The wall size residual was Revit's join extension, and the envelope already
 * holds it.** A rebuilt solid's run is the centre plane's trim range — the wall
 * as modelled — and Revit extends a wall's *body* at a join to the far face of
 * the wall it meets without moving the location line. So the drawn wall stops
 * short of the exported one, and it stops short by an amount that is not one
 * constant: over the 4,008 axis-aligned solid-drawn walls the shortfall spikes at
 * 45, 50, 60, 75, 100, 120, 150 and 200 mm, which are exactly half of this
 * model's 90, 100, 120, 150, 200, 240, 300 and 400 mm wall types. Half of the
 * neighbour's thickness, element by element.
 *
 * The other two axes were ruled out rather than assumed. The recovered thickness
 * reproduces the export's cross-extent to **0.0 mm for 3,999 of those 4,008**,
 * and the elevation band to 0.0 mm for 3,979; the residual is in the length axis
 * alone, and it is **negative** — the drawn wall is short, not long, which is the
 * opposite of what this project used to explain the column away with.
 *
 * The envelope is a second, independent reading of the same element and is the
 * *joined* extent: along the run it reproduces the export's box to within
 * 0.001 ft for **3,372 of the 3,381** walls that carry a real duplicated-bounds
 * record. So the extension is read off it rather than invented.
 *
 * **Two premises, and both are load-bearing.**
 *
 * The envelope must be an independent reading. An element with no bounds record
 * gets one synthesised from its own solid, and that synthesis pads the box by
 * half a thickness on *both* plan axes — so along the run it is a full thickness
 * too long, and extending into that slack is circular. Of the 627 synthesised
 * axis-aligned wall envelopes, the slack is exactly 1.000 × the wall's own
 * thickness for **627 of 627**. Fed those envelopes as well, the same rule scores
 * `IfcWallStandardCase` size at **92.0% — below the 92.4% it started from** —
 * against 95.8% when it is confined to real records. The gate is the difference
 * between the rule working and the rule hurting.
 *
 * And an extension longer than the run it extends is not a join. Uncapped, 16
 * ends travel further than their own solid's length, worst a 0.97 ft stub
 * stretched 5.46 ft. Capping each end at the run's own length — a bound taken
 * from the solid, not fitted to the export — removes all 16 and takes the worst
 * extension from 5.46 ft to 2.59 ft at a cost of 3 of 4,883 exactly-right walls.
 *
 * **Effect and specificity.** It fires on 2,407 of 6,556 solid-drawn records,
 * 36.7%, moving 2,781 ends by a median of 0.1969 ft — 60 mm, half a 120 mm wall.
 * 2,352 of them are `IfcWallStandardCase`, 44 `IfcWall`, and 11 everything else;
 * no other class's agreement moves at all.
 *
 * | | shipped | extended |
 * | --- | --- | --- |
 * | `IfcWallStandardCase` centre / size | 98.5% / 92.4% | **98.9% / 95.8%** |
 * | median size error | 0.073 ft | **0.000 ft** |
 * | `IfcWall` centre / size | 90.3% / 73.9% | **91.0% / 85.8%** |
 * | median size error | 0.218 ft | **0.019 ft** |
 * | walls whose box is exact to 0.001 ft | 3,170 | **4,883** |
 * | walls over half a foot out | 548 | **302** |
 *
 * **Nulls.** Extending to a *shuffled* real envelope puts `IfcWallStandardCase`
 * at 41.0% / 37.7% with a median size error of 39.98 ft — it fires on 4,282
 * records and moves ends by a median of 174 ft. Extending to the real envelope of
 * the element one id below — a genuinely nearby box — scores 90.6% / 83.8%, below
 * the baseline. The gain needs the element's own record.
 *
 * **A guard that looked better and is not, recorded so it is not retried.** The
 * envelope is the AABB of the body, so if that body is one oriented rectangle of
 * this solid's thickness `t` at direction `(c, s)` then `envW = L·c + t·s` and
 * `envH = L·s + t·c` — two equations for one unknown, and requiring the two
 * solved lengths to agree is a check with no fitted number in it. It costs
 * accuracy rather than buying it: it declines 350–716 records depending on the
 * slack and takes `IfcWallStandardCase` to 95.3% and `IfcWall` to **81.3%** from
 * 85.8%, because `IfcWall` is precisely the class whose body is *not* one
 * rectangle — 86 of 140 are faceted `Brep`s. Every slack from 1e-9 to 0.5 ft
 * scores worse than no guard at all. That same test *is* what
 * `shrinkSolidIntoEnvelope` needs, for a reason worth stating: a solid may be
 * grown towards a union it is only part of, because the join extension is real
 * geometry the envelope has and the solid has not, but it must not be cut down to
 * a union, because that removes geometry the solid has and the union shares with
 * something else.
 */
export function extendSolidToEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_CLIPPED_LENGTH_FEET) return false;
  const unitX = dx / length;
  const unitY = dy / length;
  const normalX = -unitY * solid.thickness * 0.5;
  const normalY = unitX * solid.thickness * 0.5;

  // `endReach` is signed and this function only grows: an end whose corner is
  // already outside the envelope reads negative, and letting that through would
  // make this an unguarded shrink. It is the guarded `shrinkSolidIntoEnvelope`
  // that is allowed to take length away, and clamping here rather than there is
  // what keeps the two rules separable — with the clamp missing, four
  // `Body/SweptSolidx2` walls whose envelope holds two bodies were cut from
  // 0.373 ft out to 1.278 ft.
  const forward = Math.max(
    0,
    Math.min(length, endReach(solid.end.x, solid.end.y, unitX, unitY, normalX, normalY, envelope)),
  );
  const back = Math.max(
    0,
    Math.min(length, endReach(solid.start.x, solid.start.y, -unitX, -unitY, normalX, normalY, envelope)),
  );
  if (forward < MIN_EXTENSION_FEET && back < MIN_EXTENSION_FEET) return false;

  solid.start = {
    ...solid.start,
    x: solid.start.x - unitX * back,
    y: solid.start.y - unitY * back,
  };
  solid.end = {
    ...solid.end,
    x: solid.end.x + unitX * forward,
    y: solid.end.y + unitY * forward,
  };
  return true;
}

/**
 * The two solved lengths may differ by this much and still count as one answer.
 *
 * **Not on a cliff.** Every slack from 0.001 ft to 0.1 ft selects a rule that
 * scores `IfcWallStandardCase` at 96.0% and `IfcWall` at 88.8%; it moves only how
 * many records are reached — 1,042, 1,118 and 1,176 — and how many of those the
 * export disagrees with, 24, 26 and 40.
 */
const ONE_RECTANGLE_SLACK_FEET = 0.01;

/**
 * The run length the envelope implies, if the envelope is the axis-aligned box of
 * one oriented rectangle of this solid's thickness and direction — or null when
 * the two axes do not agree on an answer.
 *
 * For a rectangle of length `L` and thickness `t` whose unit direction has
 * `c = |u.x|` and `s = |u.y|`, the axis-aligned box measures
 *
 *   `envW = L·c + t·s`      `envH = L·s + t·c`
 *
 * — two equations in the single unknown `L`. Solving each and requiring the
 * answers to agree is an **overdetermined** test the envelope either passes or
 * fails; there is no length to fit, only a residual to check. An envelope holding
 * anything besides this one rectangle — a second swept body, a faceted profile, a
 * neighbour's box — gives two different lengths and is declined.
 */
function oneRectangleLength(solid: WallSolid, envelope: Bounds3, slack: number): number | null {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_CLIPPED_LENGTH_FEET) return null;
  const alongX = Math.abs(dx / length);
  const alongY = Math.abs(dy / length);
  const width = envelope.max.x - envelope.min.x;
  const height = envelope.max.y - envelope.min.y;

  const solved: number[] = [];
  if (alongX > 1e-9) solved.push((width - solid.thickness * alongY) / alongX);
  else if (Math.abs(width - solid.thickness) > slack) return null;
  if (alongY > 1e-9) solved.push((height - solid.thickness * alongX) / alongY);
  else if (Math.abs(height - solid.thickness) > slack) return null;
  if (!solved.length) return null;

  const low = Math.min(...solved);
  const high = Math.max(...solved);
  if (high - low > slack || low <= 0) return null;
  return (low + high) / 2;
}

/**
 * Shrink a solid's run until the box the viewer draws for it lies inside the
 * element's own envelope, in place. Returns true when either end moved.
 *
 * **`clipSolidToEnvelope` clips the centreline and this clips the box, and for a
 * wall at an angle those are not the same rectangle.** A drawn box corner sits
 * half a thickness off the centreline along the run's normal, so a diagonal wall
 * whose centreline has been clipped to its envelope still has two corners outside
 * it — element 332243's drawn box is 9.91 × 15.32 ft against an envelope and an
 * export box that both read 9.36 × 16.21. This model is not a special case for
 * that: 1,888 of the 5,316 eligible runs sit at 32°, 35.5° or 45° to the model
 * axes.
 *
 * **The premise is checked, not assumed, and that is the whole rule.** Shrinking
 * is only sound where the envelope is this slab's own box rather than a union the
 * slab is one part of, so `oneRectangleLength` has to solve. Unguarded, the same
 * shrink fires on 1,437 records and *loses* ground — `IfcWallStandardCase`
 * 95.8% → 95.5%, `IfcWall` 85.8% → **84.3%** with its centre agreement 91.0% →
 * 88.8% — because it cuts multi-body walls down to the union of their parts: four
 * `Body/SweptSolidx2` walls go from 0.48 ft out to 2.56 ft. Guarded it fires on
 * 1,118 and:
 *
 * | | shipped | shrunk |
 * | --- | --- | --- |
 * | `IfcWallStandardCase` centre / size | 98.9% / 95.8% | 98.9% / **96.0%** |
 * | walls exact to 0.001 ft | 4,880 | **5,880** |
 * | `IfcWall` centre / size | 91.0% / 85.8% | 91.0% / **88.8%** |
 * | `IfcWall` median size error | 0.019 ft | **0.000 ft** |
 * | `IfcWall` exact to 0.001 ft | 66 | **87** |
 *
 * — improving 1,067 walls and 22 `IfcWall` against 26 and 0 disagreements, worst
 * disagreement 0.696 ft. No other class moves at all.
 *
 * **Nulls, with the guard applied against the wrong envelope too, because the
 * guard is part of the rule.** Against a shuffled real envelope it reaches 7
 * records and improves 1 while worsening 6. Against the real envelope of the
 * element one id below — a genuinely nearby box — it reaches 124 and improves
 * **0** while worsening 124. The rectangle test is where the specificity lives:
 * fed a wrong box it almost always declines, and where it does not it is wrong.
 */
export function shrinkSolidIntoEnvelope(solid: WallSolid, envelope: Bounds3): boolean {
  const dx = solid.end.x - solid.start.x;
  const dy = solid.end.y - solid.start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_CLIPPED_LENGTH_FEET) return false;
  if (oneRectangleLength(solid, envelope, ONE_RECTANGLE_SLACK_FEET) == null) return false;

  const unitX = dx / length;
  const unitY = dy / length;
  const normalX = -unitY * solid.thickness * 0.5;
  const normalY = unitX * solid.thickness * 0.5;

  const forward = Math.min(0, endReach(solid.end.x, solid.end.y, unitX, unitY, normalX, normalY, envelope));
  const back = Math.min(0, endReach(solid.start.x, solid.start.y, -unitX, -unitY, normalX, normalY, envelope));
  if (forward > -MIN_EXTENSION_FEET && back > -MIN_EXTENSION_FEET) return false;
  // Shrinking to nothing is a disagreement to report, not a length to invent.
  if (length + forward + back < MIN_CLIPPED_LENGTH_FEET) return false;

  solid.start = {
    ...solid.start,
    x: solid.start.x - unitX * back,
    y: solid.start.y - unitY * back,
  };
  solid.end = {
    ...solid.end,
    x: solid.end.x + unitX * forward,
    y: solid.end.y + unitY * forward,
  };
  return true;
}
