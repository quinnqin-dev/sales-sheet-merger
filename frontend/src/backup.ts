import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import { z } from "zod";
import { LocalizedError } from "./i18n-core.ts";
import { database, emptyWorkspace, getLibrary } from "./storage.ts";
import { parse, ruleSchema, validateLibrary } from "./validation.ts";
import type { SourceFile, Workspace } from "./domain.ts";
const manifestSchema = z.object({
  format: z.literal("sheet-merger.full-backup"),
  version: z.literal(1),
  files: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().min(1).max(255),
        size: z
          .number()
          .nonnegative()
          .max(50 * 1024 * 1024),
        encoding: z.enum(["utf-8-sig", "gb18030"]),
        header_rows: z.record(z.number().int().min(1).max(1000)),
        sheets: z
          .array(
            z.object({
              name: z.string().max(255),
              headers: z.array(z.string().max(32767)).max(1000),
            }),
          )
          .max(100),
      }),
    )
    .max(30),
  assignments: z
    .record(
      z.object({
        enabled: z.boolean(),
        confirmed: z.boolean().optional(),
        rule: ruleSchema.nullable(),
      }),
    )
    .refine((v) => Object.keys(v).length <= 3000),
  selectedTemplateId: z.string().max(80).nullable().default(null),
  duplicatePolicy: z
    .enum(["keep-all", "keep-first", "keep-last"])
    .default("keep-all"),
});
export async function exportBackup() {
  const db = await database(),
    library = await getLibrary(),
    workspace = (await db.get("settings", "workspace")) as
      Workspace | undefined;
  const files = [
    ...(workspace?.files ?? []),
    ...(workspace?.pendingImport?.files ?? []),
  ];
  const assignments = {
    ...workspace?.pendingImport?.assignments,
    ...workspace?.assignments,
  };
  const entries: Parameters<typeof zipSync>[0] = {};
  entries["rules.json"] = strToU8(
    JSON.stringify({ ...library, templates: [] }, null, 2),
  );
  for (const template of library.templates)
    entries[`templates/${template.id}.json`] = strToU8(
      JSON.stringify(template, null, 2),
    );
  const job = workspace?.job
    ? await db.get("jobs", workspace.job.id)
    : undefined;
  entries["batch.json"] = strToU8(
    JSON.stringify(
      {
        format: "sheet-merger.full-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        originalFilesIncluded: false,
        resultIncluded: !!job?.output,
        files: files.map((f) => ({
          ...f,
          sheets: f.sheets.map((s) => ({ name: s.name, headers: s.headers })),
        })),
        assignments,
        selectedTemplateId: workspace?.selectedTemplateId ?? null,
        duplicatePolicy: workspace?.duplicatePolicy ?? "keep-all",
      },
      null,
      2,
    ),
  );
  if (job?.status === "done" && job.output)
    entries["result.xlsx"] = [
      new Uint8Array(
        job.output instanceof Blob
          ? await job.output.arrayBuffer()
          : job.output,
      ),
      { level: 0 },
    ];
  const bytes = zipSync(entries, { level: 6 });
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
    name: `sheet-merger-backup-${new Date().toISOString().slice(0, 10)}.zip`,
  };
}
export async function importBackup(file: File) {
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error("size");
    const seen = new Set<string>();
    let size = 0;
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        if (
          seen.has(entry.name) ||
          entry.name.includes("..") ||
          entry.name.startsWith("/")
        )
          throw new Error("entry");
        seen.add(entry.name);
        const use =
          ["rules.json", "batch.json"].includes(entry.name) ||
          /^templates\/[A-Za-z0-9_-]{1,80}\.json$/.test(entry.name);
        if (use) {
          size += entry.originalSize;
          if (entry.originalSize > 8 * 1024 * 1024 || size > 12 * 1024 * 1024)
            throw new Error("size");
        }
        return use;
      },
    });
    const read = (name: string) => {
      if (!entries[name]) throw new Error("missing");
      return JSON.parse(strFromU8(entries[name]));
    };
    const manifest = parse(
      manifestSchema,
      read("batch.json"),
      "backup.invalid",
    );
    if (new Set(manifest.files.map((f) => f.id)).size !== manifest.files.length)
      throw new Error("ids");
    const templates = Object.keys(entries)
      .filter((name) => name.startsWith("templates/"))
      .map(read);
    const library = validateLibrary({ ...read("rules.json"), templates });
    const workspace: Workspace = {
      ...emptyWorkspace(crypto.randomUUID()),
      duplicatePolicy: manifest.duplicatePolicy,
      selectedTemplateId: library.templates.some(
        (t) => t.id === manifest.selectedTemplateId,
      )
        ? manifest.selectedTemplateId
        : null,
      pendingImport: {
        files: manifest.files.map((f) => ({
          ...f,
          sheets: f.sheets.map((sheet) => ({
            ...sheet,
            header_row: f.header_rows[sheet.name] ?? 1,
            row_count: 0,
            blank_count: 0,
            sample: [],
          })),
        })),
        assignments: Object.fromEntries(
          Object.entries(manifest.assignments).map(([key, value]) => [
            key,
            { ...value, confirmed: false },
          ]),
        ),
      },
    };
    // Validate everything before touching saved data, then replace it atomically.
    const tx = (await database()).transaction(
      ["settings", "files", "jobs", "rows"],
      "readwrite",
    );
    await Promise.all([
      tx.objectStore("settings").clear(),
      tx.objectStore("files").clear(),
      tx.objectStore("jobs").clear(),
      tx.objectStore("rows").clear(),
    ]);
    await tx.objectStore("settings").put(library, "library");
    await tx.objectStore("settings").put(workspace, "workspace");
    await tx.done;
    return { library, workspace };
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError")
      throw new LocalizedError("browser.quota");
    throw new LocalizedError("backup.invalid");
  }
}
