/** Cross-platform determinism of compiled indoor geometry.
 *
 * Math.sin/cos/atan2/hypot/... are implementation-approximated in ECMAScript
 * and differ in the last ulp between platform builds (the 2026-10 Linux
 * recompile moved 28 curved walls by a few ulps relative to the macOS arm64
 * compile, which was enough to merge two rooms in the exact area derivation).
 * The compiler therefore routes every such call through deterministic-math.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as DMath from "../lib/reviter/deterministic-math.ts";
import { nativeWallArcPolygon } from "../lib/reviter/architectural-plan.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bits = new DataView(new ArrayBuffer(8));
const ordered = (x: number) => {
  bits.setFloat64(0, x);
  const v = bits.getBigInt64(0);
  return v < 0n ? -(v & 0x7fffffffffffffffn) : v;
};
const ulps = (a: number, b: number) => {
  const d = ordered(a) - ordered(b);
  return Number(d < 0n ? -d : d);
};
const random = (seed: number) => () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

test("deterministic sin/cos/atan/atan2 stay within 1 ulp of the platform Math", () => {
  const rnd = random(987654321);
  let worst = 0;
  for (let i = 0; i < 200000; i++) {
    const x = (rnd() - 0.5) * 8 * Math.PI;
    worst = Math.max(worst, ulps(DMath.sin(x), Math.sin(x)), ulps(DMath.cos(x), Math.cos(x)));
    const y = (rnd() - 0.5) * 2 * 10 ** (rnd() * 6 - 3),
      z = (rnd() - 0.5) * 2 * 10 ** (rnd() * 6 - 3);
    worst = Math.max(worst, ulps(DMath.atan2(y, z), Math.atan2(y, z)), ulps(DMath.atan(y / z), Math.atan(y / z)));
  }
  for (const x of [0, -0, Math.PI / 4, Math.PI / 2, Math.PI, 1.5 * Math.PI, 2 * Math.PI, 1e5, -12345.678, 1e-300])
    worst = Math.max(worst, ulps(DMath.sin(x), Math.sin(x)), ulps(DMath.cos(x), Math.cos(x)), ulps(DMath.atan(x), Math.atan(x)));
  assert.ok(worst <= 1, `max ulp ${worst}`);
});

test("deterministic acos stays within 4 ulps of Math.acos", () => {
  const rnd = random(424242);
  let worst = 0;
  for (let i = 0; i < 200000; i++) {
    const x = rnd() * 2 - 1;
    worst = Math.max(worst, ulps(DMath.acos(x), Math.acos(x)));
  }
  for (const x of [-1, -0.5, 0, 0.5, 1, 1 - 2 ** -52, -1 + 2 ** -53]) worst = Math.max(worst, ulps(DMath.acos(x), Math.acos(x)));
  assert.ok(worst <= 4, `max ulp ${worst}`);
  assert.ok(Number.isNaN(DMath.acos(1.5)) && Number.isNaN(DMath.acos(Number.NaN)));
});

test("deterministic functions follow ECMAScript special values", () => {
  const same = (a: number, b: number, label: string) => assert.ok(Object.is(a, b), `${label}: ${a} vs ${b}`);
  const specials = [0, -0, 1, -1, Infinity, -Infinity, Number.NaN, 5e-324, -5e-324, 1e308, -1e308];
  for (const y of specials) {
    for (const x of specials) same(DMath.atan2(y, x), Math.atan2(y, x), `atan2(${y}, ${x})`);
    same(DMath.atan(y), Math.atan(y), `atan(${y})`);
    if (!Number.isFinite(y)) {
      same(DMath.sin(y), Math.sin(y), `sin(${y})`);
      same(DMath.cos(y), Math.cos(y), `cos(${y})`);
    }
  }
  assert.throws(() => DMath.sin(1e7), RangeError);
});

test("deterministic hypot reproduces V8's Math.hypot bit for bit", () => {
  const rnd = random(13579);
  for (let i = 0; i < 300000; i++) {
    const values = Array.from({ length: 1 + (i % 4) }, () => (rnd() - 0.5) * 10 ** (rnd() * 8 - 4));
    assert.ok(Object.is(DMath.hypot(...values), Math.hypot(...values)), `hypot(${values})`);
  }
  for (const values of [[], [0], [-0, -0], [3, 4], [Number.NaN, Infinity], [1, Number.NaN], [-Infinity, Number.NaN], [1e308, 1e308], [5e-324, 5e-324]])
    assert.ok(Object.is(DMath.hypot(...values), Math.hypot(...values)), `hypot(${values})`);
});

test("deterministic outputs are pinned: same bits on every platform", () => {
  // Golden digest of exactly specified arithmetic. If this fails on another
  // platform, that platform's compiled geometry would differ as well.
  const rnd = random(20261010);
  const out = new Float64Array(5 * 20000);
  for (let i = 0; i < 20000; i++) {
    const x = (rnd() - 0.5) * 16 * Math.PI,
      y = (rnd() - 0.5) * 2e3,
      z = (rnd() - 0.5) * 2e3;
    out.set([DMath.sin(x), DMath.cos(x), DMath.atan2(y, z), DMath.hypot(y, z), DMath.acos(rnd() * 2 - 1)], 5 * i);
  }
  const digest = createHash("sha256").update(new Uint8Array(out.buffer)).digest("hex");
  assert.equal(digest, GOLDEN_DIGEST);
});
const GOLDEN_DIGEST = "52eebc31627b4103b70fd7217a145381ece9365397b14e298314e756094beb69";

test("curved-wall tessellation keeps its vertex count and stays within 1e-12 ft of platform trig", () => {
  const rnd = random(987654321);
  // The pre-hardening implementation, using platform Math.
  const platform = (arc: Parameters<typeof nativeWallArcPolygon>[0]) => {
    const sweep = arc.endAngle - arc.startAngle;
    const steps = Math.max(16, Math.ceil(Math.abs(sweep * arc.radius) / 0.25));
    const angles = Array.from({ length: steps + 1 }, (_, i) => arc.startAngle + (sweep * i) / steps);
    const lo = Math.min(arc.startAngle, arc.endAngle),
      hi = Math.max(arc.startAngle, arc.endAngle);
    for (const [x, y] of [[arc.xDir.x, arc.yDir.x], [arc.xDir.y, arc.yDir.y]]) {
      if (Math.hypot(x!, y!) < 1e-12) continue;
      const extremum = Math.atan2(y!, x!);
      for (let turn = Math.ceil((lo - extremum) / Math.PI); turn <= Math.floor((hi - extremum) / Math.PI); turn++) {
        const angle = extremum + turn * Math.PI;
        if (angle > lo && angle < hi && !angles.some((existing) => Math.abs(existing - angle) < 1e-12)) angles.push(angle);
      }
    }
    angles.sort((a, b) => (sweep < 0 ? b - a : a - b));
    const side = (radius: number) =>
      angles.map((angle) => [
        arc.centre.x + radius * (Math.cos(angle) * arc.xDir.x + Math.sin(angle) * arc.yDir.x),
        arc.centre.y + radius * (Math.cos(angle) * arc.xDir.y + Math.sin(angle) * arc.yDir.y),
      ]);
    return [...side(arc.radius + arc.thickness / 2), ...side(arc.radius - arc.thickness / 2).reverse()];
  };
  for (let i = 0; i < 2000; i++) {
    const a = rnd() * Math.PI * 2;
    const start = (rnd() - 0.5) * 4 * Math.PI,
      sweep = (rnd() - 0.5) * 2 * Math.PI;
    const arc = {
      centre: { x: (rnd() - 0.5) * 1000, y: (rnd() - 0.5) * 1000, z: 0 },
      radius: 1 + rnd() * 80,
      thickness: 0.2 + rnd(),
      startAngle: start,
      endAngle: start + sweep,
      xDir: { x: Math.cos(a), y: Math.sin(a), z: 0 },
      yDir: { x: -Math.sin(a), y: Math.cos(a), z: 0 },
    } as unknown as Parameters<typeof nativeWallArcPolygon>[0];
    const p = platform(arc),
      q = nativeWallArcPolygon(arc);
    assert.equal(q.length, p.length);
    for (let k = 0; k < p.length; k++)
      assert.ok(Math.abs(p[k]![0]! - q[k]![0]!) <= 1e-12 && Math.abs(p[k]![1]! - q[k]![1]!) <= 1e-12);
  }
});

/** Import closure of the indoor compiler (walls, planes, rooms, circulation),
 * including worker modules started through new URL(...). */
