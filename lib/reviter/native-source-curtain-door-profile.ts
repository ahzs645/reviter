/** Exact whole crossing containment in a current native curtain-cell profile.
 * The profile is reference geometry, not an operability or air-space claim.
 * Saved leaf, sill, host members, owners and access remain separate guards. */
import { Rational, rational, type NativeRationalParts } from "./native-rational-overlay.ts";
import { validateOriginalNamedCapReference } from "./native-source-floor-local-support.ts";
import { inspectOriginalCurrentCurtainDoorDefinition } from "./native-source-curtain-door-definition.ts";
import type { OriginalCurtainMaterialContainer } from "./native-source-curtain-material-container.ts";
import type { OriginalNativeForeignEnvelopeCensus } from "./native-source-foreign-envelope-census.ts";
type Q = Rational;
type Definition = ReturnType<typeof inspectOriginalCurrentCurtainDoorDefinition>;
const add = (a: Q, b: Q) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d), sub = (a: Q, b: Q) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d), mul = (a: Q, b: Q) => new Rational(a.n * b.n, a.d * b.d), div = (a: Q, b: Q) => new Rational(a.n * b.d, a.d * b.n), cmp = (a: Q, b: Q) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const q = ([n, d]: [
    string,
    string
]) => new Rational(BigInt(n), BigInt(d));
/** Pure exact geometry only; copied reports cannot confer source authority. */
export function inspectCurtainDoorProfileCrossing(definition: Pick<Definition, "originalProfileCurves" | "originalCellPlaneOperands" | "originalNativePlacementOperands">, walkingFootprintFeet: NativeRationalParts, highestFootPlaneFeet: Q, headPlaneFeet: Q) {
    if (walkingFootprintFeet.length !== 1 || walkingFootprintFeet[0]!.length !== 1 || !(walkingFootprintFeet[0]![0]!.length === 4 || (walkingFootprintFeet[0]![0]!.length === 5 && walkingFootprintFeet[0]![0]![0]!.every((v, i) => cmp(v, walkingFootprintFeet[0]![0]![4]![i]!) === 0))))
        throw Error("Curtain-cell crossing requires one complete finite four-edge footprint");
    validateOriginalNamedCapReference(walkingFootprintFeet);
    if (cmp(headPlaneFeet, highestFootPlaneFeet) <= 0)
        throw Error("Invalid whole crossing vertical demand");
    const curves = definition.originalProfileCurves;
    if (curves.length !== 4)
        throw Error("Unresolved original curtain-cell profile branches");
    const starts = curves.map(c => c.exactEndpointsFeet[0]!.map(q)), ends = curves.map(c => c.exactEndpointsFeet[1]!.map(q));
    for (let i = 0; i < 4; i++)
        if (ends[i]!.some((v, j) => cmp(v, starts[(i + 1) % 4]![j]!) !== 0))
            throw Error("Original curtain-cell profile endpoints do not join exactly");
    const plane = definition.originalCellPlaneOperands as {
        m_origin: number[];
        m_xVec: number[];
        m_yVec: number[];
        m_orientFlag: number;
        m_Envelope: {
            m_corners: number[][];
        };
    }, zero = rational(0), one = rational(1);
    if (!plane || plane.m_origin?.length !== 3 || plane.m_xVec?.length !== 3 || plane.m_yVec?.length !== 3 || ![0, 1].includes(plane.m_orientFlag) || [...plane.m_origin, ...plane.m_xVec, ...plane.m_yVec].some(v => !Number.isFinite(v)))
        throw Error("Unresolved finite original curtain-cell plane");
    // This constructor supports the actual vertical x/z native profile. No
    // tilted plane or tiny nonzero direction term is flattened into that role.
    if (plane.m_xVec.some((v, i) => cmp(rational(v), i === 0 ? one : zero) !== 0) || plane.m_yVec.some((v, i) => cmp(rational(v), i === 2 ? one : zero) !== 0))
        throw Error("Unsupported original curtain-cell plane basis");
    const envelope = plane.m_Envelope?.m_corners;
    if (!Array.isArray(envelope) || envelope.length !== 2 || envelope.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v))) || envelope[0]!.some((v, i) => v >= envelope[1]![i]!))
        throw Error("Unresolved original finite profile plane domain");
    const planeY = rational(plane.m_origin[1]!);
    if (starts.some(p => p.length !== 3 || cmp(p[1]!, planeY) !== 0))
        throw Error("Original curtain-cell profile is not on its named native plane");
    for (const p of starts) {
        const uv = [sub(p[0]!, rational(plane.m_origin[0]!)), sub(p[2]!, rational(plane.m_origin[2]!))];
        if (uv.some((v, i) => cmp(v, rational(envelope[0]![i]!)) < 0 || cmp(v, rational(envelope[1]![i]!)) > 0))
            throw Error("Original profile leaves its finite native plane domain");
    }
    const xs = starts.map(p => p[0]!).sort(cmp), zs = starts.map(p => p[2]!).sort(cmp), left = xs[0]!, right = xs[3]!, bottom = zs[0]!, top = zs[3]!;
    if (cmp(left, right) >= 0 || cmp(bottom, top) >= 0 || new Set(starts.map(p => `${p[0]!.n}/${p[0]!.d}:${p[2]!.n}/${p[2]!.d}`)).size !== 4 || starts.some(p => ![left, right].some(x => cmp(x, p[0]!) === 0) || ![bottom, top].some(z => cmp(z, p[2]!) === 0)))
        throw Error("Original curtain-cell profile is not a complete finite rectangle");
    for (let i = 0; i < 4; i++) {
        const a = starts[i]!, b = ends[i]!;
        if ((cmp(a[0]!, b[0]!) === 0) === (cmp(a[2]!, b[2]!) === 0))
            throw Error("Unsupported original curtain-cell profile edge");
    }
    const trf = definition.originalNativePlacementOperands as {
        m_3x3: number[][];
        m_or: number[];
    };
    if (!trf || trf.m_or?.length !== 3 || trf.m_3x3?.length !== 3 || trf.m_3x3.some(r => r.length !== 3) || [...trf.m_or, ...trf.m_3x3.flat()].some(v => !Number.isFinite(v)))
        throw Error("Malformed original curtain-cell affine");
    const m = trf.m_3x3.map(r => r.map(rational)), o = trf.m_or.map(rational);
    if ([m[0]![2]!, m[1]![2]!, m[2]![0]!, m[2]![1]!].some(v => v.n !== 0n) || cmp(m[2]![2]!, zero) <= 0)
        throw Error("Unsupported original tilted curtain-cell affine");
    const det = sub(mul(m[0]![0]!, m[1]![1]!), mul(m[0]![1]!, m[1]![0]!));
    if (!det.n)
        throw Error("Singular original curtain-cell affine");
    const local = walkingFootprintFeet[0]![0]!.map(([x, y]) => { const dx = sub(x, o[0]!), dy = sub(y, o[1]!); return [div(sub(mul(m[1]![1]!, dx), mul(m[0]![1]!, dy)), det), div(sub(mul(m[0]![0]!, dy), mul(m[1]![0]!, dx)), det)] as [
        Q,
        Q
    ]; });
    const hits: Q[] = [];
    const addHit = (x: Q) => { if (!hits.some(v => cmp(v, x) === 0))
        hits.push(x); };
    for (let i = 0; i < local.length; i++) {
        const a = local[i]!, b = local[(i + 1) % local.length]!, da = sub(a[1], planeY), db = sub(b[1], planeY);
        if (!da.n)
            addHit(a[0]);
        if (cmp(da, zero) * cmp(db, zero) < 0) {
            const t = div(da, sub(da, db));
            addHit(add(a[0], mul(sub(b[0], a[0]), t)));
        }
    }
    if (hits.length !== 2 || !local.some(p => cmp(p[1], planeY) < 0) || !local.some(p => cmp(p[1], planeY) > 0))
        throw Error("Whole footprint does not cross the original finite profile plane");
    hits.sort(cmp);
    const foot = div(sub(highestFootPlaneFeet, o[2]!), m[2]![2]!), head = div(sub(headPlaneFeet, o[2]!), m[2]![2]!);
    if (cmp(hits[0]!, left) <= 0 || cmp(hits[1]!, right) >= 0 || cmp(foot, bottom) < 0 || cmp(head, top) >= 0)
        throw Error("Whole crossing demand leaves or contacts the original finite profile boundary");
    return { wholeCrossingWithinOriginalFiniteProfile: true as const, originalProfileCrossingLocalXFeet: hits, originalLocalFootPlaneFeet: foot, originalLocalHeadPlaneFeet: head, originalProfileRectangleFeet: { left, right, bottom, top }, sourcePlaneAndAllOriginalJoinsRetained: true as const, sourceApertureApproved: false as const, sourceLeafOperationApproved: false as const, sourceMaterialOmitted: false as const, routeApproved: false as const };
}
export function inspectOriginalCurrentCurtainDoorProfileCrossing(census: OriginalNativeForeignEnvelopeCensus, container: OriginalCurtainMaterialContainer, doorId: number, footprint: NativeRationalParts, highestFoot: Q, head: Q) { const current = inspectOriginalCurrentCurtainDoorDefinition(census, container, doorId); return { ...inspectCurtainDoorProfileCrossing(current, footprint, highestFoot, head), nativeDoorElementId: doorId, nativeHostElementId: current.nativeHostElementId, nativeDefinitionElementId: current.nativeDefinitionElementId, sourceModelSha256: current.sourceModelSha256, sourceSchemaSha256: current.sourceSchemaSha256, originalNativeInstanceSha256: current.originalNativeInstanceSha256, originalNativeDefinitionSha256: current.originalNativeDefinitionSha256 }; }
