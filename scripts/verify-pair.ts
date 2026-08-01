/**
 * Verify one RVT against its own IFC export, in one command.
 *
 *   node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc
 *   node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc --json run.json
 *
 * ## Why this exists
 *
 * Every rule in this decoder was fitted on **one building**. A tighter-of-two-
 * copies bounds rule, a 3.61 ft railing guard height, a 10,000 sq ft unnamed-
 * sheet threshold, a door-swing geometry, a top-rail suppression — each has a
 * null control, and a null control is not a second file. The cheapest defence
 * against a rule that only works on `unbc.rvt` is to make checking a second
 * pair take one command and ten seconds of reading.
 *
 * So this prints the two tables that already exist — the per-class coverage
 * from `audit-coverage.ts` and the per-class geometric agreement from
 * `overlay-diff.ts`, both imported rather than reimplemented, and both computed
 * from a **single** conversion — and then adds what neither has: named
 * assertions with thresholds. A rule that does not generalise fails loudly and
 * says which rule it was.
 *
 * ## Where the thresholds come from
 *
 * Every one is the number measured on the supplied Revit 2027 project with
 * slack, and the slack is deliberately generous: this is a tripwire for a rule
 * that has stopped working, not a regression test pinning today's figures. A
 * threshold that fires on a healthy second building is worse than useless,
 * because it teaches the reader to ignore the report.
 *
 *   assertion                             observed on unbc   threshold
 *   -----------------------------------------------------------------------
 *   building-element-coverage             80.3% drawn        >= 60%
 *   no-records-outside-hull               1 of 31,177        <= 0.02% + 5 = 6
 *   hull-overhang-bounded                 14.1 ft            <= 200 ft
 *   centre-agreement/IFCMEMBER            98.6%              >= 85%
 *   centre-agreement/IFCPLATE             99.9%              >= 85%
 *   centre-agreement/IFCCOLUMN            100.0%             >= 80%
 *   centre-agreement/IFCRAILING           100.0%             >= 80%
 *   centre-agreement/IFCCOVERING          100.0%             >= 80%
 *   centre-agreement/IFCWALLSTANDARDCASE  96.8%              >= 85%
 *   door-swing-geometry                   78.1% centre ok    >= 55%
 *   door-swing-leaves-cut                 86.6% of drawn     >= 40%
 *   railing-guard-height                  3.609 ft median    2.5 - 4.5 ft
 *   railing-paths-believed                68 of 173 drawn    >= 1
 *   sheets-held-back-small                215 of 31,177      <= 3% of drawn
 *   sheets-held-back-fires                215 held back      >= 1
 *   stair-companions-adopted              111 adopted        >= 1
 *   tail-placements-read                  30,696 of 25,887   >= 50% of families
 *
 * **The per-class centre floors** are the classes the README reports at 96-100%
 * (members 98.6, plates 99.9, columns 100, railings 100, coverings 100, walls
 * 96.8). They are what the tighter-of-two-copies rule most directly bought —
 * columns went from 95 drawn to 266 at 100.0% agreement — so they are where a
 * bounds rule that has stopped generalising shows up first. Doors,
 * walls-that-are-not-standard-case, slabs and stair flights sit at 78%, 68%,
 * 75% and 42% on this model and are deliberately excluded: a floor under them
 * would be measuring the known remaining decoder gaps, not a broken rule.
 *
 * **The last four assert that a rule fires at all**, which nothing here used to
 * do. Every other threshold measures how well a rule does on the population it
 * reaches, and a rule that reaches *nothing* passes all of them: the population
 * is empty, so the share is vacuous or the assertion is skipped, and the loss
 * turns up as coverage missing somewhere else with no assertion naming it. Two
 * of these are sized to fire on a state this repository actually had rather than
 * on zero — see `tail-placements-read` below — because a floor of "at least one"
 * would not have caught either regression.
 *
 * `scripts/holdout.ts` runs the same idea one level down, per storey and per
 * wing, and it found a live example the whole-model version cannot see: the
 * railing sweep fires on 68 railings and on **none** of the 21 on Floor 1.
 * Whole-model floors belong here; per-partition ones belong there.
 *
 * The one rule with no firing assertion here is the tighter-of-two-copies
 * choice, because the copy it discarded is not in the conversion's output. That
 * rule's firing is measured in `holdout.ts`, which re-reads the pages.
 *
 * **The hull budget is set below a regression this repository actually had.**
 * Before the sheets rule, 11 records on *this* model were drawn past the
 * export's hull; after it, 2 by the original probe and 1 by the measurement
 * here. A budget of 6 therefore still fires on the state the rule was written
 * to fix. A threshold that would not have caught the regression it is modelled
 * on is not a threshold, so the obvious "0.1% of drawn" — 31 records — was
 * rejected as too loose to be worth printing.
 *
 * **The overhang ceiling guards the copy choice.** Taking the second bounds copy
 * unconditionally admitted a box 8,701 ft across; choosing whichever copy
 * encloses less dropped that tail. 200 ft is 14x the worst legitimate overhang
 * here and 40x under the failure it exists to catch.
 *
 * **The railing band is narrower than the decoder's own filter, on purpose.**
 * `convert.ts` rejects any path whose implied guard falls outside 1.5-5 ft, so
 * asserting the median lands in *that* band could never fail — every survivor is
 * already inside it. 2.5-4.5 ft is 30-54 inches, which is the range a handrail
 * can actually be, and it sits strictly inside the filter. A second building
 * whose surviving guards cluster at 1.6 ft has not failed the filter; it has
 * failed the rule, and only a band tighter than the filter shows that.
 *
 * ## The control on the harness itself
 *
 * A gate that cannot fail is decoration, and with one model there is no second
 * building to prove it discriminates. The substitute is a deliberately
 * mismatched pair: shift every `Tag` in the export past any real Revit id and
 * re-run. `building-element-coverage` drops to **0.0% and FAILs**, exit status
 * 1, and every assertion that depends on the join reports `skip` with its reason
 * rather than passing vacuously. The three RVT-only assertions — the hull
 * measurements read against the export's geometry, the railing guard, the sheet
 * share — correctly still pass, because nothing they measure was broken.
 *
 * ## Running it on a new pair
 *
 * Nothing here is specific to `unbc`. Point it at any RVT and the IFC exported
 * from that same RVT — the join is the Revit element id every IFC product
 * carries in its `Tag`, so the two files must be the same model, not merely the
 * same building. Classes the export does not contain are reported `skip`, not
 * `fail`, so a house with no curtain wall and no railings still gets a clean
 * report on what it does have.
 *
 * Exit status is 0 when every assertion passes or skips, 1 when any fails, so
 * this is usable as a gate. `--json <path>` writes the same numbers machine-
 * readably, which is how two models get differenced:
 *
 *   node --experimental-strip-types scripts/verify-pair.ts a.rvt a.ifc --json a.json
 *   node --experimental-strip-types scripts/verify-pair.ts b.rvt b.ifc --json b.json
 *   diff <(jq -S . a.json) <(jq -S . b.json)
 *
 * A note on cost: the conversion dominates, about 40s on a workstation and
 * around 2.5 minutes in a constrained container for the 67 MB supplied project.
 * Both tables come out of that one conversion.
 */
