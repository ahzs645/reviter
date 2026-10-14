import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Feature = { id: string; disposition: string; behavior: string; limitations: string; nextAction: string; upstreamSources: string[] };
type Module = { path: string; sha256: string; featureIds: string[]; sourceUrl: string };
const inventory = JSON.parse(readFileSync(new URL("../docs/rvt-upstream-capability-inventory.json", import.meta.url), "utf8")) as {
  upstream: { commit: string; sourceModules: number };
  features: Feature[];
  sourceModules: Module[];
  commandLineTools: Array<{ path: string; feature: string; interpretation: string }>;
  uncoveredSourceModules: string[];
  nativeFuzzTargets: Array<{ path: string; interpretation: string }>;
};

test("the pinned module and CLI inventory has no orphan, duplicate or unwitnessed source paths", () => {
  assert.equal(inventory.upstream.commit, "1c3d337dbd2a6810e9dfad68fe99857843d67387");
  assert.equal(inventory.upstream.sourceModules, 158);
  assert.equal(inventory.sourceModules.length, 158);
  assert.equal(inventory.commandLineTools.length, 19);
  assert.deepEqual(inventory.uncoveredSourceModules, []);
  const features = new Set(inventory.features.map(feature => feature.id));
  assert.equal(features.size, inventory.features.length);
  const sources = new Set<string>();
  for (const entry of inventory.sourceModules) {
    assert.equal(sources.has(entry.path), false, entry.path);
    sources.add(entry.path);
    assert.match(entry.path, /^src\/[A-Za-z0-9_/]+\.rs$/);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.sourceUrl.includes(inventory.upstream.commit));
    assert.ok(entry.featureIds.length > 0 && entry.featureIds.every(id => features.has(id)));
  }
  for (const command of inventory.commandLineTools) {
    assert.ok(sources.has(command.path));
    assert.ok(features.has(command.feature));
    assert.ok(command.interpretation.length > 0);
  }
});

test("concrete source gaps and native fuzz boundaries cannot be presented as complete ports", () => {
  for (const id of ["native-records", "parameter-definitions", "extensible-storage", "ifc-representations"]) {
    assert.equal(inventory.features.find(feature => feature.id === id)?.disposition, "narrower", id);
  }
  assert.equal(inventory.features.find(feature => feature.id === "source-drafting")?.disposition, "gap");
  assert.match(inventory.features.find(feature => feature.id === "native-records")!.limitations, /not all document objects/);
  assert.match(inventory.features.find(feature => feature.id === "extensible-storage")!.limitations, /not full entity evaluation/);
  assert.match(inventory.features.find(feature => feature.id === "ifc-representations")!.limitations, /remain missing/);
  assert.equal(inventory.features.find(feature => feature.id === "viewer-share")?.disposition, "narrower");
  for (const feature of inventory.features) {
    assert.ok(feature.upstreamSources.length > 0);
    assert.ok(feature.behavior.length > 0 && feature.limitations.length > 0 && feature.nextAction.length > 0);
  }
  assert.equal(inventory.nativeFuzzTargets.length, 11);
  assert.ok(inventory.nativeFuzzTargets.every(target => /does not cover this target/.test(target.interpretation)));
});
