import { prepareIndoorDataset, sha256Bytes } from "./indoor-pipeline.ts";
import { makeGlb } from "./export-glb.ts";
import type { ConvertResult } from "./types.ts";
import type { RoomDirectoryData } from "./room-directory.ts";
const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          model: ConvertResult;
          rooms: RoomDirectoryData;
          source: Uint8Array;
        }>,
      ) => Promise<void>)
    | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = async (event) => {
  try {
    const { model, rooms, source } = event.data;
    const indoor = await prepareIndoorDataset(
      model,
      rooms,
      await sha256Bytes(source),
      (message) => scope.postMessage({ type: "progress", message }),
    );
    scope.postMessage({
      type: "progress",
      message: "Preparing the georeferenced 3D scene…",
    });
    const scene = new Uint8Array(makeGlb(model));
    scope.postMessage({ type: "complete", indoor, scene }, [scene.buffer]);
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