import { writeFileSync } from "node:fs";

import {
  computeCoverage,
  convertModel,
  printCoverage,
  printLedger,
  type CoverageResult,
} from "./audit-coverage.ts";
import {
  computeOverlay,
  printOverlay,
  readTruthBoxes,
  type OverlayResult,
} from "./overlay-diff.ts";

import type { ConvertResult } from "../lib/reviter/types.ts";

// --- thresholds, all sourced in the header comment ---------------------------

/** Share of the export's building elements that must reach the scene. */
const MIN_BUILDING_COVERAGE = 0.6;

/**
 * Records allowed past the export's hull, as a share of drawn plus a floor.
 * Sized to still fire on the 11 this model had before the sheets rule.
 */
const MAX_ESCAPED_SHARE = 0.0002;
const MAX_ESCAPED_FLOOR = 5;

/** The worst single overhang past the hull, in feet. */
const MAX_OVERHANG_FEET = 200;

/**
 * Per-class centre-agreement floors, for the classes currently at 96-100%.
 * A class absent from the export, or with fewer than the overlay's ten matched
 * elements, is skipped rather than failed.
 */
const CENTRE_FLOORS: Record<string, number> = {
  IFCMEMBER: 85,
  IFCPLATE: 85,
  IFCCOLUMN: 80,
  IFCRAILING: 80,
  IFCCOVERING: 80,
  IFCWALLSTANDARDCASE: 85,
};

