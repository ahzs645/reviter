/**
 * Extract Reviter's recovered geometry from an RVT into an open-format file.
 *
 * Usage:
 *   npm run extract -- model.rvt --out model.glb
 *   npm run extract -- model.rvt --out audit.json
 *   npm run extract -- model.rvt --out model.obj --revit-version 2027
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { makeGlb } from "../lib/reviter/export-glb.ts";
import { makeIfcCenterlines } from "../lib/reviter/export-ifc.ts";
import { makeDxf, makeObj } from "../lib/reviter/export-mesh-text.ts";
import { makeReport } from "../lib/reviter/export-report.ts";
import { makeFloorPlateSvg, makePlanSvg } from "../lib/reviter/export-svg.ts";

type Format = "glb" | "obj" | "dxf" | "svg" | "ifc" | "json";

export type ExtractArguments = {
  input: string;
  output: string;
  format: Format;
  revitVersion?: number;
  planLevelId?: number;
  floorPlates?: boolean;
};

const FORMATS = new Set<Format>(["glb", "obj", "dxf", "svg", "ifc", "json"]);

function valueAfter(arguments_: string[], flag: string): string | undefined {
  const index = arguments_.indexOf(flag);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

export function parseExtractArguments(arguments_: string[]): ExtractArguments {
  const input = arguments_[0];
  const output = valueAfter(arguments_, "--out");
  if (!input || input.startsWith("-") || !output) {
    throw new Error("Usage: npm run extract -- model.rvt --out model.glb [--revit-version 2027] [--level-id 311] [--floor-plates]");
  }

  const extension = extname(output).slice(1).toLowerCase();
  const requestedFormat = (valueAfter(arguments_, "--format") ?? extension) as Format;
  if (!FORMATS.has(requestedFormat)) {
    throw new Error(
      `Unsupported output format "${requestedFormat || "(none)"}". ` +
        "Use glb, obj, dxf, svg, ifc, or json.",
    );
  }

  const rawVersion = valueAfter(arguments_, "--revit-version");
  const revitVersion = rawVersion == null ? undefined : Number(rawVersion);
  if (
    rawVersion != null &&
    (!Number.isInteger(revitVersion) || revitVersion! < 2000 || revitVersion! > 2099)
  ) {
    throw new Error(`Invalid Revit version "${rawVersion}".`);
  }

  const rawLevelId = valueAfter(arguments_, "--level-id");
  const planLevelId = rawLevelId == null ? undefined : Number(rawLevelId);
  if (
    rawLevelId != null &&
    (!Number.isSafeInteger(planLevelId) || planLevelId! <= 0)
  ) {
    throw new Error(`Invalid Revit level id "${rawLevelId}".`);
  }
  if (planLevelId != null && requestedFormat !== "svg") {
    throw new Error("--level-id is available only for SVG floor-plan exports.");
  }
  const floorPlates = arguments_.includes("--floor-plates");
  if (floorPlates && (requestedFormat !== "svg" || planLevelId == null)) {
    throw new Error("--floor-plates requires an SVG output and --level-id.");
  }

  return { input, output, format: requestedFormat, revitVersion, planLevelId, floorPlates };
}

type SuccessfulConversion = Extract<ReturnType<typeof convertRvtBytes>, { ok: true }>;

function outputFor(
  format: Format,
  result: SuccessfulConversion,
  options: Pick<ExtractArguments, "planLevelId" | "floorPlates"> = {},
): Uint8Array | string {
  switch (format) {
    case "glb": return new Uint8Array(makeGlb(result));
    case "obj": return makeObj(result);
    case "dxf": return makeDxf(result);
    case "svg": return options.floorPlates
      ? makeFloorPlateSvg(result, options.planLevelId!)
      : makePlanSvg(result, { levelId: options.planLevelId });
    case "ifc": return makeIfcCenterlines(result);
    case "json": return makeReport(result, null);
  }
}

export function extractGeometry(arguments_: string[]): void {
  const options = parseExtractArguments(arguments_);
  const input = readFileSync(options.input);
  const outcome = convertRvtBytes(
    new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
    options.input.split("/").pop() ?? "model.rvt",
    options.revitVersion == null ? {} : { revitVersion: options.revitVersion },
    ({ ratio, message }) => {
      process.stderr.write(
        `\r${String(Math.round(ratio * 100)).padStart(3)}% ${message.padEnd(52)}`,
      );
    },
  );
  process.stderr.write("\n");
  if (!outcome.ok) throw new Error(outcome.error);

  writeFileSync(options.output, outputFor(options.format, outcome, options));
  const megabytes = input.byteLength / (1024 * 1024);
  console.log(
    `Extracted ${outcome.stats.candidatesUsed.toLocaleString()} elements and ` +
      `${outcome.stats.triangleCount.toLocaleString()} triangles from ${megabytes.toFixed(1)} MB ` +
      `of Revit ${outcome.decoderCoverage.revitVersion ?? "unknown"} data to ${options.output}.`,
  );
  for (const warning of outcome.warnings.slice(0, 3)) console.log(`warning: ${warning}`);
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("extract-geometry.ts")) {
  try {
    extractGeometry(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
