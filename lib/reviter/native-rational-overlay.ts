import engine from "./vendor/native-rational-polygon-clipping.mjs";
import { Rational, rational, rationalScalarToIEEE, clearOriginalRationalCoordinateCache } from "./vendor/native-rational-overlay-arithmetic.mjs";
export { Rational, rational, rationalScalarToIEEE as nativeRationalScalarToIEEE, clearOriginalRationalCoordinateCache };
export const NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION = "native-rational-overlay-v1:6c73f58c8cb5571076db8c36f28091a52aef372af12d772c99ba109157983c2c";
export type NativeRationalPoint = [Rational, Rational];
export type NativeRationalParts = NativeRationalPoint[][][];
export type NativeRationalOverlayInput = ([number|Rational,number|Rational])[][][];
/** Never return floating intersection vertices to subsequent source booleans.
 * Numeric render geometry requires a separately checked representation. */
export function nativeRationalOverlay(operation:"union"|"difference"|"intersection"|"xor", subject:NativeRationalOverlayInput, ...operands:NativeRationalOverlayInput[]):NativeRationalParts {
 const output=engine[operation](subject,...operands);
 return output.map(part=>part.map(ring=>ring.map(point=>[rational(point[0]),rational(point[1])])));
}