/** The door-swing geometry: cut the leaf out of the swing, or do not draw one. */
const MIN_DOOR_CENTRE_PERCENT = 55;
const MIN_DOOR_LEAF_SHARE = 0.4;

/**
 * The band the *median* guard height must land in — 30 to 54 inches, which is
 * what a handrail can be.
 *
 * Strictly inside `convert.ts`'s own 1.5-5 ft filter, and that is the point:
 * every guard the decoder accepts is already inside the filter, so asserting the
 * filter back would be vacuous. Observed median here is 3.609 ft.
 */
const GUARD_MIN_FEET = 2.5;
const GUARD_MAX_FEET = 4.5;

/**
 * Railings the export must name before `railing-paths-believed` is enforced.
 * A building with three railings and no sketch curves for them has not broken
 * the rule, so below this the assertion skips rather than failing.
 */
const MIN_RAILINGS_FOR_PATH_CHECK = 20;

/**
 * Walls the export must hold before an absence of curved ones is a failure.
 * A small building can legitimately have none, and asserting on it would fire
 * on a healthy second model — which is the one thing these thresholds must not
 * do.
 */
const MIN_WALLS_FOR_CURVE_CHECK = 500;

/** Sheets held back, as a share of what is drawn. */
const MAX_SHEET_SHARE = 0.03;

/**
 * Populations the export must hold before "the rule fired on nothing" is a
 * failure rather than a building without stairs, floors or curtain wall.
 */
const MIN_STAIRS_FOR_COMPANION_CHECK = 20;
const MIN_SHEET_HOSTS_FOR_CHECK = 20;
const MIN_FAMILIES_FOR_PLACEMENT_CHECK = 500;

/**
 * Elements the tail-placement read must place, as a share of the loadable-family
 * elements the export names.
 *
 * A floor of one would be decoration here. `readInstancePlacement` returned
 * early on any object whose length was not exactly 300, so before that was
 * fixed this model placed **3** elements against 25,942 members and plates in
 * the export — 0.01%. After it, 30,696.
 *
 * **What is counted changed, because the original count measured the wrong
 * thing.** This asserted on `instanceOnlyElements`: elements the placement read
 * was the *sole* source of geometry for. That was a sharp signal when it was
 * written — 3 broken against 3,901 working — but it is a measure of how little
 * other evidence exists, not of whether the read works, so it falls whenever
 * the rest of the pipeline improves. It has since fallen to **21**, not because
 * the read broke but because 30,675 of those elements now also carry a real
 * duplicated-bounds record, which is the better evidence of the two. An
 * assertion that fails when the decoder gets better is worse than no assertion:
 * it trains the reader to ignore it.
 *
 * `placedInstances` measures the read directly — an element whose own object
 * yielded a transform and a shared shape — and it collapses toward zero if the
 * read breaks, exactly as the old metric did, without being pushed down by
 * unrelated progress. Today it is 30,696 against 25,887 families, 118%. A floor
 * of 50% sits well under that and two orders of magnitude over the broken
 * state, which is the same way the hull budget is sized.
 */
const MIN_PLACEMENT_SHARE = 0.5;

// --- assertion plumbing ------------------------------------------------------

type Verdict = "pass" | "fail" | "skip";

type Assertion = {
  /** Named after the rule it guards, so a failure says what stopped working. */
  name: string;
  verdict: Verdict;
  /** What was measured, formatted for a human. */
  observed: string;
  /** What was required of it. */
  required: string;
  /** The raw number, for `--json`. */
  value: number | null;
};

const assertions: Assertion[] = [];

function check(
  name: string,
  value: number | null,
  ok: boolean,
  observed: string,
  required: string,
): void {
  assertions.push({
    name,
    verdict: value === null ? "skip" : ok ? "pass" : "fail",
    observed,
    required,
    value,
  });
}

