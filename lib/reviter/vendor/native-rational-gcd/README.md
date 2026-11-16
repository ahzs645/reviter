# Exact integer gcd (WebAssembly)

`src/lib.rs` is a dependency-free binary gcd over 64-bit limbs. It is compiled
to WebAssembly and embedded as base64 in
`native-rational-overlay-arithmetic.mjs`, which runs in Node and in browsers.
A gcd is an exact integer, so this path and the JavaScript Lehmer fallback give
the same value; neither can change any geometry.

Rebuild with `sh build.sh` (needs the `wasm32-unknown-unknown` Rust target). It
prints the base64 and SHA-256 to paste into both vendored copies of the module
(Reviter and OpenIndoorMaps must stay byte-identical).
