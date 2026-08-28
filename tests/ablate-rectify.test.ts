import assert from "node:assert/strict";
import test from "node:test";

import { parseModes } from "../scripts/ablate-rectify.ts";

test("the mode vocabulary is small and refuses anything outside it", () => {
  // A typo that silently became a default is how an ablation stops ablating.
  assert.deepEqual(parseModes("hull")[0]!.options, { contact: false });
  assert.deepEqual(parseModes("contact")[0]!.options, {});
  assert.deepEqual(parseModes("elastic:5")[0]!.options, { bandMetres: 5 });
  assert.deepEqual(parseModes("elastic:12.5")[0]!.options, { bandMetres: 12.5 });
  assert.equal(parseModes("hull,contact,elastic:5").length, 3);
  for (const bad of ["", "elastic", "elastic:", "hulls", "contact:1", "elastic:x"]) {
    assert.throws(() => parseModes(bad), `"${bad}" should be refused`);
  }
});
