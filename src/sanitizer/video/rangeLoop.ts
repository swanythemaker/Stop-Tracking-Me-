type ReadRequest = { offset: number; len: number };

type RangeJob = {
  nextRead(): ReadRequest | undefined;
  feed(offset: number, bytes: Uint8Array): void;
};

export async function runRangeLoop(
  job: RangeJob,
  blob: Blob,
  signal?: AbortSignal,
  onBytes?: (done: number) => void,
): Promise<void> {
  let done = 0;
  for (;;) {
    if (signal?.aborted) throw new Error("Cancelled.");
    const req = job.nextRead();
    if (!req) return;
    const end = Math.min(blob.size, req.offset + req.len);
    const buffer = await blob.slice(req.offset, end).arrayBuffer();
    job.feed(req.offset, new Uint8Array(buffer));
    done += buffer.byteLength;
    onBytes?.(done);
  }
}
