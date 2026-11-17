// Exact arithmetic. Original IEEE values are represented
// as dyadic rationals; generated intersections are never rounded internally.
const ieee = new DataView(new ArrayBuffer(8));

// Exact integer gcd. All three give the same value, so the path taken can never
// change a result: only reduction to lowest terms depends on it.
const TWO53=1n<<53n;
const smallGcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
// Lehmer (Knuth 4.5.2 algorithm L): run Euclid on the leading 50 bits in doubles,
// apply the cofactors once to the full BigInts, and finish below 2^53 in doubles.
// floor(log2(x)) for a finite x >= 1, read exactly from its IEEE exponent bits.
const exponentView=new DataView(new ArrayBuffer(8));
const binaryExponent=x=>{exponentView.setFloat64(0,x);return ((exponentView.getUint32(0)>>>20)&2047)-1023;};
export function lehmerGcd(a,b){
  a=a<0n?-a:a;b=b<0n?-b:b;if(a<b){const t=a;a=b;b=t;}
  while(b>=TWO53){
    const leading=Number(a);
    if(!Number.isFinite(leading)){const r=a%b;a=b;b=r;continue;}
    const shift=BigInt(Math.max(0,binaryExponent(leading)-49));
    let x=Number(a>>shift),y=Number(b>>shift),A=1,B=0,C=0,D=1;
    for(;;){
      if(y+C===0||y+D===0)break;
      const q=Math.floor((x+A)/(y+C));
      if(q!==Math.floor((x+B)/(y+D)))break;
      const T=A-q*C,W=B-q*D,V=x-q*y;
      if(Math.abs(T)>=33554432||Math.abs(W)>=33554432)break;
      A=C;C=T;B=D;D=W;x=y;y=V;
    }
    if(B===0){const r=a%b;a=b;b=r;continue;}
    const nextA=BigInt(A)*a+BigInt(B)*b,nextB=BigInt(C)*a+BigInt(D)*b;a=nextA;b=nextB;
  }
  if(!b)return a;
  const r=a%b;
  return r?BigInt(smallGcd(Number(b),Number(r))):b;
}
// Rust source and build: Reviter lib/reviter/vendor/native-rational-gcd.
// SHA-256 of the module below: e704c335c8d6d9684987b834bd22f5b6dfc8f4bf74eaaa74521a8ae4b664a764
const GCD_WASM='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';
export const NATIVE_RATIONAL_GCD_WASM_SHA256='e704c335c8d6d9684987b834bd22f5b6dfc8f4bf74eaaa74521a8ae4b664a764';
let wasmGcdState;
function wasmGcdInstance(){
  if(wasmGcdState!==undefined)return wasmGcdState;
  try{
    const bytes=Uint8Array.from(atob(GCD_WASM),c=>c.charCodeAt(0));
    const wasm=new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports,capacity=wasm.cap();
    wasmGcdState={wasm,capacity:capacity-2,left:new BigUint64Array(wasm.memory.buffer,wasm.a_ptr(),capacity),right:new BigUint64Array(wasm.memory.buffer,wasm.b_ptr(),capacity)};
  }catch{wasmGcdState=null;} // A policy that forbids WebAssembly only loses speed.
  return wasmGcdState;
}
const limbs=(x,into,capacity)=>{let i=0;while(x>0n){if(i>=capacity)return -1;into[i++]=x;x>>=64n;}return i;};
export function wasmGcd(a,b){
  a=a<0n?-a:a;b=b<0n?-b:b;
  if(!a)return b;if(!b)return a;
  if(a<TWO53&&b<TWO53)return BigInt(smallGcd(Number(a),Number(b)));
  const state=wasmGcdInstance();
  if(!state)return lehmerGcd(a,b);
  const m=limbs(a,state.left,state.capacity),n=limbs(b,state.right,state.capacity);
  if(m<0||n<0)return lehmerGcd(a,b);
  const count=state.wasm.gcd(m,n);let r=0n;
  for(let i=count-1;i>=0;i--)r=(r<<64n)|state.left[i];
  return r;
}
const gcd=wasmGcd;
const isPowerOfTwo=d=>(d&(d-1n))===0n;
const lowestBit=x=>x&-x;
// gcd(n,d) for a denominator d>0, without division loops when d is 1 or 2^k.
const gcdWithDenominator=(n,d)=>{if(d===1n)return 1n;if(isPowerOfTwo(d)){const bit=lowestBit(n<0n?-n:n);return bit<d?bit:d;}return gcd(n,d);};
const gcdOfDenominators=(a,b)=>{if(a===b)return a;if(a===1n||b===1n)return 1n;if(isPowerOfTwo(a)&&isPowerOfTwo(b))return a<b?a:b;return gcd(a,b);};
// Floating-point filters. U=2^-53. BigInt-to-Number conversion rounds to nearest,
// so n/d is known to relative error 3U; APPROX allows 6U so a non-conforming
// conversion within 1 ulp stays sound. A result is taken from the filter only
// when it clears the bound, and exact arithmetic decides everything else.
const U=2**-53,APPROX=6*U,COMPARE_BOUND=13*U,SMALLEST_APPROX=1e-280,PRODUCT_UNDERFLOW=1e-300;
const REDUCED=Symbol('reduced');
let approximate,unedited;
// The IEEE value a rational was made from, only while its value is unchanged.
const exactOriginal=q=>q.original!==undefined&&unedited(q)?q.original:undefined;
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
  // Private, so a cached approximation never reaches serialized or hashed data.
  #approximation;
  // The value at construction. Callers may edit n and d in place; the stored
  // original and the cached approximation are then no longer trusted.
  #n;#d;
  constructor(n,d=1n,original,reduced){
    if(reduced===REDUCED){this.n=n;this.d=d;this.original=original;}
    else{
      if(!d)throw Error('Zero rational denominator');
      if(d<0n){n=-n;d=-d;}
      if(d===1n){this.n=n;this.d=d;this.original=original;}
      else if(n===0n){this.n=0n;this.d=1n;this.original=original;}
      else{const g=gcdWithDenominator(n,d);this.n=n/g;this.d=d/g;this.original=original;}
    }
    this.#n=this.n;this.#d=this.d;
  }
  static{unedited=q=>#n in q&&q.n===q.#n&&q.d===q.#d;approximate=q=>{
    const original=exactOriginal(q);if(original!==undefined)return original;
    // Frozen copies made through Object.create have no private slot, and an
    // object edited in place no longer matches its snapshot: neither is cached.
    const cacheable=unedited(q);
    let v=cacheable?q.#approximation:undefined;
    if(v===undefined){v=Number(q.n)/Number(q.d);if(!Number.isFinite(v)||(v!==0&&Math.abs(v)<SMALLEST_APPROX))v=NaN;if(cacheable)q.#approximation=v;}
    return v;
  };}
  valueOf(){throw Error('Exact native rational coordinates require an explicit scalar conversion.');}
  toJSON(){throw Error('Exact native topology must be encoded by its rational carrier, never implicit IEEE serialization.');}
}
const originals=new Map();
export function rational(x){if(x instanceof Rational)return x;if(!Number.isFinite(x))throw Error('Nonfinite rational input');let q=originals.get(x);if(q)return q;ieee.setFloat64(0,x,false);const w=ieee.getBigUint64(0,false),e=Number((w>>52n)&2047n),f=w&((1n<<52n)-1n);let n=(e?(1n<<52n)|f:f)*(w>>63n?-1n:1n),p=e?e-1075:-1074;q=p>=0?new Rational(n<<BigInt(p),1n,x):new Rational(n,1n<<BigInt(-p),x);if(originals.size>=65536)originals.delete(originals.keys().next().value);originals.set(x,q);return q;}
const isR = x => x instanceof Rational;
const reduced=(n,d)=>new Rational(n,d,undefined,REDUCED);
// Sum and product of reduced fractions in lowest terms (Knuth 4.5.1, as in GMP's
// mpq): the gcds run on small operands instead of on the full result.
function sumOf(an,ad,bn,bd){
  const g=gcdOfDenominators(ad,bd);
  if(g===1n){const t=an*bd+bn*ad;return t===0n?reduced(0n,1n):reduced(t,ad*bd);}
  const ax=ad/g,bx=bd/g,t=an*bx+bn*ax;
  if(t===0n)return reduced(0n,1n);
  const h=gcdWithDenominator(t,g);
  return h===1n?reduced(t,ax*bd):reduced(t/h,ax*(bd/h));
}
function productOf(an,ad,bn,bd){
  if(an===0n||bn===0n)return reduced(0n,1n);
  const g=gcdWithDenominator(an,bd),h=gcdWithDenominator(bn,ad);
  return reduced((g===1n?an:an/g)*(h===1n?bn:bn/h),(h===1n?ad:ad/h)*(g===1n?bd:bd/g));
}
export const add=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return sumOf(a.n,a.d,b.n,b.d);})():a+b;
export const sub=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return sumOf(a.n,a.d,-b.n,b.d);})():a-b;
export const mul=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);return productOf(a.n,a.d,b.n,b.d);})():a*b;
export const div=(a,b)=>isR(a)||isR(b)?(()=>{a=rational(a);b=rational(b);if(!b.n)throw Error('Zero rational denominator');return b.n<0n?productOf(a.n,a.d,-b.d,-b.n):productOf(a.n,a.d,b.d,b.n);})():a/b;
export function compare(a,b){if(isR(a)||isR(b)){if(typeof a==='number'&&!Number.isFinite(a))return a===Infinity?1:-1;if(typeof b==='number'&&!Number.isFinite(b))return b===Infinity?-1:1;a=rational(a);b=rational(b);{const x=exactOriginal(a),y=exactOriginal(b);if(x!==undefined&&y!==undefined)return x<y?-1:x>y?1:0;}if(a.d===b.d)return a.n<b.n?-1:a.n>b.n?1:0;const x=approximate(a),y=approximate(b),gap=x-y,bound=COMPARE_BOUND*(Math.abs(x)+Math.abs(y));if(gap>bound)return 1;if(-gap>bound)return -1;const z=a.n*b.d-b.n*a.d;return z<0n?-1:z>0n?1:0;}return a<b?-1:a>b?1:0;}
const inputError=q=>exactOriginal(q)!==undefined?0:APPROX;
// Sign of the same determinant as orient2d, or null when doubles cannot prove it.
// p,q,r,s carry the input error plus one subtraction; each product and the final
// subtraction add U. The 1.01 absorbs second-order terms and the bound's own rounding.
function filteredOrient(ax,ay,bx,by,cx,cy){
  const a=approximate(ax),b=approximate(ay),c=approximate(bx),d=approximate(by),e=approximate(cx),f=approximate(cy);
  const p=c-a,q=f-b,r=d-b,s=e-a;
  const ep=inputError(bx)*Math.abs(c)+inputError(ax)*Math.abs(a)+U*Math.abs(p);
  const eq=inputError(cy)*Math.abs(f)+inputError(ay)*Math.abs(b)+U*Math.abs(q);
  const er=inputError(by)*Math.abs(d)+inputError(ay)*Math.abs(b)+U*Math.abs(r);
  const es=inputError(cx)*Math.abs(e)+inputError(ax)*Math.abs(a)+U*Math.abs(s);
  const left=p*q,right=r*s,det=left-right;
  const bound=1.01*(Math.abs(p)*eq+Math.abs(q)*ep+ep*eq+Math.abs(r)*es+Math.abs(s)*er+er*es+2*U*(Math.abs(left)+Math.abs(right))+U*Math.abs(det))+PRODUCT_UNDERFLOW;
  if(det>bound)return -1;
  if(-det>bound)return 1;
  return null;
}
export const lt=(a,b)=>compare(a,b)<0,le=(a,b)=>compare(a,b)<=0,gt=(a,b)=>compare(a,b)>0,ge=(a,b)=>compare(a,b)>=0;
export const eq=(a,b)=>isR(a)||isR(b)?(isR(a)||typeof a==='number')&&(isR(b)||typeof b==='number')&&compare(a,b)===0:a===b;
export const ne=(a,b)=>!eq(a,b);
export function orient2d(ax,ay,bx,by,cx,cy){
  if(![ax,ay,bx,by,cx,cy].some(isR)){const d=sub(mul(sub(bx,ax),sub(cy,ay)),mul(sub(by,ay),sub(cx,ax)));return -compare(d,0);}
  ax=rational(ax);ay=rational(ay);bx=rational(bx);by=rational(by);cx=rational(cx);cy=rational(cy);
  const filtered=filteredOrient(ax,ay,bx,by,cx,cy);
  if(filtered!==null)return filtered;
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
