# Browser-safe Revit `TransmissionData`

Reviter now decodes the optional CFB `TransmissionData` stream entirely in the
browser. This is semantic provenance, not a geometry source: it identifies
external resources the model expected when saved and can explain missing
keynote or classification data.

## Framing and safety contract

The exact stream is:

```text
uint32le UTF-16 code-unit count
count * 2 bytes of UTF-16LE XML
```

The reader requires the byte length to equal `4 + count * 2`, caps both code
units and reference records before allocation, uses fatal UTF-16 decoding, and
rejects DTD/entity declarations or unknown root content. It reads only the
known `TransmissionData` and `ExternalFileReference` fields.

`LastSavedAbsolutePath` is deliberately never returned. Directory components
are also stripped from `LastSavedPath` and `DesiredPath`; only filenames, path
types, saved/desired load states, reference type, and element identity enter
`ConvertResult` or the JSON report.

Implementation:

- `lib/reviter/transmission-data.ts`
- `tests/transmission-data.test.ts`

## Exact UNBC result

The supplied model has a version-5, non-transmitted manifest with two external
references:

| Element | Native Revit UniqueId | Type | Filename | Saved state | Desired state |
| ---: | --- | --- | --- | --- | --- |
| 86,291 | `7f70fb92-8b7f-42e5-9898-4667e717d385-00015113` | Keynote Table | `RevitKeynotes_RUS.txt` | Not Found | Loaded |
| 220,560 | `3f22db78-be78-43c8-a990-a912a66d70cd-00035d90` | Assembly Code Table | `UniformatClassifications.txt` | Not Found | Loaded |

Both element IDs join to the independently decoded
`Global/History` + `Global/ElemTable` native identity set. The converter emits
one redacted warning stating that two desired resources were missing, without
publishing a workstation path.

The stream coverage row is now `external-references / full`. The exact
2,628-byte stream contains 1,312 UTF-16 code units and no undecoded suffix.

## Boundary

This decoder does not fetch, upload, or infer the missing files. It cannot
manufacture keynotes, assembly codes, family regeneration, material
assignments, or geometry. It records why some classifications may be absent
and gives a future user-supplied resource workflow stable element/UniqueId join
keys while keeping the converter client-side.
