/** Unwired conservative physical envelope recovery. Invalid saved boxes are
 * never absence evidence; complete original body branches and an independent
 * original native placement must agree before deriving any finite box. */
import { collectRevit2027GInstanceBindings } from "./revit-2027-nested-instance.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import { inspectPlacedPlanarObstacleBranches } from "./native-source-placed-planar-obstacles.ts";
import { readInstancePlacement } from "./instanced-geometry.ts";
import { outwardNativeRationalBound } from "./native-planar-component-envelopes.ts";
import { Rational, rational } from "./native-rational-overlay.ts";
import type { Bounds3 } from "./types.ts";
const cmp = (a: Rational, b: Rational) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
export function inspectOriginalUnboundedInstanceEnvelope(
  occurrence: Revit2027GRepReplay,
  definition: Revit2027GRepReplay,
  nativeOccurrence: Uint8Array,
) {
  try {
    const v = new DataView(
        nativeOccurrence.buffer,
        nativeOccurrence.byteOffset,
        nativeOccurrence.byteLength,
      ),
      length = v.getUint32(12, true);
    if (
      nativeOccurrence.length < 40 ||
      v.getUint32(0, true) !== Number(occurrence.ownerElementId) ||
      v.getUint32(4, true) !== 0 ||
      v.getUint16(16, true) !== 2031 ||
      length + 20 !== nativeOccurrence.length ||
      v.getUint32(length + 16, true) !== length
    )
      throw Error("Original FamilyInstance frame identity/length mismatch");
    let a = 1,
      b = 0;
    for (let i = 16; i < nativeOccurrence.length - 4; i++) {
      a = (a + nativeOccurrence[i]!) % 65521;
      b = (b + a) % 65521;
    }
    if ((b * 65536 + a) >>> 0 !== v.getUint32(8, true))
      throw Error("Original FamilyInstance checksum mismatch");
    const bindings = collectRevit2027GInstanceBindings(occurrence),
      placement = readInstancePlacement(nativeOccurrence, {
        offset: 0,
        elementId: Number(occurrence.ownerElementId),
        marker: 2031,
        objectLength: length,
        typeCode: v.getUint32(18, true),
      });
    if (
      !bindings.ok ||
      bindings.value.length !== 1 ||
      bindings.value[0]!.kind !== "external" ||
      !placement
    )
      throw Error("Original physical placement is unsupported");
    const i = bindings.value[0]!.instance,
      t = i.transform,
      basis = [
        t.xAxis[0],
        t.yAxis[0],
        t.zAxis[0],
        t.xAxis[1],
        t.yAxis[1],
        t.zAxis[1],
        t.xAxis[2],
        t.yAxis[2],
        t.zAxis[2],
      ];
    if (
      placement.geometryId !== Number(definition.ownerElementId) ||
      placement.symbolId !== Number(definition.ownerElementId) ||
      JSON.stringify(placement.origin) !== JSON.stringify(t.origin) ||
      JSON.stringify(placement.basis) !== JSON.stringify(basis)
    )
      throw Error(
        "Original FamilyInstance and GInstance affine/definition disagree",
      );
    if (
      [...t.xAxis, ...t.yAxis, ...t.zAxis, ...t.origin].some(
        (v) => !Number.isFinite(v),
      )
    )
      throw Error("Non-finite original affine");
    const add = (a: Rational, b: Rational) =>
        new Rational(a.n * b.d + b.n * a.d, a.d * b.d),
      mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d),
      sub = (a: Rational, b: Rational) =>
        new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
    const [u, axisV, w] = [t.xAxis, t.yAxis, t.zAxis].map((axis) =>
      axis.map(rational),
    );
    const det = add(
      sub(
        mul(u![0]!, sub(mul(axisV![1]!, w![2]!), mul(axisV![2]!, w![1]!))),
        mul(u![1]!, sub(mul(axisV![0]!, w![2]!), mul(axisV![2]!, w![0]!))),
      ),
      mul(u![2]!, sub(mul(axisV![0]!, w![1]!), mul(axisV![1]!, w![0]!))),
    );
    if (det.n === 0n) throw Error("Singular original affine");
    const needsGeneralAffine =
      t.xAxis[2] !== 0 ||
      t.yAxis[2] !== 0 ||
      t.zAxis[0] !== 0 ||
      t.zAxis[1] !== 0 ||
      t.zAxis[2] <= 0;
    // This PURE mathematical identity probe obtains a local-coordinate body
    // enclosure. It never becomes a source record or a certificate. The actual
    // independently checked original affine is then applied to its full prism.
    // This preserves every source component while supporting rotated mullions.
    const localOccurrence = needsGeneralAffine
      ? structuredClone(occurrence)
      : occurrence;
    if (needsGeneralAffine) {
      const info = localOccurrence.spans.find(
        (s) => s.readerId === "Revit2027InstanceInfo",
      );
      if (!info) throw Error("Missing original placement info");
      const value = info.value as { transform: typeof t };
      value.transform = {
        ...value.transform,
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        zAxis: [0, 0, 1],
        origin: [0, 0, 0],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      };
    }
    const body = inspectPlacedPlanarObstacleBranches(
      localOccurrence,
      definition,
    );
    if (!body.ok) return body;
    const xs: Rational[] = [],
      ys: Rational[] = [],
      zs: Rational[] = [];
    for (const c of body.components) {
      for (const p of c.outerPlanEnvelope.flat(2)) {
        if (needsGeneralAffine) {
          for (const z of [c.minimumElevationFeet, c.maximumElevationFeet]) {
            const q = [0, 1, 2].map((axis) =>
              add(
                add(
                  add(
                    rational(t.origin[axis]!),
                    mul(rational(t.xAxis[axis]!), p[0]),
                  ),
                  mul(rational(t.yAxis[axis]!), p[1]),
                ),
                mul(rational(t.zAxis[axis]!), z),
              ),
            );
            xs.push(q[0]!);
            ys.push(q[1]!);
            zs.push(q[2]!);
          }
        } else {
          xs.push(p[0]);
          ys.push(p[1]);
        }
      }
      if (!needsGeneralAffine)
        zs.push(c.minimumElevationFeet, c.maximumElevationFeet);
    }
    if (!xs.length || !ys.length || !zs.length)
      throw Error("No complete positive original physical component");
    const lo = (xs: Rational[]) =>
        xs.reduce((a, b) => (cmp(a, b) <= 0 ? a : b)),
      hi = (xs: Rational[]) => xs.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
    const boundsFeet: Bounds3 = {
      min: {
        x: outwardNativeRationalBound(lo(xs), -1),
        y: outwardNativeRationalBound(lo(ys), -1),
        z: outwardNativeRationalBound(lo(zs), -1),
      },
      max: {
        x: outwardNativeRationalBound(hi(xs), 1),
        y: outwardNativeRationalBound(hi(ys), 1),
        z: outwardNativeRationalBound(hi(zs), 1),
      },
    };
    if (
      Object.values(boundsFeet)
        .flatMap((p) => Object.values(p))
        .some((x) => !Number.isFinite(x))
    )
      throw Error("Derived original physical bounds are not finite");
    return {
      ok: true as const,
      boundsFeet,
      componentCount: body.components.length,
      appliedCompleteOriginalThreeDimensionalAffine: needsGeneralAffine,
      physicalFaceTokens: body.components.flatMap((c) => c.physicalFaceTokens),
      originalFreeGraphicsTokens: body.originalFreeGraphicsTokens,
      originalHatchTokens: body.originalHatchTokens,
      sourceFalseFilters: body.sourceFalseFilters,
      originalSourceAuthorityGranted: false as const,
      walkingSupportApproved: false as const,
      routeApproved: false as const,
    };
  } catch (e) {
    return {
      ok: false as const,
      blockers: [e instanceof Error ? e.message : String(e)],
      originalSourceAuthorityGranted: false as const,
      routeApproved: false as const,
    };
  }
}
