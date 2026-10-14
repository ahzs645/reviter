import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commit = "1c3d337dbd2a6810e9dfad68fe99857843d67387";
const upstream = "https://github.com/helenkwok/rvt-rs.git";
const root = fileURLToPath(new URL("../", import.meta.url));
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
if (run("git", ["status", "--porcelain"])) throw Error("WASM source must be clean");
const lock = readFileSync(resolve(source, "Cargo.lock"), "utf8");
const bindgen = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
if (run("wasm-bindgen", ["--version"]) !== `wasm-bindgen ${bindgen}`) throw Error(`Install wasm-bindgen-cli ${bindgen} with cargo install --locked`);
run("rustup", ["target", "add", "wasm32-unknown-unknown"]);
run("cargo", ["build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "-p", "rvt-wasm"]);
const target = resolve(root, "lib/rvt-wasm");
run("wasm-bindgen", [resolve(source, "target/wasm32-unknown-unknown/release/rvt_wasm.wasm"), "--target", "web", "--out-dir", target, "--out-name", "rvt"]);
copyFileSync(resolve(source, "LICENSE"), resolve(target, "LICENSE"));
copyFileSync(resolve(source, "NOTICE"), resolve(target, "NOTICE"));
const hashes = Object.fromEntries(["rvt.js", "rvt.d.ts", "rvt_bg.wasm", "rvt_bg.wasm.d.ts"].map(file => [file, createHash("sha256").update(readFileSync(resolve(target, file))).digest("hex")]));
writeFileSync(resolve(target, "provenance.json"), JSON.stringify({ upstream, commit, packageVersion: "0.4.0", rustc: run("rustc", ["--version"]), wasmBindgen: bindgen, target: "web", wasmOpt: false, build: "cargo build --locked --release --target wasm32-unknown-unknown -p rvt-wasm", hashes }, null, 2) + "\n");
const pkg = JSON.parse(readFileSync(resolve(target, "package.json"), "utf8"));
pkg.version = "0.4.0";
pkg.files = ["rvt_bg.wasm", "rvt_bg.wasm.d.ts", "rvt.js", "rvt.d.ts", "LICENSE", "NOTICE", "provenance.json"];
writeFileSync(resolve(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`Built rvt-wasm 0.4.0 from ${commit}`);
