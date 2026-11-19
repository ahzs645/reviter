import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import * as fast from '../lib/reviter/vendor/native-rational-overlay-arithmetic.mjs';
import * as reference from './native-rational-reference.fixture.mjs';

// Differential check: the module must agree with the original Euclid-only
// arithmetic on every value, including signs, zero and -0 from orient2d.
let seed=9;
const next=()=>(seed=(seed*16807)%2147483647);
const real=()=>next()/2147483647;
const big=(bits:number)=>{let v=0n;for(let i=0;i<bits;i+=31)v=(v<<31n)|BigInt(next());return v;};
const signed=(x:bigint)=>next()%2?x:-x;
const euclid=(a:bigint,b:bigint)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){const r=a%b;a=b;b=r;}return a;};
type Pair = [fast.Rational, reference.Rational];
function pair():Pair{
 const kind=next()%7;
 if(kind<2){const x=(real()-.5)*1800;return [fast.rational(x),reference.rational(x)];}
 if(kind===2){const x=Math.round(real()*64)/8-4;return [fast.rational(x),reference.rational(x)];}
 if(kind===3){const n=signed(big(1+next()%400)),d=big(1+next()%400)+1n;return [new fast.Rational(n,d),new reference.Rational(n,d)];}
 if(kind===4){const n=signed(big(1+next()%200)),s=BigInt(next()%200);return [new fast.Rational(n,1n<<s),new reference.Rational(n,1n<<s)];}
 if(kind===5)return [new fast.Rational(0n,7n),new reference.Rational(0n,7n)];
 const n=BigInt(next()%9)-4n;return [new fast.Rational(n,3n),new reference.Rational(n,3n)];
}
function same(a: number | fast.Rational, b: number | reference.Rational, what: string) {
 assert.ok(typeof a !== 'number' && typeof b !== 'number', what);
 assert.equal(a.n,b.n,what);
 assert.equal(a.d,b.d,what);
 assert.ok(a.d>0n,what);
}

test('both gcd paths equal Euclid',()=>{
 const edges:[bigint,bigint][]=[[0n,5n],[5n,0n],[0n,0n],[-12n,18n],[1n<<2000n,(1n<<1999n)+1n],[1n<<64n,1n<<64n],[(1n<<64n)-1n,1n<<64n],[3n<<128n,9n<<70n],[1n<<53n,(1n<<53n)-1n],[1n<<20000n,3n]];
 for(const [a,b] of edges){const x=euclid(a,b);assert.equal(fast.lehmerGcd(a,b),x);assert.equal(fast.wasmGcd(a,b),x);}
 for(let i=0;i<20000;i++){const g=big(1+i%300)+1n,a=signed(big(1+i%1600)*g),b=signed(big(1+(i*7)%1600)*g),x=euclid(a,b);assert.equal(fast.lehmerGcd(a,b),x);assert.equal(fast.wasmGcd(a,b),x);}
});

test('reduced fractions and comparisons equal the reference',()=>{
 for(let i=0;i<60000;i++){
  const [a,c]=pair(),[b,d]=pair();
  for(const op of ['add','sub','mul'] as const)same(fast[op](a,b),reference[op](c,d),op);
  assert.equal(b.n,d.n,'divisor numerator');
  if(b.n!==0n)same(fast.div(a,b),reference.div(c,d),'div');
  assert.equal(fast.compare(a,b),reference.compare(c,d));
  assert.equal(fast.compare(a,a),0);
 }
 assert.throws(()=>fast.div(fast.rational(1),new fast.Rational(0n,1n)),/Zero rational denominator/);
});

const coordinate = (value: number): Pair => [fast.rational(value),reference.rational(value)];
function checkOrientation(ax: Pair, ay: Pair, bx: Pair, by: Pair, cx: Pair, cy: Pair) {
 const actual = fast.orient2d(ax[0],ay[0],bx[0],by[0],cx[0],cy[0]);
 const expected = reference.orient2d(ax[1],ay[1],bx[1],by[1],cx[1],cy[1]);
 assert.ok(Object.is(actual,expected));
}

test('orient2d equals the reference, including collinear walls on a rotated grid',()=>{
 const t=58*Math.PI/180;
 for(let i=0;i<60000;i++){
  checkOrientation(pair(),pair(),pair(),pair(),pair(),pair());
  const x=(real()-.5)*1800,y=(real()-.5)*1800,s=real()*300;
  const ax=coordinate(x),ay=coordinate(y),cx=coordinate(x+s*Math.cos(t)),cy=coordinate(y+s*Math.sin(t));
  checkOrientation(ax,ay,coordinate(x+200*Math.cos(t)),coordinate(y+200*Math.sin(t)),cx,cy);
  checkOrientation(ax,ay,ax,ay,cx,cy);
 }
});

test('filters stay sound for tiny, huge and unrepresentable values',()=>{
 const tiny=new fast.Rational(1n,1n<<1060n),tiny2=new fast.Rational(3n,1n<<1061n),huge=new fast.Rational(1n<<1100n,3n),huge2=new fast.Rational((1n<<1100n)+1n,3n);
 const t=new reference.Rational(1n,1n<<1060n),t2=new reference.Rational(3n,1n<<1061n),h=new reference.Rational(1n<<1100n,3n),h2=new reference.Rational((1n<<1100n)+1n,3n);
 assert.equal(fast.compare(tiny,tiny2),reference.compare(t,t2));
 assert.equal(fast.compare(huge,huge2),reference.compare(h,h2));
 assert.equal(fast.compare(tiny,huge),reference.compare(t,h));
 assert.ok(Object.is(fast.orient2d(tiny,tiny2,huge,huge2,tiny2,tiny),reference.orient2d(t,t2,h,h2,t2,t)));
});

test('a cached approximation never reaches keys, clones or the wire form',()=>{
 const a=new fast.Rational(5n,3n);
 fast.compare(a,new fast.Rational(7n,11n));
 assert.deepEqual(Object.keys(a),['n','d','original']);
 assert.deepEqual(structuredClone(a),{n:5n,d:3n,original:undefined});
 assert.throws(()=>JSON.stringify(a));
});

test('frozen prototype copies of a Rational, as immutable caches make, still compare and orient',()=>{
 const copy=(q: fast.Rational): fast.Rational=>Object.freeze(Object.assign(Object.create(fast.Rational.prototype),{n:q.n,d:q.d,original:q.original}));
 const [a,c]=[new fast.Rational(5n,3n),new reference.Rational(5n,3n)],[b,d]=[new fast.Rational(7n,11n),new reference.Rational(7n,11n)];
 assert.equal(fast.compare(copy(a),copy(b)),reference.compare(c,d));
 assert.ok(Object.is(fast.orient2d(copy(a),copy(b),copy(b),copy(a),a,copy(b)),reference.orient2d(c,d,d,c,c,d)));
 same(fast.add(copy(a),copy(b)),reference.add(c,d),'add');
});

test('the embedded module matches its recorded digest and Rust source is present',()=>{
 const text=readFileSync(new URL('../lib/reviter/vendor/native-rational-overlay-arithmetic.mjs',import.meta.url),'utf8');
 const b64=/const GCD_WASM='([^']+)'/.exec(text)![1]!;
 assert.equal(createHash('sha256').update(Buffer.from(b64,'base64')).digest('hex'),fast.NATIVE_RATIONAL_GCD_WASM_SHA256);
 assert.ok(readFileSync(new URL('../lib/reviter/vendor/native-rational-gcd/src/lib.rs',import.meta.url),'utf8').includes('Binary GCD'));
});
