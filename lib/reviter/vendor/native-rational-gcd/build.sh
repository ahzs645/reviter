#!/usr/bin/env sh
set -eu
cd "$(dirname -- "$0")"
cargo build --release --target wasm32-unknown-unknown --target-dir "${TMPDIR:-/tmp}/native-rational-gcd"
out="${TMPDIR:-/tmp}/native-rational-gcd/wasm32-unknown-unknown/release/gcdwasm.wasm"
shasum -a 256 "$out"
base64 < "$out" | tr -d '\n'
echo