function skip(name: string, reason: string, required: string): void {
  assertions.push({ name, verdict: "skip", observed: reason, required, value: null });
}

const percent = (value: number) => `${value.toFixed(1)}%`;

// --- the checks --------------------------------------------------------------

/**
 * Coverage: how much of the building the export names actually reaches the
 * scene. This is the one number that moves when any recovery rule stops
 * generalising, which is why it is the first assertion rather than the last.
 */
function checkCoverage(coverage: CoverageResult): void {
  const { inIfc, drawn } = coverage.totals;
  if (!inIfc) {
    skip("building-element-coverage", "export names no building elements", `>= ${percent(MIN_BUILDING_COVERAGE * 100)}`);
    return;
  }
  const share = drawn / inIfc;
  check(
    "building-element-coverage",
    share * 100,
    share >= MIN_BUILDING_COVERAGE,
    `${drawn.toLocaleString()} of ${inIfc.toLocaleString()} drawn, ${percent(share * 100)}`,
    `>= ${percent(MIN_BUILDING_COVERAGE * 100)}`,
  );
}

/**
 * The hull test, guarding the tighter-of-two-copies bounds rule.
 *
 * Taking the second bounds copy unconditionally admitted a box 8,701 ft across;
 * choosing whichever copy encloses less volume dropped that tail without
 * costing accuracy. A model where that choice stops working does not show it in
 * a coverage count — the element is still drawn, just nowhere near the
 * building. Both the count of escapees and the worst single overhang are
 * checked, because a rule can fail in either direction: many small strays, or
 * one enormous one.
 */
function checkHull(overlay: OverlayResult): void {
  const budget = Math.max(MAX_ESCAPED_FLOOR, Math.round(overlay.drawnCount * MAX_ESCAPED_SHARE));
  check(
    "no-records-outside-hull",
    overlay.escaped.length,
    overlay.escaped.length <= budget,
    `${overlay.escaped.length} of ${overlay.drawnCount.toLocaleString()} drawn reach past the hull`,
    `<= ${budget}`,
  );
  check(
    "hull-overhang-bounded",
    overlay.worstOverhangFeet,
    overlay.worstOverhangFeet <= MAX_OVERHANG_FEET,
    `worst record reaches ${overlay.worstOverhangFeet.toFixed(1)} ft past the hull`,
    `<= ${MAX_OVERHANG_FEET} ft`,
  );
}

/**
 * Per-class centre agreement, guarding the bounds rules by class.
 *
 * A class can be present in full and drawn in the wrong place, so counting is
 * not enough. These floors sit under the classes the README reports at 96-100%,
 * which are the ones the bounds work bought outright.
 */
function checkCentreAgreement(overlay: OverlayResult): void {
  const byType = new Map(overlay.byClass.map((row) => [row.type, row]));
  for (const [type, floor] of Object.entries(CENTRE_FLOORS)) {
    const row = byType.get(type);
    if (!row) {
      skip(`centre-agreement/${type}`, "not in the export, or under 10 matched", `>= ${percent(floor)}`);
      continue;
    }
    check(
      `centre-agreement/${type}`,
      row.centreOkPercent,
      row.centreOkPercent >= floor,
      `${percent(row.centreOkPercent)} of ${row.matched.toLocaleString()} within 0.5 ft` +
        `, median ${row.medianCentreError.toFixed(3)} ft`,
      `>= ${percent(floor)}`,
    );
  }
}

/**
 * The door-swing geometry.
 *
 * A door's record is its opening plus the quarter-circle swing, so the leaf is
 * what is left when the swing is cut away: the record's extent along the wall,
 * the wall's own thickness across it, on the wall's centreline. That took doors
 * from 0.4% centre agreement to 78.1%. Two things have to hold for it to still
 * be working — the cut has to find host walls, and the result has to land.
 */
