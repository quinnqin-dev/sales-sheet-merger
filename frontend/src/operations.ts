import type { Library, Workspace, StoredJob, SourceFile } from "./domain.ts";
import type { SavedTemplate } from "./template-files.ts";
import { OUTPUT_TEMPLATE_EXAMPLE } from "./template-state.ts";
import { LocalizedError, type Locale } from "./i18n-core.ts";
import { inspectFile, validateRule } from "./engine.ts";
import {
  clearData,
  database,
  emptyWorkspace,
  getLibrary,
  getRows,
  putLibrary,
  restore,
  saveWorkspace,
} from "./storage.ts";
import {
  documentSchema,
  emptyLibrary,
  parse,
  ruleSchema,
  templateSchema,
  validateLibrary,
} from "./validation.ts";
import { prepare, preview, runJob, finishExport } from "./processing.ts";

let active = false;
const idle = () => {
  if (active) throw new LocalizedError("merge_running");
};
const id = () => crypto.randomUUID();
async function requireBatch(batch: string) {
  const workspace = (await (await database()).get("settings", "workspace")) as
    Workspace | undefined;
  if (!batch || workspace?.batch !== batch)
    throw new LocalizedError("batch_missing");
  return workspace;
}
async function requireFile(batch: string, fileId: string) {
  await requireBatch(batch);
  const file = await (await database()).get("files", fileId);
  if (!file || file.batchId !== batch) throw new LocalizedError("file_missing");
  return file;
}
const publicJob = ({ output: _, ...job }: StoredJob) => job;
export const operations = {
  bootstrap: async (_: undefined) => restore(),
  saveWorkspace: async (state: Workspace) => saveWorkspace(state),
  createBatch: async (_: undefined) => {
    idle();
    const batch = id();
    await clearData(false, batch);
    return { id: batch };
  },
  clearData: async ({ all }: { all: boolean }) => {
    idle();
    await clearData(all);
    return { library: await getLibrary(), workspace: emptyWorkspace() };
  },
  getConfig: async (_: undefined) => getLibrary(),
  importConfig: async (value: unknown) => {
    idle();
    return putLibrary(validateLibrary(value));
  },
  applyTemplate: async (value: unknown) => {
    idle();
    const template = parse(templateSchema, value);
    return putLibrary({
      ...(await getLibrary()),
      template,
      template_configured: true,
    });
  },
  resetTemplate: async (_: undefined) => {
    idle();
    return putLibrary({
      ...(await getLibrary()),
      template: structuredClone(OUTPUT_TEMPLATE_EXAMPLE),
      template_configured: false,
    });
  },
  validateTemplate: async (value: unknown) =>
    parse(documentSchema, value, "templates.invalidFile"),
  registerTemplate: async ({
    record: value,
    replace,
  }: {
    record: SavedTemplate;
    replace: boolean;
  }) => {
    idle();
    const doc = parse(documentSchema, value, "templates.invalidFile");
    const record = {
      ...doc,
      file_name:
        typeof value.file_name === "string"
          ? value.file_name.slice(0, 255)
          : "",
    };
    const lib = await getLibrary(),
      existing = lib.templates.find((t) => t.id === doc.id);
    if (existing && !replace) {
      if (JSON.stringify(existing) === JSON.stringify(record)) return lib;
      throw new LocalizedError("template_exists");
    }
    if (!existing && replace) throw new LocalizedError("template_missing");
    lib.templates = existing
      ? lib.templates.map((t) => (t.id === doc.id ? record : t))
      : [...lib.templates, record];
    if (lib.templates.length > 100) throw new LocalizedError("template_limit");
    return putLibrary(validateLibrary(lib));
  },
  deleteTemplate: async ({ id }: { id: string }) => {
    idle();
    const lib = await getLibrary();
    if (!lib.templates.some((t) => t.id === id))
      throw new LocalizedError("template_missing");
    lib.templates = lib.templates.filter((t) => t.id !== id);
    return putLibrary(lib);
  },
  saveRule: async (value: unknown) => {
    idle();
    const rule = parse(ruleSchema, value),
      lib = await getLibrary();
    validateRule(rule, lib.template, rule.headers);
    lib.rules = [...lib.rules.filter((r) => r.id !== rule.id), rule];
    if (lib.rules.length > 500) throw new LocalizedError("rule_limit");
    return putLibrary(validateLibrary(lib));
  },
  deleteRule: async ({ id }: { id: string }) => {
    idle();
    const lib = await getLibrary();
    lib.rules = lib.rules.filter((r) => r.id !== id);
    return putLibrary(lib);
  },
  addFiles: async ({ batch, files }: { batch: string; files: File[] }) => {
    idle();
    await requireBatch(batch);
    const db = await database();
    const existing = await db.getAllFromIndex("files", "batch", batch);
    if (existing.length + files.length > 30)
      throw new LocalizedError("file_limit");
    if (files.some((f) => f.size > 50 * 1024 * 1024))
      throw new LocalizedError("file_size");
    const added = files.map((blob) => {
      const fileId = id();
      return {
        id: fileId,
        batchId: batch,
        blob,
        meta: {
          id: fileId,
          name: blob.name,
          size: blob.size,
          encoding: "utf-8-sig",
          header_rows: {},
          sheets: [],
          error: "browser.inspectionInterrupted",
          error_code: "browser.inspectionInterrupted",
        } as SourceFile,
      };
    });
    // Commit original blobs first, so closing the page during inspection retains inputs.
    const tx = db.transaction("files", "readwrite");
    await Promise.all(added.map((f) => tx.store.put(f)));
    await tx.done;
    for (const file of added) {
      file.meta = await inspectFile(file.blob, file.id);
      await db.put("files", file);
    }
    return [...existing, ...added].map((f) => f.meta);
  },
  inspectFile: async ({
    batch,
    id,
    encoding,
    header_rows,
  }: {
    batch: string;
    id: string;
    encoding: string;
    header_rows: Record<string, number>;
  }) => {
    idle();
    if (!["utf-8-sig", "gb18030"].includes(encoding))
      throw new LocalizedError("invalid_config");
    const file = await requireFile(batch, id);
    file.meta = await inspectFile(
      new File([file.blob], file.meta.name),
      id,
      encoding,
      header_rows,
    );
    await (await database()).put("files", file);
    return file.meta;
  },
  removeFile: async ({ batch, id }: { batch: string; id: string }) => {
    idle();
    await requireFile(batch, id);
    await (await database()).delete("files", id);
  },
  preview: async ({
    batch,
    request,
    locale,
  }: {
    batch: string;
    request: unknown;
    locale: Locale;
  }) => {
    idle();
    await requireBatch(batch);
    return preview(await prepare(batch, request), locale);
  },
  startJob: async ({
    batch,
    request,
    locale,
  }: {
    batch: string;
    request: unknown;
    locale: Locale;
  }) => {
    idle();
    const workspace = await requireBatch(batch),
      prepared = await prepare(batch, request);
    const job: StoredJob = {
      id: id(),
      batchId: batch,
      status: "running",
      phase: "",
      phase_code: "phase_converting",
      locale,
      processed: 0,
      total: prepared.total,
      summary: null,
      template: prepared.request.template,
      duplicatePolicy: prepared.request.duplicatePolicy??"keep-all",
      created: new Date().toISOString(),
    };
    const tx = (await database()).transaction(
      ["jobs", "settings"],
      "readwrite",
    );
    await tx.objectStore("jobs").put(job);
    await tx
      .objectStore("settings")
      .put({ ...workspace, step: 5, job: publicJob(job) }, "workspace");
    await tx.done;
    active = true;
    void runJob(job, prepared).finally(() => {
      active = false;
    });
    return publicJob(job);
  },
  retryExport: async ({id}:{id:string})=>{
    idle();const db=await database(),job=await db.get('jobs',id);
    if(!job?.summary||job.status!=='export-failed')throw new LocalizedError('job_incomplete');
    job.status='running';job.phase_code='phase_exporting';await db.put('jobs',job);active=true;
    void finishExport(job).finally(()=>{active=false;});return publicJob(job);
  },
  getJob: async ({ id }: { id: string }) => {
    const job = await (await database()).get("jobs", id);
    if (!job) throw new LocalizedError("job_missing");
    return publicJob(job);
  },
  getRows: async ({
    id,
    kind,
    page,
    duplicates,
  }: {
    id: string;
    kind: string;
    page: number;
    duplicates: boolean;
  }) => getRows(id, kind, page, duplicates),
  exportJob: async ({ id }: { id: string }) => {
    const job = await (await database()).get("jobs", id);
    if (job?.status !== "done" || !job.output)
      throw new LocalizedError("job_incomplete");
    return {
      blob: job.output,
      name: `sheets-merged-${job.created.slice(0, 10)}.xlsx`,
    };
  },
};
export type Operations = typeof operations;
