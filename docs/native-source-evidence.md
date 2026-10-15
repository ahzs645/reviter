# Optional native source evidence

Reviter preserves its existing scene decoder and adds an on-demand, bounded source inspector. `openNativeEvidence` is a Reviter-owned WASM binding patch over Helen Kwok's rvt-rs commit `1c3d337dbd2a6810e9dfad68fe99857843d67387`; it calls the upstream `native_document::extract` implementation without modifying the core Rust decoders.

The inspector retains selected stored owner graphs and saved metadata, parameter definitions, unit formatting, parameter bindings and the extensible-storage catalog. Each retained record carries its upstream source stream, record offset and body hash. The adapter binds the report to the SHA-256 of the original RVT bytes. These are serialized source values: formulas are not evaluated, annotations are not reconstructed, and source room records do not certify navigation boundaries.

The default class allowlist selects metadata and annotation owners rather than extracting all elements. Explicit IDs accept safe JavaScript integers or exact decimal strings. Numbers beyond JavaScript's safe integer range are returned as decimal strings; unsupported records retain diagnostics.

Resource limits cover source file and streams, inflated members and their aggregate bytes, gzip members, group size, per-owner graph values and objects, decoded and retained records, each encoded record, the summary and final encoded JSON. The inspector preflights source members before using the upstream inflation cache. Responses distinguish `complete`, `partial`, `budget-blocked` and `unsupported`; a complete response is complete only within its selected extraction scope.

These limits bound source/response work, not total process memory. The underlying extractor scans parameter-definition owners before selected owner records, and may keep cache and graph copies. Definition extraction remains under stream/group/per-graph limits but its owner count is not capped by the selected-record count. Historical records and embedded content groups remain excluded. Unsupported graph classes and the disabled built-in definition catalog remain unresolved.

Run `npm run inspect:rvt-evidence -- model.rvt --out evidence.json`, optionally with `--ids 123,456` or `--classes TextNote,Dimension`. The browser inspector runs this work in a separate worker on user request and leaves scene geometry and material assignments intact.

`lib/rvt-wasm/patches/manifest.json` declares the local patch. `provenance.json` records the pinned upstream revision, exact patch hash, generated binary/bindings hashes and toolchain. `node scripts/rebuild-rvt-wasm.mjs --source /path/to/pinned/rvt-rs` accepts a pristine checkout or precisely the declared patch result, rejects unrelated edits, and rebuilds the vendor bundle. Apache-2.0 LICENSE and NOTICE remain in the package.

The checked-in witness report is `docs/generated/rvt-native-evidence-validation.json`; uploaded RVT files and raw owner graph dumps are kept outside the repository.

The rebuilt WASM was exercised against the uploaded RAC and Snowdon models:

| Source | Parameter definitions | Unit formats | Native bindings | Stored ES schemas |
| --- | ---: | ---: | ---: | ---: |
| RAC 2025 | 774 | 136 | 2 | 0 |
| Snowdon 2024 | 1,604 | 136 | 166 | 9 |

The RAC units/phases selection recovered four complete owner records. Broader family-owner selections returned explicit partial results after retaining 128 records; RAC decoded 706 selected complete graphs and Snowdon 1,517. Definition extraction retained eight unresolved diagnostics in RAC and two in Snowdon. These counts describe stored evidence exposed by the upstream reader, not complete parameter interpretation or extensible-storage behavior.

Seven WASM/provenance checks passed, covering malformed source responses, bounded selections, exact IDs, actual gzip inflation caps, source hashing and declared patch hashes. Five Rust adapter checks passed, including decimal serialization of `u64::MAX` and `i64::MIN`.

The returned report now includes separately bounded [typed records](native-record-inventory.md) and [parameter inventories](native-parameter-inventory.md). The browser supplies targeted catalog/record selections, and its definition CSV includes the picked owner where supported. Explicit CLI IDs select those owners alone unless classes are also supplied. Raw WASM output limits do not include the additional TypeScript JSON/CSV projections; all partial/blocked states and raw fallbacks remain visible.
