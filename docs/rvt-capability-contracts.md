# Capability contracts, bounded fuzz regressions and WASM staging

`lib/reviter/capabilities.ts` provides a serializable, versioned manifest of
**code eligibility and claim ceilings**, separately from per-file recovery.
Its interchange shape is `docs/schemas/capability-manifest.schema.json`.

```sh
node --experimental-strip-types scripts/report-capabilities.ts 2027
node --experimental-strip-types scripts/report-capabilities.ts 2023 --narrow-ids
```

`--narrow-ids` describes evidence already read from the file's schema; the CLI
does not infer it from a release number. A positive eligibility result permits
a decoder attempt. It does not prove the file contains the expected layout or
that any particular element was recovered. Existing conversion coverage remains
the authority for observed counts and representation provenance.

The manifest keeps the three bands independent:

- Container/schema metadata can be attempted without admitting native records.
- Selected 2019–2023 record readers require schema-confirmed 32-bit ids.
  The 2024–2027 path translates class tags; individual decoders can have
  narrower release gates. Neither band claims complete semantics or geometry.
- The **shipped** optional Rust/WASM 0.1.2 element/material adapter is gated to
  2016–2026. Its quick summary may succeed outside that band, including 2027,
  without enabling the element/material call. New upstream source support does
  not automatically describe the shipped binary.

`tests/capabilities.test.ts` exercises boundary releases, noninteger/unknown
versions, actual native-plan eligibility with both id widths, independent
metadata/WASM gates and the existence of evidence files. A matching year is
never promoted to a universal converter-grade claim. New semantic modules
should be declared only with their own release gates and test/corpus evidence.

## Deterministic fuzz regressions

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  --test tests/capabilities.test.ts tests/parser-fuzz-regressions.test.ts \
  tests/revit-inflation-bounds.test.ts
```

The seeded campaigns are finite and include their seed and case number in
failure context: 96 independent Node zlib payloads, 256 compressed-header/body
mutation and truncation cases, and 512 schema truncation/mutation cases. Payload
sizes are capped at 8 KiB and decoder output at 4 KiB in the malformed-stream
campaign. Assertions check exact round trips against an independent compressor,
subarray offsets, bounded outputs, structured schema failures and structural
invariants of successful parses. They supplement the existing gigabyte-shaped
bomb and shared stream-budget regressions. They are not a coverage-guided fuzzer,
completeness claim or security proof. Preserve any new crashing input as a small,
redistributable regression fixture before changing its parser.

## Pin and stage the optional reader

`scripts/rvt-wasm-pin.json` records Helen's reviewed source revision
`1c3d337dbd2a6810e9dfad68fe99857843d67387`, the exact Cargo.lock digest,
proposed Rust 1.90.0 / wasm-bindgen-cli 0.2.118 toolchain and hashes of the existing
vendored artifacts. The original vendored source revision is unknown and is
recorded as null, rather than guessed from package version 0.1.2.

Create a clean checkout at that revision, install the pinned Rust target and
CLI, and stage into a **new directory outside the checkout**:

```sh
rustup toolchain install 1.90.0
rustup target add wasm32-unknown-unknown --toolchain 1.90.0
cargo +1.90.0 install wasm-bindgen-cli --version 0.2.118 --locked
node scripts/stage-rvt-wasm.mjs /path/to/clean/rvt-rs /tmp/rvt-wasm-candidate --dry-run
node scripts/stage-rvt-wasm.mjs /path/to/clean/rvt-rs /tmp/rvt-wasm-candidate
```

The script verifies revision, clean source tree, lockfile hash and binding CLI
version, builds with `cargo --locked`, runs `wasm-bindgen --target web`, and writes
artifact hashes, commands and compiler version to `provenance.json`. It never
copies files into `lib/rvt-wasm`. No wasm-opt step is used, matching the upstream
crate's explicit opt-out. Dependency versions are locked; bit-for-bit output
across host platforms is not promised.

The dry run has been exercised. An actual Rust/WASM build has not been executed
in this environment because Rust and wasm-bindgen are not installed. The proposed
toolchain pin therefore still needs a real build; do not treat its presence as
build validation.

Before promotion, compare the candidate and shipped reader against the same
source bytes and authoritative conversions. Verify the worker's diagnostics,
material packing/transparency, PartAtom shape, 2027 skip and panic recovery,
then browser loading, no-network imports and bundle size. Preserve native
geometry provenance and compare actual outputs rather than equating source API
availability with recovered semantic evidence. Promote reviewed JS/WASM/types,
licence/provenance and release gates together only after these checks pass.
Model files and proprietary converted assets belong in ignored external corpus
storage, not the repository.
