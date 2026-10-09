export class Rational { readonly n: bigint; readonly d: bigint; readonly original?: number; constructor(n:bigint,d?:bigint,original?:number); valueOf():never; toJSON():never; }
export function rational(value:number|Rational):Rational;
export function rationalScalarToIEEE(value:number|Rational):number;
export function clearOriginalRationalCoordinateCache():void;
export function compare(a:number|Rational,b:number|Rational):number;
export function add(a:number|Rational,b:number|Rational):number|Rational;
export function sub(a:number|Rational,b:number|Rational):number|Rational;
export function mul(a:number|Rational,b:number|Rational):number|Rational;
export function div(a:number|Rational,b:number|Rational):number|Rational;

export function orient2d(ax:number|Rational,ay:number|Rational,bx:number|Rational,by:number|Rational,cx:number|Rational,cy:number|Rational):number;
