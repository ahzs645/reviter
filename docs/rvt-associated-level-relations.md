# Persisted Revit associated-level relationships

Reviter now decodes `Element.m_assocLevelId` as a separate, typed spatial
relationship. It does not relabel the field as element ownership or use it to
overwrite the persisted `Global/ElemTable.OwningElementId` and
`InsertableInst.m_hostId` graphs.

## Reader identity

Two independent artifacts in the supplied Revit 2027 reader establish the
field:

- the embedded `Formats/Latest` schema lists `m_assocLevelId` in the `Element`
  base fields immediately after the document and element-id fields;
- the native API exports `OdBmElement::getAssocLevelId()`, backed by
  `OdBmElementInternalImpl::getAssocLevelId()`.

The browser decoder does not execute or ship the native reader. Those symbols
and the schema establish field identity; Reviter implements its own
length-delimited binary read.

## Browser-safe resolution

Every candidate must satisfy all of these checks:

1. the partition object has a zero high word on its element id;
2. its body length is in the framed-object range;
3. the trailer echoes that exact body length;
4. the candidate is a complete 64-bit element id at one of the Revit 2027
   versioned base-object offsets `+64`, `+66`, `+68`, `+70`, or `+72`;
5. the target resolves, in a separate whole-file pass, to a framed object with
   the Revit 2027 Level marker `0x0a19`;
6. all resolving candidates for a source agree on one target.

The second pass is required because a source and its Level can be in different
compressed chunks. Conflicts fail closed. The runtime does not consult IFC,
element names, elevations, adjacency, or geometry.

## Exact UNBC validation

Against the supplied UNBC project, the RVT-only decoder finds:

- 37,503 unique element-to-Level relations;
- zero sources with conflicting Level targets;
- 13 Level targets used by IFC-contained building elements;
- 11,703 IFC-contained numeric Revit tags on the same storey;
- zero storey mismatches;
- 117 IFC-contained tags with no persisted associated-level relation.

The IFC is a validation oracle only. It is not needed by conversion and does
not supply Level ids to the decoder.

The five field layouts contribute 133, 27,584, 293, 9,425, and 71 scanned
candidates respectively before repeated copies are collapsed. Nearby byte
windows do not become relations unless their target independently resolves to
the framed Level class.
