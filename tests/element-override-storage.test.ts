import assert from "node:assert/strict";
import test from "node:test";
import { elementOverrideStorageKey, loadElementOverrides, saveElementOverrides } from "../app/studio/element-override-storage.ts";
import { emptyElementOverrideState, setElementOverride } from "../lib/reviter/element-overrides.ts";

const model = { fileName: "building.rvt", byteLength: 4096, sourceSha256: "a".repeat(64) };

test("assertions follow identical source bytes and never a matching filename/size alone", () => {
  assert.equal(elementOverrideStorageKey(model), elementOverrideStorageKey({ ...model, fileName: "renamed.rvt" }));
  assert.notEqual(elementOverrideStorageKey(model), elementOverrideStorageKey({ ...model, sourceSha256: "b".repeat(64) }));
  assert.equal(elementOverrideStorageKey({ ...model, sourceSha256: undefined }), null);
  assert.equal(elementOverrideStorageKey({ ...model, sourceSha256: "bad" }), null);
});

test("storage restores validated assertions only for the bound source", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } } });
  try {
    const state = setElementOverride(emptyElementOverrideState(), 10, { note: "Checked" }, "reviewer");
    saveElementOverrides(model, state.overrides);
    assert.deepEqual(loadElementOverrides(model), state.overrides);
    assert.deepEqual(loadElementOverrides({ ...model, sourceSha256: "b".repeat(64) }), []);
    assert.deepEqual(loadElementOverrides({ ...model, sourceSha256: undefined }), []);
    values.set(elementOverrideStorageKey(model)!, JSON.stringify([
      state.overrides[0], { ...state.overrides[0], elementId: 20, updatedAt: "invalid" },
    ]));
    assert.deepEqual(loadElementOverrides(model), state.overrides);
    values.set("reviter.element-overrides.v1:building.rvt:4096", JSON.stringify(state.overrides));
    assert.deepEqual(loadElementOverrides({ ...model, sourceSha256: undefined }), []);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
