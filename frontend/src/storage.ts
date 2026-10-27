import { openDB, type DBSchema } from "idb";
import type {
  Library,
  Workspace,
  StoredFile,
  StoredJob,
  StoredRow,
} from "./domain.ts";
import { emptyLibrary } from "./validation.ts";
import { LocalizedError } from "./i18n-core.ts";

interface MergerDB extends DBSchema {
  settings: { key: string; value: Library | Workspace };
  files: { key: string; value: StoredFile; indexes: { batch: string } };
  jobs: { key: string; value: StoredJob; indexes: { batch: string } };
  rows: {
    key: [string, number];
    value: StoredRow;
    indexes: { kind: [string, string]; duplicate: [string, number] };
  };
}
let connection: ReturnType<typeof openDB<MergerDB>> | undefined;
export const database = () =>
  (connection ??= openDB<MergerDB>("sheet-merger", 1, {
    upgrade(db) {
      db.createObjectStore("settings");
      db.createObjectStore("files", { keyPath: "id" }).createIndex(
        "batch",
        "batchId",
      );
      db.createObjectStore("jobs", { keyPath: "id" }).createIndex(
        "batch",
        "batchId",
      );
      const rows = db.createObjectStore("rows", {
        keyPath: ["jobId", "index"],
      });
      rows.createIndex("kind", ["jobId", "kind"]);
      rows.createIndex("duplicate", ["jobId", "duplicate"]);
    },
    blocking() {
      void connection?.then((db) => db.close());
    },
  }));
export async function getLibrary() {
  return (
    ((await (await database()).get("settings", "library")) as
      Library | undefined) ?? emptyLibrary()
  );
}
export async function putLibrary(lib: Library) {
  await (await database()).put("settings", lib, "library");
  return lib;
}
export async function saveWorkspace(state: Workspace) {
  const db = await database();
  const tx = db.transaction("settings", "readwrite");
  const current = (await tx.store.get("workspace")) as Workspace | undefined;
  // A delayed UI autosave cannot recreate a cleared/replaced batch.
  if (current?.batch !== state.batch) {
    await tx.done;
    return;
  }
  await tx.store.put(state, "workspace");
  await tx.done;
}
export const emptyWorkspace = (batch = ""): Workspace => ({
  batch,
  files: [],
  assignments: {},
  step: 1,
  selectedTemplateId: null,
  preview: [],
  job: null,
});
export async function clearData(all: boolean, batch = "") {
  const db = await database();
  const tx = db.transaction(["settings", "files", "jobs", "rows"], "readwrite");
  await Promise.all([
    tx.objectStore("files").clear(),
    tx.objectStore("jobs").clear(),
    tx.objectStore("rows").clear(),
  ]);
  if (all) await tx.objectStore("settings").clear();
  await tx.objectStore("settings").put(emptyWorkspace(batch), "workspace");
  await tx.done;
}
export const storageError = (error: unknown) =>
  error instanceof LocalizedError
    ? error
    : new LocalizedError(
        error instanceof DOMException && error.name === "QuotaExceededError"
          ? "browser.quota"
          : "browser.storageError",
      );
export async function restore() {
  const db = await database();
  const workspace =
    ((await db.get("settings", "workspace")) as Workspace | undefined) ??
    emptyWorkspace();
  if (!(await db.get("settings", "workspace")))
    await db.put("settings", workspace, "workspace");
  if (workspace.batch) {
    const files = await db.getAllFromIndex("files", "batch", workspace.batch);
    const order = new Map(workspace.files.map((f, i) => [f.id, i]));
    workspace.files = files
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
      .map((f) => f.meta);
    const jobs = await db.getAllFromIndex("jobs", "batch", workspace.batch);
    for (const job of jobs) {
      if (job.status === "running") {
        job.status = "interrupted";
        job.error_code = "browser.interrupted";
        job.output = undefined;
        await db.put("jobs", job);
      }
    }
    const latest = jobs.find((job) => job.id === workspace.job?.id);
    if (latest) {
      const { output: _, ...job } = latest;
      workspace.job = job;
      workspace.step = 5;
    } else workspace.job = null;
  }
  return { library: await getLibrary(), workspace };
}
export async function putRows(rows: StoredRow[]) {
  const tx = (await database()).transaction("rows", "readwrite");
  await Promise.all(rows.map((r) => tx.store.put(r)));
  await tx.done;
}
export async function getRows(
  id: string,
  kind: string,
  page: number,
  duplicates: boolean,
) {
  if (
    !["valid", "issues"].includes(kind) ||
    !Number.isInteger(page) ||
    page < 1
  )
    throw new LocalizedError("invalid_pagination");
  const db = await database();
  const tx = db.transaction("rows");
  const index = tx.store.index(duplicates ? "duplicate" : "kind");
  const key = duplicates ? [id, 1] : [id, kind];
  const total = await index.count(key as [string, number] & [string, string]);
  let cursor = await index.openCursor(
    key as [string, number] & [string, string],
  );
  if (cursor && page > 1) cursor = await cursor.advance((page - 1) * 50);
  const rows: StoredRow[] = [];
  while (cursor && rows.length < 50) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }
  return { rows, total };
}
