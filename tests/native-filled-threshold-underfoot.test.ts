import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inspectFilledThresholdStepGeometry } from "../lib/reviter/native-filled-threshold-step.ts";
import { inspectFilledThresholdOwnSillStepping } from "../lib/reviter/native-filled-threshold-underfoot.ts";
import { Rational } from "../lib/reviter/native-rational-overlay.ts";
const frame = (id: number) => { const bytes = readFileSync(new URL(`./fixtures/native-filled-threshold-${id}.bin`, import.meta.url)); return { bytes, nativeElementId: id, sha256: createHash("sha256").update(bytes).digest("hex") }; };
const cases = [{ sill: 2315423, definition: 1223587, from: [35.53982462700122, 528.5495338272797, 24.278215223097114], to: [28.8971, 528.5495338272798, 24.278215223097114] }, { sill: 2311773, definition: 1223587, from: [32.32406123802166, 528.5495338272797, 14.435695538057743], to: [28.8971, 528.5495338272798, 14.435695538057743] }, { sill: 1505916, definition: 2464392, from: [51.87207421791895, 484.85891702937954, 24.278215223097114], to: [46.79615541250058, 484.85891702937954, 24.278215223097114] }, { sill: 2042019, definition: 1191708, from: [88.33982462700122, 527.8441532498509, 24.278215223097114], to: [83.05144567076621, 527.8441532498509, 24.278215223097114] }, { sill: 2465287, definition: 1439914, from: [84.49212156185723, 489.06610206874933, 34.120734908136484], to: [79.34212156185721, 489.06610206874933, 34.120734908136484] }];
const original = (c = cases[0]!, reverse = false) => inspectFilledThresholdStepGeometry({ placed: frame(c.sill), definition: frame(c.definition), fromFeet: (reverse ? c.to : c.from) as [
        number,
        number,
        number
    ], toFeet: (reverse ? c.from : c.to) as [
        number,
        number,
        number
    ] });
test("all five actual finite sill bodies retain two explicit vertical transfers and complete two-foot footplanes in both directions", () => { for (const c of cases)
    for (const reverse of [false, true]) {
        const s = original(c, reverse);
        assert.equal(s.ok, true, s.blockers.join("; "));
        const r = inspectFilledThresholdOwnSillStepping(s, "walking");
        assert.equal(r.ownSillSteppedFootplaneGeometryQualified, true);
        assert.equal(r.verticalTransitionsRetained, 2);
        assert.equal(r.stations.length, 3);
        assert.equal(r.physicalForwardPointsFeet.length, 7);
        assert.deepEqual(r.physicalReversePointsFeet, r.physicalForwardPointsFeet.toReversed());
        assert.deepEqual(r.originalRiseFeet, s.riseFeet);
        assert.equal(r.sourceSillMaterialOmitted, false);
        assert.equal(r.sourceSillUnderfootExceptionApproved, false);
        assert.equal(r.sourceLeafOperationApproved, false);
        assert.equal(r.routeApproved, false);
        assert.equal(r.wheelchairApproved, false);
    } });
test("positive original sill rise is never admitted for step-free routing or flattened by a rise policy", () => { const s = original(); assert.throws(() => inspectFilledThresholdOwnSillStepping(s, "step-free"), /step-free/); const low = s.floorElevationFeet!, tooHigh = new Rational(low.n + 2n * low.d, low.d); assert.throws(() => inspectFilledThresholdOwnSillStepping({ ...s, topElevationFeet: tooHigh, riseFeet: new Rational(2n) }, "walking"), /step rise/); });
test("additional material above the exact cap, duplicate physical faces and stale support partitions retain refusals", () => { const s = original(), body = structuredClone(s.body), high = s.topElevationFeet!; body.placedFaces![0]!.ringFeet[0]![2] = [(high.n + 1n).toString(), high.d.toString()]; assert.throws(() => inspectFilledThresholdOwnSillStepping({ ...s, body }, "walking"), /cap prism/); const duplicate = structuredClone(s.body); duplicate.placedFaces![0]!.faceToken = duplicate.placedFaces![1]!.faceToken; assert.throws(() => inspectFilledThresholdOwnSillStepping({ ...s, body: duplicate }, "walking"), /six-face/); assert.throws(() => inspectFilledThresholdOwnSillStepping({ ...s, floorWalkingPartsFeet: [] }, "walking"), /partition/); });
test("the original fifth standing demand remains refused rather than borrowing the unapplied deeper endpoint", () => { const c = { ...cases[4]!, from: [83.49212156185723, 489.06610206874933, 34.120734908136484] }, s = original(c); assert.equal(s.ok, false); assert.match(s.blockers.join("; "), /standing/); assert.throws(() => inspectFilledThresholdOwnSillStepping(s, "walking"), /complete original|Complete original/); });
