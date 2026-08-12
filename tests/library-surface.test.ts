/**
 * The public barrel has to be loadable by the runtime the tests use.
 *
 * `lib/reviter/index.ts` re-exports the library's whole surface, but every one
 * of its ninety specifiers was extensionless while the modules underneath used
 * `.ts`. A bundler resolves that; `node --experimental-strip-types` does not,
 * so the declared entry point was the one module the suite could never import.
 * Nothing noticed, because every other test reaches past it into the module it
 * wanted. This asserts the surface loads and that the entry point named in the
 * README is on it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import * as reviter from "../lib/reviter/index.ts";

test("the public barrel loads under the test runtime", () => {
  assert.equal(typeof reviter, "object");
  assert.ok(Object.keys(reviter).length > 0, "the barrel exported nothing");
});

test("the entry point the README documents is exported and callable", () => {
  // README's "Library surface" section opens with this import.
  assert.equal(typeof reviter.convertRvtBytes, "function");
  for (const name of ["makeDxf", "makeIfcCenterlines", "makeObj", "makePlanSvg", "makeReport"]) {
    assert.equal(typeof reviter[name as keyof typeof reviter], "function", `${name} is not exported`);
  }
});

test("every exported value is defined", () => {
  // A re-export naming a symbol its module does not have resolves to undefined
  // rather than throwing, so the barrel can rot silently as modules move.
  const missing = Object.entries(reviter)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  assert.deepEqual(missing, [], `barrel exports resolving to undefined: ${missing.join(", ")}`);
});
