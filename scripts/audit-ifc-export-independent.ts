#!/usr/bin/env node

/**
 * Read a real recovered model's IFC export back with a reader that is not
 * `web-ifc`, and check it against the recovery-evidence IDS.
 *
 * `audit-ifc-export-roundtrip.ts` answers a geometric question — does the
 * generated IFC reproduce the scene that entered the exporter, element by
 * element, to a hundredth of a foot. It answers it with `web-ifc`, which is
 * also the reader the studio uses, so a defect both implementations share is
 * invisible to it.
 *
 * This script answers a different question with a different reader. Is the file
 * valid IFC to an implementation that shares no code with the one we depend on,
 * and does every recovered product still carry the evidence that says it is a
 * recovery? The second half matters most: a recovered element that reaches an
 * IFC without `Reviter_Recovery` is indistinguishable from an authored one, and
 * nothing downstream can tell that a bounds envelope is not a measured body.
 *
 * `tests/export-ifc-independent-reader.test.ts` runs the same two checks on the
 * checked-in fixture, so `npm test` catches a regression without a model. This
 * script is the building-scale run, and it is the one that can say something
 * about a **second** building — the IDS document states the exporter's promises
 * with no threshold fitted to the supplied project, so it is as meaningful on a
 * file this repository has never seen as on the one every other gate was tuned
 * against.
 *
 *   node --experimental-strip-types scripts/audit-ifc-export-independent.ts model.rvt
 *   node --experimental-strip-types scripts/audit-ifc-export-independent.ts model.rvt \
 *     --out recovered.ifc --json independent.json
 *
 * An already-exported IFC can be checked without reconverting:
 *
 *   node --experimental-strip-types scripts/audit-ifc-export-independent.ts \
 *     --ifc recovered.ifc
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import {
  IfcParser,
  extractPropertiesOnDemand,
  getInheritanceChainForEntity,
} from "@ifc-lite/parser";
import { parseIDS, validateIDS, createTranslationService } from "@ifc-lite/ids";
import { createDataAccessor } from "@ifc-lite/ids/bridge";

import { convertModel } from "./audit-coverage.ts";
import {
  countsByFrequency,
  countsByKey,
  increment,
  optionValue,
  percent,
  positionals,
  writeJsonReport,
} from "./lib/rvt-harness.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";

const RECOVERY_IDS = new URL("../tests/fixtures/reviter-recovery.ids", import.meta.url);

const [rvtPath] = positionals("--out", "--json", "--ids", "--ifc");
const existingIfc = optionValue("--ifc");
const requestedOutput = optionValue("--out");
const jsonPath = optionValue("--json");
const idsPath = optionValue("--ids");

if (!rvtPath && !existingIfc) {
  throw new Error(
    "usage: audit-ifc-export-independent.ts <model.rvt> [--out recovered.ifc] [--json report.json] [--ids requirements.ids]\n" +
      "   or: audit-ifc-export-independent.ts --ifc recovered.ifc [--json report.json] [--ids requirements.ids]",
  );
}

/**
 * Is this entity one of the building elements the exporter tags?
 *
 * Asked of the reader's own IFC4 schema registry rather than of a name pattern.
 * A hand-written prefix test counted `IfcSIUnit`, `IfcMaterialLayerSetUsage`
 * and `IfcOwnerHistory` as products and then reported that 12 of 14 "products"
 * carried no recovery evidence — which was true and meaningless, because a
 * material layer is not something a recovery has provenance about.
 *
 * `IfcProduct` is the right root: it covers every element with a placement and
 * a shape. Two branches below it are excluded, and for the same reason — they
 * are things the exporter *synthesises*, not things it recovered, so demanding
 * recovery evidence from them would be demanding provenance for a fact that has
 * no source record.
 *
 * `IfcSpatialElement` — project, site, building, storey, and the `IfcSpace`
 * entities that come from an accepted room review — are containers Reviter
 * builds to hold the recovery.
 *
 * `IfcFeatureElement` — the `IfcOpeningElement` voids written for a persisted
 * door or window host relation — describe a relationship between two recovered
 * elements rather than a third recovered element. The first run of this script
 * reported "1 of 3 products carry no Reviter_Recovery evidence" and the one was
 * `Opening for 11`, which is correct behaviour being counted as a defect.
 */
function isTaggableProduct(type: string): boolean {
  const chain = getInheritanceChainForEntity(type);
  if (!chain.includes("IfcProduct")) return false;
  if (chain.includes("IfcSpatialElement") || chain.includes("IfcSpatialStructureElement")) return false;
  return !chain.includes("IfcFeatureElement");
}

/**
 * The reader writes `[parseLite] <phase>: <n>ms` and `[IfcParser] Fast scan:
 * ...` through bare `console.log` calls that its own `IFC_DEBUG` switch does
 * not gate. This script prints a JSON report on stdout, so a dozen timing lines
 * in front of it would make the output unparseable. Only those two telemetry
 * prefixes are filtered; anything else the reader says still reaches the
 * terminal, and its warnings and errors go to stderr regardless.
 */
