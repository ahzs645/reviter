# Decoder capabilities and malformed-input regression checks

`lib/reviter/capabilities.ts` describes **decoder admission**, the exact releases
with recorded corpus observations, required per-record evidence, and executable
test suites. Its pure `evaluateCapability` function does not change conversion
state. It returns missing evidence rather than promoting a release into a general
support claim. The registry is additive; it is not a complete inventory of every
geometry decoder.

The current source supports selected 32-bit-ID record readers for 2019–2023 only
after the file's `Identifier` schema declares `int32`. The 2024–2027 record gate
does not imply that every surface or semantic field is decoded in every release.
2016–2018 and 2028 have no admitted native-record contract. An absent `Identifier`
declaration retains the converter's existing wide-ID default; a conflicting width
fails this contract.

| Capability | Admitted releases | Evidence limits |
| --- | --- | --- |
| Element records | 2019–2027 with width gate | Selected narrow readers; categories and envelopes do not certify geometry |
| Native identities | 2019–2027 with width gate | Complete History/ElemTable shapes and creation history required; paired identity observations documented for 2023–2026 and original 2027 layout |
| IFC export overrides | 2024, 2025, 2026 | Measured upstream scan protocol 2024/2025; 2026 header validated synthetically, positive paired counts tracked separately |
| Source room identities | Admitted header releases | Explicit room category and placed project ownership; boxless identity is retained |
| Stored room outlines | 2023, 2024, 2025 | Upstream measured solid layouts; ownership and valid topology required, never routing certification |
| MEP systems | 2024, 2025, 2026, 2027 | Upstream 2025 record observations; schema, owner, frame echo and checksum required |
| MEP connector joins | 2025 | Measured joins only; native graph and unconnected symbol ports remain unresolved |
| Primary design options | 2024, 2025 | Positive upstream option evidence is 2024; explicit flag and unambiguous set required |

The native IFC parameter collector currently reads class and predefined-type
strings only. Numeric "Export to IFC" instance/type flags are honored when the
existing generic parameter decoder supplies their published parameter IDs;
the new native string scan does not establish flag recovery by itself.

Run the executable contracts and decoder regression suites:

```sh
npm run test:capabilities
npm run capabilities:rvt -- --release 2025 --id-width 8 --evidence record-framing
```

`capabilitySnapshot(context)` produces serializable admission results for every
contract. A caller can attach this to its own audit with the release, actual
schema width and a set of proven evidence names; the CLI prints the same snapshot
plus the complete contracts. Passing a release alone leaves record evidence
missing, and the output explicitly reports that rather than claiming support.

`scripts/lib/rvt-malformed-fuzz.ts` generates a deterministic corpus from valid
metadata, schema, history, bounds, both header widths, gzip and a nine-byte
truncated optional gzip header. It applies truncation, random bytes, extreme
32-bit counts, bit flips and extra tails using a local seeded generator. Every
parser input is a nonzero-offset byte view.

The corpus reaches ten targets: BasicFileInfo, ElemTable, partition names,
schema, history, 32/64-bit record framing, gzip, raw-container refusal and the
full converter with a valid CFB envelope containing mutated partition payloads.
It counts successful parsing, absent evidence and structured refusals separately.
An accidental throw, invalid result invariant or unexpected converter refusal
fails the run. Converter error text is checked because a caught RangeError must
not be reported as successful malformed-input handling.

```sh
npm run test:fuzz
npm run fuzz:rvt -- --seed 5396052 --cases 256 --output /tmp/reviter-fuzz.json
```

The report contains target counts, seed, corpus SHA-256 and exact failing input
hex plus its target and case ID (the first 32 failures are saved, with a total
failure count to bound reporting memory). Repeating a seed and case count regenerates the
same corpus. `--max-input-bytes` accepts 512–4096; `--cases` accepts 1–4096.
Gzip parser targets use 16 KiB chunk and 32 KiB stream ceilings. Converter
fixtures contain at most 4 KiB of uncompressed mutated payload, a valid CFB
header, at most 64 diagnostic segments and a 16 KiB native mesh budget. The CLI
uses a child process with a 60-second deadline, so a synchronous parser hang
cannot keep it alive indefinitely.

This is a bounded regression check, not arbitrary-container coverage or a
geometry accuracy evaluation. It deliberately preserves CFB allocation metadata
and fuzzes the streams inside; arbitrary FAT/sector counts need a separately
isolated container campaign. The corpus shares the committed synthetic fixture
writer used by end-to-end tests. It does not fuzz the vendored Rust/WASM binary,
invent support for releases outside each contract, or replace paired RVT/IFC and
Autodesk conversion checks. New recovered semantic layouts should get positive
and malformed fixtures in their decoder suite before adding new release claims.
