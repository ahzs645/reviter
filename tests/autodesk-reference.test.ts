import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTODESK_REFERENCE_DOCUMENT_ID,
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

test("the document GUID decides, so a rename cannot turn the derivative off", () => {
  // The derivative is of one document. Its name is metadata a user controls;
  // `BasicFileInfo`'s Unique Document GUID is written by Revit and survives a
  // rename, a copy, and a re-download.
  assert.equal(
    hasAutodeskReference({
      documentId: AUTODESK_REFERENCE_DOCUMENT_ID,
      fileName: "whatever the user called it.rvt",
    }),
    true,
  );
  assert.equal(
    hasAutodeskReference({
      documentId: AUTODESK_REFERENCE_DOCUMENT_ID.toUpperCase(),
      fileName: "model.rvt",
    }),
    true,
  );
});

test("a different document cannot borrow the derivative by taking its name", () => {
  // The failure the name gate allowed: any model saved under the reference's
  // file name was shown this building's geometry instead of its own.
  assert.equal(
    hasAutodeskReference({
      documentId: "00000000-0000-0000-0000-000000000000",
      fileName: "UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt",
    }),
    false,
  );
});

test("the file name is used only when no document identity could be read", () => {
  // A `BasicFileInfo` too old for the GUID leaves the studio with an empty
  // `documentId`. There the name is the only evidence there is.
  assert.equal(
    hasAutodeskReference({
      documentId: "",
      fileName: "UNBC Model - 2026-06-30 - FINAL (Fixed Library).rvt",
    }),
    true,
  );
  assert.equal(hasAutodeskReference({ documentId: "   ", fileName: "other.rvt" }), false);
  assert.equal(hasAutodeskReference({}), false);
});