const READER_TELEMETRY = /^\[(?:parseLite|IfcParser)\]/;

async function parseQuietly(source: Uint8Array) {
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && READER_TELEMETRY.test(args[0])) return;
    log(...args);
  };
  try {
    return await new IfcParser().parseColumnar(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer,
    );
  } finally {
    console.log = log;
  }
}

const temporaryDirectory = rvtPath && !requestedOutput
  ? mkdtempSync(join(tmpdir(), "reviter-ifc-independent-"))
  : null;

try {
  let ifcPath: string;
  let sourceFileName: string;

  if (existingIfc) {
    ifcPath = existingIfc;
    sourceFileName = basename(existingIfc);
  } else {
    const recovered = convertModel(rvtPath!);
    sourceFileName = recovered.fileName;
    ifcPath = requestedOutput ?? join(
      temporaryDirectory!,
      `${basename(rvtPath!).replace(/\.[^.]+$/, "")}-recovered.ifc`,
    );
    writeFileSync(ifcPath, makeIfc(recovered));
  }

  const bytes = readFileSync(ifcPath);
  const store = await parseQuietly(new Uint8Array(bytes));

  // Every product the independent reader can see, and what evidence it carries.
  const table = store.entities;
  const productTypes = new Map<string, number>();
  const provenances = new Map<string, number>();
  const categoryEvidence = new Map<string, number>();
  let products = 0;
  let withRecovery = 0;
  let withGeometry = 0;
  let exactGeometry = 0;
  const missingRecovery: Array<{ expressId: number; type: string; name: string }> = [];

  for (let row = 0; row < table.count; row += 1) {
    const expressId = table.expressId[row]!;
    const type = table.getTypeName(expressId);
    if (!isTaggableProduct(type)) continue;
    products += 1;
    increment(productTypes, type);
    if (table.hasGeometry(expressId)) withGeometry += 1;

    const recovery = (extractPropertiesOnDemand(store, expressId) ?? [])
      .find((set) => set.name === "Reviter_Recovery");
    if (!recovery) {
      if (missingRecovery.length < 30) {
        missingRecovery.push({ expressId, type, name: table.getName(expressId) });
      }
      continue;
    }
    withRecovery += 1;
    const values = new Map((recovery.properties ?? []).map((p) => [p.name, p.value]));
    increment(provenances, String(values.get("GeometryProvenance") ?? "unstated"));
    increment(categoryEvidence, String(values.get("CategoryEvidence") ?? "unstated"));
    if (values.get("GeometryExact") === true) exactGeometry += 1;
  }

  const specification = parseIDS(readFileSync(idsPath ?? RECOVERY_IDS, "utf8"));
  const validation = await validateIDS(
    specification,
    createDataAccessor(store),
    {
      modelId: sourceFileName,
      schemaVersion: store.schemaVersion,
      entityCount: store.entityCount,
    },
    { translator: createTranslationService("en") },
  );

  const specifications = validation.specificationResults.map((result) => ({
    name: result.specification.name,
    applicable: result.applicableCount ?? 0,
    passed: result.passedCount ?? null,
    failed: result.failedCount ?? null,
    passRate: result.passRate,
  }));

  const report = {
    schemaVersion: 1,
    generatedBy: "scripts/audit-ifc-export-independent.ts",
    reader: "@ifc-lite/parser",
    source: { fileName: sourceFileName, ifcPath: requestedOutput ?? existingIfc ?? null },
    file: { bytes: statSync(ifcPath).size, schema: store.schemaVersion, entities: store.entityCount },
    products: {
      total: products,
      withGeometry,
      withRecoveryEvidence: withRecovery,
      recoveryEvidenceCoverage: percent(withRecovery, products),
      geometryExact: exactGeometry,
      byType: countsByFrequency(productTypes),
      byGeometryProvenance: countsByKey(provenances),
      byCategoryEvidence: countsByKey(categoryEvidence),
    },
    ids: { document: idsPath ?? "tests/fixtures/reviter-recovery.ids", specifications },
    missingRecoveryEvidence: missingRecovery,
  };

  console.log(JSON.stringify(report, null, 2));
  if (jsonPath) writeJsonReport(jsonPath, report);

  // Two failure conditions, and they are different kinds of wrong.
  //
  // A specification that fails means the exporter broke a promise it makes
  // about every product. A specification that matched nothing means the
  // document no longer describes what the exporter emits — it passed without
  // checking anything, which is worse than failing.
  const vacuous = specifications.filter((entry) => entry.applicable === 0);
  const failed = specifications.filter((entry) => entry.passRate !== 100);
  if (vacuous.length || failed.length || withRecovery !== products) {
    process.exitCode = 1;
    for (const entry of vacuous) console.error(`IDS matched no entities: ${entry.name}`);
    for (const entry of failed) {
      console.error(`IDS failed: ${entry.name} — ${entry.passRate}% of ${entry.applicable}`);
    }
    if (withRecovery !== products) {
      console.error(
        `${products - withRecovery} of ${products} products carry no Reviter_Recovery evidence`,
      );
    }
  }
} finally {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}