function checkDoorSwing(coverage: CoverageResult, overlay: OverlayResult): void {
  const doors = coverage.rows.IFCDOOR;
  const row = overlay.byClass.find((entry) => entry.type === "IFCDOOR");
  if (!doors || !row) {
    skip("door-swing-geometry", "no doors in the export", `>= ${percent(MIN_DOOR_CENTRE_PERCENT)}`);
    skip("door-swing-leaves-cut", "no doors in the export", `>= ${percent(MIN_DOOR_LEAF_SHARE * 100)} of drawn doors`);
    return;
  }
  check(
    "door-swing-geometry",
    row.centreOkPercent,
    row.centreOkPercent >= MIN_DOOR_CENTRE_PERCENT,
    `${percent(row.centreOkPercent)} of ${row.matched.toLocaleString()} doors within 0.5 ft`,
    `>= ${percent(MIN_DOOR_CENTRE_PERCENT)}`,
  );
  // Both routes count: the leaf is folded out of the door's own shared shape
  // where that can be read, and cut from the host wall where it cannot. Counting
  // only the wall route made this fail the moment the better one took over —
  // which is the assertion working, but on the wrong question.
  const leaves = (coverage.stats.doorLeaves ?? 0) + (coverage.stats.doorLeavesFromShape ?? 0);
  const share = doors.drawn ? leaves / doors.drawn : 0;
  check(
    "door-swing-leaves-cut",
    share * 100,
    share >= MIN_DOOR_LEAF_SHARE,
    `${leaves.toLocaleString()} leaves cut for ${doors.drawn.toLocaleString()} drawn doors, ${percent(share * 100)}`,
    `>= ${percent(MIN_DOOR_LEAF_SHARE * 100)}`,
  );
}

/**
 * The railing guard height.
 *
 * A railing's envelope is its path's rise plus the guard above it, so the guard
 * is one minus the other — 3.609 ft median here, a handrail, derived from the
 * file rather than assumed. The decoder rejects a path whose guard falls
 * outside 1.5-5 ft, so a per-element check would be circular; the median of
 * what survives is not, and a second building whose railings cluster at the
 * band's edge is telling you the arithmetic no longer picks out a handrail.
 */
function checkRailingGuard(outcome: ConvertResult, coverage: CoverageResult): void {
  const guards = outcome.elementBounds
    .map((record) => record.railPath?.guardHeightFeet)
    .filter((value): value is number => typeof value === "number");
  const railings = coverage.rows.IFCRAILING?.drawn ?? 0;
  const band = `${GUARD_MIN_FEET}-${GUARD_MAX_FEET} ft`;
  if (!guards.length) {
    // Too few railings to draw a conclusion is a clean skip. A building full of
    // railings and not one believed path is not: the rule found nothing it
    // could use, which is exactly the failure this is here to surface.
    if (railings < MIN_RAILINGS_FOR_PATH_CHECK) {
      skip("railing-guard-height", `only ${railings} railings drawn`, band);
      skip("railing-paths-believed", `only ${railings} railings drawn`, ">= 1");
      return;
    }
    skip("railing-guard-height", "no rail path believed, so no median", band);
    check("railing-paths-believed", 0, false, `0 of ${railings} railings swept`, ">= 1");
    return;
  }
  const sorted = [...guards].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  check(
    "railing-guard-height",
    median,
    median >= GUARD_MIN_FEET && median <= GUARD_MAX_FEET,
    `median guard ${median.toFixed(3)} ft over ${guards.length} swept railings`,
    band,
  );
  check(
    "railing-paths-believed",
    guards.length,
    guards.length >= 1,
    // The numerator is the RVT's and the denominator the export's, so the
    // denominator is dropped when the export names none rather than printing
    // "68 of 0".
    `${guards.length} swept along their path` +
      (railings ? `, of ${railings} drawn railings` : " (export names no railings)"),
    ">= 1",
  );
}

/**
 * Two rules whose failure mode is silence rather than error.
 *
 * `solidBelongsToEnvelope` drops a plane triple drawn on an element whose own
 * bounds record disagrees with it — 11 of 5,360 on drawn records here, of which
 * 6 improved by 4.8 to 252.2 ft and none worsened. `facetElevationBand` narrows
 * a stair stringer's z to the facets it owns, where those facets cap it. Neither
 * can be judged by a per-class percentage: the first is 0.2% specific and the
 * variants that fire on 62% and 100% of solids *score better* on wall size,
 * because the envelope is the export's own box. So both are asserted on reach.
 */
