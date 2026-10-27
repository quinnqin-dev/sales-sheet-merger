import ExcelJS from "exceljs";
import { Decimal } from "decimal.js";
import type {
  RunRequest,
  SourceFile,
  StoredFile,
  StoredJob,
  StoredRow,
  Summary,
  Workspace,
} from "./domain.ts";
import { LocalizedError, translate, type Locale } from "./i18n-core.ts";
import {
  blank,
  convertRow,
  duplicateKey,
  readBook,
  validateRule,
} from "./engine.ts";
import { database, putRows } from "./storage.ts";
import { parse, runSchema } from "./validation.ts";

export async function prepare(batch: string, value: unknown) {
  const request: RunRequest = parse(runSchema, value);
  const files = await (
    await database()
  ).getAllFromIndex("files", "batch", batch);
  if (!files.length) throw new LocalizedError("batch_missing");
  if (files.some((f) => f.meta.error))
    throw new LocalizedError("unreadable_files");
  const keys = new Set<string>();
  let total = 0;
  const selections = request.selections.map((selection) => {
    const key = JSON.stringify([selection.file_id, selection.sheet]);
    if (keys.has(key)) throw new LocalizedError("duplicate_selection");
    keys.add(key);
    const file = files.find((f) => f.id === selection.file_id);
    const sheet = file?.meta.sheets.find((s) => s.name === selection.sheet);
    if (!file || !sheet || sheet.error)
      throw new LocalizedError("sheet_unreadable");
    if (sheet.header_row !== selection.header_row)
      throw new LocalizedError("header_changed");
    validateRule(selection.rule, request.template, sheet.headers);
    total += sheet.row_count;
    return { file, sheet, selection };
  });
  if (total > 100000) throw new LocalizedError("total_row_limit");
  return { request, selections, total };
}
type Prepared = Awaited<ReturnType<typeof prepare>>;
export async function preview(prepared: Prepared, locale: Locale) {
  const rows = [];
  for (const { file, sheet, selection } of prepared.selections) {
    const book = await readBook(
      new File([file.blob], file.meta.name),
      file.meta.encoding,
    );
    for (const row of book.rows(sheet.name)) {
      if (row.row <= sheet.header_row || blank(row.raw)) continue;
      rows.push({
        file: file.meta.name,
        sheet: sheet.name,
        row: row.row,
        ...convertRow(
          row,
          selection.rule,
          prepared.request.template,
          sheet.headers,
          locale,
        ),
      });
      if (rows.length >= 20) return { rows, total: prepared.total };
    }
  }
  return { rows, total: prepared.total };
}
export async function exportWorkbook(job: StoredJob) {
  const db = await database(),
    book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(translate("sheet_details", {}, job.locale), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = job.template.columns.map((c) => ({
    header: c.name.replace(
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    ),
    width: 20,
  }));
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF214C40" },
    };
  });
  // Bounded IDB pages avoid keeping a second copy of all result rows in memory.
  let after = 0;
  while (true) {
    const tx = db.transaction("rows");
    let cursor = await tx.store.openCursor(
      IDBKeyRange.bound(
        [job.id, after],
        [job.id, Number.MAX_SAFE_INTEGER],
        true,
        false,
      ),
    );
    const page: StoredRow[] = [];
    while (cursor && page.length < 1000) {
      page.push(cursor.value);
      cursor = await cursor.continue();
    }
    await tx.done;
    if (!page.length) break;
    for (const row of page) {
      after = row.index;
      if (row.kind !== "valid") continue;
      const output = sheet.addRow(
        row.values.map((value, i) => {
          if (value == null) return null;
          const type = job.template.columns[i].type;
          if (type === "number") return Number(value);
          if (type === "date") {
            const date = new Date(0);
            const [y, m, d] = String(value).split("-").map(Number);
            date.setUTCFullYear(y, m - 1, d);
            return date;
          }
          // Strings, including '=...', are literal strings in ExcelJS.
          return String(value);
        }),
      );
      job.template.columns.forEach((c, i) => {
        if (c.type === "number")
          output.getCell(i + 1).numFmt = "#,##0.############";
        if (c.type === "date") output.getCell(i + 1).numFmt = "yyyy-mm-dd";
      });
    }
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sheet.rowCount, column: job.template.columns.length },
  };
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
export async function runJob(job: StoredJob, prepared: Prepared) {
  const db = await database();
  try {
    const totals: Record<string, Decimal> = Object.fromEntries(
      job.template.columns
        .filter((c) => c.type === "number")
        .map((c) => [c.id, new Decimal(0)]),
    );
    const counts = new Map<string, number>(),
      sources: Summary["sources"] = [];
    let chunk: StoredRow[] = [];
    // Read one source workbook at a time, reusing it for its selected sheets.
    const files = new Map<
      string,
      { file: StoredFile; selections: Prepared["selections"] }
    >();
    for (const entry of prepared.selections) {
      if (!files.has(entry.file.id))
        files.set(entry.file.id, { file: entry.file, selections: [] });
      files.get(entry.file.id)!.selections.push(entry);
    }
    for (const { file, selections } of files.values()) {
      const book = await readBook(
        new File([file.blob], file.meta.name),
        file.meta.encoding,
      );
      for (const { sheet, selection } of selections) {
        const source = {
          file: file.meta.name,
          sheet: sheet.name,
          read: 0,
          valid: 0,
          issues: 0,
          blank: 0,
        };
        for (const row of book.rows(sheet.name)) {
          if (row.row <= sheet.header_row) continue;
          if (blank(row.raw)) {
            source.blank++;
            continue;
          }
          const result = convertRow(
            row,
            selection.rule,
            job.template,
            sheet.headers,
            job.locale,
          );
          const kind = result.reasons.length ? "issues" : "valid";
          const fingerprint =
            kind === "valid" ? duplicateKey(result.values, job.template) : "";
          source.read++;
          source[kind]++;
          job.processed++;
          if (job.processed > 100000)
            throw new LocalizedError("total_row_limit");
          if (kind === "valid") {
            counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
            job.template.columns.forEach((c, i) => {
              if (totals[c.id] && result.values[i] != null)
                totals[c.id] = totals[c.id].plus(String(result.values[i]));
            });
          }
          chunk.push({
            jobId: job.id,
            index: job.processed,
            kind,
            fingerprint,
            duplicate: 0,
            file: file.meta.name,
            sheet: sheet.name,
            row: row.row,
            ...result,
          });
          if (chunk.length === 1000) {
            await putRows(chunk);
            chunk = [];
            await db.put("jobs", job);
          }
        }
        sources.push(source);
      }
    }
    if (chunk.length) await putRows(chunk);
    const groups = [...counts.entries()].filter(([, count]) => count > 1);
    job.summary = {
      read: job.processed,
      valid: sources.reduce((n, s) => n + s.valid, 0),
      issues: sources.reduce((n, s) => n + s.issues, 0),
      blank: sources.reduce((n, s) => n + s.blank, 0),
      duplicate_rows: groups.reduce((n, [, c]) => n + c, 0),
      duplicate_extra: groups.reduce((n, [, c]) => n + c - 1, 0),
      duplicate_groups: groups.length,
      totals: Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [k, v.toFixed()]),
      ),
      sources,
    };
    if (groups.length) {
      const tx = db.transaction("rows", "readwrite");
      let cursor = await tx.store.openCursor(
        IDBKeyRange.bound([job.id, 0], [job.id, Number.MAX_SAFE_INTEGER]),
      );
      while (cursor) {
        if ((counts.get(cursor.value.fingerprint) ?? 0) > 1)
          await cursor.update({
            ...cursor.value,
            duplicate: 1,
            duplicate_group: cursor.value.fingerprint.slice(0, 12),
          });
        cursor = await cursor.continue();
      }
      await tx.done;
    }
    job.phase_code = "phase_exporting";
    await db.put("jobs", job);
    job.output = await exportWorkbook(job);
    job.status = "done";
    job.phase_code = "phase_done";
    // Export and done status commit together. No partial workbook is exposed.
    await db.put("jobs", job);
  } catch (e) {
    job.status = "failed";
    job.output = undefined;
    job.error_code =
      e instanceof LocalizedError
        ? e.code
        : e instanceof DOMException && e.name === "QuotaExceededError"
          ? "browser.quota"
          : "processing_failed";
    job.error_params = e instanceof LocalizedError ? e.params : {};
    try {
      await db.put("jobs", job);
    } catch {
      /* Original running record restores as interrupted if storage is unavailable. */
    }
  }
}
