/** Portable contract consumed by OpenIndoorMaps. Coordinates never identify a node. */
export type IndoorNode = {
  id: string;
  roomKey: string;
  levelId: number;
  building: string;
  surfaceId: string;
  pointFeet: [number, number, number];
  geographic: [number, number];
  kind: "arrival" | "junction" | "portal" | "stair";
};
export type IndoorEdge = {
  id: string;
  from: string;
  to: string;
  kind: "walk" | "door" | "opening" | "stairs" | "local-steps";
  lengthMetres: number;
  pointsFeet: [number, number, number][];
  roomKeys: string[];
  evidence: string;
  nativeElementId?: number;
  accessible: "unknown" | "yes" | "no";
  enabled: boolean;
  notes?: string;
};
export type IndoorRecord = {
  key: string;
  number: string;
  name: string;
  building: string;
  levelId: number;
  elevationFeet: number;
  elevationEvidence: string;
  surfaceId: string;
  circulation: boolean;
  stair: boolean;
  access: "public" | "staff" | "unknown";
  walkable: boolean;
  arrivalNodeId?: string;
  confidence: number;
  ringsFeet: [number, number][][];
  properties: Record<string, unknown>;
};
export type IndoorIssue = {
  id: string;
  code: string;
  severity: "info" | "review";
  message: string;
  roomKey?: string;
  nativeElementId?: number;
  levelId?: number;
};
export type IndoorDataset = {
  format: "reviter-indoor";
  version: 1;
  generator: "reviter/indoor-pipeline-1";
  source: { modelFileName: string; modelSha256: string; roomsSha256: string };
  alignment: {
    originFeet: [number, number, number];
    originGeographic: [number, number];
    projectionLatitude: number;
    rotationRadians: number;
    horizontalMetresPerFoot: number;
    verticalMetresPerFoot: number;
    rmsMetres: number;
    referenceCount: number;
  };
  floors: {
    id: string;
    name: string;
    levelIds: number[];
    elevationFeet: number;
  }[];
  nativeLevels: { id: number; name: string; elevationFeet: number }[];
  records: IndoorRecord[];
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  walls: {
    levelId: number;
    nativeElementId: number;
    ringsFeet: [number, number][][];
  }[];
  /** Native display geometry; it does not authorize a routing edge. Optional for older ZIPs. */
  doors?: {
    id: string;
    levelId: number;
    nativeElementId: number;
    pointFeet: [number, number];
    footprintFeet?: [number, number][];
    roomKeys: string[];
    state: "connected" | "unmatched" | "ambiguous";
  }[];
  issues: IndoorIssue[];
  report: {
    recordCount: number;
    routableArrivals: number;
    components: number;
    largestComponentArrivals: number;
    unmatchedDoors: number;
    cellSizeFeet: number;
    omittedSourceLabels: number;
  };
};
