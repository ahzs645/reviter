# Native MEP evidence and experimental IFC export

`lib/reviter/native-mep.ts` reads native system objects and the measured 2025
duct/pipe/fitting connector lists. It preserves source stream/byte offsets and
does not use endpoint proximity. It leaves Reviter's geometry pipeline intact.

This is a selective TypeScript port of the Apache-2.0 rvt-rs layouts at
`1c3d337`, with attribution and licence in `lib/reviter/vendor/rvt-rs-mep/`.
It does not require replacing the vendored WASM binary.

## Evidence and limits

System objects require their own schema class, positive 32-bit element id in a
wide-id record, matching length echo and valid Adler-32. HVAC/piping names use
the upstream bounded ASCII string reader; electrical names use the counted
circuit-number layout. Conflicting copies remove the system from the result.
These layouts are admitted for 2024–2027; this does not assert parity on each
release. Non-ASCII names remain unresolved.

`candidateMembers` and `membershipCandidates` are explicitly candidate evidence:
a complete positive u64 system id occurs inside the member's checksum-verified
own object. That proves an exact reference, but the containing field has not
been decoded. It does not prove a system-membership field. Categories nominated
for this scan must come from a decoded native header, token or schema-specific
object; record-code consensus is rejected.

Connector packets are admitted only for Revit 2025, following rvt-rs's measured
RE1 layouts. The later curve block carries native indices; the earlier block's
0/1 indices are inverted only when the later copy is absent. Fittings carry
their own indices. Endpoints must be independently known MEP elements, curve
indices must be 0/1, malformed flags and unknown ids are rejected, reciprocal
packets deduplicate, and conflicting partners for one port remove those joins.
Unjoined duct/pipe ends may still have ports. Flow direction, domain and port
position remain unknown. Native family symbol/instance connector graphs are
not decoded by this implementation, so family-only connections and unjoined
family connectors remain unresolved.

Objects can span inflated pages. State resets at every partition boundary.
The scanner holds at most one candidate object up to 8 MiB plus the current
page, and the raw connector scanner retains 1,635 bytes across pages. Findings
are capped at 200,000 and `coverage.limitReached` reports a cap. Failed
decompression terminates that partition's optional scan and records its path.
No partial object or salvage bytes certify an MEP object.

`emitNativeMep` is disabled unless `includeExperimentalMep: true` is explicitly
supplied. It emits `IfcSystem`, candidate `IfcRelAssignsToGroup`,
`IfcRelServicesBuildings`, `IfcDistributionPort`, `IfcRelNests` and
`IfcRelConnectsPorts` when their source evidence and emitted products exist.
An actual emitted distribution-element class must own a port; an export override
to a proxy or another building element suppresses that endpoint's connection.
System descriptions identify experimental membership candidates. Port flow is
`.NOTDEFINED.` and no placement is invented.

## Supplied-model checks

The reproducible inventory is in
[`generated/native-mep-corpus-audit.json`](generated/native-mep-corpus-audit.json),
including model hashes. Timings include opening the container and schema.

| Model | Release | Native systems | Paired evidence | Inventory seconds |
| --- | --- | ---: | --- | ---: |
| RAC | 2025 | 1 | SVF electrical circuit 693257, circuit number `<unnamed>`: 1/1 id and name matches | 1.77 |
| School | 2025 | 0 | No nonempty system witness in this check | 1.25 |
| Snowdon | 2024 | 0 | Connector layout deliberately unsupported | 6.93 |
| UNBC | 2027 | 0 | Paired IFC contains zero systems, ports or port connections | 5.28 |

The RAC SVF circuit reports one element, but this inventory-only check does not
recover or score that membership. The supplied models do not establish
nonempty connector or membership parity. A paired MEP Revit/IFC example is
still required before enabling this export by default. A zero-system result
must not be reported as demonstrated MEP coverage.

Run metadata inventory with:

```sh
node --experimental-strip-types --import ./scripts/register-local-typescript.mjs scripts/audit-native-mep.ts /path/model.rvt
node --experimental-strip-types --import ./scripts/register-local-typescript.mjs scripts/audit-native-mep.ts --reference-svf /path/RAC-svf.zip /path/RAC.rvt
```

Focused tests cover arbitrary page splits, checksums, duplicate/conflicting
records, source isolation, circuit names, early/later connector indices,
unsupported releases, malformed/unknown endpoints, candidate export gating,
and web-ifc's independent reading of the emitted port/system relationships.

## Integration contract

The converter exposes optional `ConvertResult.nativeMep` with type
`NativeMepDecode` and invokes `scanContainerNativeMep(openedContainer,
elementBounds)` from `native-mep-container.ts` only when
`ConvertOptions.experimentalMep` is enabled.
This is a separate optional semantic scan, so ordinary conversions incur no
extra partition inflation. It should not be coupled to geometry recovery.

The IFC exporter calls `emitNativeMep` after all products exist, passing the STEP writer,
`ownerHistory`, `building`, `productByElement`, actual `entityByElement`, and
the existing `guid`/`quoted` helpers. Pass the explicit experimental export
option to `includeExperimentalMep`. The actual emitted class map includes
export overrides. Supported concrete category/type mappings belong to the
existing IFC class mapper, rather than this relationship helper. The CLI
`--experimental-mep` switch requests collection and, for IFC output, emission.
