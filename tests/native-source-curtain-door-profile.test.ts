import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inspectOriginalCurtainDoorDefinition } from "../lib/reviter/native-source-curtain-door-definition.ts";
import { inspectCurtainDoorProfileCrossing, inspectOriginalCurrentCurtainDoorProfileCrossing } from "../lib/reviter/native-source-curtain-door-profile.ts";
import { inspectFilledThresholdStepGeometry } from "../lib/reviter/native-filled-threshold-step.ts";
import { Rational, rational, type NativeRationalParts } from "../lib/reviter/native-rational-overlay.ts";
const file = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url)), schema = file("native-drawing-reference-source-schema.bin"), frame = (id: number) => { const bytes = file(`native-filled-threshold-${id}.bin`); return { bytes, nativeElementId: id, sha256: createHash("sha256").update(bytes).digest("hex") }; };
const cases = [{ door: 1505914, symbol: 2464763, sill: 1505916, definition: 2464392, from: [51.87207421791895, 484.85891702937954, 24.278215223097114], to: [46.79615541250058, 484.85891702937954, 24.278215223097114] }, { door: 2042015, symbol: 2464665, sill: 2042019, definition: 1191708, from: [88.33982462700122, 527.8441532498509, 24.278215223097114], to: [83.05144567076621, 527.8441532498509, 24.278215223097114] }];
const original = (c: typeof cases[number]) => { const d = inspectOriginalCurtainDoorDefinition(schema, file(`native-curtain-door-${c.door}-2031.bin`), file(`native-curtain-door-symbol-${c.symbol}.bin`)), step = inspectFilledThresholdStepGeometry({ placed: frame(c.sill), definition: frame(c.definition), fromFeet: c.from as [
        number,
        number,
        number
    ], toFeet: c.to as [
        number,
        number,
        number
    ] }); assert.equal(step.ok, true); const foot = step.topElevationFeet!, head = new Rational(foot.n + 6n * foot.d, foot.d); return { d, step, foot, head }; };
test("both actual closed native profiles contain the complete original crossing and full six-foot demand above its exact highest cap", () => { for (const c of cases) {
    const { d, step, foot, head } = original(c), r = inspectCurtainDoorProfileCrossing(d, step.fullWalkingStripFeet, foot, head);
    assert.equal(r.wholeCrossingWithinOriginalFiniteProfile, true);
    assert.deepEqual([r.originalLocalFootPlaneFeet.n, r.originalLocalFootPlaneFeet.d], [1n, 562949953421312n]);
    assert.equal(r.sourceApertureApproved, false);
    assert.equal(r.sourceLeafOperationApproved, false);
    assert.equal(r.sourceMaterialOmitted, false);
} });
test("original nonjoining profile operands retain an exact refusal instead of flattening the reference plane", () => { const bad = inspectOriginalCurtainDoorDefinition(schema, file("native-curtain-door-2315416-2031.bin"), file("native-curtain-door-symbol-2312095.bin")), { step, foot, head } = original(cases[0]!); assert.throws(() => inspectCurtainDoorProfileCrossing(bad, step.fullWalkingStripFeet, foot, head), /do not join exactly/); });
test("full width, vertical bounds, holes, changed native plane domain and tiny tilt remain vetoes", () => { const { d, step, foot, head } = original(cases[0]!); assert.throws(() => inspectCurtainDoorProfileCrossing(d, step.fullWalkingStripFeet, foot, new Rational(head.n + 10n * head.d, head.d)), /boundary/); assert.throws(() => inspectCurtainDoorProfileCrossing(d, [step.fullWalkingStripFeet[0]!, step.fullWalkingStripFeet[0]!], foot, head), /complete finite/); const wide: NativeRationalParts = [[[[rational(46), rational(480)], [rational(52), rational(480)], [rational(52), rational(490)], [rational(46), rational(490)]]]]; assert.throws(() => inspectCurtainDoorProfileCrossing(d, wide, foot, head), /boundary/); const changed = structuredClone(d) as typeof d; const p = changed.originalCellPlaneOperands as {
    m_Envelope: {
        m_corners: number[][];
    };
}; p.m_Envelope.m_corners[1]![0] = -100; assert.throws(() => inspectCurtainDoorProfileCrossing(changed, step.fullWalkingStripFeet, foot, head), /plane domain/); const tilted = structuredClone(d) as typeof d; (tilted.originalNativePlacementOperands as {
    m_3x3: number[][];
}).m_3x3[0]![2] = Number.MIN_VALUE; assert.throws(() => inspectCurtainDoorProfileCrossing(tilted, step.fullWalkingStripFeet, foot, head), /tilted/); });
test("foreign native definitions and forged original source/container contexts cannot mint profile facts", () => { assert.throws(() => inspectOriginalCurtainDoorDefinition(schema, file("native-curtain-door-1505914-2031.bin"), file("native-curtain-door-symbol-2464665.bin")), /identities differ/); const { step, foot, head } = original(cases[0]!); assert.throws(() => inspectOriginalCurrentCurtainDoorProfileCrossing({} as never, {} as never, 1505914, step.fullWalkingStripFeet, foot, head), /Untrusted/); });