export function compilerModuleGraph(base: string, entries: readonly string[]) {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const follow = (specifier: string) => {
      if (!specifier.startsWith(".")) return;
      const target = resolve(dirname(path), specifier);
      const file = [target, `${target}.ts`, `${target}.tsx`, `${target}.mjs`, `${target}/index.ts`].find(
        (p) => existsSync(p) && statSync(p).isFile(),
      );
      if (file && /\.(?:ts|tsx|mjs|js)$/.test(file) && file.startsWith(base)) visit(file);
    };
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const typeSpecifiersOnly = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(specifier => specifier.isTypeOnly) && !clause.name;
        if (!clause?.isTypeOnly && !typeSpecifiersOnly) follow(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeSpecifiersOnly = node.exportClause && ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 && node.exportClause.elements.every(specifier => specifier.isTypeOnly);
        if (!node.isTypeOnly && !typeSpecifiersOnly) follow(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        follow(node.arguments[0].text);
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" &&
        node.arguments?.[0] && ts.isStringLiteral(node.arguments[0]) && /\.(?:ts|mjs)$/.test(node.arguments[0].text)) {
        follow(node.arguments[0].text);
      }
      // Type-query import expressions are ImportType nodes, not runtime calls.
      // AST traversal also avoids following import-looking comments/strings.
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  for (const entry of entries) visit(resolve(base, entry));
  return [...seen].map((p) => relative(base, p)).sort();
}

test("compiler graph follows runtime imports/reexports/workers while excluding erased type dependencies", () => {
  const directory = mkdtempSync(join(tmpdir(), "reviter-runtime-compiler-graph-"));
  try {
    writeFileSync(join(directory, "entry.ts"), `
      import type { Shape } from './type-import.ts';
      import { type Shape as OtherShape } from './inline-types.ts';
      export type { Shape } from './type-export.ts';
      export type * from './type-star.ts';
      export { type Shape as Alias } from './inline-type-export.ts';
      type Deferred = import('./type-query.ts').Shape;
      import { type Shape as MixedShape, runtime } from './mixed.ts';
      import './side-effect.ts';
      export { runtime as forwarded } from './runtime-export.ts';
      const later = () => import('./dynamic.ts');
      const worker = new URL('./worker.ts', import.meta.url);
      const text = "import('./quoted.ts')";
      // import './commented.ts';
    `);
    for (const name of ["type-import", "inline-types", "type-export", "type-star", "inline-type-export", "type-query", "mixed", "side-effect", "runtime-export", "dynamic", "worker", "quoted", "commented"]) {
      writeFileSync(join(directory, `${name}.ts`), "export type Shape = {}; export const runtime = 1;\n");
    }
    assert.deepEqual(compilerModuleGraph(directory, ["entry.ts"]), [
      "dynamic.ts", "entry.ts", "mixed.ts", "runtime-export.ts", "side-effect.ts", "worker.ts",
    ]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
const APPROXIMATE =
  /(?<![\w$.])Math\.(?:sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|exp|expm1|log|log1p|log2|log10|pow|cbrt)\b/;
/** `2 ** n` is an exact power of two; any other base needs Math.pow semantics. */
const APPROXIMATE_POWER = /(?<![\w$.])(?!2\s*\*\*)[\w$.\])]+\s*\*\*(?!\/)/;
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, "")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("compiler geometry modules use no implementation-approximated Math", () => {
  for (const line of ["x = Math.sin(a);", "Math.hypot(...v)", "q = Math.pow(a, 0.5)", "s = u[0] ** 2"])
    assert.ok(APPROXIMATE.test(code(line)) || APPROXIMATE_POWER.test(code(line)), line);
  for (const line of ["x = DMath.sin(a);", "size = 256 * 2 ** zoom;", "e = 2 ** -52", "// Math.sin(a)", "/** see Math.cos */ y = 1"])
    assert.ok(!APPROXIMATE.test(code(line)) && !APPROXIMATE_POWER.test(code(line)), line);
  const files = compilerModuleGraph(root, [
    "lib/reviter/indoor-pipeline.ts",
    "scripts/indoor/parallel-native-circulation.ts",
    "scripts/indoor/native-landing-approaches.ts",
  ]);
  assert.ok(files.includes("lib/reviter/architectural-plan.ts") && files.includes("scripts/indoor/native-circulation-plane-worker.ts"));
  assert.ok(files.length > 100, `compiler graph has ${files.length} modules`);
  const offenders = files.flatMap((file) =>
    code(readFileSync(resolve(root, file), "utf8"))
      .split("\n")
      .flatMap((line, i) => (APPROXIMATE.test(line) || APPROXIMATE_POWER.test(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
  );
  assert.deepEqual(offenders, []);
});
