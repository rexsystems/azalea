import type { BatchEvent, BatchStatus } from "./api";

export interface BatchResult {
  status: BatchStatus;
  output: { text: string; stderr: boolean }[];
  exitCode: number | null;
  error: string | null;
}

export function applyBatchEvent(
  results: Record<string, BatchResult>,
  event: BatchEvent,
): Record<string, BatchResult> {
  const previous = results[event.host_id];
  if (!previous) return results;
  let next = previous;
  if (event.kind === "started" && previous.status === "queued")
    next = { ...previous, status: "running" };
  if (event.kind === "output") {
    const output = [...previous.output];
    const last = output[output.length - 1];
    if (last && last.stderr === event.stderr && last.text.length < 16384) {
      output[output.length - 1] = { ...last, text: last.text + event.text };
    } else output.push({ text: event.text, stderr: event.stderr });
    next = { ...previous, output };
  }
  if (event.kind === "finished")
    next = { ...previous, status: event.status, exitCode: event.exit_code, error: event.error };
  return { ...results, [event.host_id]: next };
}

export const batchStatusLabel: Record<BatchStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timed_out: "Timed out",
  cancelled: "Cancelled",
};
