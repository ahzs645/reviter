import assert from "node:assert/strict";
import { test } from "node:test";
import { modelImportFiles } from "../app/studio/model-import.ts";

test("model and rooms are accepted in either picker order", () => {
  const model = {name:"UNBC model.rvt"}, json = {name:"rooms.directory-edited.json"};
  assert.deepEqual(modelImportFiles([model,json]),{model,json});
  assert.deepEqual(modelImportFiles([json,model]),{model,json});
});
test("model-only and JSON-only selections remain supported", () => {
  const model = {name:"UNBC.RVT"}, json = {name:"rooms.JSON"};
  assert.deepEqual(modelImportFiles([model]),{model,json:null});
  assert.deepEqual(modelImportFiles([json]),{model:null,json});
});
test("extra files are rejected instead of silently choosing the first", () => {
  assert.throws(()=>modelImportFiles([{name:"one.rvt"},{name:"two.rvt"}]),/Select one/);
  assert.throws(()=>modelImportFiles([{name:"one.json"},{name:"two.json"}]),/Select one/);
  assert.throws(()=>modelImportFiles([{name:"model.rvt"},{name:"image.png"}]),/Select one/);
});
