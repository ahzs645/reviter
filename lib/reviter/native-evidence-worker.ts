import { readNativeSourceEvidence, type NativeEvidenceReport, type NativeEvidenceOptions } from "./native-evidence-reader.ts";
import type { WorkerEnvelope, WorkerRequestEnvelope } from "./worker-client.ts";
export type NativeEvidenceRequest = WorkerRequestEnvelope & { type: "inspect"; bytes: ArrayBuffer; options?: NativeEvidenceOptions };
const context = self as unknown as { onmessage: (event: MessageEvent<NativeEvidenceRequest>) => void; postMessage: (reply: WorkerEnvelope<NativeEvidenceReport>) => void };
context.onmessage = async ({ data }) => {
  try {
    const result = await readNativeSourceEvidence(new Uint8Array(data.bytes), data.options);
    context.postMessage({ id: data.id, type: "result", result });
  } catch (error) {
    context.postMessage({ id: data.id, type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
