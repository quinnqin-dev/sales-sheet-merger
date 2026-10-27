import type { Operations } from "./operations.ts";
import { LocalizedError } from "./i18n-core.ts";

let worker: Worker | undefined,
  sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: never) => void; reject: (error: unknown) => void }
>();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./processing.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error)
      request.reject(new LocalizedError(data.error.code, data.error.params));
    else request.resolve(data.value as never);
  });
  worker.addEventListener("error", () => {
    for (const p of pending.values())
      p.reject(new LocalizedError("browser.workerError"));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  });
  return worker;
}
export function local<K extends keyof Operations>(
  operation: K,
  payload: Parameters<Operations[K]>[0],
): Promise<Awaited<ReturnType<Operations[K]>>> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    getWorker().postMessage({ id, operation, payload });
  });
}
let locked: Promise<void> | undefined;
export function acquireWorkspace() {
  return (locked ??= new Promise<void>((resolve, reject) => {
    if (!navigator.locks) {
      reject(new LocalizedError("browser.locksUnsupported"));
      return;
    }
    void navigator.locks
      .request(
        "sheet-merger-workspace",
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            reject(new LocalizedError("browser.otherTab"));
            return;
          }
          resolve();
          // A single writer per origin prevents other tabs overwriting this batch.
          await new Promise<void>(() => {});
        },
      )
      .catch(() => reject(new LocalizedError("browser.storageError")));
  }));
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function downloadResult(id: string) {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  let handle: FileSystemFileHandle | undefined;
  try {
    // Open synchronously from the click, before the worker round trip.
    if (picker)
      handle = await picker.call(window, {
        suggestedName: `sheets-merged-${new Date().toISOString().slice(0, 10)}.xlsx`,
        types: [
          {
            description: "Excel workbook",
            accept: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                [".xlsx"],
            },
          },
        ],
      });
    const { blob, name } = await local("exportJob", { id });
    if (!handle) {
      downloadBlob(blob, name);
      return;
    }
    const writer = await handle.createWritable();
    try {
      await writer.write(blob);
      await writer.close();
    } catch (e) {
      await writer.abort().catch(() => {});
      throw e;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (e instanceof LocalizedError) throw e;
    throw new LocalizedError("browser.downloadError");
  }
}
