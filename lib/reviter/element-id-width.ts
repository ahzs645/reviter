/**
 * How many bytes an element id takes in the file being converted.
 *
 * Revit widened `ElementId` from 32 to 64 bits in 2024, and the file's own
 * `Formats/Latest` says which it writes: the inline class `Identifier` holds
 * one field, `m_id` declared `int32` in the 2019 to 2023 schemas, and
 * `m_id64` declared `int64` from 2024 (checked on Autodesk's 2019, 2022 and
 * 2023 RAC samples and on the 2024, 2025 and 2027 projects here). Everything
 * that stores an element id follows it, starting with the frame every
 * partition object is written in:
 *
 * ```text
 * 2024 on:  [u64 element id][u32 discriminator][u32 length][u16 class] ... [u32 length]
 * 2023:     [u32 element id][u32 discriminator][u32 length][u16 class] ... [u32 length]
 * ```
 *
 * In both, the length counts the bytes from the class index to the echo, so
 * the echo sits `length` bytes after the class and the next frame four bytes
 * after that. Measured on the 2023 RAC sample: of the 11,841 frames headed by
 * that schema's `GElement` whose length word reads in range, 11,841 echo at
 * class + length (none at any other offset), and 11,837 repeat the frame's id
 * as their first field, as the 2025 sample's same elements do at +8.
 *
 * The width is read from the schema, not inferred from the release number,
 * so a file saved by a release this project has never seen still frames by
 * what its schema declares. Like the class-tag translation in
 * `revit-class-tags.ts`, it is module state installed by the container stage
 * for the length of one synchronous conversion and cleared afterwards; the
 * default is the 64-bit layout every decoder was first written for, so a
 * conversion that never reads a schema, and every test fixture, behave as
 * before.
 */

export type ElementIdBytes = 4 | 8;

let active: ElementIdBytes = 8;

/** Install the width for the conversion about to run; `null` restores 8 bytes. */
export function setActiveElementIdBytes(bytes: ElementIdBytes | null): void {
  active = bytes ?? 8;
}

/** Bytes per element id in the current file: 4 through Revit 2023, 8 from 2024. */
export function activeElementIdBytes(): ElementIdBytes {
  return active;
}

/** Whether the current file writes 32-bit element ids. */
export function narrowElementIds(): boolean {
  return active === 4;
}

/**
 * Bytes in front of a partition object's class index: the id, the
 * discriminator and the length. 16 from 2024, 12 through 2023.
 */
export function frameHeaderBytes(): 12 | 16 {
  return active === 4 ? 12 : 16;
}

type SchemaClassLike = {
  name: string;
  properties?: ReadonlyArray<{ name: string; variant?: { kind?: string } }>;
};

/**
 * The id width a schema declares, from `Identifier`'s single field, or `null`
 * when the schema does not say (no `Identifier`, or a field of another kind),
 * in which case the caller keeps the default.
 */
export function elementIdBytesFromSchema(
  classes: ReadonlyArray<SchemaClassLike>,
): ElementIdBytes | null {
  const identifier = classes.find((entry) => entry.name === "Identifier");
  const field = identifier?.properties?.length === 1 ? identifier.properties[0] : undefined;
  switch (field?.variant?.kind) {
    case "int32":
      return 4;
    case "int64":
      return 8;
    default:
      return null;
  }
}