function checkGeometryRulesFire(outcome: ConvertResult): void {
  const disowned = outcome.stats?.disownedSolids ?? 0;
  const narrowed = outcome.stats?.narrowedFacetBands ?? 0;
  check(
    "stray-solids-disowned",
    disowned,
    disowned >= 1,
    `${disowned} solids dropped from records whose own envelope disagrees with them`,
    ">= 1",
  );
  check(
    "facet-bands-narrowed",
    narrowed,
    narrowed >= 1,
    `${narrowed} elevation bands narrowed to the element's own capping facets`,
    ">= 1",
  );
}

/**
 * How far an element may be drawn past *its own* export box, in feet.
 *
 * `no-records-outside-hull` measures against the whole building's hull, so an
 * element drawn a hundred feet too long *inside* the envelope passes it. The
 * per-class "size ok" percentages do not catch it either: they are counts, and a
 * handful of monsters cannot move a figure over 7,000 walls. This is the gap
 * those two leave — measured per element, against that element's own truth.
 *
 * Sized to fire on the state it exists to catch. It was written when a wall was
 * drawn **260.3 ft** from its own export box; dropping the misattributed solid
 * that caused it and narrowing the stair stringers' z band to their own facets
 * took the count 35 → 23 and the worst case to 19.8 ft. The budget is 26,
 * because the 23 that remain are *characterised* — 21 stringers that own no
 * facet at all, 401861 which has no second reading to check against, and
 * 1622190 where the exporter tags only a ramp's landing and writes its two
 * flights untagged — so a rise above them is a new defect rather than the
 * known residue.
 */
const MAX_ELEMENT_OVERHANG_FEET = 10;
const MAX_ELEMENTS_OVER_OWN_BOX = 26;

function checkElementOverhang(overlay: OverlayResult): void {
  const over = overlay.overhangingElements ?? [];
  if (!overlay.drawnCount) {
    skip("no-element-past-its-own-box", "nothing drawn", `<= ${MAX_ELEMENTS_OVER_OWN_BOX}`);
    return;
  }
  const worst = over[0];
  check(
    "no-element-past-its-own-box",
    over.length,
    over.length <= MAX_ELEMENTS_OVER_OWN_BOX,
    `${over.length} of ${overlay.drawnCount.toLocaleString()} drawn reach over ` +
      `${MAX_ELEMENT_OVERHANG_FEET} ft past their own export box` +
      (worst ? `, worst ${worst.overhangFeet.toFixed(1)} ft (${worst.elementId})` : ""),
    `<= ${MAX_ELEMENTS_OVER_OWN_BOX}`,
  );
}

/**
 * The curved-wall rule: a stride-137 cylinder triple whose middle radius is the
 * mean of the outer two.
 *
 * This is a *firing* assertion in the same sense as the four below it. The
 * arithmetic is self-checking — a run of unrelated cylinders will not have a
 * centre radius — so the failure mode is not a wrong arc but silence: a release
 * that writes cylinders at a different stride, or an attribution that stops
 * reaching them, and every curved wall quietly reverts to the rectangle
 * enclosing its bulge with nothing in the output saying so. 27 fired here.
 *
 * It is asserted against the walls the export holds rather than as a bare
 * count, and skips when the export has too few walls to judge.
 */
function checkCurvedWalls(outcome: ConvertResult, coverage: CoverageResult): void {
  const rebuilt = outcome.stats?.curvedWalls ?? 0;
  const walls =
    (coverage.rows.IFCWALLSTANDARDCASE?.inIfc ?? 0) + (coverage.rows.IFCWALL?.inIfc ?? 0);
  if (walls < MIN_WALLS_FOR_CURVE_CHECK) {
    skip("curved-walls-rebuilt", `only ${walls} walls in the export`, ">= 1");
    return;
  }
  check(
    "curved-walls-rebuilt",
    rebuilt,
    rebuilt >= 1,
    `${rebuilt} walls rebuilt as an arc from their own cylinder triple, against ${walls.toLocaleString()} walls in the export`,
    ">= 1",
  );
}

