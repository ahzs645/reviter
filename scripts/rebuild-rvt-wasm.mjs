import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const commit = "1c3d337dbd2a6810e9dfad68fe99857843d67387";
const upstream = "https://github.com/helenkwok/rvt-rs.git";
const root = fileURLToPath(new URL("../", import.meta.url));
const vanilla = process.argv.includes("--vanilla");
const outputAt = process.argv.indexOf("--out");
if (vanilla && (outputAt < 0 || !process.argv[outputAt + 1])) throw Error("--vanilla requires a separate --out directory");
const vendor = resolve(root, "lib/rvt-wasm");
const target = outputAt < 0 ? vendor : resolve(process.argv[outputAt + 1]);
if (vanilla && target === vendor) throw Error("Keep the vanilla comparison bundle separate from the patched vendor directory");
const optionAt = process.argv.indexOf("--source");
const source = optionAt < 0 ? mkdtempSync(resolve(tmpdir(), "reviter-rvt-wasm-")) : resolve(process.argv[optionAt + 1]);
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} failed (${result.status})`);
  return result.stdout.trim();
}
if (optionAt < 0) {
  run("git", ["clone", upstream, source], root);
  run("git", ["checkout", "--detach", commit]);
}
if (run("git", ["rev-parse", "HEAD"]) !== commit) throw Error("WASM source must be the pinned upstream commit");
const patchRoot = resolve(root, "lib/rvt-wasm/patches");
const manifest = vanilla ? { baseCommit: commit, patches: [] } : JSON.parse(readFileSync(resolve(patchRoot, "manifest.json"), "utf8"));
if (manifest.baseCommit !== commit) throw Error("WASM patch manifest base must match pinned commit");
const canonical = mkdtempSync(resolve(tmpdir(), "reviter-rvt-patched-files-"));
const patchFiles = new Set();
const localPatches = manifest.patches.map(patch => {
  if (!/^[a-z0-9-]+\.patch$/.test(patch.file)) throw Error("Invalid WASM patch filename");
  const path = resolve(patchRoot, patch.file), bytes = readFileSync(path);
  const paths = [...bytes.toString("utf8").matchAll(/^\+\+\+ b\/([^\n]+)$/gm)].map(match => match[1]);
  if (!paths.length || paths.some(path => path.includes("..") || path.startsWith("/"))) throw Error("Invalid WASM patch paths");
  for (const path of paths) {
    patchFiles.add(path);
    const original = spawnSync("git", ["show", `HEAD:${path}`], { cwd: source, encoding: "utf8" });
    if (original.status === 0 && !existsSync(resolve(canonical, path))) {
      mkdirSync(dirname(resolve(canonical, path)), { recursive: true });
      writeFileSync(resolve(canonical, path), original.stdout);
    }
  }
  run("git", ["apply", path], canonical);
  return { path: `lib/rvt-wasm/patches/${patch.file}`, sha256: createHash("sha256").update(bytes).digest("hex"), purpose: patch.purpose, files: paths };
});
// Accept an untouched checkout or exactly these patches, including their new
// files. Comparing complete patched files rejects unrelated edits outside hunks.
if (!run("git", ["status", "--porcelain"])) for (const patch of localPatches) run("git", ["apply", resolve(root, patch.path)]);
const changed = run("git", ["status", "--porcelain", "--untracked-files=all"])
  .split("\n").filter(Boolean).map(line => line.trimStart().slice(2).trim());
if (changed.some(path => !patchFiles.has(path))) throw Error("WASM source contains changes outside declared patches");
for (const path of patchFiles) if (!existsSync(resolve(source, path)) || !readFileSync(resolve(source, path)).equals(readFileSync(resolve(canonical, path)))) {
  throw Error(`WASM source differs from the declared patch result: ${path}`);
}
const lock = readFileSync(resolve(source, "Cargo.lock"), "utf8");
const bindgen = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
if (run("wasm-bindgen", ["--version"]) !== `wasm-bindgen ${bindgen}`) throw Error(`Install wasm-bindgen-cli ${bindgen} with cargo install --locked`);
run("rustup", ["target", "add", "wasm32-unknown-unknown"]);
run("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "-p", "rvt-wasm"]);
run("wasm-bindgen", [resolve(process.env.CARGO_TARGET_DIR ?? resolve(source, "target"), "wasm32-unknown-unknown/release/rvt_wasm.wasm"), "--target", "web", "--out-dir", target, "--out-name", "rvt"]);
copyFileSync(resolve(source, "LICENSE"), resolve(target, "LICENSE"));
copyFileSync(resolve(source, "NOTICE"), resolve(target, "NOTICE"));
const hashes = Object.fromEntries(["rvt.js", "rvt.d.ts", "rvt_bg.wasm", "rvt_bg.wasm.d.ts"].map(file => [file, createHash("sha256").update(readFileSync(resolve(target, file))).digest("hex")]));
writeFileSync(resolve(target, "provenance.json"), JSON.stringify({ upstream, commit, packageVersion: "0.4.0", localPatches, rustc: run("rustc", ["--version"]), wasmBindgen: bindgen, target: "web", wasmOpt: false, build: "cargo build --locked --release --target wasm32-unknown-unknown -p rvt-wasm", hashes }, null, 2) + "\n");
const pkg = JSON.parse(readFileSync(resolve(existsSync(resolve(target, "package.json")) ? target : vendor, "package.json"), "utf8"));
pkg.version = "0.4.0";
pkg.files = ["rvt_bg.wasm", "rvt_bg.wasm.d.ts", "rvt.js", "rvt.d.ts", "LICENSE", "NOTICE", "provenance.json", ...(vanilla ? [] : ["patches/manifest.json", ...manifest.patches.map(patch => `patches/${patch.file}`)])];
if (!vanilla && target !== vendor) {
  mkdirSync(resolve(target, "patches"), { recursive: true });
  copyFileSync(resolve(patchRoot, "manifest.json"), resolve(target, "patches/manifest.json"));
  for (const patch of manifest.patches) copyFileSync(resolve(patchRoot, patch.file), resolve(target, "patches", patch.file));
}
writeFileSync(resolve(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`Built rvt-wasm 0.4.0 from ${commit} with ${localPatches.length} declared local patch(es)`);
