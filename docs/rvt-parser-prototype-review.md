# Isolated `rvt-parser` prototype review

The isolated folder includes a 14-file TypeScript exploration project in
`rvt-parser/src`. It is useful evidence, but it is not itself a client-side RVT
converter: every entrypoint depends on Node `fs`, `Buffer`, or `zlib`, several
commands write analysis files, and the record index accepts false positives.
Reviter therefore ports corroborated format concepts to browser-safe readers
instead of copying the prototype wholesale.

## Exact UNBC test

The prototype was run read-only against:

`UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`

Its CFB reader correctly enumerated the 14 non-directory streams, including
`Partitions/325`, both `Formats/Latest` streams, `Global/ElemTable`,
`Global/History`, `BasicFileInfo`, and the zipped `ProjectInformation`.

Its gzip scanner decoded 3,332 partition chunks and 383,905,134 bytes. Reviter's
window-aware reader decodes 3,666 chunks and 421,867,755 bytes from the same
stream: the prototype drops 334 chunks and 37,962,621 bytes, about 9.0% of the
inflated partition. The cause is structural: `gz.ts` inflates every gzip-looking
offset independently, while Revit chunks can reference the preceding 32 KiB
deflate window. Reviter carries that window, validates headers, and salvages a
strict prefix when a chunk desynchronizes.

The prototype's `index.ts` then proposed 99,335 records, including an element id
of 16,677,358,010,367. The exact file's persisted element range is below
2.5 million, and Reviter finds 174,785 objects through the object's echoed
length framing. The prototype's `0x0604` anchor is therefore useful as an
exploratory locator only; it cannot be a production ownership or geometry
boundary.

## Per-file disposition

| Prototype file | Useful concept | Reviter disposition |
| --- | --- | --- |
| `cfb.ts` | OLE/CFB FAT, mini-FAT, directory, and stream chains | Concept retained through the browser-compatible `cfb` package; path and bounds checks are stricter |
| `cli.ts` | Separate list, dump, decode, and hex workflows | Kept as offline diagnostic concepts; file-writing commands are not shipped to the browser |
| `gz.ts` | Locate gzip members and decode a ZIP local member | ZIP concept retained; independent gzip inflation rejected in favor of prior-window-aware decoding |
| `wins.ts` | Find preview image signatures and BasicFileInfo strings | Preview/release concepts retained in bounded decoders; raw signature copying is not a geometry path |
| `u16strings.ts` | Locate UTF-16 text during exploration | Useful probe only; production names require a framed owner and field identity |
| `analyze.ts` | Search for strides, walks, and printable strings | Retained as an analysis technique, never as runtime evidence |
| `records.ts` | Compare possible record-size conventions | Retained as a negative-control technique |
| `walkall.ts` | Measure how far one proposed framing walks | Retained as an audit technique; not a decoder |
| `resume.ts` | Search after an invalid span for a plausible next record | Superseded by validated chunk salvage and object length echoes |
| `index.ts` | Build a searchable candidate record index | Rejected for production: false ids and incomplete coverage on the exact RVT |
| `segmap.ts` | Visualize candidate coverage and holes | Useful offline audit only |
| `findstr.ts` | Attribute a string hit to a candidate record | Kept only when the enclosing record has independent framing |
| `hexpayload.ts` | Inspect payloads grouped by a proposed class | Useful offline probe only |
| `debug.ts` | Print CFB internals | Superseded by bounded container coverage reports |

## What was actually brought over

The portable value is the staged workflow:

1. enumerate CFB streams;
2. decode each stream according to its own container;
3. preserve partition chunk state;
4. locate candidates;
5. require independent framing, ownership, and release gates before exporting
   semantics or geometry.

That workflow now exists in client-side TypeScript and Web Platform primitives.
The prototype supplied useful hypotheses for CFB, ZIP, preview, UTF-16, and
record exploration. It did not supply the missing Revit object graph, family
regenerator, BRep kernel, or tessellator.
