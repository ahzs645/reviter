interface NativeJstsCollection {
  toArray(): unknown[];
  size(): number;
}
declare module "jsts/org/locationtech/jts/io/GeoJSONReader.js" {
  export default class GeoJSONReader {
    read(json: unknown): unknown;
  }
}
declare module "jsts/org/locationtech/jts/io/GeoJSONWriter.js" {
  export default class GeoJSONWriter {
    write(geometry: unknown): unknown;
  }
}
declare module "jsts/org/locationtech/jts/geom/PrecisionModel.js" {
  export default class PrecisionModel {
    constructor(scale: number);
  }
}
declare module "jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js" {
  export default class GeometryNoder {
    constructor(precision: unknown);
    setValidate(enabled: boolean): void;
    node(inputs: unknown): NativeJstsCollection;
  }
}
declare module "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js" {
  export default class Polygonizer {
    add(inputs: unknown): void;
    getPolygons(): NativeJstsCollection;
    getDangles(): NativeJstsCollection;
    getCutEdges(): NativeJstsCollection;
  }
}
declare module "jsts/java/util/ArrayList.js" {
  export default class ArrayList {
    add(value: unknown): void;
  }
}
declare module "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js" {
  export default class BufferParameters {
    static JOIN_MITRE: number;
    setJoinStyle(style: number): void;
  }
}
declare module "jsts/org/locationtech/jts/operation/buffer/BufferOp.js" {
  export default class BufferOp {
    static bufferOp(
      geometry: unknown,
      distance: number,
      parameters: unknown,
    ): unknown;
  }
}
declare module "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js" {
  export default class OverlayOp {
    static difference(a: unknown, b: unknown): unknown;
    static intersection(a: unknown, b: unknown): unknown;
  }
}