/**
 * The sheets rule: a floor's own boundary sketch, an unnamed storey-sized
 * plate over 10,000 sq ft, and a railing's top rail lying along its parent.
 *
 * All three hold geometry back from the scene, and all three were derived from
 * one building. The failure mode that matters is a threshold that is too
 * eager somewhere else and starts eating real elements, and that shows up as
 * the held-back count growing against the model. 215 of 31,177 here.
 */
function checkSheets(coverage: CoverageResult): void {
  if (!coverage.drawnCount) {
    skip("sheets-held-back-small", "nothing drawn", `<= ${percent(MAX_SHEET_SHARE * 100)} of drawn`);
    return;
  }
  const share = coverage.omittedSheetCount / coverage.drawnCount;
  check(
    "sheets-held-back-small",
    share * 100,
    share <= MAX_SHEET_SHARE,
    `${coverage.omittedSheetCount.toLocaleString()} held back against ` +
      `${coverage.drawnCount.toLocaleString()} drawn, ${percent(share * 100)}`,
    `<= ${percent(MAX_SHEET_SHARE * 100)}`,
  );
}

/**
 * The rules that have to fire at all.
 *
 * Nothing above notices a rule that reaches nothing, because a rule with an
 * empty population has no share to fall below a threshold. That is the failure
 * mode these four exist for: the stair companion adoption, the sheet
 * suppression, the shared-shape resolution and the tail-placement read all lose
 * geometry silently when they stop firing, and the loss surfaces as coverage
 * missing from a class rather than as a named assertion.
 *
 * Each is gated on the export holding enough of the population for the absence
 * to mean something, so a house with no stairs and no curtain wall reports skip
 * rather than fail.
 */
function checkRulesFire(coverage: CoverageResult): void {
  const stats = coverage.stats;
  const rows = coverage.rows;

  const stairs = (rows.IFCSTAIRFLIGHT?.inIfc ?? 0) + (rows.IFCSTAIR?.inIfc ?? 0);
  if (stairs < MIN_STAIRS_FOR_COMPANION_CHECK) {
    skip("stair-companions-adopted", `only ${stairs} stairs in the export`, ">= 1");
  } else {
    const adopted = stats.adoptedStairBoxes ?? 0;
    check(
      "stair-companions-adopted",
      adopted,
      adopted >= 1,
      `${adopted.toLocaleString()} stair parts adopted a companion record's box, ` +
        `against ${stairs.toLocaleString()} stairs in the export`,
      ">= 1",
    );
  }

  // A building with floors has floor sketches and a building with railings has
  // top rails, so either population is enough for the sheet rule to have work.
  const sheetHosts = (rows.IFCSLAB?.inIfc ?? 0) + (rows.IFCRAILING?.inIfc ?? 0);
  if (sheetHosts < MIN_SHEET_HOSTS_FOR_CHECK) {
    skip("sheets-held-back-fires", `only ${sheetHosts} slabs and railings in the export`, ">= 1");
  } else {
    check(
      "sheets-held-back-fires",
      coverage.omittedSheetCount,
      coverage.omittedSheetCount >= 1,
      `${coverage.omittedSheetCount.toLocaleString()} sheets held back, against ` +
        `${sheetHosts.toLocaleString()} slabs and railings in the export`,
      ">= 1",
    );
  }

  const families = (rows.IFCMEMBER?.inIfc ?? 0) + (rows.IFCPLATE?.inIfc ?? 0);
  if (families < MIN_FAMILIES_FOR_PLACEMENT_CHECK) {
    skip(
      "tail-placements-read",
      `only ${families} members and plates in the export`,
      `>= ${percent(MIN_PLACEMENT_SHARE * 100)}`,
    );
    return;
  }
  // `placedInstances` counts the elements whose own object yielded a transform
  // and a shared shape, which is the tail read itself rather than a side effect
  // of it. See `MIN_PLACEMENT_SHARE` for why the previous metric was retired.
  const placed = stats.placedInstances ?? 0;
  const share = placed / families;
  const tailOnly = stats.instanceOnlyElements ?? 0;
  check(
    "tail-placements-read",
    share * 100,
    share >= MIN_PLACEMENT_SHARE,
    `${placed.toLocaleString()} placements resolved to a transform and a shared shape, ` +
      `${percent(share * 100)} of the ${families.toLocaleString()} members and plates in the export ` +
      `(${tailOnly.toLocaleString()} of them have no other geometry)`,
    `>= ${percent(MIN_PLACEMENT_SHARE * 100)}`,
  );
}

