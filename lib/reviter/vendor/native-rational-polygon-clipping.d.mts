import type {Rational} from './native-rational-overlay-arithmetic.mjs';
type Parts=(number|Rational)[][][][];
declare const engine:{union(subject:Parts,...operands:Parts[]):Parts;difference(subject:Parts,...operands:Parts[]):Parts;intersection(subject:Parts,...operands:Parts[]):Parts;xor(subject:Parts,...operands:Parts[]):Parts;};
export default engine;
