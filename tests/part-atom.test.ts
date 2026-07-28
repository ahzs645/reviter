import assert from "node:assert/strict";
import test from "node:test";

import { parsePartAtomXml, partAtomMetadataFromSummary } from "../lib/reviter/part-atom.ts";

test("keeps useful PartAtom family metadata and drops its raw XML", () => {
  assert.deepEqual(
    partAtomMetadataFromSummary({
      partatom: {
        title: "HDW-2BN",
        updated: "2017-08-28T11:02:13Z",
        categories: [{ term: "Specialty Equipment" }],
        taxonomies: [{ term: "adsk:revit", label: "Autodesk Revit" }],
        raw_xml: "<entry>an unbounded duplicate that must not cross the worker boundary</entry>",
      },
    }),
    {
      title: "HDW-2BN",
      updated: "2017-08-28T11:02:13Z",
      categories: [{ term: "Specialty Equipment" }],
      taxonomies: [{ term: "adsk:revit", label: "Autodesk Revit" }],
      links: [],
      types: [],
    },
  );
});

test("declines an absent or empty PartAtom summary", () => {
  assert.equal(partAtomMetadataFromSummary({}), undefined);
  assert.equal(partAtomMetadataFromSummary({ partatom: { raw_xml: "<entry />" } }), undefined);
});

test("parses family types and parameters from PartAtom XML in a worker-safe way", () => {
  const result = parsePartAtomXml(`
    <entry xmlns="http://www.w3.org/2005/Atom" xmlns:A="urn:schemas-autodesk-com:partatom">
      <title>Drawer &amp; Warmer</title>
      <id>urn:family:drawer-warmer</id>
      <updated>2017-08-28T11:02:13Z</updated>
      <category><term>Specialty Equipment</term><scheme>adsk:revit:grouping</scheme></category>
      <A:taxonomy><term>adsk:revit</term><label>Autodesk Revit</label></A:taxonomy>
      <link rel="design-2d" type="application/rfa" href=".">
        <A:design-file>
          <A:title>drawer.rfa</A:title>
          <A:product>Revit</A:product>
          <A:product-version>2014</A:product-version>
          <A:updated>2017-08-28T11:02:13Z</A:updated>
        </A:design-file>
      </link>
      <A:family type="user">
        <A:variationCount>1</A:variationCount>
        <A:part type="user">
          <title>HDW-2BN</title>
          <Width type="custom" typeOfParameter="Length">1' - 8 19/32"</Width>
          <Watts displayName="Power" type="shared" id="abc" typeOfParameter="Wattage" units="W">900 W</Watts>
        </A:part>
      </A:family>
    </entry>
  `);
  assert.equal(result?.entryTitle, "Drawer & Warmer");
  assert.equal(result?.id, "urn:family:drawer-warmer");
  assert.equal(result?.title, "HDW-2BN");
  assert.equal(result?.familyType, "user");
  assert.equal(result?.variationCount, 1);
  assert.deepEqual(result?.categories, [{
    term: "Specialty Equipment",
    scheme: "adsk:revit:grouping",
  }]);
  assert.deepEqual(result?.links[0], {
    rel: "design-2d",
    type: "application/rfa",
    href: ".",
    files: [{
      title: "drawer.rfa",
      product: "Revit",
      productVersion: 2014,
      updated: "2017-08-28T11:02:13Z",
    }],
  });
  assert.deepEqual(result?.types[0]?.parameters[1], {
    name: "Watts",
    displayName: "Power",
    sourceType: "shared",
    id: "abc",
    parameterType: "Wattage",
    units: "W",
    value: "900 W",
  });
});
