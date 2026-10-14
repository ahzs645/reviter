/** Build a pinned candidate outside lib/rvt-wasm. Never promotes the binary. */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const pin = JSON.parse(readFileSync(new URL("./rvt-wasm-pin.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const paths = args.filter((arg) => arg !== "--dry-run");
if (paths.length !== 2) throw new Error("Usage: node scripts/stage-rvt-wasm.mjs SOURCE_CHECKOUT OUTPUT_DIRECTORY [--dry-run]");
const [source, output] = paths.map((path) => resolve(path));
const vendored = resolve(root, "lib/rvt-wasm");
const inside = (parent, path) => relative(parent, path) === "" || (!relative(parent, path).startsWith("..") && !relative(parent, path).startsWith("/"));
if (inside(vendored, output) || inside(source, output)) throw new Error("Output must be outside the source checkout and lib/rvt-wasm.");
if (existsSync(output)) throw new Error("Use a new output directory so earlier candidates cannot be overwritten.");
const run = (command, argv, cwd = source) => execFileSync(command, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
if (run("git", ["rev-parse", "HEAD"]) !== pin.commit) throw new Error(`Source must be pinned to ${pin.commit}`);
if (run("git", ["status", "--porcelain"])) throw new Error("Source checkout must be clean, including untracked files.");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (sha(resolve(source, "Cargo.lock")) !== pin.cargoLockSha256) throw new Error("Cargo.lock does not match pin.");
const target = resolve(output, "cargo-target");
const commands = [
  ["cargo", [`+${pin.rustToolchain}`, "build", "--release", "--locked", "--target", pin.target, "--target-dir", target, "--manifest-path", resolve(source, "rvt-wasm/Cargo.toml")]],
  ["wasm-bindgen", [resolve(target, pin.target, "release/rvt_wasm.wasm"), "--target", "web", "--out-name", "rvt", "--out-dir", resolve(output, "pkg")]],
];
if (dryRun) {
  console.log(JSON.stringify({ pin, commands, output, promoted: false }, null, 2));
} else {
  if (run("wasm-bindgen", ["--version"]) !== `wasm-bindgen ${pin.wasmBindgenCli}`) throw new Error(`Install wasm-bindgen-cli ${pin.wasmBindgenCli} exactly.`);
  const compiler = run("rustc", [`+${pin.rustToolchain}`, "--version"]);
  mkdirSync(output, { recursive: true });
  for (const [command, argv] of commands) console.log(run(command, argv));
  const hashes = Object.fromEntries(["rvt.js", "rvt.d.ts", "rvt_bg.wasm", "rvt_bg.wasm.d.ts"].map((file) => [file, sha(resolve(output, "pkg", file))]));
  writeFileSync(resolve(output, "provenance.json"), JSON.stringify({ ...pin, compiler, commands, sha256: hashes, promoted: false }, null, 2) + "\n");
  console.log(`Staged candidate in ${output}; lib/rvt-wasm is unchanged.`);
}
