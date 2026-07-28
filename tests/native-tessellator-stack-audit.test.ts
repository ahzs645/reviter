import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const defaultSourceRoot =
  "/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated";

test("static native tessellator audit verifies the supplied exact build", async (t) => {
  const sourceRoot = process.env.REVITER_ODA_ROOT ?? defaultSourceRoot;
  try {
    await access(`${sourceRoot}/TB_Geometry.tx`);
  } catch {
    t.skip("set REVITER_ODA_ROOT to run the optional native metadata audit");
    return;
  }

  const result = spawnSync(
    process.execPath,
    ["scripts/audit-native-tessellator-stack.mjs", sourceRoot],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout) as {
    evidenceMode: string;
    summary: {
      targetCount: number;
      allHashesMatchKnownBuild: boolean;
      allRequiredSymbolsObserved: boolean;
      allMainTargetsElfX8664: boolean;
    };
    browserPortability: {
      wasmArtifacts: string[];
      browserBindingMarkers: Record<string, string[]>;
      observedBrowserCallableAbi: boolean;
    };
    handoff: {
      triangleOutput: {
        carrier: string;
        serialized: boolean;
        materialIncludedInCarrier: boolean;
      };
      nativeModelerBody: {
        documentedPortableFormatObserved: boolean;
      };
    };
  };

  assert.equal(report.evidenceMode, "static-only");
  assert.equal(report.summary.targetCount, 9);
  assert.equal(report.summary.allHashesMatchKnownBuild, true);
  assert.equal(report.summary.allRequiredSymbolsObserved, true);
  assert.equal(report.summary.allMainTargetsElfX8664, true);
  assert.deepEqual(report.browserPortability.wasmArtifacts, []);
  assert.deepEqual(report.browserPortability.browserBindingMarkers, {});
  assert.equal(report.browserPortability.observedBrowserCallableAbi, false);
  assert.equal(report.handoff.triangleOutput.carrier, "GeMesh::OdGeTrMesh&");
  assert.equal(report.handoff.triangleOutput.serialized, false);
  assert.equal(report.handoff.triangleOutput.materialIncludedInCarrier, false);
  assert.equal(
    report.handoff.nativeModelerBody.documentedPortableFormatObserved,
    false,
  );
});