// --- run ---------------------------------------------------------------------

// `--json` takes a value, so the argument after it is consumed rather than
// filtered by name — filtering by name would drop a model whose path happened
// to match the report path.
const positional: string[] = [];
let jsonPath: string | undefined;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]!;
  if (argument === "--json") {
    jsonPath = process.argv[index + 1];
    index += 1;
    continue;
  }
  if (argument.startsWith("--")) continue;
  positional.push(argument);
}
const [rvtPath, ifcPath] = positional;
if (!rvtPath || !ifcPath) {
  console.error("usage: verify-pair.ts <model.rvt> <model.ifc> [--json <path>]");
  process.exit(2);
}

// The export is read first: it is the cheaper of the two and a bad path should
// not cost a two-minute conversion before saying so.
const truth = await readTruthBoxes(ifcPath);
const outcome = convertModel(rvtPath);
const coverage = computeCoverage(outcome, ifcPath, new Set(truth.keys()));
const overlay = computeOverlay(outcome, truth);

console.log(`\n${rvtPath.split("/").pop()} against ${ifcPath.split("/").pop()}\n`);
printCoverage(coverage);
printLedger(coverage);
printOverlay(overlay);

checkCoverage(coverage);
checkHull(overlay);
checkElementOverhang(overlay);
checkGeometryRulesFire(outcome);
checkCentreAgreement(overlay);
checkDoorSwing(coverage, overlay);
checkRailingGuard(outcome, coverage);
checkCurvedWalls(outcome, coverage);
checkSheets(coverage);
checkRulesFire(coverage);

const failed = assertions.filter((assertion) => assertion.verdict === "fail");
const skipped = assertions.filter((assertion) => assertion.verdict === "skip");

console.log("\nassertions\n");
const nameWidth = Math.max(...assertions.map((assertion) => assertion.name.length));
for (const assertion of assertions) {
  const mark = assertion.verdict === "pass" ? "pass" : assertion.verdict === "fail" ? "FAIL" : "skip";
  console.log(
    `  ${mark}  ${assertion.name.padEnd(nameWidth)}  ${assertion.observed}` +
      (assertion.verdict === "skip" ? "" : `   [${assertion.required}]`),
  );
}

const verdict = failed.length ? "FAIL" : "PASS";
console.log(
  `\n${verdict} — ${assertions.length - failed.length - skipped.length} passed, ` +
    `${failed.length} failed, ${skipped.length} skipped\n`,
);
if (failed.length) {
  console.log("Each failing assertion is named after the rule it guards. A rule that");
  console.log("was fitted on one building and does not hold on this one fails here.\n");
}

if (jsonPath) {
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        rvt: rvtPath.split("/").pop(),
        ifc: ifcPath.split("/").pop(),
        verdict,
        assertions,
        coverage: {
          rows: coverage.rows,
          totals: coverage.totals,
          recordCount: coverage.recordCount,
          withVolumeCount: coverage.withVolumeCount,
          drawnCount: coverage.drawnCount,
          unclassifiedCount: coverage.unclassifiedCount,
          omittedSheetCount: coverage.omittedSheetCount,
          omittedWrapperCount: coverage.omittedWrapperCount,
        },
        overlay: {
          truthCount: overlay.truthCount,
          agreement: overlay.agreement,
          buildingBox: overlay.buildingBox,
          framingErrorFeet: overlay.framingErrorFeet,
          escapedCount: overlay.escaped.length,
          worstOverhangFeet: overlay.worstOverhangFeet,
          escaped: overlay.escaped.slice(0, 50),
          byClass: overlay.byClass,
        },
        stats: coverage.stats,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`machine-readable report written to ${jsonPath}`);
}

process.exit(failed.length ? 1 : 0);
