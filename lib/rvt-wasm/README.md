# Reviter's pinned rvt-rs WASM reader

This directory vendors rvt-rs **0.4.0** from
[`helenkwok/rvt-rs@1c3d337`](https://github.com/helenkwok/rvt-rs/tree/1c3d337dbd2a6810e9dfad68fe99857843d67387).
The Apache-2.0 `LICENSE` and upstream `NOTICE` are retained.
`provenance.json` records the exact commit, toolchain, build flags and hashes.

Reviter keeps its own geometry pipeline. The optional worker adapter uses
`quickSummary` for metadata and
`openRvtBytesWithDiagnosticsModeAndLimits` with explicit `scaffold` mode and
bounded walker limits for diagnostics/material definitions. Its existing
2016–2026 admission policy remains separate from Reviter's release-specific
geometry decoders. Metadata range is not a claim of complete element or
geometry recovery. Revit 2027 metadata opens, but full optional-reader decoding
remains excluded until independently verified.

Room, MEP, IFC override and design-option evidence is adapted into Reviter's
shared TypeScript page scan with file-local ownership and release gates. Updating
the WASM alone does not replace or connect those semantics. See
[`docs/rvt-semantic-attribution.md`](../../docs/rvt-semantic-attribution.md).

## Rebuild

Install Rust with `wasm32-unknown-unknown` and `wasm-bindgen-cli` **0.2.118**,
then run from the Reviter checkout:

```sh
node scripts/rebuild-rvt-wasm.mjs
# Or reuse a clean checkout already at the pinned upstream commit:
node scripts/rebuild-rvt-wasm.mjs --source /path/to/rvt-rs
```

The script verifies the source commit/cleanliness and binding-tool version,
builds using upstream `Cargo.lock`, runs wasm-bindgen with target `web`, and
records output hashes. It skips wasm-opt, matching upstream's release policy.
Exact byte reproducibility additionally requires the recorded Rust toolchain.
The browser still performs all conversion locally.
