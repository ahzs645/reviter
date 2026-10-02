import test from "node:test";
import assert from "node:assert/strict";
import {parseRoomDirectory} from "../lib/reviter/room-directory.ts";
import {validateVisitorMetadata} from "../lib/reviter/visitor-metadata.ts";

test("curated visitor metadata is validated and retained separately from native room identity", () => {
  const data = {format: "reviter-room-annotations", version: 1, coordinateSystem: "revit-model-feet", model: {fileName: "test.rvt"},
    annotations: [{key: "room", building: "01", number: "01-101", name: "Original", levelId: 1, polygonFeet: [[0,0],[10,0],[10,10],[0,10]], labelPointFeet: [5,5], confidence: 1}],
    visitorMetadata: {version: 1, buildings: {"01": {name: "Library", shortName: "LIB"}}, places: {room: {displayName: "Reading Room", category: "study", color: "#b8d5a5", landmark: true}}}};
  const parsed = parseRoomDirectory(JSON.stringify(data));
  assert.equal(parsed.annotations[0]!.name, "Original");
  assert.deepEqual(parsed.visitorMetadata, data.visitorMetadata);
  assert.throws(() => parseRoomDirectory(JSON.stringify({...data, visitorMetadata: {...data.visitorMetadata, places: {missing: {displayName: "Missing"}}}})), /Invalid visitor place/);
  assert.throws(() => validateVisitorMetadata({version:1,buildings:{},places:{room:{color:"url(secret)"}}}, [{key:"room",building:"01"}]), /Invalid visitor place/);
});
