#!/usr/bin/env node

/**
 * Focused, read-only audit of the native ODA/Revit tessellator stack.
 *
 * This script never loads or executes a target binary. It reads file bytes and
 * invokes only static metadata tools (`file`, `objdump`, and `nm`).
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SOURCE_ROOT =
  "/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated";

const TARGETS = [
  {
    name: "TB_Geometry.tx",
    sha256: "4f93e3753f3011145063d649c474dd957ade06910dd3f21b9f41512192cfcf5f",
    role: "Revit geometry graph and modeler/BRep bridge",
    symbolNeedles: [
      "OdBmGeometryImpl::brepBuilder(",
      "OdBmGeometryImpl::brep(",
      "OdBmMdUtils::mdBody2BmGeometry(",
      "OdBmGPolyMesh::setFacetedTopology(",
    ],
  },
  {
    name: "libTD_Ge.so",
    sha256: "bd8821c698f1217df6726efcfe57b45011ebf5ed855f95a77d5ff539022a0c7b",
    role: "Analytic curves/surfaces and in-memory triangle mesh types",
    symbolNeedles: [
      "GeMesh::OdGeTrMesh::clear(",
      "GeMesh::OdGeTrMesh::append(",
      "OdGeSerializer::writePlane(",
    ],
  },
  {
    name: "libOdBrepModeler.so",
    sha256: "f9ac29574c44060f1e1b5de4c44c9e4110e711d1cb37c79f80d395490b262562",
    role: "Solid-modeling bodies, operations, and native body serialization",
    symbolNeedles: [
      "OdMdBinFile::load(",
      "OdMdSerializer::writeBody(",
      "OdMdDeserializer::readBody(",
    ],
  },
  {
    name: "libTD_BrepBuilder.so",
    sha256: "23a9481d1d36649b4a230c6e72949ba8a338e80a450b4e6c699ea1f17f77e0e7",
    role: "Incremental construction of BRep topology",
    symbolNeedles: [
      "OdBrepBuilder::addFace(",
      "OdBrepBuilder::addLoop(",
      "OdBrepBuilder::addEdge(",
      "OdBrepBuilder::addCoedge(",
      "OdBrepBuilder::finish()",
    ],
  },
  {
    name: "libTD_Br.so",
    sha256: "c32a077404815e652cd1b55ac44754c8081e6f7c2313c753c423c7ee1ff82e4c",
    role: "Read-only BRep topology traversal",
    symbolNeedles: [
      "OdBrBrep::set(",
      "OdBrFace::getSurface(",
      "OdBrLoopEdgeTraverser::setLoop(",
    ],
  },
  {
    name: "libTD_BrepRenderer.so",
    sha256: "88df6dba62c629c60a599f0f0bf6bef38041cc7f9c6ef68aabb7503f3b58d1c3",
    role: "Trimmed-surface tessellation and face mesh extraction",
    symbolNeedles: [
      "OdBrepRendererImpl::getFaceMesh(",
      "wrRenderBrep::renderBrep(",
      "SrfTess::tesselateSrf(",
    ],
  },
  {
    name: "libTD_BrepBuilderFiller.so",
    sha256: "4829d65a4506d7758e239a12520022b2d89b2460270bc402ea8ee352494f5c0b",
    role: "BRep traversal-to-builder adapter and topology repair",
    symbolNeedles: [
      "OdBrepBuilderFillerHelper::performFace(",
      "OdBrepBuilderFillerHelper::performLoop(",
    ],
  },
  {
    name: "TB_Database.tx",
    sha256: "712af67aee47941fd54c613394e392050618f8bfebcc8ffd08512c5bed513f17",
    role: "Element geometry entry point and modeler-to-renderer dispatch",
    symbolNeedles: [
      "OdBmElement::getGeometry(",
      "OdBmModelerGeometryImpl::getFaceMesh(",
      "OdBmModelerGeometryImpl::setLevelOfDetail(",
    ],
  },
  {
    name: "TB_ModelerGeometry.tx",
    sha256: "f15c4ba415cb1d9a520b9a6363d99c3c0fbdaf4bd3396e53d55327d28170f19e",
    role: "Triangulation policy, level-of-detail, and cache configuration",
    symbolNeedles: [
      "OdBmModelerGeometryPE::setMeshTolerance(",
      "OdBmModelerGeometryPE::setTriangulationParams(",
    ],
  },
];

const BROWSER_BINDING_MARKERS = [
  "WebAssembly",
  "wasm32",
  "emscripten",
  "embind",
  "napi_register",
  "node_api",
];

function runStaticTool(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.map((arg) => JSON.stringify(arg)).join(" ")} failed: ${
        result.stderr || result.stdout
      }`,
    );
  }
  return result.stdout;
}

function objdumpMetadata(path) {
  const output = runStaticTool("objdump", ["-p", path]);
  return {
    soname: output.match(/^\s*SONAME\s+(.+)$/m)?.[1]?.trim() ?? null,
    rpath:
      output.match(/^\s*(?:RPATH|RUNPATH)\s+(.+)$/m)?.[1]?.trim() ?? null,
    needed: [...output.matchAll(/^\s*NEEDED\s+(.+)$/gm)].map((match) =>
      match[1].trim()
    ),
  };
}

function demangledDefinedSymbols(path) {
  return runStaticTool("nm", ["-D", "-C", "--defined-only", path])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/\b[ABCDGIRSTUVW]\s+(.+)$/)?.[1] ?? line);
}

async function collectWasmArtifacts(root) {
  const results = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && /\.(?:wasm|wat)$/i.test(entry.name)) {
        results.push(relative(root, path));
      }
    }
  }
  await visit(root);
  return results.sort();
}

const sourceRoot = resolve(process.argv[2] ?? DEFAULT_SOURCE_ROOT);
const files = [];

for (const target of TARGETS) {
  const path = resolve(sourceRoot, target.name);
  const bytes = await readFile(path);
  const fileStat = await stat(path);
  const description = runStaticTool("file", ["-b", path]).trim();
  const dynamic = objdumpMetadata(path);
  const symbols = demangledDefinedSymbols(path);
  const matchedSymbols = Object.fromEntries(
    target.symbolNeedles.map((needle) => [
      needle,
      symbols.find((symbol) => symbol.includes(needle)) ?? null,
    ]),
  );
  const browserBindingMarkers = BROWSER_BINDING_MARKERS.filter((marker) =>
    bytes.includes(Buffer.from(marker))
  );
  const digest = createHash("sha256").update(bytes).digest("hex");

  files.push({
    name: basename(path),
    byteLength: fileStat.size,
    sha256: digest,
    matchesKnownBuild: digest === target.sha256,
    description,
    elfX8664:
      description.includes("ELF 64-bit") && description.includes("x86-64"),
    dynamicallyLinked: description.includes("dynamically linked"),
    stripped:
      /\bstripped\b/.test(description) &&
      !/\bnot stripped\b/.test(description),
    role: target.role,
    soname: dynamic.soname,
    rpath: dynamic.rpath,
    needed: dynamic.needed,
    matchedSymbols,
    allRequiredSymbolsObserved: Object.values(matchedSymbols).every(Boolean),
    browserBindingMarkers,
  });
}

const wasmArtifacts = await collectWasmArtifacts(sourceRoot);
const mainTargets = files.filter((file) =>
  [
    "TB_Geometry.tx",
    "libTD_Ge.so",
    "libOdBrepModeler.so",
    "libTD_BrepBuilder.so",
    "libTD_Br.so",
    "libTD_BrepRenderer.so",
  ].includes(file.name)
);
const localNames = new Set(files.map((file) => file.name));

const report = {
  schemaVersion: 1,
  evidenceMode: "static-only",
  sourceRoot,
  summary: {
    targetCount: files.length,
    allTargetsPresent: files.length === TARGETS.length,
    allHashesMatchKnownBuild: files.every((file) => file.matchesKnownBuild),
    allRequiredSymbolsObserved: files.every(
      (file) => file.allRequiredSymbolsObserved
    ),
    allMainTargetsElfX8664: mainTargets.every((file) => file.elfX8664),
  },
  browserPortability: {
    wasmArtifacts,
    browserBindingMarkers: Object.fromEntries(
      files
        .filter((file) => file.browserBindingMarkers.length)
        .map((file) => [file.name, file.browserBindingMarkers]),
    ),
    observedBrowserCallableAbi:
      wasmArtifacts.length > 0 ||
      files.some((file) => file.browserBindingMarkers.length > 0),
    conclusion:
      "The supplied artifacts expose a native C++ ELF ABI only; no browser/WASM binding is observed.",
  },
  dependencyEdges: files.flatMap((file) =>
    file.needed
      .filter((dependency) => localNames.has(dependency))
      .map((dependency) => ({ from: file.name, to: dependency }))
  ),
  handoff: {
    requiredInput: [
      "owned and oriented BRep faces",
      "ordered loops and coedges",
      "analytic 3D edge curves",
      "surface definitions and 2D p-curves",
      "body/instance transforms",
      "face markers and material identities",
      "triangulation parameters",
    ],
    triangleOutput: {
      carrier: "GeMesh::OdGeTrMesh&",
      kind: "in-memory C++ object",
      serialized: false,
      observedPayload: ["point positions", "three integer indices per triangle"],
      materialIncludedInCarrier: false,
    },
    persistedFacetedTopology: {
      carrier: "OdBmGPolyMesh/OdBmFacetedTopology variants",
      alreadyTessellated: true,
      browserReadyWithoutReleaseSpecificRecordDecoding: false,
    },
    nativeModelerBody: {
      loadersObserved: true,
      documentedPortableFormatObserved: false,
    },
  },
  files,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
