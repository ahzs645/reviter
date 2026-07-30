import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAutodeskReference,
} from "../app/studio/autodesk-reference-file.ts";

test("the Autodesk derivative follows conventional duplicate-download suffixes", () => {
  assert.equal(
    hasAutodeskReference("UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt"),
    true,
  );
  assert.equal(
    hasAutodeskReference("UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"),
    true,
  );
  assert.equal(
    hasAutodeskReference("unbc model - 2026-06-30 - final (fixed library) (12).RVT"),
    true,
  );
});

test("a similarly named or non-RVT file cannot borrow the derivative", () => {
  assert.equal(
    hasAutodeskReference("UNBC Model - 2026-06-30 - FINAL (Fixed Library) revised.rvt"),
    false,
  );
  assert.equal(
    hasAutodeskReference("UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc"),
    false,
  );
});
