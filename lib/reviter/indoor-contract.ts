/** Portable contract consumed by OpenIndoorMaps. Coordinates never identify a node. */
export type IndoorNode = {
  id: string;
  roomKey: string;
  levelId: number;
  building: string;
  surfaceId: string;
  pointFeet: [number, number, number];
  geographic: [number, number];
  kind: "arrival" | "junction" | "portal" | "stair" | "connector";
};
export type IndoorEdge = {
  id: string;
  from: string;
  to: string;
  kind:
    | "walk"
    | "door"
    | "opening"
    | "stairs"
    | "local-steps"
    | "elevator"
    | "escalator"
    | "ramp";
  lengthMetres: number;
  pointsFeet: [number, number, number][];
  roomKeys: string[];
  evidence: string;
  nativeElementId?: number;
  /** Walking branch rebuilt inside this model-bound native circulation cell. */
  nativeCellId?: string;
  accessible: "unknown" | "yes" | "no";
  enabled: boolean;
  notes?: string;
  /** Omitted means bidirectional, preserving older prepared projects. */
  direction?: "both" | "from-to" | "to-from";
  connectorId?: string;
  /** Model-bound tangent crossing centres for a proved doorless circulation
   * seam. Actual angled body crossing must fit the complete native/source
   * checked aperture; no accessibility or ordinary-door widening is inferred. */
  openingSpan?: {
    version: 1;
    sourceModelSha256: string;
    levelId: number;
    pointsFeet: [[number, number, number], [number, number, number]];
    nativeFloorElementIds: number[];
    walkingStripWidthFeet: number;
    apertureFeet: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
  };
  /** Fixed registered drawing doorway, never a fabricated native Revit door.
   * Source leaf/swing/jamb primitives independently identify the aperture;
   * same-height native floor and obstacle checks justify its actual crossing. */
  sourceDoorProof?: {
    version: 1;
    sourceModelSha256: string;
    sourceSha256: string;
    sectionId: string;
    registrationErrorFeet: number;
    levelId: number;
    elevationFeet: number;
    nativeFloorElementIds: number[];
    wallSegmentIndices: number[];
    doorSymbolSegmentIndices: number[];
    doorSymbolCollection: "wallSegments";
    apertureFeet: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    walkingStripWidthFeet: number;
  };
  routingQuality?: {
    turnCount: number;
    estimatedRasterClearanceFeet: number;
    clearanceCertified: false;
  };
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
  /** Exact same-model horizontal walking slabs, retaining every profile hole. */
  walkingSupport?: {
    version: 1;
    sourceModelSha256: string;
    floors: {
      nativeElementId: number;
      elevationFeet: number;
      ringsFeet: [number, number][][];
    }[];
  };
  /** Model-derived walking cells. Room records retain semantic/source identities. */
  circulationGeometry?: {
    version: 1;
    sourceModelSha256: string;
    sourceGeometryKey: string;
    /** All source circulation identities assessed on supported native floors. */
    preparedRoomKeys?: string[];
    /** Unclassified source claims clipped to physical floor and obstacles. */
    reviewSurfaces?: {
      roomKey: string;
      levelId: number;
      elevationFeet: number;
      ringsFeet: [number, number][][];
    }[];
    /** Exact low slab tops used as solid fixture blocks in 2D/3D. */
    fixtures?: {
      id: string;
      nativeElementId: number;
      levelIds: number[];
      elevationFeet: number;
      heightFeet: number;
      ringsFeet: [number, number][][];
    }[];
    cells: {
      id: string;
      levelIds: number[];
      elevationFeet: number;
      roomKeys: string[];
      nativeFloorIds: number[];
      ringsFeet: [number, number][][];
      /** Separate native shells with their own nested holes. */
      partsFeet?: [number, number][][][];
      sourceCoverage: number;
    }[];
  };
  records: IndoorRecord[];
  nodes: IndoorNode[];
  edges: IndoorEdge[];
  walls: {
    kind?: "wall" | "column";
    /** Bounding envelope rather than a verified native wall face. Display only. */
    approximate?: boolean;
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
    /** Unit native traversal direction; host depth is not doorway width. */
    normalFeet?: [number, number];
    roomKeys: string[];
    state: "connected" | "unmatched" | "ambiguous";
  }[];
  /** Prepared visual geometry. It never authorizes a graph edge or replaces source routing polygons. */
  presentation?: {
    version: 1;
    generator:
      | "reviter/native-room-presentation-1"
      | "reviter/native-room-presentation-2";
    sourceModelSha256: string;
    junctionToleranceFeet: number;
    rooms: {
      roomKey: string;
      levelId: number;
      sourceGeometryKey: string;
      interiorRingsFeet: [number, number][][];
      blockPartsFeet: [number, number][][][];
      boundarySource:
        | "native-wall-enclosure"
        | "revit-finish-face"
        | "registered-source-wall-enclosure"
        | "source-backed-native-wall-enclosure";
      sourceProof?: {
        sourceSha256: string;
        sectionId: string;
        registrationErrorFeet: number;
        wallSegmentIndices: number[];
        doorSegmentIndices: number[];
        nativeFloorCoveredSquareFeet: number;
        jointRepairs?: {
          nativeWallElementId: number;
          supportingElementId: number;
          gapFeet: number;
          toleranceFeet: number;
          wallSegmentIndices: [number, number];
        }[];
      };
      boundaryEvidence?: string;
      boundaryElementIds: number[];
      sourceCoverage: number;
      cellCoverage: number;
    }[];
    diagnostics: {
      roomKey: string;
      levelId: number;
      code: string;
      message: string;
    }[];
  };
  /** Native tread projections for display and selection only, including curved flights.
   * The source room boundary and navigation graph remain authoritative for routing. */
  stairDisplay?: {
    version: 1;
    generator: "reviter/native-stair-display-1";
    sourceModelSha256: string;
    flights: {
      roomKey: string;
      levelId: number;
      floorElevationFeet: number;
      sourceGeometryKey: string;
      stairElementId: number;
      displayOnly?: true;
      /** Actual native solid slab faces near this flight. Holes remain openings. */
      floorOccluders?: {
        nativeElementId: number;
        elevationFeet: number;
        ringsFeet: [number, number][][];
      }[];
      treads: {
        runElementId: number;
        elevationFeet: number;
        /** Native tread thickness; older packages use a 50 mm display tread. */
        thicknessFeet?: number;
        ringFeet: [number, number][];
      }[];
    }[];
  };
  /** Exact owner-tagged native ramp walking faces. Display does not establish adjacency. */
  rampDisplay?: {
    version: 1;
    sourceModelSha256: string;
    ramps: {
      edgeId: string;
      nativeElementId: number;
      levelIds: number[];
      anchorPointFeet: [number, number, number];
      trianglesFeet: [number, number, number][][];
    }[];
  };
  connectors?: {
    id: string;
    kind: "elevator" | "escalator";
    nativeElementId: number;
    reviewedShaft?: {
      pinId: string;
      pointFeet: [number, number];
      wallElementIds: number[];
    };
    sourceModelSha256: string;
    evidence: string;
    accessible: "yes" | "no" | "unknown";
    direction: "both" | "from-to" | "to-from";
    entrances: { nodeId: string; roomKey: string; levelId: number }[];
  }[];
  visitor?: {
    version: 1;
    buildings: Record<string, { name: string; shortName?: string }>;
    places: Record<
      string,
      {
        displayName?: string;
        description?: string;
        category?:
          | "study"
          | "food"
          | "washroom"
          | "department"
          | "entrance"
          | "other";
        department?: string;
        color?: string;
        landmark?: boolean;
      }
    >;
  };
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
