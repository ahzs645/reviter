// Exact arithmetic. Original IEEE values are represented
// as dyadic rationals; generated intersections are never rounded internally.
const ieee = new DataView(new ArrayBuffer(8));
const gcd = (a,b) => { a=a<0n?-a:a; b=b<0n?-b:b; while(b){const r=a%b;a=b;b=r;}return a; };
const nearestInteger=(n,d)=>{const q=n/d,r=n%d,t=r*2n;return q+(t>d||t===d&&(q&1n)?1n:0n);};
export function rationalNearestIEEE(n,d){
  if(!n)return 0;const sign=n<0n?-1:1;n=n<0n?-n:n;
  let e=n.toString(2).length-d.toString(2).length;
  if(e>=0?n<(d<<BigInt(e)):(n<<BigInt(-e))<d)e--;
  if(e>1023)throw Error('Exact generated coordinate is outside finite IEEE range');
  if(e< -1022)return sign*Number(nearestInteger(n<<1074n,d))*2**-1074;
  const p=52-e,m=p>=0?nearestInteger(n<<BigInt(p),d):nearestInteger(n,d<<BigInt(-p));
  const result=sign*Number(m)*2**(e-52);
  if(!Number.isFinite(result))throw Error('Exact generated coordinate overflows IEEE');
  return result;
}
export class Rational {
  constructor(n,d=1n,original){if(!d)throw Error('Zero rational denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);this.n=n/g;this.d=d/g;this.original=original;}
  valueOf(){throw Error('Exact native rational coordinates require an explicit scalar conversion.');}
  toJSON(){throw Error('Exact native topology must be encoded by its rational carrier, never implicit IEEE serialization.');}
}
const originals=new Map();
export function rational(x){if(x instanceof Rational)return x;if(!Number.isFinite(x))throw Error('Nonfinite rational input');let q=originals.get(x);if(q)return q;ieee.setFloat64(0,x,false);const w=ieee.getBigUint64(0,false),e=Number((w>>52n)&2047n),f=w&((1n<<52n)-1n);let n=(e?(1n<<52n)|f:f)*(w>>63n?-1n:1n),p=e?e-1075:-1074;q=p>=0?new Rational(n<<BigInt(p),1n,x):new Rational(n,1n<<BigInt(-p),x);if(originals.size>=65536)originals.delete(originals.keys().next().value);originals.set(x,q);return q;}
const isR = x => x instanceof Rational;
export const add=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return new Rational(a.n*b.d+b.n*a.d,a.d*b.d);})():a+b;
export const sub=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return new Rational(a.n*b.d-b.n*a.d,a.d*b.d);})():a-b;
export const mul=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return new Rational(a.n*b.n,a.d*b.d);})():a*b;
export const div=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return new Rational(a.n*b.d,a.d*b.n);})():a/b;
export function compare(a,b){if(isR(a)||isR(b)){if(typeof a==='number'&&!Number.isFinite(a))return a===Infinity?1:-1;if(typeof b==='number'&&!Number.isFinite(b))return b===Infinity?-1:1;a=rational(a);b=rational(b);const z=a.n*b.d-b.n*a.d;return z<0n?-1:z>0n?1:0;}return a<b?-1:a>b?1:0;}
export const lt=(a,b)=>compare(a,b)<0,le=(a,b)=>compare(a,b)<=0,gt=(a,b)=>compare(a,b)>0,ge=(a,b)=>compare(a,b)>=0;
export const eq=(a,b)=>isR(a)||isR(b)?(isR(a)||typeof a==='number')&&(isR(b)||typeof b==='number')&&compare(a,b)===0:a===b;
export const ne=(a,b)=>!eq(a,b);
export function orient2d(ax,ay,bx,by,cx,cy){
  if(![ax,ay,bx,by,cx,cy].some(isR)){const d=sub(mul(sub(bx,ax),sub(cy,ay)),mul(sub(by,ay),sub(cx,ax)));return -compare(d,0);}
  ax=rational(ax);ay=rational(ay);bx=rational(bx);by=rational(by);cx=rational(cx);cy=rational(cy);
  const dxn=bx.n*ax.d-ax.n*bx.d,dxd=bx.d*ax.d;
  const dyn=by.n*ay.d-ay.n*by.d,dyd=by.d*ay.d;
  const pxn=cx.n*ax.d-ax.n*cx.d,pxd=cx.d*ax.d;
  const pyn=cy.n*ay.d-ay.n*cy.d,pyd=cy.d*ay.d;
  const det=dxn*pyn*dyd*pxd-dyn*pxn*dxd*pyd;
  return det<0n?1:det>0n?-1:-0;
}
export function exactTurnComparator(shared,base){const cache=new Map(),v={x:sub(base.x,shared.x),y:sub(base.y,shared.y)};const entry=e=>{let q=cache.get(e);if(q)return q;const p=e.otherSE.point,w={x:sub(p.x,shared.x),y:sub(p.y,shared.y)};q={x:add(mul(w.x,v.x),mul(w.y,v.y)),y:sub(mul(w.x,v.y),mul(w.y,v.x))};cache.set(e,q);return q;};return (a,b)=>{a=entry(a);b=entry(b);const ha=lt(a.y,0)?1:0,hb=lt(b.y,0)?1:0;if(ha!==hb)return ha-hb;const z=sub(mul(a.x,b.y),mul(a.y,b.x)),s=compare(z,0);if(s)return-s;return compare(b.x,a.x);};}
export function rationalCoordinates(geometry){return geometry.map(p=>p.map(r=>r.map(q=>q.map(v=>{v=rational(v);return {numerator:String(v.n),denominator:String(v.d),original:v.original??null};}))));}

export const rationalScalarToIEEE=q=>q instanceof Rational?(q.original!==undefined?q.original:rationalNearestIEEE(q.n,q.d)):q;
export function clearOriginalRationalCoordinateCache(){originals.clear();}
