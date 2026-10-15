import { readNativeDrawingEvidence, readNativeSourceEvidence, type NativeEvidenceReport, type NativeEvidenceOptions, type NativeDrawingReadOptions } from "./native-evidence-reader.ts";
import type { WorkerEnvelope, WorkerRequestEnvelope } from "./worker-client.ts";
export type NativeEvidenceRequest = WorkerRequestEnvelope & { type: "inspect"; bytes: ArrayBuffer; options?: NativeEvidenceOptions; drawingViewId?: string; drawingOptions?: NativeDrawingReadOptions };
const context = self as unknown as { onmessage: (event: MessageEvent<NativeEvidenceRequest>) => void; postMessage: (reply: WorkerEnvelope<NativeEvidenceReport>) => void };
context.onmessage = async ({ data }) => {
  try {
    const bytes = new Uint8Array(data.bytes);
    const result = data.drawingViewId === undefined ? await readNativeSourceEvidence(bytes, data.options) : await readNativeDrawingEvidence(bytes, data.drawingViewId, undefined, data.drawingOptions);
    context.postMessage({ id: data.id, type: "result", result });
  } catch (error) {
    context.postMessage({ id: data.id, type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
