import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRevitTransmissionData,
} from "../lib/reviter/transmission-data.ts";

function framed(xml: string): Uint8Array {
  const data = new Uint8Array(4 + xml.length * 2);
  const view = new DataView(data.buffer);
  view.setUint32(0, xml.length, true);
  for (let index = 0; index < xml.length; index += 1) {
    view.setUint16(4 + index * 2, xml.charCodeAt(index), true);
  }
  return data;
}

const XML = `<?xml version="1.0"?>
<TransmissionData isTransmitted="false" userData="" version="5">
  <ExternalFileReference>
    <ElementId>86291</ElementId>
    <ExternalFileReferenceType>Keynote &amp; Table</ExternalFileReferenceType>
    <LastSavedPath>library\\RevitKeynotes_RUS.txt</LastSavedPath>
    <LastSavedAbsolutePath>C:\\private\\RevitKeynotes_RUS.txt</LastSavedAbsolutePath>
    <LastSavedPathType>Relative to Library Locations</LastSavedPathType>
    <LastSavedLoadState>Not Found</LastSavedLoadState>
    <DesiredPath>desired/RevitKeynotes_RUS.txt</DesiredPath>
    <DesiredPathType>Relative to Library Locations</DesiredPathType>
    <DesiredLoadState>Loaded</DesiredLoadState>
  </ExternalFileReference>
</TransmissionData>`;

test("decodes bounded TransmissionData without exposing absolute paths", () => {
  const result = parseRevitTransmissionData(framed(XML));
  assert.deepEqual(result, {
    version: 5,
    isTransmitted: false,
    references: [{
      elementId: 86291,
      referenceType: "Keynote & Table",
      lastSavedFileName: "RevitKeynotes_RUS.txt",
      lastSavedPathType: "Relative to Library Locations",
      lastSavedLoadState: "Not Found",
      desiredFileName: "RevitKeynotes_RUS.txt",
      desiredPathType: "Relative to Library Locations",
      desiredLoadState: "Loaded",
      missing: true,
    }],
    missingReferenceCount: 1,
    privateAbsolutePathsOmitted: true,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /C:\\\\private|LastSavedAbsolutePath/u,
  );
});

test("TransmissionData reader enforces framing, XML, and allocation bounds", () => {
  const valid = framed(XML);
  assert.equal(
    parseRevitTransmissionData(valid, { maxCodeUnits: XML.length - 1 }),
    undefined,
  );
  assert.equal(
    parseRevitTransmissionData(valid, { maxReferences: 0 }),
    undefined,
  );

  const overlong = new Uint8Array(valid.length + 2);
  overlong.set(valid);
  assert.equal(parseRevitTransmissionData(overlong), undefined);

  const withDoctype = framed(
    XML.replace(
      '<?xml version="1.0"?>',
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY secret "value">]>',
    ),
  );
  assert.equal(parseRevitTransmissionData(withDoctype), undefined);

  const nestedUnknown = framed(
    XML.replace(
      "</TransmissionData>",
      "<Unsupported>value</Unsupported></TransmissionData>",
    ),
  );
  assert.equal(parseRevitTransmissionData(nestedUnknown), undefined);
});
