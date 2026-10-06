import { convert } from './core/convert';
import { EncodingError } from './core/encoding';
import type { ConvertResult, ProgressEvent } from './core/types';

export type WorkerRequest = { type: 'convert'; file: File; encodingOverride?: string };
export type WorkerResponse =
  | ({ type: 'progress' } & ProgressEvent)
  | { type: 'done'; result: ConvertResult }
  | { type: 'error'; message: string; technical: string };

const ctx = self as unknown as {
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

ctx.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'convert') return;
  try {
    const bytes = new Uint8Array(await msg.file.arrayBuffer());
    const result = await convert(
      { name: msg.file.name, bytes },
      { encodingOverride: msg.encodingOverride ?? 'auto' },
      (p) => ctx.postMessage({ type: 'progress', stage: p.stage, percent: p.percent }),
    );
    if (result.ok) {
      const wb = result.workbook;
      ctx.postMessage({ type: 'done', result }, [wb.buffer as ArrayBuffer]);
    } else {
      ctx.postMessage({ type: 'done', result });
    }
  } catch (err) {
    // Only the error message goes back; never file contents.
    const technical = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const message =
      err instanceof EncodingError
        ? err.friendly
        : err instanceof RangeError
          ? 'This file is too large for this browser to convert. Try a different browser (for example Chrome or Firefox) on a computer with more memory.'
          : 'Something went wrong while converting this file, so the workbook was not created.';
    ctx.postMessage({ type: 'error', message, technical });
  }
};
